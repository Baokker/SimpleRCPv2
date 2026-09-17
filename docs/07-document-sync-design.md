# SimpleRCPv2 文档同步设计

状态：讨论稿

更新时间：2026-09-17

本文确定「磁盘 ↔ Yjs ↔ Agent」三方同步的最小实现方案。基线需求文档 [运行系统基线需求](./05-baseline-product-requirements.md) 引用本文作为同步部分的设计依据，落地步骤见 [基线实施计划](./08-implementation-plan.md)。

## 1. 问题陈述

一个项目目录同时存在三类写入者。

1. 浏览器成员通过 Monaco 写入 Yjs 文档，Yjs 再写入磁盘。
2. 共享终端里的命令直接写入磁盘。
3. Agent（OpenCode 子进程）直接读写磁盘，并执行 grep、构建、测试等命令。

真相源只能选一个。如果选 Yjs，Agent 的 grep 和构建命令看到的是过期文件，这正是 open-collaboration-tools 的结构性问题。因此磁盘是唯一真相源，Yjs 是磁盘文本文件的实时投影。

由此得到同步层要解决的两个方向。

- Yjs 到磁盘。成员每次编辑都要尽快落盘，使任意时刻启动的命令都能读到最新内容。
- 磁盘到 Yjs。终端和 Agent 产生的外部写入要实时出现在所有已打开该文件的编辑器中，并且不能破坏其他成员正在进行的编辑。

## 2. 现有实现的两个缺陷

现有同步逻辑在 `apps/server/src/collaborativeDocuments.ts` 的 `reloadPath` 中，两个缺陷都会在 Agent 接入后从偶发变成高频。

### 2.1 回声判据错误

现有代码把磁盘内容与**当前** Yjs 内容比较，相同就认为是自己写出的回声并跳过。问题在于服务端写盘和 watcher 回调之间存在延迟，`awaitWriteFinish` 的 `stabilityThreshold` 就是 100 毫秒，成员在这个窗口内继续打字会让 Yjs 领先于磁盘，判据失效，代码进入覆盖分支，把刚打的字符回滚掉。

时序如下。

| 时刻 | 事件 | 磁盘 | Yjs |
| --- | --- | --- | --- |
| T0 | 成员输入到 `foo` | `foo` | `foo` |
| T1 | 服务端写盘 `foo` | `foo` | `foo` |
| T2 | 成员继续输入 `bar` | `foo` | `foobar` |
| T3 | watcher 回调携带 T1 的写入 | `foo` | `foobar` |
| T4 | 判据 `foo !== foobar` 成立，覆盖 Yjs | `foo` | `foo` |

T4 是一次真实的数据丢失，今天就可复现，不需要 Agent 参与。

同样的自写自检竞态在 jupyter 生态中已有记录。`jupyter-server-documents` 的 issue #320 描述的就是 `save()` 写完文件后释放锁，轮询任务读到新 mtime 与自己记录的旧 mtime 不符，于是把自己的写入判定为外部变化并触发 reload。这说明判据必须锚定「本进程写出了什么内容」，而不是锚定时间戳或对端当前状态。

### 2.2 全量覆盖破坏 CRDT 身份

现有覆盖分支的实现是先 `text.delete(0, text.length)` 再 `text.insert(0, content)`。这会让文件里每一个字符都获得新的 CRDT 标识，后果有三个。

1. 所有在线成员的光标和选区失去锚点，跳到文件开头或随机位置。
2. 基于 `RelativePosition` 的远端光标渲染全部失效。
3. 每次外部写入都往文档里追加一份全文的插入记录，Yjs 更新体积按文件大小增长。jupyter-collaboration 的 issue #243 记录了同一现象，整体覆盖导致 YStore 膨胀，而新用户加入时需要接收完整文档，连接因此变慢。官方给出的方向是对小改动计算 diff 并只应用 diff。

今天外部写入很少，所以这个缺陷不显眼。Agent 每次 run 会产生十几次文件写入，届时它会变成常态。

## 3. 业界做法与可借用的结论

### 3.1 jupyter-collaboration

