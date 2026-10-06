# 检查点 C 冻结清单

状态：等待人工确认。协议 checkpoint-c-v1；日期 2026-10-07。本次只导出配置、哈希和标签抽检材料；X1 至 X7 尚未执行。

## 代码与环境

评价代码提交：`d1725b162ac5511360eb769fed3468b6d341191f`。分支 feature/conflict-guard。产品源码 SHA-256：`051b49a8163a657f26de28493bf3fd092457eecc4fae47ab04b45654d3771550`。冻结材料提交由 Git 保存，与评价代码提交分别追踪。

Node v24.7.0；pnpm 9.0.0；TypeScript 5.9.3；OpenCode 与 SDK 1.18.31。pnpm-lock.yaml 的 SHA-256 为 `87c83edc08ed7f4c66a7d07fa879e588f2f2a37bf5e5e606f97e39a103f707ef`。逐文件哈希及字节数见 [freeze.json](freeze.json)。

## 数据集

| 数据 | 版本 | 规模 | 清单 SHA-256 |
|---|---|---|---|
| D1 | d1-v2 | 200 组；dev 75；holdout 125 | `07af4c5a220896762e9078ef03d1d223db16cc906b5b01d1867a47d5a7f95bb2` |
| D2 | d2-greylock-v1 | 51 案例 + 6 场景；57 份轨迹 | `0977607e0a4ec88684372846b5776d839a7ad7bae010845d2b2e626a7cbb4e41` |
| D3 | d3-v0 | 13 任务对；跨属主 10，同属主 3 | `01ed579432cda621826e745dabeaad43fc44f1aa07bf4a9cd59cfa3830dbf2d1` |

D1 原始生成提交 5d0aa3dfc7ad6caa768257be657d7d7520306186，固定种子 20261008。归档 SHA-256：`9ff62258ac9c6f42abee02975151b85047847be987a3c883434bd0ccb3459732`。清单、标签、剔除表与每份轨迹均与归档核对。开发集项目：billing、cache、commerce；保留集项目：access、calendar、events、text、warehouse。

| 划分 | 有标签变体 | 剔除变体 | 有效变体 | 去重后有效程序 |
|---|---:|---:|---:|---:|
| dev | 101 | 0 | 101 | 79 |
| holdout | 182 | 7 | 175 | 130 |

跨项目归一化 token 相似度最大 0.59943978，限制 0.6；开发与保留项目的程序交集 0，站点交集 0。仅保留集算子族：SS、EB。

| 剔除样本 | 划分 | 原因 |
|---|---|---|
| d1-0041-conflict | holdout | invalid-side |
| d1-0041-safe | holdout | invalid-side |
| d1-0044-conflict | holdout | invalid-side |
| d1-0148-conflict | holdout | invalid-side |
| d1-0148-safe | holdout | invalid-side |
| d1-0153-conflict | holdout | invalid-side |
| d1-0153-safe | holdout | invalid-side |

总剔除率 7/283 = 2.47%。[抽检材料](label-audit/README.md)覆盖 40/200 个关系组，各项目五组；[两位标注者表格](label-audit/reviewer-1.json)与 [第二份表格](label-audit/reviewer-2.json)独立填写。抽样只使用固定种子和组号。

## 规则、会话与策略

分区规则版本：`rules-sha256:97bd590f1333899a8e82c9108304fcdc765d49afc8fe11dc3b437e96791c145a`；规则集合包括 classifier、类型检查、接口分析、候选生成与规则文件，具体文件哈希见 freeze.json。指标源码 SHA-256：`e28dc4c00be71adbc133ce25fb1031012acb2c7cc7c8692bcbd1f8282bedae8e`。

[会话配置](runtime-config.json)：k=2；idleMs=1500；maxBatchDurationMs=5000；activeIdleMs=600000；光标离开三行；光标防抖 200 ms；文件写入延迟与语义防抖均为 300 ms；四状态检查预算 500 ms；预约确认 2000 ms；卡片等待 300000 ms；同属主重试最多两次。

| 策略 | 冻结行为 |
|---|---|
| P0 | 无协调 |
| P1 | 编辑开始时预先锁定文件 |
| P2 | 编辑开始时预先锁定 k≤2 的符号范围 |
| P3 / G0 | 本地规则，灰区 warn |
| P* | 批次关闭时，对 truth=lock 或 warn 的候选对 lock；无关系 allow |
| G1 | 灰区使用深判 |
| G2 | 灰区使用快判 |
| G3 | 快判置信度低于阈值、lock 或失败时升级深判 |
| G4 | T1=G3，T2=G1，T3=G1 |
| P5 | full，意图注入 on，属主仲裁 owner，T2/T3 开启 |

