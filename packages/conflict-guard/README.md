# @simplercp/conflict-guard

这个包保存语义冲突预防所需的纯逻辑。它接收带来源的文本编辑和光标变化，维护编辑批次、活跃变更集以及随他人编辑移动的文本范围，并发出可写入轨迹的事件。

产品目录包含 `model/`、`tracking/`、`semantic/`、`routing/`、`coordination/` 和 `trace/`。服务端负责把 Yjs 事务转换为 `TextEdit`，把事件写入项目元数据目录，并提供查询接口。产品逻辑不依赖 Express、WebSocket 或文件系统；`bench/` 的探针适配器与 `scripts/` 负责命令行文件读写及子进程。

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

规则编号依次为 `same-symbol-concurrent-write`、`type-only-unchanged`、`comment-format-only`、`observability-only`、`equivalent-refactor`、`referenced-symbol-removed`、`runtime-export-removed`、`call-signature-incompatible`、`consumed-return-property-removed`、`interface-required-member-incompatible`、`merge-only-type-error`、`unparsable-side` 和 `semantic-interaction-uncertain`。每条规则保存在 `routing/rules/` 的独立文件。白区返回 `allow`，黑区返回 `lock`，灰区返回 `warn`。服务端在 `rules/full` 模式暂停黑区文件写入，在 `observe` 模式只记录结果，撤回与确认接口返回 409。

`coordination/session.ts` 的 `createSessionCoordinator` 由服务端与回放共同使用。它处理批次判定、当前文件的 `pending-judgement`、冻结范围、判定异常与 T0。进行中的批次一旦触及其他成员活跃修改的相关符号，文件写入立即暂停；删除声明时，批次开始的符号与路径保留到判定完成。单方接口变化在批次结束时登记，依赖方开始相关批次即可收到 T0。

公开箭头函数属性的参数与返回类型纳入外部接口变化。冻结范围随编辑移动，语义索引更新时重新取得当前声明的完整范围。悬空引用通过 TypeChecker 查询导入名称与来源文件，已有本地声明和参数保持自身绑定；引用移除后，动态悬空关系随下一次更新消失。等价重构的临时变量消除仅接受下一条语句直接返回该变量的形式。

变更对的 `revision` 由双方符号 before/after 的 SHA-256 与关系路径确定。有效判定或正在分析的输入首次变化时增加一次；pending 与 stale 期间的连续输入，以及候选临时消失后重新出现，保留当前修订号。行号、时间和无关编辑不影响修订号，双方确认在相同修订号下持续有效。修订改变时清除旧确认，随后恢复原文仍需重新判定。冻结字符范围随每次编辑变换，服务端通过 `/ws` 通知当前范围。

服务端保留有未写入内容、活跃修改、未关闭变更对或暂停写入的同一个 Y.Doc。UndoManager 按成员编号维护，关闭所有连接后仍可撤回。撤回必须改变文本；没有可撤回内容返回 409。外部文件输入使用最近一次写入的 Yjs 快照建立副本，在副本应用磁盘差异后将增量 update 合并到共享文档。

四状态检查使用文件提供者的 `readLib()` 读取 `lib.es2022.d.ts`，单次检查耗时写入 `typecheck.durationMs`。变更对事件包含 `revision`、规则编号、双方符号键和判定证据，阶段 4 可以按事件顺序复现判定。客户端冻结只阻止冻结区域的键入、粘贴和拖放，服务端继续接受 Yjs update，并把越界修改记录为 `freeze_violation`。

## 阶段 4 回放与基准

`replay/` 提供 `VirtualClock`、`MemoryFileProvider`、`replayTrace`、`checkReplay` 和四个 `ZoningPolicy`。主输入为 `doc_open`、`edit`、`cursor`，并支持 `mirror_resync`、文件退出和确认操作。批次关闭、候选关系和分区结果由同一套 tracker、语义索引、分区器和状态机产生。录制的派生事件只用于一致性校验。重同步与服务端共用 `textDiffOps`。

