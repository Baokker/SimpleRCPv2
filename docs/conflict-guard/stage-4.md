# 阶段 4 报告：可量化回放

`packages/conflict-guard/src/replay/` 使用虚拟时钟与内存文件提供者，直接驱动产品的 tracker、语义索引、SemanticChangeTracker、classify 与 PairCoordinator。服务端和回放共用 `src/coordination/session.ts`，由 `createSessionCoordinator` 处理批次过滤、待判定闸门、冻结区域、判定异常与 T0。输入按 seq 推进；批次、候选关系和状态转换由产品逻辑产生，录制的派生事件用于核验。

回放记录冻结区域、闸门区间、300 毫秒写入防抖后的文本与判定序列。P1 在一方开始编辑时锁定文件，P2 锁定该符号两跳内的区域；另一方在锁区内的首次输入即标记为反事实。冻结后的相交编辑继续维护文本坐标，包含反事实编辑的持久记录单独处理。`mirror_resync` 与服务端共用 `fast-diff` 转换。实际运行耗时放在 `timing`，评价时间来自虚拟时钟。

`src/bench/` 包含 19 个算子、四状态 probe runner、标签器与确定性生成器。七个种子项目覆盖购物、库存、权限、文本格式、日程、计费与事件投递，每个项目有七个 TypeScript 源文件和两份 Node 内置测试。算子通过 AST 与语义索引选取原项目中的声明和调用方。原项目的全部测试作为共享回归探针执行。状态目录位于被 Git 忽略的 `.test-workspaces/probes/`，编译、类型诊断与探针在真实子进程中运行，单次预算为 20 秒，每种状态执行三次并保存原始结果。本轮使用 Node.js 24.7.0 的 `--experimental-strip-types --test`。

交付 D1 使用种子 `20261006`，生成代码提交为 `3b1eef093bfe8197168b9beaa99314cd85a0efb3`。60 个关系组包含 88 个非 alias 样本：allow 60、warn 3、lock 25，1056 次状态运行完成，剔除零项。开发集为两个项目的 18 组，保留集为另外五个项目的 42 组；SS 与 EB 两个完整算子族仅在保留集。七个 baseline 项目产生 225 个不同完整状态程序、87 个不同四状态组合，开发集与保留集的程序重叠为零。旧行为、新行为、无关修改分别为 28、28、14 个样本，安全算子另外计数。保留集仅完成生成与真值标注，策略评价只运行开发集。

轨迹使用最小编辑片段与 Yjs RelativePosition。字符间隔从固定种子采样，中位数约 150 ms，范围 65 至 350 ms；思考停顿为 1800 至 7000 ms。时序包括同时编辑、前后相隔 5 至 60 秒的编辑、交替多个批次。部分场景通过连续输入触发最长批次时间，通过光标离开关闭批次。元数据记录全部节奏参数。

生成命令支持将 groups 改为 200 扩大数据集：

```bash
pnpm --filter @simplercp/conflict-guard bench:prepare --seeds bench/seeds --out bench/datasets/d1-v1 --groups 60 --seed 20261006 --concurrency 8
pnpm --filter @simplercp/conflict-guard replay:run --dataset bench/datasets/d1-v1 --split dev --policy 'P0,P1,P2,P3,P*' --repeat 2 --out ../../docs/conflict-guard/evidence/checkpoint-a-dev-report
```

开发集评价按安全孪生与冲突变体分别计数，相同四状态程序仅计一次。本次每个策略包含 28 个去重样本，其中冲突变体 15 个、安全样本 13 个。漏阻断率的分母为 8 个 lock 真值样本，误阻断率为 18 个 allow 真值样本，逃逸率为 10 个 lock 或 warn 真值样本。逃逸要求冲突合并态已写入，且此前没有通知或阻止；warn、lock 与 T0 均计为提示。本地决定比例按变更对计数，P0、P1、P2、P* 为 N/A。各比例及按算子族、detectability 分组的 Wilson 95% 区间保存在结果 JSON。

| 策略 | 逃逸率 | 漏阻断率 | 误阻断率 | 本地决定比例 | 冻结人秒 |
|---|---:|---:|---:|---:|---:|
| P0 | 100.0% | 100.0% | 0.0% | N/A | 0.00 |
| P1 | 90.0% | 87.5% | 33.3% | N/A | 29874.17 |
| P2 | 0.0% | 0.0% | 72.2% | N/A | 33492.43 |
| P3 | 0.0% | 62.5% | 0.0% | 24.2% | 3355.05 |
| P* | 0.0% | 0.0% | 0.0% | N/A | 11408.82 |

P* 在批次关闭时对真值为冲突的候选对判定 lock，提供本数据与时序下的预言机对照。P1 的文件锁覆盖了同文件冲突，跨文件冲突仍有逃逸。P2 阻止所有关联区域，因此误阻断率为 72.2%。P3 的五个漏阻断均为 CP 族的 runtime-only 样本；它们获得了 warn 或 T0 提示，所以逃逸率为零、漏阻断率仍为 62.5%。P3 的三分类一致率为 13/28，即 46.4%。这些数值分别描述提示能力与 lock 判定能力。