检测侧使用 mtime 轮询，`file_poll_interval` 默认 1 秒，发现 mtime 与记录不一致就从磁盘重新加载。应用侧直接赋值 `self._document.source = model["content"]`，等价于全量覆盖。

可借用的结论有两条，而且都是反面结论。检测不要依赖 mtime，因为自己的写入会污染判据；应用不要整体覆盖，因为它同时破坏光标与文档体积。

### 3.2 Yjs 官方 API

`Y.Text` 提供 `applyDelta(delta)` 与 `toDelta()`，delta 由 `retain`、`insert`、`delete` 三种操作组成，是把外部字符串变化并入 `Y.Text` 的惯用方式。Yjs 没有内置的 setText-with-diff，社区讨论中反复出现这个需求，公认做法是自行 diff 再转成 delta。

### 3.3 WordPress Gutenberg 实时协作

Gutenberg 在 `fast-diff` 之上加了一个 `diffWithCursor()` 后处理，把 diff 结果偏向用户光标位置。动机是纯字符 diff 在重复字符或重复子串处存在歧义，例如在一串相同字符中间插入一个同样的字符，diff 可以合法地把插入点放在任意位置，从而让相对位置漂移。

这条经验对本项目只部分适用。Gutenberg 的场景是本地编辑器状态与文档状态对齐，有明确的光标可以作为提示。本项目的外部写入来自终端和 Agent，没有对应的光标，因此不引入 `diffWithCursor`。歧义的实际代价被限制在改动区域内部的少量字符上，而改动区域内的光标本来就要移动。

### 3.4 Theia 的 delta 偏移修复

Theia PR 18014 修正了消费 delta 时的偏移计算。delta 需要两个游标，`retain` 同时推进旧文档与新文档，`insert` 只推进新文档，`delete` 只推进旧文档。解析到旧文档坐标时，游标在 `retain` 和 `delete` 上推进，在 `insert` 上不动。方向搞反会让多段 delta 的第二段起全部错位。本项目生成 delta 时要遵守同一套偏移规则。

### 3.5 Differential Synchronization

Neil Fraser 的 Differential Synchronization 用 shadow 副本加模糊补丁解决两端异步收敛。本项目借用 shadow 这个概念，但不需要模糊补丁，因为两端都在同一个 Node 进程内，服务端可以同步拿到磁盘内容与 `Y.Text` 当前内容，不存在需要模糊定位的过期补丁。这一点让实现显著变短。

## 4. 设计

### 4.1 四条不变量

以下四条是同步层的正确性契约，实现和评审都以此为准。

1. **磁盘是唯一真相源，并且永远最新。** Yjs 文档的每次更新都立即写盘，没有 debounce，没有 flush 阶段。任意时刻启动的 grep、构建、测试命令读到的都是成员当前所见内容。
2. **回声抑制以「本进程最近写出的内容哈希」为判据。** 不使用 mtime，不使用「与当前 Yjs 内容相同」。
3. **外部内容并入 `Y.Text` 必须是最小 delta，禁止 `delete(0, len)` 加 `insert`。** 未改动区域的字符标识必须保持不变。
4. **同步层不做语义合并。** Agent 基于过期读取写回属于语义冲突，由 run 级别的并发警告处理，不在同步层解决。

### 4.2 每文件同步状态

基线不保留完整 shadow 副本。diff 的基准直接取 `Y.Text` 的当前内容，回声判据只需要一个有界的哈希环。

```ts
interface FileSyncState {
  /** 本进程最近写出内容的哈希，环形缓冲，容量 8 */
  recentWriteHashes: string[];
  /** 正在写盘，用于串行化同一文件的写入 */
  writing: boolean;
  /** 写盘期间又有新内容，写完后再写一次 */
  dirty: boolean;
}
```

哈希使用 `node:crypto` 的 sha1，输入为待写入的完整文本。sha1 在这里只做相等判定，不承担安全职责。