P0 放行全部候选；P1 在首名成员开始修改时锁定其他成员对该文件的输入；P2 在开始修改时锁定两跳内的相关符号；P3 调用 `routing/classifier.ts`；P* 使用探针真值，在批次结束时锁定冲突候选。P1/P2 对另一成员首次输入即记录反事实。文件文本与 lib 由调用者注入，回放不读取系统 lib 文件。批次参数从 `session_start.config` 取得，语义更新合并窗口为 25 毫秒，文件写入防抖为 300 毫秒。

新服务端与合成轨迹记录 `session_start.pairRevisionMode: "judged-input"`，回放使用相同的修订方式。缺少该字段的已有轨迹使用 legacy 方式；一致性校验只在有效的 `revisionKey` 完全相同时接受历史计数差异，并通过 `legacyRevisionMatches` 单独报告。规则、动作、时间、闸门、文件写入和冻结继续核验。

P1 的文件锁包含声明以外的注释和空白修改。P1/P2 的反事实编辑继续维护共享文本坐标，原有成员的编辑所有权保持有效，锁区只限制其他成员。

结果包含判定序列、变更对状态、最终动作、冻结与闸门区间、持久记录及反事实编辑。冻结后的相交编辑记录 `shouldHaveBeenBlocked`，文本继续更新以保留坐标；其后的相应持久记录标记 `counterfactual`，统计不把它计为真实逃逸。

基准生成器位于 `bench/`，通过语义索引在七个业务种子项目中选择声明与调用方，IC、CP、SS、EB、SF 算子修改项目自身代码。`bench:generate` 写出 schema 3 轨迹、项目划分、程序去重统计和哈希；`bench:label` 在真实子进程中对四种状态各执行三次，并运行种子项目测试，保存四类 probe 的原始结果。`bench:prepare` 顺序执行生成与标注。`replay:run` 分别统计安全与冲突变体，按真值定义各指标分母，并保存 Wilson 95% 区间、算子族和 detectability 分组。完全相同的两个变体只统计一次。

```bash
pnpm --filter @simplercp/conflict-guard build
pnpm --filter @simplercp/conflict-guard bench:prepare --seeds bench/seeds --out ../../.test-workspaces/stage-4-small --groups 10 --seed 7 --concurrency 2
pnpm --filter @simplercp/conflict-guard replay:run --dataset bench/datasets/d1-v1 --split dev --policy 'P0,P1,P2,P3,P*' --repeat 2 --out ../../docs/conflict-guard/evidence/checkpoint-a-dev-report
pnpm --filter @simplercp/conflict-guard replay:check ../../docs/conflict-guard/evidence/stage-4-live-traces/call-signature.jsonl
pnpm --filter @simplercp/conflict-guard bench:import-greylock --source ../../../collaboration-tools
```

回放结果只使用虚拟时间；报告的 `timing` 保存命令行实际耗时。`--repeat` 检查每个变体的逐字节确定性；去掉 timing 后，同一输入、配置和种子产生相同结果。`replay:check` 比较判定、闸门、文件写入与冻结事件；文件写入在各文件内比较顺序与文本哈希。没有录制判定时返回 `checked:false, valid:false`。类型检查跳过按轨迹记录重现，缺少记录时标记 `timeoutSimulation: unavailable`。

真实界面回放命令为 `pnpm --filter @simplercp/conflict-guard replay:ui --server http://127.0.0.1:3000 --project <id> --trace <file> --speed 2 --hold 15000`，包命令转发到服务端 CLI。它注册 `Replay <memberId>` 成员，重置初始文件，通过真实 presence 与 Yjs 连接发送编辑和光标。最后等待批次判定并保留连接，随后释放连接。第三位成员可以观察输入、冻结与冲突卡片。请使用独立的演示项目执行文件重置。

