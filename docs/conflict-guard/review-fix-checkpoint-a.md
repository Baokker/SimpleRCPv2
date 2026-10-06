# 检查点 A：产品、基准与回放验证

仓库分支为 `feature/conflict-guard`。服务端时序回归使用真实 `createApp`、导入项目及 `WebsocketProvider`，批次空闲阈值为 1500 ms，文件写入等待为 300 ms。浏览器验收操作两个独立上下文、Monaco、Yjs 与共享文件，并通过 `cat` 核验磁盘文本。

## P 组

| 编号 | 实现位置与行为 | 对应生产参数测试 |
|---|---|---|
| P1 | `collaborativeDocuments.ts` 固定具有未写入文本、活跃变更、冻结或者未关闭变更对的 Y.Doc，文档与 Undo 历史共同保留。`projectConflictGuard.ts` 以稳定成员 origin 维护 Undo；撤回必须改变文本，候选仍存在时按重判结果处理。变更对关闭后同步刷新闸门并补写。 | `P1 锁定期间全部连接关闭后保留文档与成员 Undo 历史`；`P1 切换文件后撤回确实恢复原文件并补写另一成员内容`；`P1 结束活跃修改后关闭变更对并立即恢复写入`；`P1 已完成文档释放并重新打开后撤回新一轮修改` |
| P2 | `coordination/session.ts` 在编辑发生时查询当前文件的批次符号与其他成员活跃符号，未判定关系阻挡写入；删除声明保留批次开始时的关系。服务端编辑后防抖更新索引，批次关闭时完整更新。已判白区的文件保持独立。 | `P2 先后编辑在判定前和判定后保持调用方磁盘内容`；`P2 白区文件允许写入并且不受其他文件持续输入影响`；`P2 删除被引用导出时等待判定期间保持磁盘原文`；阶段 3 双方编辑场景 |
| P3 | `collaborativeDocuments.ts` 保存每次写入对应的完整 Yjs update。外部变化在该副本文档上执行，再按元素生成 update 合并到主文档。阻挡期间的外部输入记录 `persist_conflict`。 | `P3 外部输入在开头中间末尾通过 Yjs 元素合并并记录冲突` |
| P4 | `routing/candidates.ts` 的 revisionKey 仅包含双方符号 before/after 哈希及关系路径；`coordination/pairState.ts` 只在该键变化时推进 revision。确认结果按相同 revisionKey 保存，灰区同一 revision 只判定一次。 | `P4 P6 区域外插入即时移动冻结行号且保留双方确认`；包内 `只在符号内容或关系路径变化时增加修订号`、`灰区同一修订只计算一次`、`双方确认的修订在变更对关闭后重新出现时继续有效` |
| P5 | `projectConflictGuard.ts` 拒绝 observe 下的确认与撤回。rules/full 下要求当前变更对为 judged(lock)，其他状态返回 409；被拒绝的操作不写 ui_action。 | `P5 拒绝观察模式下确认和撤回并保持内容`；生产场景中的确认、撤回请求 |
| P6 | `coordination/session.ts` 在每次编辑后变换冻结字符范围，API 用当前镜像计算行号。`realtime.ts` 推送版本通知，`App.tsx` 立即读取冻结与卡片状态，并排除过期响应。 | `P4 P6 区域外插入即时移动冻结行号且保留双方确认`；真实浏览器冻结拦截及重新打开文件场景 |
| P7 | `routing/candidates.ts` 将活跃 deleted 符号的旧入边与新写入的旧名称引用连接，边包含 dangling 标记。新增引用继续参与路径查询与 runtime-export-removed。 | `P7 新增旧名称引用仍与已改名导出形成黑区关系`；生产参数删除导出场景；开发集 IC-4 |

上述 P 组测试位于 `apps/server/src/__tests__/conflictGuardCheckpoint.integration.test.ts` 与 `conflictGuardScenarios.integration.test.ts`。两个文件各有十一项测试。

### P 组变异检验

每项变异使用文件编辑工具执行，运行对应测试后恢复产品实现。日志保存到 `evidence/checkpoint-a-tests/`。

