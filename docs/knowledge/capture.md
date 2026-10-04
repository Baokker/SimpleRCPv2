# 协作事件捕获与回放

## 规范化事件 schema 1

`packages/knowledge/src/capture/events.ts` 定义事件，`isCaptureEvent` 校验字段和坐标。每条事件包含 `schemaVersion: 1`、`type`、毫秒时间 `at` 和严格递增的 `seq`。

| type | 字段 | 坐标与来源 |
| --- | --- | --- |
| `docOpen` | `file`, `text` | 初始工作区扫描与准备 Y.Doc 时记录全文。 |
| `edit` | `file`, `actor`, `ops`, `revisionAfter`, `textBefore`, `textAfter` | `ops` 使用修改前文本的 UTF-16 索引，按 `start` 排序且互不重叠。每项为 `{ start, deleteCount, insertText, deletedText }`。 |
| `cursor` | `memberId`, `file`, `position`, `selection` | 行与字符均从零开始。每名成员的 200 ms 窗口保留最后一次光标消息。 |
| `chat` | `messageId`, `authorId`, `kind`, `text`, `mentions` | `kind` 为 `member`, `agent`, `system`。捕获只统计成员消息。 |
| `fileExternal` | `file`, `change`, `textBefore`, `textAfter`, `hasDocument` | watcher 提供添加、变化与删除事件。全文使回放能够处理没有 Y.Doc 的文件。 |
| `docRetired` | `file` | 文档销毁、文件停用时结束检查点并清除归属区间。保留已知文件文本供引用搜索。 |
| `memberPresence` | `memberId`, `action`, `file`, `previousFile` | 加入、离开、切换文件；离开与切换文件同时结束光标停留。 |

服务端 `attribution.ts` 使用 WebSocket 身份映射识别 `transaction.origin`。y-websocket 2.1.0 的 `readSyncMessage` 把连接对象传给 Yjs 作为 origin。文件系统更新以 `FILESYSTEM_ORIGIN` 标识；其他来源记录为 `unknown`。每个 Y.Text 维护修改前文本镜像，使用 `event.delta` 计算 ops，并与 `toString()` 校验；不一致时记录 `mirror_resync` 并重新提供 `docOpen`。

事件写入项目元数据目录的 `knowledge/events.jsonl`，目录与工作区分开。`KNOWLEDGE_RECORD_EVENTS` 默认开启。`.env` 文件不参与捕获；已配置的 API key 用等长星号替换，必要时重新计算脱敏文本的 ops，保持回放的文本一致性。事件、模型统计和卡片均不读取环境变量集合。

## 时钟与检查点

`engine.ts` 使用注入的 `CaptureClock`，内部不调用 `Date.now()` 或 `setTimeout`。线上适配层推进 `VirtualCaptureClock` 并安排下一次期限；离线回放使用同一个时钟与引擎。期限与事件同一时刻时，先执行期限回调，再处理事件；多个期限以注册顺序执行。

成员停止编辑 30 秒、切换文件或离开时建立检查点。每名成员、每个文件保存独立的前一次检查点文本。自动持久化回调不构成检查点。配置由 `defaultCaptureEngineConfig` 提供，完整配置保存为相邻的 `capture-config.json`。重新启动会恢复事件历史和 Inbox；同一录制文件要求配置保持一致，配置不一致会报告错误。

## 触发阈值与证据

| 触发 | 条件 | 冷却 | 证据 |
| --- | --- | --- | --- |
| `todo.cleared` | 检查点之前存在 TODO/FIXME/HACK，之后数量为零 | 成员与文件 5 分钟 | 标记行、前后变化、相关行范围。 |
| `magicNumber.added` | TS/JS 检查点新增至少三个数字的数字字面量，当前行与上一行没有注释 | 成员与文件 2 分钟 | 数字、代码行、其他已记录文件中的出现位置。TypeScript scanner 识别数字、字符串和注释。 |
| `dependency.changed` | `package.json` 的 dependencies/devDependencies/peerDependencies/optionalDependencies 名称存在增删 | 默认 0 ms，可配置 | 依赖增删、前后变化、其他文件的引用。版本变化保持名称时不触发。watcher 的变化注明 `filesystem`。 |
| `rollback.detected` | 净删除超过 500 字符或 20 行，5 分钟内恢复某次大删除之前的 SHA-256，中间内容发生变化 | 文件 5 分钟 | 删除前后摘要、净删除数量、恢复文本、删除者与恢复者。保留窗口内多个删除候选。 |
| `chat.dense` | 5 分钟内至少 11 条成员消息 | 项目 5 分钟 | 窗口消息、参与者、主要发言者；等待 1 分钟收集讨论之后的代码活动，生成候选锚点。 |
| `edit.overwritten` | 成员删除另一名成员 10 分钟内写入的内容，删除超过 3 行或当前归属区间组的一半 | 无序成员对与文件 5 分钟 | 原始文本与时间、删除文本、改写、时间间隔、两人的聊天和最近光标。 |

阈值、窗口、冷却和共现权重均在配置对象中。检查点与序列判定调用共享的 `shouldTriggerCapture`。尚未完成的 `package.json` 在后续有效文本检查点继续处理。

工作区扫描复用 `workspacePolicy` 的忽略规则，跳过符号链接与 `.env`，读取支持的文本文件。扫描结果以 `docOpen` 录制；引用搜索只使用录制的文本，返回最多 40 个位置，保证离线计算使用相同输入。