研判配置 adjudication-v1；提示词 pair-v1；级联阈值 0。来源为 [开发集校准](../evidence/checkpoint-b-dev-report/calibration/calibration.json)，十二个最终灰区 revision 全部为 lock 标签，allow 标签为零。这个校准集合无法估计灰区安全样本的误阻断率。

[提示词全文](prompts.json) SHA-256：`d424cb33b457a9974e6c72460d16f323ae92eda0d500932b3b1a78988d2d8aaa`；[研判配置](adjudication-config.json) SHA-256：`8fb24f4f28ce9ca860f67e1e3db7519da9f4fbc854d7457874a97670d0489d29`。每个输入字段上限 3000 字符，每侧最多三个调用点，不变量开启。

快判 jev / jev-1.13.0；深判 deepseek / deepseek-flash。DeepSeek 当前使用供应方模型别名，未提供不可变版本标识；实际响应 model 随原始输出保存。T1、T2、T3 的 reasoning 均关闭；预算分别为 8000、30000、60000 ms，T1 进度提示为 2000 ms。temperature=0，深判 JSON response_format，Jev 使用直接 choice。缓存身份包括输入、全文提示词、适配器、模型与请求参数。

价格日期 2026-10-06，币种 USD。每百万 token：快判输入 0.042，输出 0；深判输入 0.3，输出 1.2。费用按这份配置估算，未声称是实验执行日的新价格。

## 指标与统计

公式、分母、Wilson、exact McNemar、关系组 bootstrap、Holm 与重复一致率见 [metrics-and-statistics.md](metrics-and-statistics.md)，其全文 SHA-256 为 `97bd2cab5d61759d1942e86b3516cad3948d9fb19a5d15d1bf96987e7b3ba730`。bootstrap 重复 2000 次，种子 20261007，置信水平 95%。

T03：完成率 ≥95%；漏阻断 ≤10%；误阻断 ≤15%；一致率 ≥80%；p50 ≤3000 ms；p95 ≤8000 ms。X4 研究候选固定为开发集 G2，T03 未全部通过。

## 实验命令、重复与预算

以下命令为人工确认后的执行清单，当前没有执行。完整参数和缺少的入口能力见 [protocol.json](protocol.json)。所有输出位于 experiment/编号/，每个运行目录保存 command.txt、config.json、原始输出与 summary.md。命令工作目录由 pnpm filter 切换到对应包。

| 实验 | 重复 | 快判调用预计 | 深判调用预计 | 初始 Agent run | 费用预计 USD |
|---|---|---:|---:|---:|---:|
| X1 | 1 | 0 | 0 | 0 | 0.0000 |
| X2 | 1 | 0 | 0 | 0 | 0.0000 |
| X3 | record 1 + replay 3 + live 3，每策略 | 1032 | 888 | 0 | 0.7230 |
| X3b | 未执行 | 0 | 0 | 0 | 0.0000 |
| X4 | 1 | 0 | 0 | 0 | 0.0000 |
| X5 | 3 | 0 | 234 | 468 | 28.6845 |
| X6 | 3 | 0 | 180 | 120 | 7.4453 |
| X7 | 1 | 138 | 0 | 0 | 0.0069 |

总预计：快判 1170 次，深判 1302 次，初始 Agent 588 个 run，Agent 内部 HTTP 请求约 4508 次，费用约 USD 36.8597。角色调用与 Agent 内部模型调用分别统计。预算依据、token 与公式见 [budget.json](budget.json)。预计超过任一类别或费用的 120% 之前停止汇报；未知 usage 和失败调用单独记录。

X3 质量使用每策略一次 record，三次 replay 验证重现；三轮 live 用于真实延迟与重复一致率，独立调用、不复用缓存。X4 复用 X3 和既有开发集录制。X5 有 13×3×2×3×2=468 个初始 run；X6 复用 owner，只增加 10×2×3×2=120 个。既有冒烟 token 已包含追加执行，费用均值外推不重复乘追加次数。

### X1

```sh
pnpm --filter @simplercp/conflict-guard replay:run --dataset bench/datasets/d1-v2 --split holdout --policy P3 --repeat 1 --out ../../docs/conflict-guard/experiment/X1/d1
```

D2 的 manifest 格式需要专用读取入口；规则命中数和精确率需要从原始判定聚合。GreyLock 51 条案例本地决定 10 条作为来源基线，保持其分母。

### X2

