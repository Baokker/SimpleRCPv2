# 可执行基准

## 种子项目与源码选择

当前数据集使用 `bench/seeds/native/` 中八个手写 TypeScript 项目。来源为本仓库的基准代码，各项目采用独立的业务组织，没有引入外部源码。每个项目包含五份生产 TypeScript 文件和一份 `node:test` 文件。测试使用 Node.js 24.7.0 的 strip-types 支持，十六项原始业务测试通过。

| 项目 | 业务组织 | 非空代码行（含测试） |
|---|---|---:|
| access | 角色继承、权限策略、风险、会话、审计 | 338 |
| billing | 用量、阶梯费率、发票、支付、账目 | 308 |
| cache | 双向链表、LRU、分区、memo、权重 | 350 |
| calendar | 时间区间、周期、空闲时间、提醒、日历 | 306 |
| commerce | 购物车、库存、订单、价格、配送 | 310 |
| events | 事件总线、流处理、路由、重试、投递 | 318 |
| text | 文档、字符宽度、布局、渲染、搜索 | 303 |
| warehouse | 批次库存、拣货、调拨、盘点、预测 | 329 |

`bench:inspect` 使用 TypeScript scanner，将 identifier 统一为固定 token，再计算 token 序列 LCS Dice 相似度。所有跨项目源文件和测试文件均参与检查，超过 0.6 时生成失败。最大值为 0.5994397759，完整文件对见 `evidence/checkpoint-b-dev-report/seed-diversity.json`。复制业务文件的变异检验使检查失败。

生成器以原始项目文件为 baseline，通过 TypeScript AST 识别参数、默认值、对象返回值、导出别名、状态写入与调用表达式；semantic index 验证被依赖声明与调用方在两跳内可达。修改位置来自声明和表达式的字符范围。四种状态保存完整业务项目，原有函数、类型、调用方和测试都参与执行。

## 算子

当前 native 项目生成 IC-1 到 IC-4、CP-2、CP-3、CP-5、SS-1、EB-2、SF-1 到 SF-5，共十四个满足前提的算子。兼容生成器保留其余五个算子，用于既有回归夹具。D1-v2 的实际覆盖以 manifest 中的组数为准。

- `IC-1`：可选参数改为必填参数，依赖方保留旧参数数量；安全孪生提供该参数。
- `IC-2`：删除返回对象字段，依赖方读取该字段；安全孪生读取保留的字段。
- `IC-3`：改变返回单位，依赖方继续使用旧单位；安全孪生使用单位访问值进行换算。
- `IC-4`：更改导出名称，依赖方新增旧名称引用；安全孪生使用保留的导出别名。
- `CP-1`：改变规则优先级，依赖方声明期望的组合输出；安全孪生通过明确的参数消除顺序影响。
- `CP-2`：改变默认值，依赖方省略参数；安全孪生明确提供原参数。
- `CP-3`：收紧输入检查，依赖方产生超出新范围的输入；安全孪生产生合法输入。
- `CP-4`：加入提前返回，依赖方要求历史记录更新；安全孪生选择会完整执行的输入。
- `CP-5`：同一文件中的计算函数与读取其结果的函数同时修改；安全孪生配套规范化结果。
- `SS-1`：返回共享对象，依赖方跨调用保留对象引用；安全孪生复制对象。
- `SS-2`：初始化覆盖配置，依赖方调整同一配置；安全孪生使用配套的初始化顺序。
- `SS-3`：覆盖写入改为追加写入，依赖方增加重试；安全孪生在重试前检查记录。
- `EB-1`：异常改为返回 `undefined`，依赖方保留异常回退；安全孪生同时检查返回值。
- `EB-2`：同步函数改为异步，依赖方继续同步使用结果；安全孪生使用 `await`。
- `SF-1`：增加日志。
- `SF-2`：增加注释。
- `SF-3`：等价的局部变量重构。
- `SF-4`：同一文件中修改无依赖关系的函数。
- `SF-5`：改变返回单位并让依赖方使用单位访问值，形成依赖新行为的配套修改。