判定延迟使用促成当前 revision 的相关批次关闭时刻；没有对应批次时，使用当前待判定闸门的关闭时刻。P0、P2、P3、P* 的冲突与安全样本 p50/p95 均为 25/25 ms，P1 均为 0/0 ms。这里计量虚拟时钟中的判定安排时间，实际运行耗时保存在 `timing`。各策略缺少触发时刻的判定数量均为零。冻结区间在变更对解除或活跃变更结束时关闭，按成员合并重叠区间；冻结次数分别为 P0 0、P1 49、P2 61、P3 7、P* 19，被阻止编辑数分别为 0、64、1017、17、158。冻结人秒受 600000 ms 活跃变更空闲阈值影响，代表指定生命周期下的模拟时间。

卡片按 `pairId:revision` 去重，包含灰区通知与 T0；每小时频率以第一次至最后一次编辑的时间为分母。P0、P1、P2、P3、P* 分别为 0、477.14、234.90、216.55、121.12 次。有限的判定前暴露窗口样本为零；P0 有 10 个、P1 有 9 个全程未提示的逃逸样本，单独计数。P2、P3、P* 的全程未提示逃逸数为零。

两次独立进程均对每个样本重复回放两次，结果 JSON 除顶层 `timing` 外逐字节相同，SHA-256 为 `c35c2c9eeb0cc61a12eea7bfaf6ba9eabfa52fc425dfc3287b0f513039806aff`。主表、分组、判定序列、散点图、计数与复现证据位于 `evidence/checkpoint-a-dev-report/`；`determinism.json` 记录比较范围与结果。

D2 包含 51 个规则案例与六个交付场景，共 57 条 schema 3 轨迹。导入校验了 37 个来源文件和全部轨迹的 SHA-256；来源包括 selection、覆盖报告、五份数据集及六个场景的原始文件。规则案例的本地动作全部与 GreyLock 一致，其中 10 个 allow、41 个 warn，每个案例重复回放得到相同 JSON。六个交付场景中四项一方 before/after 相同，两项没有静态关系，因此 tracker 没有双边候选。清单保存 unavailable 原因与来源内容。D2 的校验计数保存在 `packages/conflict-guard/bench/datasets/d2-greylock/verification.json`。

GreyLock 原始分区器测试另外提供 47 个独立输入，其中 27 个分区和规则结果一致；20 个差异逐条记录于 `evidence/checkpoint-a-greylock-parity.json` 与 `stage-3.md`。D2 的 51/51 动作一致覆盖白区、灰区，原始分区器的 27/47 对照覆盖不同规则边界，两份证据各自保留来源哈希与输入。

本轮保存九份真实服务端轨迹，覆盖白区、灰区、合并独有类型错误、确认、撤回、重判、冻结期间输入、observe 与多文件 `mirror_resync`。`replay:check` 对判定、闸门、写入与冻结事件均无差异，九份轨迹的 `valid` 和 `checked` 均为 true，`errors` 均为空。证据为 `evidence/checkpoint-a-live-traces/verification.json`。发生四状态检查的两份轨迹按记录复现检查；其余轨迹明确记录 `timeoutSimulation: unavailable`。

本模块验证命令与结果：

| 命令 | 结果 |
|---|---|
| `pnpm --filter @simplercp/conflict-guard exec vitest run src/replay/metrics.test.ts src/replay/replay.test.ts` | 36 项通过 |
| `pnpm --filter @simplercp/conflict-guard exec vitest run src/replay/greylockImport.test.ts` | 2 项通过 |
| `bench:prepare --groups 60 --seed 20261006 --concurrency 8` | 88 个非 alias 样本完成标注，零项剔除 |
| `replay:run --split dev --policy 'P0,P1,P2,P3,P*' --repeat 2` | 18 个关系组、28 个去重样本，各策略无错误 |
| 独立进程重复运行上述开发集命令 | 除 `timing` 外逐字节相同 |
| D2 导入与重复回放 | 37 个来源、57 条轨迹哈希通过，51 个规则动作一致 |
| `pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/check-checkpoint-traces.ts` | 九份服务端录制无差异 |

完整构建、服务端与包测试、三种模式的协作测试以及 Playwright 验收结果统一记录于 `review-fix-checkpoint-a.md`。Playwright 的真实浏览器验收覆盖阶段 3 十项与先后编辑、重新打开文件、切换文件后撤回三项；执行参数为批次空闲 1500 ms、写入延迟 300 ms，截图与 `acceptance.json` 位于 `evidence/checkpoint-a-manual/`。`manual-acceptance.md` 提供命令和手工步骤。

合成项目代表清单中的业务与修改方式，探针覆盖受测试输入限制。样本仍共享项目与算子，Wilson 区间描述当前计数的不确定性，不能直接解释为独立用户实验。冻结后的反事实文本继续参与后续语义计算，持久化统计排除包含反事实编辑的文件；长期反事实推演受到此处理影响。六个 GreyLock 交付场景的双边输入不足，保留为来源资料。原始分区器的 20 个差异仍需在规则能力分析中单独报告。冻结人秒是指定空闲阈值下的模拟量，实际人的操作等待需要另外测量。

阶段 5 可通过 ZoningPolicy 接入模型策略，使用同一四状态真值、会话编排器与指标，保存模型响应和异常记录。规则与模型设置只参照开发集调整，正式评价前冻结配置，保留集留至阶段 8。应分别分析黑区判定、灰区提示、误阻断与 P* 的时序上界，并持续保存可重放的服务端证据。