| 编号 | 实际检验的变异 | 检测到的失败 |
|---|---|---|
| P1 | `shouldDeferRelease()` 恒为 false | 全部连接关闭后重新打开，未写入文本丢失，文档内容断言失败。 |
| P2 | 删除 session 的 pending-judgement 闸门分支 | 第二名成员修改后的 500 ms 时，磁盘已包含新文本，原文断言失败。 |
| P3 | 将磁盘差异直接施加到主 Y.Text | 文件末尾追加文本进入声明内部，合并文本断言失败。 |
| P4 | 候选指纹包含完整 SymbolChange，含行号与时间 | 区域外插入使 revision 从 0 增至 1，revision 与确认保持断言失败。 |
| P5 | 删除 observe 模式动作检查 | 撤回返回 204，预期为 409。 |
| P6 | 停止变换冻结字符范围 | 区域外插入后，等待新冻结行号的断言超时。 |
| P7 | 删除 dangling 边生成 | 新写入旧名称引用后，无法得到 runtime-export-removed，判定等待超时。 |

## M 组

| 编号 | 实现与验证 |
|---|---|
| M1 | 七个种子项目各有七个源文件、两份 Node 测试；AST 与 semantic index 选择项目自身的被依赖声明和调用方。60 个关系组产生 88 个非 alias 样本、225 个完整状态程序、87 个四状态组合。开发集两个项目共 18 组，保留集五个项目共 42 组，程序交集为零。SS、EB 两个完整算子族只属于保留集。manifest 报告项目、算子和去重数量。 |
| M2 | `replay/metrics.ts` 使用 lock、allow、lock 或 warn 的分别对应分母；提示包括 warn、lock、T0。本地决定以变更对计数，P0/P1/P2/P* 为 N/A。冻结区间按解除或活跃变更结束关闭，成员重叠区间合并。卡片按 pairId:revision 去重，频率时长为第一次至最后一次编辑。增加 P*、孪生分别计数、重复程序去重、触发时刻与暴露窗口统计。 |
| M3 | `replay/engine.ts` 的 P1/P2 在首名成员编辑时建立文件或两跳符号锁，另一方首次相交输入即标记反事实。CP-5 在同一文件中的不同函数构造冲突，P1 可检出该场景。 |
| M4 | `bench/generator.ts` 使用 fast-diff 最小编辑、固定种子采样的字符间隔与思考停顿，包含同时、先后间隔 5–60 秒、交替批次三类时序。真实 tracker 测试核验 max-duration 与 cursor-left。 |
| M5 | SF 相同变体只生成独立样本；三类依赖修改只统计冲突算子。SF-5 修改返回单位及调用方。观测点按算子明确的 merged 期望判断；没有期望时只记录观测。单方类型错误剔除，所有四状态均执行种子自带共享测试。 |

包内 bench 七项测试使用真实子进程和真实种子源码。七个原始项目的十四项 Node 测试通过。88 个样本完成 1056 次状态探针：allow 60、warn 3、lock 25、剔除零项。全部保留集样本只生成与标注，策略评价使用开发集。

### 规则来源与开发集依据

规则行为修改依据为本轮 C7、C8 指定的复现场景与规则顺序。未根据保留集判定结果调整规则。以下独立规则文件最后修改提交均为 `e83c9cc`；开发集组号用于核验覆盖，行为修改依据保留为具名故障测试与明确规则要求。

| ruleId | 本轮依据 | 开发集核验组 |
|---|---|---|
| same-symbol-concurrent-write | C8 顺序；同符号生产参数测试 | 未命中 |
| type-only-unchanged | C8 独立规则与同符号优先顺序 | 未命中 |
| comment-format-only | C8 独立规则，保持规则条件 | d1-0051 |
| observability-only | C8 独立规则；日志白区生产场景 | d1-0044 |
| equivalent-refactor | C8 独立规则；GreyLock 对照 | d1-0058 |
| referenced-symbol-removed | C8 独立规则；删除声明回归 | 未命中 |
| runtime-export-removed | P7 dangling 引用回归；C8 独立规则 | d1-0002、d1-0022 |
| call-signature-incompatible | C8 规则顺序；生产参数黑区场景 | 未命中 |
| consumed-return-property-removed | C7 未知返回变量与局部对象变量；C8 顺序 | 未命中 |
| interface-required-member-incompatible | C5 接口新增必需成员测试；C8 独立规则 | 未命中 |
| merge-only-type-error | C8 独立规则；四状态生产场景 | d1-0001、d1-0002、d1-0022 |
| unparsable-side | C7 新增/删除空文本；C8 独立规则 | d1-0016、d1-0029、d1-0030 |
| semantic-interaction-uncertain | C8 独立规则；灰区生产场景 | 下列十组 |

