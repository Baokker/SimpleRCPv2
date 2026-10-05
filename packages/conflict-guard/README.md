# @simplercp/conflict-guard

这个包保存语义冲突预防所需的纯逻辑。它接收带来源的文本编辑和光标变化，维护编辑批次、活跃变更集以及随他人编辑移动的文本范围，并发出可写入轨迹的事件。

目录包含 `model/`、`tracking/`、`semantic/`、`routing/` 和 `trace/`。服务端负责把 Yjs 事务转换为 `TextEdit`，把事件写入项目元数据目录，并提供查询接口。包不依赖 Express、WebSocket 或文件系统。

`ConflictGuardTracker` 的时间通过 `ConflictGuardClock` 注入，包含 `now`、`setTimeout` 和 `clearTimeout`。默认阈值是批次空闲 1.5 秒、光标离开范围 3 行、批次最长 5 秒、活跃变更集空闲 10 分钟。阶段 4 可以使用虚拟时钟驱动相同的追踪逻辑。

当前产生 human、filesystem 和 unknown 来源。`batch_closed` 触发符号映射，`getActiveChangeSets()` 返回当前状态快照，其中变更文件包含基线文本、范围与 `SymbolChange`。

范围使用字符位置。其他参与者在本人范围内部插入文本时，范围的结束位置会向后移动；替换操作与重叠删除会按照当前文本变换范围。符号映射保留这些边界语义。

## 语义索引

`createSemanticIndex({ files, now })` 接收同步 `SemanticFileProvider`，提供 `listFiles()`、`readFile(path)`、`version(path)`。`now` 返回用于测量耗时的毫秒时间。索引使用 TypeScript LanguageService 与 `noLib: true`，按版本缓存 ScriptSnapshot。`update()` 建立全部符号和关系，`update(changedFiles)` 更新修改文件与直接引用者，包括经过重导出的引用。新增文件满足此前未解析的 import 时也更新引用者。文件系统由服务端提供，回放可以使用内存文件提供者。

索引处理 `.ts`、`.tsx`、`.js`、`.jsx`、`.mts`、`.cts`，排除 `node_modules`、`.git`、`dist`、`build`、`coverage`。相对路径排序后取前 2000 个文件，`stats().truncated` 报告是否超过上限。

索引同时记录表达式推断类型所引用的声明文件，包含 union、intersection、generic 参数、mapped type 参数及继承来源。被引用类型新增属性时，其使用者会重新计算关系。文件列表变化后刷新声明节点，保留当前 Program 与符号映射的对应关系。`UpdateStats.files` 记录本次重新计算符号或关系的文件数；`full` 表示是否通过不指定 changedFiles 的调用建立全量索引。

符号键使用 `相对路径#容器.名字`，例如 `src/cart.ts#Cart.total`。同容器重名按声明顺序加 `@2`、`@3`，包含重载及 getter/setter。函数、类、方法、属性、accessor、接口、类型别名、枚举与模块变量都有字符范围与从 1 开始的行号。`symbolsInRange` 取范围内最内层声明。

`outgoing`、`incoming` 支持双向关系查询。关系种类为 `call`、`value-reference`、`type-reference`、`inheritance`、`implementation`、`state-read`、`state-write`、`contains`、`override`、`implements-member`，`via` 保存经过的重导出文件。`contains` 用于类与成员的直接嵌套关系，路径搜索默认跳过它；类与成员分别修改时由候选层按距离 0 处理。`findPaths(fromKeys, toKeys, maxHops = 2)` 对每个符号组合返回一条最短路径，每一跳记录种类与方向，并设置 `typeOnly` 表示所有跳都是类型关系；同符号返回零跳路径。

## 符号变更与候选对

`mapSymbolChanges` 使用成员首次修改文件时的 `baseText` 和本人活跃范围，生成 `modified`、`added`、`deleted` 的 before/after。基线仅由 `ts.createSourceFile` 解析。批次关闭时才解析删除操作；改名时按本批次新旧符号集合补充旧键的 `deleted` 状态。文本相同的符号不参与候选生成。

`SemanticChangeTracker.update(changeSets, closedBatches)` 更新符号及候选对。两位人类成员的符号在两跳内有关联时，按成员与符号键生成稳定 SHA-256 编号。距离 0 的 `path` 为 `null`，其他距离保留路径。符号文本、状态或路径变化更新候选，活跃符号结束或关系消失关闭候选。`getCandidatePairs()` 按更新时间倒序返回当前候选，`onEvent()` 发出 `change_unit` 和 `pair_candidate_opened/updated/closed`，供后续规则处理使用。

一个包含有效符号变化的人类关闭批次计为一个变更单元，单元只使用该批次的范围和文本；候选对仍使用成员当前活跃变更中的累计符号。`statistics()` 的 `total` 是会话累计单元数，`related` 是曾经形成候选的单元数，`unrelated` 为两者之差，`unrelatedRatio` 为比例，`typeOnly` 是当前仅类型关系候选数量。恢复为基线且没有符号净变化的批次不产生 `change_unit`。删除或改名符号的旧关系在活跃变更集期间保留为 `stale` 边。

## 阶段 3 分区与协调

`routing/classifier.ts` 提供纯逻辑 `classify(ZoneInput)`。规则按固定顺序返回 `white/allow`、`black/lock` 或 `grey/warn`，结果同时返回双方 `contractChanged`。`routing/typecheck.ts` 使用同一个 TypeScript LanguageService 检查 baseline、leftOnly、rightOnly、merged 四个状态，只记录合并状态新增的诊断，单次检查超过 500 毫秒返回跳过原因。`coordination/pairState.ts` 管理 `pending → judged → stale → judged` 和 `resolved/closed` 状态，保存修订号、判定、双方确认状态与冻结时间。

规则编号依次为 `type-only-unchanged`、`same-symbol-concurrent-write`、`comment-format-only`、`observability-only`、`equivalent-refactor`、`referenced-symbol-removed`、`runtime-export-removed`、`call-signature-incompatible`、`consumed-return-property-removed`、`interface-required-member-incompatible`、`merge-only-type-error`、`unparsable-side` 和 `semantic-interaction-uncertain`。白区返回 `allow`，黑区返回 `lock`，灰区返回 `warn`。服务端在 `rules/full` 模式将黑区符号行交给写盘闸门，在 `observe` 模式只记录结果。

四状态检查使用文件提供者的 `readLib()` 读取 `lib.es2022.d.ts`，单次检查耗时写入 `typecheck.durationMs`。变更对事件包含 `revision`、规则编号、双方符号键和判定证据，阶段 4 可以按事件顺序复现判定。客户端冻结只阻止冻结区域的键入、粘贴和拖放，服务端继续接受 Yjs update，并把越界修改记录为 `freeze_violation`。