保留一个环而不是单个哈希的原因是写入可能连续发生。成员快速打字会产生 A、B 两次写盘，watcher 可能只回调一次，也可能回调两次，而回调时读到的磁盘内容既可能是 A 也可能是 B。只记录最后一次哈希时，读到 A 会被误判为外部变化并把 Yjs 回退到 A，随后 Yjs 更新又把 B 写回磁盘，虽然最终收敛但会产生可见抖动。容量 8 的环可以覆盖这种重叠，代价是几十字节。

### 4.3 Yjs 到磁盘

```
document.on("update", (_update, origin) => {
  if (origin === FILESYSTEM_ORIGIN) return;   // 自己刚并入的外部内容，不回写
  void writeThrough(name);
});

async function writeThrough(name) {
  const state = stateOf(name);
  if (state.writing) { state.dirty = true; return; }
  state.writing = true;
  try {
    do {
      state.dirty = false;
      const text = document.getText("content").toString();
      const hash = sha1(text);
      if (state.recentWriteHashes.at(-1) === hash) break;   // 内容没变
      rememberWriteHash(state, hash);
      await writeWorkspaceFile(root, filePath, text);
    } while (state.dirty);
  } finally {
    state.writing = false;
  }
}
```

要点有四个。

- 哈希在写盘**之前**记入环。watcher 回调随时可能到达，晚记会漏。
- `writing` 与 `dirty` 构成同一文件的写入串行化，避免并发 `writeFile` 交错产生截断内容。
- 来自 `FILESYSTEM_ORIGIN` 的更新不触发回写，否则每次外部写入都会立刻引发一次等价内容的回写。
- 没有定时器。`persistDelayMs` 与 `persistTimers` 整体删除。

写穿会把打字压力直接变成写盘压力。单文件写入按内容串行，同一次连续输入的多个字符会被 `dirty` 合并成一次写入，实测量级在每秒几次，对本地文件系统无压力。如果后续在超大文件上观察到问题，正确的处理方式是提高该文件的写入合并粒度，而不是恢复全局 debounce，因为 debounce 会直接破坏不变量 1。

### 4.4 磁盘到 Yjs

```
async function onExternalChange(filePath) {
  const docs = documentsFor(filePath);
  if (docs.length === 0) return;                    // 无人打开，只广播文件树变化

  const result = await readWorkspaceFile(root, filePath, true);
  if (result.status !== "text") { dropPath(filePath); return; }

  for (const { name, document } of docs) {
    const state = stateOf(name);
    const hash = sha1(result.content);
    if (state.recentWriteHashes.includes(hash)) continue;   // 回声，丢弃

    const text = document.getText("content");
    const delta = textDelta(text.toString(), result.content);
    if (delta.length === 0) continue;
    document.transact(() => text.applyDelta(delta), FILESYSTEM_ORIGIN);
  }
}
```

要点有三个。

- 始终**重新读取磁盘当前内容**，不信任 watcher 事件里的任何内容或时间戳。这让多次回调自然幂等。
- 回声判据用 `includes` 查环，而不是比较最后一个。
- `transact` 的 origin 固定为 `FILESYSTEM_ORIGIN`，既让 4.3 能识别并跳过回写，也让客户端可以区分外部变化与成员编辑。

### 4.5 最小 delta 的计算

先裁剪公共前后缀，再对中间段做字符 diff，最后把结果按前缀长度偏移。

```ts
import diff from "fast-diff";

export function textDelta(oldText: string, newText: string): Delta[] {
  if (oldText === newText) return [];

  let head = 0;
  const max = Math.min(oldText.length, newText.length);
  while (head < max && oldText[head] === newText[head]) head += 1;

  let tail = 0;
  while (
    tail < max - head &&
    oldText[oldText.length - 1 - tail] === newText[newText.length - 1 - tail]
  ) tail += 1;

  const oldMiddle = oldText.slice(head, oldText.length - tail);
  const newMiddle = newText.slice(head, newText.length - tail);

  const delta: Delta[] = [];
  if (head > 0) delta.push({ retain: head });
  for (const [op, chunk] of diff(oldMiddle, newMiddle)) {
    if (op === diff.EQUAL) delta.push({ retain: chunk.length });
    else if (op === diff.INSERT) delta.push({ insert: chunk });
    else delta.push({ delete: chunk.length });
  }
  return delta;
}
```