种子项目、算子与标签定义见 `docs/conflict-guard/benchmark.md`，真实轨迹、界面验收与开发集结果保存在 `docs/conflict-guard/evidence/stage-4-*`。

## 阶段 5 灰区研判

`adjudication/` 定义 `FastJudge` 与 `DeepJudge` 两个角色。适配器通过名字注册，HTTP 使用注入的 fetch；Jev 固定 `jev-1.13.0`，DeepSeek 使用配置中的模型并在 T1 关闭 thinking。`openai-compatible` 使用相同深判输出格式。白区与黑区由本地规则决定，只有灰区进入角色接口。

| 策略 | 灰区处理 |
|---|---|
| G0 | warn |
| G1 | 深判 |
| G2 | 快判 |
| G3 | 快判；置信度低于阈值、lock 或失败时升级深判 |
| G4 | T1 使用配置的 G2 或 G3 |

`buildAdjudicationInput` 供产品与回放共同使用，包含双方符号 before/after、参与者种类、关系路径、本地排除规则与类型检查结果。`extractInvariants` 从入边选取至多三个调用点，按与另一侧符号的距离排序，补充函数签名、调用行前后各三行、测试名称及断言、修改前注释与返回值用法。调用与测试引用通过索引的 `referenceTargets` 使用 TypeChecker 查询目标声明，支持同名方法、import 别名和匿名 default 声明；索引包含 `.mjs` 与 `.cjs` 测试。文本字段上限为 3000 字符，`invariants:false` 可以关闭这部分上下文。

`createAdjudicationService` 合并相同输入的并发角色请求。输入、角色、适配器、模型版本、提示词全文、端点、temperature、reasoning 与截止时间共同形成 SHA-256 缓存键。取消一个订阅者保留其他订阅者的请求，最后一个订阅者取消时中止 HTTP。缓存读取与整个级联过程均受 8000 ms 时间预算限制。失败、超时与无效格式在 T1 返回 warn，模型结果通过 `PairCoordinator` 的修订号检查生效。

灰区等待期间状态为 `analyzing`，相关区域标黄、文本同步继续、文件写入暂停；超过 2000 ms 推送分析进度。结束后复用通知、冻结与卡片。接口统计包含角色调用、缓存命中、升级比例、完整研判延迟、失败与费用。`provider_call` 只保存版本、输入哈希与结果元数据。

`live` 直接调用；`record` 保存经过脱敏的输入和原始响应；`replay` 只读取 `bench/model-cache/`，未命中返回失败。录制文件使用权限 0600，缓存内容经过结构验证。凭据与对象属性名中的敏感值都经过脱敏。`subscriptions()` 与 `onSubscription` 提供每个订阅者各自的等待状态，离线服务通过 `recordedSubscriptions` 恢复该状态。订阅者超时只影响自己的研判，共享响应缓存保留完整结果。

```bash
pnpm --filter @simplercp/conflict-guard data:artifacts --dataset bench/datasets/d1-v2 --restore
pnpm --filter @simplercp/conflict-guard replay:run --dataset bench/datasets/d1-v2 --policy G1,G2 --provider-mode record --cache bench/model-cache/checkpoint-b-round1
pnpm --filter @simplercp/conflict-guard adjudication:calibrate --dataset bench/datasets/d1-v2 --record ../../docs/conflict-guard/evidence/checkpoint-b-dev-report/real-round1/results.json.gz
pnpm --filter @simplercp/conflict-guard replay:run --dataset bench/datasets/d1-v2 --policy G3 --threshold 0 --provider-mode record --cache bench/model-cache/checkpoint-b-calibrated
```