开发集实际覆盖的 ruleId 与关系组为：

- `merge-only-type-error`：d1-0001、d1-0002、d1-0022。
- `runtime-export-removed`：d1-0002、d1-0022。
- `observability-only`：d1-0044。
- `comment-format-only`：d1-0051。
- `equivalent-refactor`：d1-0058。
- `unparsable-side`：d1-0016、d1-0029、d1-0030。
- `semantic-interaction-uncertain`：d1-0001、d1-0002、d1-0009、d1-0016、d1-0022、d1-0029、d1-0030、d1-0036、d1-0037、d1-0050。

其余规则的本轮依据为具名回归测试与 GreyLock 原始样例，开发集未命中的规则保持此项事实。

## C 组

| 编号 | 实现位置、测试与证据 |
|---|---|
| C1 | `coordination/session.ts` 共用批次过滤、闸门、冻结范围、判定异常与 T0。服务端记录 persist、persist_gate、freeze，`replay/check.ts` 比较判定及三类协调事件。`策略计算异常记录为 warn，输入继续复原`、镜像同步与九份服务端轨迹均通过。 |
| C2 | `conflictGuardScenarios.integration.test.ts` 以生产参数录制九份轨迹，覆盖白区、灰区、黑区、重判、确认、撤回、mirror_resync、多文件、observe、冻结违规。`check-checkpoint-traces.ts` 九项 valid/checked 均为 true，differences、coordinationDifferences、errors 均为空。无法匹配 pairId 的 ui_action 计入回放 errors。 |
| C3 | pair_judged 保留完整 typecheck 耗时与跳过结果；回放按记录复现跳过，缺少记录时标 timeoutSimulation: unavailable。两份有检查记录的轨迹标 recorded。合并独有类型错误示例检查耗时 66.87 ms。 |
| C4 | `conflictGuardApi.integration.test.ts` 暂时移除实际 Y.Text observer，恢复后触发真实 mirror_resync，核验双方范围和有效轨迹。`agentConcurrency.test.ts` 增加同 session 先后运行、两种延迟顺序，各 run 只含自身文件。B3 与重新并入 session.diff 的实际变异均检出失败。round2 文档按现有证据记录。 |
| C5 | 新生产场景补齐阶段 3 的 2、3、4、7、8、9、11；补写双方确认、参数可选后的自动解除、冻结期间 Yjs 输入、撤回后调用方补写、外部输入 persist_conflict。`接口新增必需成员冻结旧对象消费者` 命中 interface-required-member-incompatible。 |
| C6 | `routing/greylock-parity.test.ts` 展开原测试全部 47 个分类调用，运行旧 classifier 与本产品。27/47 分区和规则一致，20 项差异逐项列在 stage-3.md 与完整 JSON。D2 的 51/51 动作一致另外验证白区、灰区。 |
| C7 | `routing/contracts.ts` 区分已知与未知返回属性，内部箭头函数和 return 保持在自身声明范围；新增、删除符号的空文本按状态处理。`返回未知对象变量时保留返回属性的不确定性`、`内部箭头函数变化不报告外部接口变化`、`新增符号的空文本按新增处理`、`返回局部对象变量保留其属性集合` 通过。 |
| C8 | 每条规则位于独立文件。same-symbol-concurrent-write 在 type-only-unchanged 之前，call-signature-incompatible 在 consumed-return-property-removed 之前。`调用签名规则在返回属性规则之前求值` 通过。 |
| C9 | session 在单方批次关闭后维护接口变化表；依赖方新批次查询该表，无需已有变更对。`C9 单方接口变化结束批次后即可触发依赖方 T0` 与浏览器第九项通过。 |
| C10 | pair_judged 带双方符号键与 beforeHash/afterHash。生产撤回、九份一致性证据均保存该字段。 |

C4 的 B3 变异把 resync 路径的 tracker.edit 改为 tracker.openDocument，测试中的双方活跃集合断言得到空集合并失败；恢复后通过。日志为 `checkpoint-a-b3-mutant.log.gz` 与 `checkpoint-a-b3-restored.log.gz`。

同 session 变异在 getDiff 后重新把 runtimeChanges 并入 workspaceChanges。两个延迟顺序测试均在第二个 run 的 fileChanges 多出 session-first.ts 时失败；恢复后通过。该次结果保存在执行工具输出中，没有独立日志文件。