选择 `fast-diff` 而不是自己写前后缀替换，原因是 Agent 的一次写入经常同时改动文件多处。只裁前后缀会把从第一处改动到最后一处改动之间的全部内容当作一段替换掉，中间未改动的几十行照样丢失字符标识。`fast-diff` 给出多段结果，未改动的行保持原标识，光标只在真正改动的位置移动。

`fast-diff` 是从 diff-match-patch 抽出的单文件实现，MIT 许可，无运行时依赖，接口为 `diff(a, b, cursorPos?)`，返回 `[op, text]` 数组，`op` 取 `-1` 删除、`0` 相等、`1` 插入。依赖引入时固定版本号，具体版本在实施阶段确认。

不使用 `diffWithCursor` 的理由见 3.3。前后缀裁剪保留在 diff 之前，作用是把大文件小改动的 diff 输入从整个文件缩到改动附近，避免在大文件上做全量字符 diff。

超大文本兜底。文本长度超过 `SIMPLERCP_SYNC_DIFF_MAX_BYTES`（默认 2 MiB）时跳过 diff，退回一次整体替换并记录一条 warning。这类文件本来就受现有大文件打开确认规则限制，属于边界情况，用可预期的降级替代不可预期的耗时。

### 4.6 watcher 配置修正

`workspaceWatcher.ts` 当前没有 `ignored` 选项，`.git` 与 `node_modules` 全量纳入监听。Agent 执行一次 `pnpm install` 或任意 git 操作会产生数万个事件。必须补上固定噪声路径过滤，与文件树、ZIP 导入使用同一份规则，见 `workspacePolicy.ts`。

`awaitWriteFinish` 保留。它的作用是避免读到写入中途的半个文件；4.2 的哈希环已经消化了它带来的延迟。

### 4.7 文档生命周期

没有成员打开的文件不创建 `Y.Doc`。外部变化只广播一条文件树变更消息，成员打开时按当前磁盘内容初始化文档。这条规则让 Agent 改动一百个文件不会在服务端产生一百个常驻 CRDT 文档。

### 4.8 删除 flushAll

基线需求文档原先要求在 Agent 启动前调用 `flushAll`，把待写的 Yjs 内容刷到磁盘。不变量 1 成立后这个调用没有意义，并且会造成误解，让人以为不调用它磁盘就可能过期。`flushAll` 与 `persistDelayMs` 一并删除。

Agent run 开始前仍需要一个动作，但内容不同。记录本次 run 的起始时间戳以及后续用于并发判定的文件版本，不涉及任何刷盘。

## 5. Agent 过期写入是语义问题

考虑这个时序。

| 时刻 | 事件 |
| --- | --- |
| T0 | Agent 读取 `a.ts`，内容为 V0 |
| T15 | 成员在 `a.ts` 第 40 行手写了一段代码，磁盘与 Yjs 均为 V1 |
| T30 | Agent 基于 V0 生成 V2 并写盘，V2 不含成员在 T15 的改动 |

T30 之后磁盘是 V2，同步层把 V2 并入 Yjs，成员在 T15 的输入消失。这里同步层没有任何错误，它忠实反映了磁盘。丢失发生在 Agent 用过期基准覆盖了文件，属于语义冲突。

无论回声抑制多准确、delta 多精细，都无法恢复 V1 里的那段代码，因为 V2 里根本没有它。因此基线的处理方式是承认并暴露，而不是隐藏。

- run 开始时记录每个路径的内容哈希。
- Agent 写入某路径时，比较该路径当前哈希与记录值。不一致说明期间有成员编辑，在 run 记录上打 `concurrent_change`，并在 trace 与该文件的编辑器标签页显示警告。
- 保留磁盘最终内容，不自动回退，不自动合并。成员看到警告后自行处理。

这条路线的后续演进方向已经清楚，但不进基线。Layer 3 的做法是以 run 内对某路径的首次读取内容作为三方合并的 base，用行级 diff3 把 Agent 改动与成员改动合并，只有真正重叠的行才升级为 `concurrent_change`。它需要从 trace 的文件读取事件中提取 base 快照，并引入一个行级三方合并实现，属于独立增量，接口上不影响本文的设计。