冲突算子共用改动方修改，依赖方分别生成旧行为依赖、新行为配套或无关修改。无关修改位于原项目的独立函数。每三个冲突算子关系组包含一个无关修改组；按去重样本计数，目标比例为 40%、40%、20%。安全算子单独统计，相同的两个变体只保存一份安全样本。清单保留 `aliasOf` 指向关系，生成、标注与回放都忽略重复样本。

## D1 清单与划分

`manifest.json` 保存 baseline、leftOnly、rightOnly、merged、探针、声明键、入口文件、打字参数、项目划分、生成命令、SimpleRCPv2 的提交号与轨迹 SHA-256。`codeCommit` 从脚本所属的 SimpleRCPv2 仓库读取。

`d1-v2` 使用种子 `20261008`，包含 200 个关系组，每个项目 25 组。283 个非 alias 样本完成标注，剔除 7 个，剔除率 2.47%。八个项目产生 446 个不同状态程序、214 个不同四状态组合，均按 SHA-256 去重。

固定种子选择三个开发项目，另外五个项目属于保留集。开发集 75 组，保留集 125 组；SS 与 EB 两个完整算子族仅属于保留集。开发集与保留集的程序交集为零。站点标识包含项目、被依赖符号和调用方，开发集 23 个、保留集 26 个，交集为零。相关结果写入 `diversity`、`programStats`、`siteStats`。

开发集标注后包含 101 个样本，lock 26、allow 75；按完整四状态程序去重后评价 79 个样本。算子族、项目数量和所有标签均保存于清单，预期标签只描述算子目的，最终 truth 来自真实探针。

```bash
pnpm --filter @simplercp/conflict-guard bench:prepare --seeds bench/seeds/native --out bench/datasets/d1-v2 --groups 200 --seed 20261008 --concurrency 8
pnpm --filter @simplercp/conflict-guard replay:run --dataset bench/datasets/d1-v2 --split dev --policy 'P0,P1,P2,P3,P*' --out ../../docs/conflict-guard/evidence/checkpoint-b-dev-report/rules
pnpm --filter @simplercp/conflict-guard data:artifacts --dataset bench/datasets/d1-v2 --restore
```

## 可执行标签

`dataset.json.gz` 包含完整 manifest、labels、excluded 和 traces，原始 JSON 与 traces 目录被 Git 忽略。归档哈希见 `archive-sha256.json`；恢复命令校验轨迹名称及 SHA-256。`bench:label --reuse <dataset>` 仅复用完整状态、探针、入口、reference 和观测期望哈希相同的三次原始结果。

四种状态分别写入仓库内被 Git 忽略的 `.test-workspaces/probes/` 子目录。每种状态执行三次真实子进程；每次运行都执行 TypeScript 诊断、双方适用的意图探针以及种子项目的全部测试。单次状态预算为 20 秒，结束后删除该次工作目录。`--concurrency` 控制并行数量，结果顺序保持稳定。

探针分为 `origin-intent`、`candidate-intent`、`shared-regression`、`observation`。改动方意图在 leftOnly 与 merged 中检查，依赖方意图在 rightOnly 与 merged 中检查，共享回归在全部状态中检查。baseline reference 模块提供原始业务计算，作为明确的期望值来源。

标签按以下顺序计算：

1. 超时或三次结果不一致：剔除，原因 `flaky`。
2. baseline 共享回归或类型检查失败：剔除，原因 `invalid-baseline`。
3. 单方意图、共享回归或类型检查失败：剔除，原因 `invalid-side`。
4. TypeScript 检测到文本合并标记：剔除，原因 `text-conflict`。
5. merged 意图、共享回归或类型检查失败：`lock`。
6. 算子声明了可组合的 merged 观测期望，实际 merged 观测与该期望不同：`warn`。
7. 其他情况：`allow`。

观测点需要 `expectedMergedExpression` 或 `expectedMergedObservations`。未声明期望的观测点只保存观测结果。`detectability` 依据 merged 的真实类型诊断区分 `typecheck` 与 `runtime-only`。`labels.json` 保存四种状态各三次的原始结果，包含探针、共享测试、观测期望、诊断、stdout 与 stderr；`excluded.json` 保存剔除原因。