`adjudication:verify` 按录制报告中已有的模型策略执行三轮重放，支持只录制 G3 的报告。完整录制配置保存为 `adjudication-config.json`，适配器与模型版本保存为 `adjudication-models.json`，订阅记录保存为 `adjudication-subscriptions.json`，通过 `replay:run --config <file> --models <file> --subscriptions <file>` 使用。重放使用录制的模型版本；报告的 `model.httpCalls` 记录实际 HTTP 调用数，`model.calls` 保存共享请求事件，`model.subscriptions` 保存各订阅者的完成状态与等待时间。离线重放不要求存在 `.env` 文件。已有报告缺少订阅记录时继续使用响应缓存。

阈值、价格、完整提示词和配置见 `docs/conflict-guard/adjudication.md`。阶段五命令只读取开发集；保留集留至正式评价。模型录制用于离线确定性回放，实际服务端取消与截止时间另由集成及浏览器测试验证。

快判与深判适配器均可按配置注册。`openai-compatible` 快判从三个单词的 logprobs 计算条件概率；端点不提供概率时，以 temperature=1 执行配置次数的独立单词采样。temperature=0 的能力检查响应不参与采样概率，其 token 仍计入使用量。当前 D1-v2 使用八个独立业务项目与 200 个关系组，开发集 75 组；相似度、站点检查和来源见 benchmark.md。模型报告包含 P*、逃逸、token、真实三轮重复、McNemar/Holm 和关系组 bootstrap。合成轨迹的冻结人秒按编辑结束截断，另报无人处理上界。

## Agent T2 与 T3

`coordination/agentGuard.ts` 提供纯逻辑的 `evaluateAgentChanges`、`mergeAgentProposal`、`selectAgentReverts`。提案使用相同的语义索引、候选对、分区器与状态机；共享文本合并保留其他区域的修改，删除符号保留依赖边。T3 使用当前共享视图，以 Agent 实际修改过的符号限定检查范围。撤回按完整行比较三个版本，其他参与者继续修改过的块返回 skipped。

tracker 接受 Agent 参与者并维持其活跃变更集至 run 结束。候选支持人与 Agent、两个 Agent。会话干预对人与人的行为保持原有规则；Agent 的 T2/T3 记录使用独立时点编号，人的编辑区域不因 Agent 检查冻结。

G4 在 T2/T3 分别使用 `t2Strategy`、`t3Strategy`，默认 G1；时间预算分别为 30000、60000 ms。`t2Reasoning`、`t3Reasoning` 默认 false，时点与 reasoning 进入角色输入哈希。失败与无效格式在 Agent 检查中使用 lock。

权限事件解析、审批回复、计时暂停、批准写入归属、文件恢复、界面通知由服务端负责。配置与使用限制见 `docs/conflict-guard/agent-guard.md`，真实调用及回归结果见 `docs/conflict-guard/stage-6.md`。

## 意图与属主仲裁

`coordination/intents.ts` 管理计划、实际范围、任务修订与相关协作者上下文；`arbitration.ts` 提供纯函数 `arbitrate`；`ownerCards.ts` 管理双方采纳、让路、超时与打扰统计。默认 owner 模式按属主关系处理，all-human 与 all-auto 提供实验对照。意图注入可以独立关闭。

服务端通过项目 Y.Map 同步意图。跨属主相关审批等待双方处理；建议由深判角色生成。T3 采纳后调用真实 Agent 追加执行并再次检查。同属主后到 Agent 自动等待前者结束，最多两次。人的编辑在默认模式下继续。

```bash
pnpm --filter @simplercp/conflict-guard bench:validate-d3
pnpm --filter @simplercp/conflict-guard bench:agents --dataset d3 --injection on --repeat 3
pnpm --filter @simplercp/conflict-guard replay:agents --trace <trace.jsonl> --out <directory> --arbitration owner,all-human,all-auto --repeat 3
```

D3-v0 包含十个跨属主任务对、三个同属主任务对及各自 node:test 验收。真实运行次数上限为四十，预算存储在忽略的工作目录；批量命令对每个任务对使用独立项目。临时文件使用仓库 `.test-workspaces/`。阶段七冒烟只选择三个跨属主任务对，分别开启和关闭注入。