基线不做 diff3 的理由是范围控制。三方合并引入 base 快照管理、冲突标记表示、冲突态 UI 三块新内容，而基线连一次完整的人机协作流程都还没跑通。先让不变量 1 到 4 稳定，再谈合并。

## 6. 失败模式与对策

| 失败模式 | 原因 | 对策 |
| --- | --- | --- |
| 成员输入被回滚 | 回声判据用当前 Yjs 内容 | 哈希环判据，见 4.2 |
| 光标集体跳位 | 全量 delete 加 insert | 最小 delta，见 4.5 |
| Yjs 更新体积随外部写入线性增长 | 同上 | 同上 |
| 自己的写入被判为外部变化 | mtime 判据 | 不使用 mtime，只比较内容哈希 |
| 写盘内容截断 | 同一文件并发 writeFile | `writing` 加 `dirty` 串行化，见 4.3 |
| 外部写入触发等价回写 | 未按 origin 过滤 | `FILESYSTEM_ORIGIN` 跳过回写 |
| Agent 装依赖导致事件风暴 | watcher 缺少 ignored | 补固定噪声路径过滤，见 4.6 |
| Agent 覆盖成员改动 | 过期基准写回 | `concurrent_change` 警告，见第 5 节 |
| 文件被外部删除后编辑器仍可编辑 | 未处理 unlink | `dropPath` 停止持久化并通知客户端 |
| 文本文件被改为二进制 | 未处理类型变化 | 读取结果非文本时 `dropPath` |

## 7. 测试要点

单元测试直接针对上表左列，每条一个用例。

1. 写盘后在 `awaitWriteFinish` 窗口内继续编辑，触发 watcher 回调，断言编辑内容仍在。这是 2.1 的回归测试。
2. 外部写入只改动文件中段，断言改动前后的字符 CRDT 标识不变，可通过 `Y.createRelativePositionFromTypeIndex` 在改动前后解析同一逻辑位置来验证。这是 2.2 的回归测试。
3. 外部写入同时改动文件首尾两处，断言中间段未被替换，delta 段数大于 1。
4. 同一文件连续两次 Yjs 更新，断言磁盘最终内容正确且没有并发写入交错。
5. 外部写入并入后不产生回写，断言写盘次数不增加。
6. `node_modules` 下的文件变化不创建文档也不广播。
7. 文件被删除后停止持久化。
8. Agent run 期间成员编辑同一文件，断言产生 `concurrent_change`。

`textDelta` 是纯函数，适合用属性测试覆盖。随机生成两个字符串，断言把 delta 应用到 `Y.Text` 后 `toString()` 等于目标字符串。

## 8. 引用

- [Y.Text API 文档](https://docs.yjs.dev/api/shared-types/y.text)
- [Yjs Delta 格式文档](https://docs.yjs.dev/api/delta-format)
- [jupyter-collaboration issue #243，OOB 处理与 YStore 膨胀](https://github.com/jupyterlab/jupyter-collaboration/issues/243)
- [jupyter-collaboration issue #245，重复 file loader 导致误报](https://github.com/jupyterlab/jupyter-collaboration/issues/245)
- [jupyter-server-documents issue #320，save 与轮询的自写自检竞态](https://github.com/jupyter-ai-contrib/jupyter-server-documents/issues/320)
- [JupyterLab issue #18699，外部变化检测的需求背景](https://github.com/jupyterlab/jupyterlab/issues/18699)
- [JupyterLab RTC 文档，document_save_delay 与 file_poll_interval](https://jupyterlab.readthedocs.io/en/3.6.x/user/rtc.html)
- [WordPress Gutenberg PR #73699，fast-diff 与 diffWithCursor](https://github.com/WordPress/gutenberg/pull/73699)
- [Theia PR #18014，delta 偏移的双游标规则](https://github.com/eclipse-theia/theia/pull/18014)
- [Yjs 社区讨论，关于 setText 与 diff 的需求](https://discuss.yjs.dev/t/y-text-an-actual-delta-function-that-would-work-with-settext-gettext/2101)