`真实白区轨迹按文件独立核验闸门顺序与状态` 使用最新服务端录制。各文件的闸门和写入分别保留顺序、状态与时间核验，同时开启的独立文件允许不同事件排列；改变任一文件的闸门状态仍检出差异。此测试在修改前失败，修改后通过。

## N 组

| 项目 | 实现与测试 |
|---|---|
| 写入阻挡次数 | session 仅在允许变为阻挡时计数，300 ms 重试保持同一次阻挡。生产参数 P2 测试核验计数。 |
| localDecisionRatio | 根据白区与黑区变更对数除以判定变更对数；回放 P3 单独计数，无变更对时 N/A。metrics 分母测试通过。 |
| freeze_violation | 每个编辑事务计一次，事件带相交 pairIds。`N 冻结区域中的一个事务只记录一次违规` 通过。 |
| revision 连续性 | pairState 保存 revisionHistory 与确认结果。关闭后相同内容及不同内容重新出现的测试均通过。 |
| 被拒绝的 confirmPair | 状态与成员核验通过后记录 ui_action。P5 测试核验拒绝请求没有动作记录。 |
| displaySymbol | T0 从符号键读取完整声明名称及 container，面板沿用符号 kind。浏览器验收包含函数与 Cart.total，界面回放包含 billing 声明。 |
| 四状态目录查询 | 复用索引文件清单与 readFile/readLib，检查时不扫描磁盘目录。四状态及完整服务端场景通过。 |
| codeCommit 与 D2 哈希 | bench-generate 从脚本所属 SimpleRCPv2 仓库读取提交；GreyLock 导入核验 37 份来源和 57 条轨迹的 SHA-256。greylockImport 测试通过。 |
| D2 数量与 verification | 51 个规则案例包含 41 warn、10 allow；六个交付场景 unavailable。README、stage-4.md 与重新生成的 verification.json 使用相同计数。 |

## 浏览器与回放证据

`conflict-guard-checkpoint.spec.ts` 七个真实浏览器场景完成阶段 3 的十项及补充三项，全部通过。`evidence/checkpoint-a-manual/acceptance.json` 记录十三项与场景映射，目录保存每项截图。宿主 cat 断言确认先后编辑的判定前后文件原文、锁定中重新打开保留修改、切换文件后撤回恢复文本。intervention 六项通过，阶段 2 页签在 rules、observe、off 下通过，界面 replay 一项通过。

九份修复后的服务端轨迹及完整初始文本位于 `evidence/checkpoint-a-live-traces/`。`verification.json` 同时记录各类别录制数量与回放数量；没有产生相应事件的场景，其类别标记 checked:false。

开发集报告位于 `evidence/checkpoint-a-dev-report/`，包含完整结果、Wilson 区间、P* 对照、判定前暴露窗口、冻结次数、编辑计数与 interruptions.svg。判定延迟采用当前 revision 的触发事件，分别报告安全样本与冲突变体。

每个策略使用 28 个去重样本，其中冲突变体 15、安全样本 13。比例分母分别为 lock 真值 8、allow 真值 18、lock 或 warn 真值 10。

| 策略 | 逃逸率 | 漏阻断率 | 误阻断率 | 本地决定比例 | 冻结人秒 |
|---|---:|---:|---:|---:|---:|
| P0 | 100.0% | 100.0% | 0.0% | N/A | 0.00 |
| P1 | 90.0% | 87.5% | 33.3% | N/A | 29874.17 |
| P2 | 0.0% | 0.0% | 72.2% | N/A | 33492.43 |
| P3 | 0.0% | 62.5% | 0.0% | 24.2% | 3355.05 |
| P* | 0.0% | 0.0% | 0.0% | N/A | 11408.82 |

P3 的五个漏阻断均为 CP 族 runtime-only 样本，获得 warn 或 T0，因此逃逸率与漏阻断率反映不同效果。有限暴露窗口样本数为零；P0 全程没有提示的逃逸数为 10，P1 为 9。P0/P2/P3/P* 的安全样本与冲突变体判定延迟 p50/p95 均为 25/25 ms，P1 为 0/0 ms。新增五项先后编辑与多变更对延迟回归在修改前失败、修改后通过。