需要索引测量入口，分别执行一次全量构建和逐批次增量更新；按源码非空行数分为 300–319、320–339、340 及以上三组。当前 replay:run 不接受 k 参数。

### X3

```sh
pnpm --filter @simplercp/conflict-guard replay:run --dataset bench/datasets/d1-v2 --split holdout --policy G1,G2,G3,G4 --provider-mode record --repeat 1 --config ../../docs/conflict-guard/experiment/adjudication-config.json --models ../../docs/conflict-guard/experiment/models.json --cache bench/model-cache/stage8-x3-record --out ../../docs/conflict-guard/experiment/X3/record
```

模型入口目前拒绝 holdout；需要支持冻结后的保留集选择，并核对 request-parameters.json 的 endpoint 和请求参数。灰区范围按 P3 的实际请求触发确定，禁止使用真值筛选输入。record 输出的 models 与 subscriptions 随 replay 提供；live 三轮各使用独立目录，分别执行 repeat 1，禁止复用缓存。统计入口需要使用冻结种子 20261007，当前模型 CLI 使用 manifest.seed。

### X3b

当前没有第二个 OpenAI compatible 端点，本条件不执行；如确认前补充端点，需要重新计算配置哈希与预算。

### X4

```sh
pnpm --filter @simplercp/conflict-guard replay:run --dataset bench/datasets/d1-v2 --split holdout --policy 'P0,P1,P2,P3,P*' --repeat 1 --out ../../docs/conflict-guard/experiment/X4/holdout
```

开发集执行同一命令并使用 split dev；G2 使用 X3 的固定 record，开发集使用已保存的 checkpoint-b-round1 G2 录制。需要模型入口的 holdout 支持。

### X5

```sh
pnpm --filter @simplercp/conflict-guard bench:agents --dataset d3 --injection on --arbitration owner --repeat 3 --out ../../docs/conflict-guard/experiment/X5/P5/on
```

需要选择 P0/P3/P5 与独立阶段八预算；当前脚本固定 full，并使用阶段七 40 次限制。每种策略分别执行 on/off，独立项目，按任务编号与重复编号配对。D3 当前只有 Agent 与 Agent 任务，人与 Agent 条件未提供数据，单独注明未执行。自动属主动作固定为有建议时双方采纳，无建议时后到者让路。

### X6

```sh
pnpm --filter @simplercp/conflict-guard bench:agents --dataset d3 --tasks d3-01,d3-02,d3-03,d3-04,d3-05,d3-06,d3-07,d3-08,d3-09,d3-10 --injection on --arbitration all-human --repeat 3 --out ../../docs/conflict-guard/experiment/X6/all-human
```

owner 条件复用 X5/P5/on 的十个跨属主任务，另执行 all-human/all-auto。真实运行评价逃逸与成功；对相同轨迹三种模式各 replay 三次仅评价仲裁与打扰计数，不推断行为效果。需要独立阶段八预算。

### X7

需要消融入口，使用冻结 G2。no-invariants 每个 split 重新 record 一次，其余复用对应缓存；T3 仅在 D3 轨迹上有作用，D1 条件标记 N/A。全历史模式保留当前会话自开始后的修改，不引入其他会话。任何新输入的缓存缺失都需单独计数，禁止当作消融质量变化。

## 人工确认前需处理的条件

1. 《实验与评价.md》原文尚未找到，第 5、7 节需要人工核验，公式来源已经注明。
2. 现有模型评价入口仅接受 dev，X3、X4 的保留集模型入口需要补充。
3. Agent 批量入口固定 full 和阶段七预算，需要支持冻结的 P0/P3/P5 以及阶段八独立计数。X5 的人与 Agent 条件缺少任务数据。
4. X2、D2 规则聚合及部分 X7 消融入口需要补充。新增执行代码后需更新评价提交和对应文件哈希，重新确认检查点 C，期间保持标签、提示词、阈值与统计协议。
5. 第二个兼容端点缺失，X3b 当前注明未执行。DeepSeek 的不可变版本信息由供应方能力限制。

本清单状态为等待人工确认，readyForExperiments=false。标签材料和数据哈希已经导出；保留集尚未执行任何策略评价。确认前不执行正式实验，也不根据保留集调整参数。

## 验证命令

```sh
pnpm --filter @simplercp/conflict-guard experiment:freeze --verify
node scripts/verify-evidence-secrets.mjs
```

verify 重新核对归档、标签规则、轨迹、抽样、配置和导出文件的逐字节内容，不运行模型或策略评价。freeze.json 不包含自身哈希，文件哈希清单覆盖全部其他导出内容；冻结材料提交标识由 Git 提供。