## 编辑归属与覆写

`AuthorshipIndex` 保存 `{ actor, start, end, at, text, groupId, originalText }`。每次编辑先检查被删除的归属区间，再从后向前变换全部区间的位置，最后登记本次插入。插入区间内部会把已有归属分成两个区间；删除覆盖的区间被移除，保留的文本继续属于原成员。每个插入组的删除比例使用修改前仍然存在的字符数量作为分母。

`filesystem` 与 `unknown` 更新参与位置变换，保持成员编辑归属的位置正确。覆写触发要求改写者和原作者均为成员且身份不同。30 分钟以前的区间在后续编辑时清理。服务端始终按平台原有流程接收 Yjs update。

## 共现锚点

推断窗口从首条讨论消息之前 2 分钟开始，到达到聊天触发阈值之后 1 分钟结束。对发言成员的光标停留与编辑范围按文件、每 20 行一组聚合：

`score = 停留秒数 × 1 + 编辑字符数 × 0.02 + 涉及发言者人数 × 2 + 文本匹配奖励`

聊天提及文件路径或文件名、候选代码中的 identifier、反引号代码片段时，每类匹配奖励为 3。编辑范围跨越多个行组时平均分配编辑得分。光标移动、切换文件和离开会结束上一位置的停留。结果按得分降序、文件名和起始行排序，返回前三项 `{ file, startLine, endLine, score, reasons }`，行数从一开始。

聊天多选调用同一个 `engine.infer`。建议行范围可以在草稿确认界面选择；选择后由阶段二服务生成快照、指纹及可用的 Yjs 相对位置。候选范围在确认前需要人工核对，代码后续变化可能改变行号。

## Inbox、去重与模型

每条建议原子保存到 `knowledge/inbox/<id>.json`。状态为 `open`、`accepted`、`discarded`、`merged`。成员默认读取自己的建议，也可以读取全部建议。通知只发送给 `actors.memberIds`。`seenBy` 保存每名成员的读取状态；阅读 Inbox 清除自己的未读数，已经阅读或处理的建议不再弹出推迟提示。

创建建议时，使用证据摘要、证据文本和文件路径查询可见的 `reviewed` 卡片。多成员建议只检查共同可见的团队卡片；只有一名成员时可以检查其个人卡片。文件系统建议检查团队卡片。最高得分达到 0.8 时记录 `dedupe`。合并在原卡片追加 `recurrence`，增加 `usage.recurrenceCount`，同一 suggestion id 的复现记录保持唯一。

接受使用 `extractKnowledgeCardDraft` 的确定性草稿。AI 草稿通过已有 OpenAI compatible HTTP 客户端调用配置的模型。卡片以 `draft` 保存，`provenance.origin` 为 `human-human`，保留 suggestion id、聊天 id、文件与 revision。覆写作者默认为改写者；聊天作者默认为发言最多的成员，同次数按成员 id 排序。确认界面可以修改作者、内容、作用域与选择候选锚点。

同一建议的并发处理返回 `409`，完成后持久状态阻止重复处理。模型请求失败继续报告错误，建议保留在 Inbox。`llm-calls.jsonl` 记录模型、耗时、累计 token、尝试次数、是否完成、是否使用确定性草稿及每次提示词的 SHA-256。日志不保存完整提示词。确认日志记录 `editedBeforeConfirm` 和打开编辑器到确认的 `durationMs`。

## 风险提醒与打扰控制

默认风险文件为 `package.json`、`tsconfig*.json`、`vite.config.*`、`.eslintrc*`、`Dockerfile`、`docker-compose*.yml` 和 `.github/workflows/*`。配置检查点以文件路径和前后变化搜索该成员可见的已确认 `risk`、`negative`、`constraint` 卡片。lexical 得分阈值为 1，vector 阈值为 0.8；按成员与文件、成员与卡片分别冷却 5 分钟。提醒提供卡片链接。

`NotificationPolicy` 记录最近 30 秒的编辑、光标和文件切换。至少 8 次编辑或 20 次活动，且最后活动距离当前不足 5 秒时，提示推迟 5 秒重新检查；未读数立即更新。每名成员滚动一小时最多弹出 4 条提示，超过上限的建议和风险提醒保留在 Inbox。`knowledge_notification` 记录 `popup`、`deferred` 或 `limit`，供实验统计。风险提醒的读取状态保存为 `knowledge_warning_read`。重新启动时从活动日志恢复小时提示次数与风险冷却时间。

## 离线回放

在仓库根目录运行，传入事件文件的绝对路径：

```bash
pnpm --silent --filter @simplercp/knowledge replay /absolute/path/events.jsonl > artifacts/replayed-suggestions.jsonl 2> artifacts/replay-counts.json
```

CLI 自动读取事件文件旁的 `capture-config.json`。stdout 为建议 JSONL，stderr 为触发计数。可以追加 `--end-at <毫秒时间>` 指定录制会话结束时间；默认推进到最后事件之后的检查点/聊天期限。`replayEvents(events, config, endAt)` 同时可供实验脚本直接调用。

K1 的输入是规范化协作事件。人工点击创建的聊天建议、卡片去重结果、成员的 Inbox 操作与模型草稿是服务端处理结果；引擎回放比较自动建议的类型、时间、参与者和候选锚点。录制文件包含协作代码与聊天，实验数据应使用项目元数据目录保存。