两次标准 CLI 独立进程分别执行 repeat 2，除顶层 timing 外逐字节相同。SHA-256 为 `c35c2c9eeb0cc61a12eea7bfaf6ba9eabfa52fc425dfc3287b0f513039806aff`，比较范围见 determinism.json。保留集策略没有执行。

## 验证命令与提交

| 命令 | 结果 |
|---|---|
| `pnpm -r build` | 四个包构建通过 |
| `pnpm --filter @simplercp/conflict-guard test` | 12 个测试文件，130 项通过 |
| `SIMPLERCP_CHECKPOINT_EVIDENCE=<本仓库证据目录绝对路径> pnpm --filter @simplercp/server test` | 40 个测试文件，178 项通过，包含 22 项生产参数场景 |
| `pnpm test:demo` | 2 项通过 |
| `CONFLICT_GUARD=off SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e tests/e2e/collaboration.spec.ts tests/e2e/conflict-guard-panel.spec.ts` | 协作 2 项与页签 1 项通过 |
| `CONFLICT_GUARD=observe SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e tests/e2e/collaboration.spec.ts tests/e2e/conflict-guard-panel.spec.ts` | 协作 2 项与阶段 2 页签 1 项通过 |
| `CONFLICT_GUARD=rules SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:collab` | 2 项通过 |
| `CONFLICT_GUARD=rules SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e tests/e2e/conflict-guard-checkpoint.spec.ts tests/e2e/conflict-guard-panel.spec.ts tests/e2e/conflict-guard-replay.spec.ts` | 7 个检查点场景、阶段 2 页签、界面回放共 9 项通过，覆盖十三项清单 |
| `CONFLICT_GUARD=rules SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e tests/e2e/conflict-guard-intervention.spec.ts` | 6 项通过 |
| `pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/check-checkpoint-traces.ts` | 九份真实服务端轨迹无差异 |
| `bench:prepare --groups 60 --seed 20261006 --concurrency 8` | 60 组、88 个非 alias 样本标注完成 |
| `replay:run --split dev --policy 'P0,P1,P2,P3,P*' --repeat 2` | 五种策略各 28 个去重样本，零错误 |

off 与 observe 的协作命令直接执行 test:collab 所调用的同一 collaboration.spec.ts，并在同一次启动中附加页签验收。完整原始日志使用 gzip 保存于 `evidence/checkpoint-a-tests/`，压缩前后均执行已配置敏感值的精确比对。浏览器十三项的完整结果由 acceptance.json 与截图记录。

服务端完整 updateSemantic 测量覆盖目录扫描与 pricing 直接引用更新：首次 5.61 ms，30 次增量的 p50 为 5.53 ms、p95 为 8.12 ms。包内 300 文件合成性能测试记录耗时，不设置门槛。

提交前运行 `node scripts/verify-evidence-secrets.mjs`，同时核验普通文件与解压后的日志，输出 configuredValuesFound 为 0。未调用模型，未向远端推送，main 保持原状态。

源码提交为 `e83c9cc`（P1–P7、共享会话编排器与规则）及 `3b1eef0`（M1–M5、回放与真实轨迹）。数据集的 codeCommit 为 `3b1eef093bfe8197168b9beaa99314cd85a0efb3`。生成器使用 preserve-labels 核验四种状态和探针，保留了 1056 次真实执行结果；labels.json 的 SHA-256 为 `03bc41bacf64edb4dbd9ba33cecae5d7323d12cb4ab5f27c018fe35853892079`。

## 使用限制

GreyLock 原始样例中的二十项差异涉及 alias 的绑定、历史绑定路径、同名声明、返回属性的消费方式和带有 spread 的接口对象，当前规则分析仍有这些限制。具体输入和结果均可复验；本轮完成了 C6 的逐项执行与报告，不能据此声明所有黑区分析与旧实现一致。

七个项目与算子共享部分结构，合成数据的代表性及探针输入覆盖仍然有限。Wilson 区间用于当前计数；独立项目数量需要在正式报告中同时给出。P3 的 runtime-only 修改可能得到 warn，lock 判定能力与提示能力分别由漏阻断率及逃逸率体现。反事实编辑继续维护文本坐标，包含这些编辑的文件写入另行统计，长期推演需解释该处理。

冻结在客户端执行，服务端接受全部 Yjs update 并记录违规。撤回范围为成员在该文件本轮的全部修改。文档与 Undo 历史固定到活跃状态结束；进程退出后的恢复持久化不属于本轮实现。