轨迹参数变更时，可以使用 `bench:generate --preserve-labels` 保留既有探针记录。入口逐项核对四种状态的完整文本、探针、入口文件、baseline reference 和预期观测，并要求每种状态已有三次记录；任何不一致都会终止生成。复用操作只重新生成轨迹与清单，不改变真实探针结果。

## 协作轨迹

`fast-diff` 把目标修改转换为最小编辑片段，片段逐字符形成 delta。Yjs RelativePosition 把双方原始位置转换到共享坐标，删除文本在执行前逐字符核对。

字符间隔由固定种子采样：四次均匀采样之和生成对数对称间隔，中位数约 150 ms，范围为 65 至 350 ms。每 24 或 48 个字符采样一次 1800 至 7000 ms 的思考停顿。所有参数写入清单，具体节奏写入轨迹的 `session_start`。

轨迹包含三种时序：同时开始；改动方完成后间隔 5 至 60 秒依赖方开始；双方分多段交替输入。交替输入每 12 个字符安排一次等待。部分连续输入超过 `maxBatchDurationMs=5000`，光标移到声明之外也会关闭批次。批次空闲阈值为 1500 ms，活跃变更空闲阈值为 600000 ms。尾部 cursor 推进时钟，使活跃变更与冻结按产品生命周期结束。

## 指标与回放

合成轨迹的冻结人秒在最后一次编辑处截止，另外报告活跃修改十分钟超时产生的无人处理时长上界。模型报告增加按关系组采样的 bootstrap 区间，判定对错使用配对 McNemar 检验及 Holm 校正。当前配置的策略评价仅使用开发集。

回放保留关系组与孪生关系，安全样本和冲突变体分别报告；完全相同的四状态程序只统计一次。漏阻断率的分母为 truth 为 lock 的样本，误阻断率的分母为 truth 为 allow 的样本，逃逸率的分母为 truth 为 lock 或 warn 的样本。

逃逸表示冲突合并态进入模拟持久内容之前，没有提示或阻止。warn 通知计为提示。P3 的本地决定比例以变更对为分母，白区与黑区计为本地决定；没有变更对的样本不参与该比例。P0、P1、P2 与预言机策略 P* 报 N/A。

判定延迟从批次关闭或闸门触发开始，分别报告冲突变体与安全样本。冻结区间在变更对解除或活跃变更关闭时结束，同时报告冻结次数、被冻结的编辑数与冻结人·秒。卡片按 `pairId:revision` 去重，包含灰区通知与 T0 提示；每小时卡片数使用第一次至最后一次编辑的时长。各比例与分组比例提供 Wilson 95% 区间。

P1 在编辑开始时锁定文件，P2 在编辑开始时锁定符号两跳内的区域，P3 复用产品分类器，P* 在批次关闭时锁定 truth 为冲突的候选对。报告包含各策略与 P* 的对照及判定前暴露窗口。冻结区中的后续编辑继续更新坐标，并记录反事实标记。

## D2 与适用范围

D2 包含 GreyLock 的 51 个规则案例与六个交付场景的 schema 3 轨迹，37 份来源文件与 57 份轨迹均校验 SHA-256。`sourceDecision` 为原本地动作，`sourceTruth` 为原真值，`actual` 为当前 P3 的判定序列；47 个规则案例的动作一致，另外四个等价重构样例产生 `semantic-interaction-uncertain/warn`。当前结果为 6 个 allow、45 个 warn，具体差异见 D2 的 `verification.json`。六个交付场景保留来源内容，`unavailable` 记录一方未修改或缺少静态关系的情况。黑区规则的移植对照另外使用 GreyLock 测试样例。

合成项目只能代表写明的业务与修改方式。探针通过表示当前输入与共享测试均满足要求，完整行为仍需要后续真实数据与人工抽检。清单保留项目、算子、声明位置与原始结果，供后续分析按来源分组与检查样本独立性。
