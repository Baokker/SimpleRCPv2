# 冲突预防实验复现

本目录的冻结与实验材料已由 `v2` 取代。请使用 [v2/README.md](v2/README.md) 及其下的阶段材料；本目录保留用于历史复现。

本目录内容属于旧版实验方案，当前冻结材料与实验命令全部以 [v2/README.md](v2/README.md) 和 [v2/protocol.json](v2/protocol.json) 为准。这里的 Jev 451 记录、旧样本数量和旧实验编号只用于历史追溯。

本轮开发集比较与指标判定见 [实验问题、指标与开发集结果](focused-experiment-report.md)。报告围绕人与人协作、灰区模型质量、Agent 协作组织，包含三个 MiniMax-M3 提示词版本的真实录制，并分别统计全部样本与灰区子集。报告末尾提供收缩后的正式实验设计建议；以下协议命令仍属于等待确认的完整实验方案。

探索录制 `pair-v2` 有一条缓存未通过 JSON 完整性检查，具体文件与哈希见 [统计核验](../evidence/focused-evaluation-analysis/verification.json) 的 `cacheIntegrity`。其质量数字可以从原始报告重新计算，完整缓存回放尚未验证通过。正式冻结不能采用不完整的录制。

## 环境与数据

使用 Node.js 22.19.0 或更新的支持 strip-types 的版本、pnpm 9、OpenCode 1.18.31。运行 `pnpm install --frozen-lockfile` 与 `pnpm -r build`。所有命令在 SimpleRCPv2 根目录执行。

```sh
pnpm --filter @simplercp/conflict-guard data:artifacts --dataset bench/datasets/d1-v3 --restore
pnpm --filter @simplercp/conflict-guard data:artifacts --cache bench/model-cache/preexperiment --restore
```

D1-v3 的完整清单、标签、四状态程序、剔除表与轨迹保存在已提交的 `dataset.json.gz` 中。生成器、种子与扩充入口也提交。恢复时检查轨迹 SHA-256；冻结导出逐字节核对展开文件与归档。D2 与 D3 清单和来源夹具直接入库。D2 回归测试使用仓库内的真实来源夹具。

离线模型录放使用保存的端点和请求参数，命令通过 `--providers` 读取该文件。`adjudication:verify` 从已有真实缓存生成 `adjudication-providers.json`，包含端点、MiniMax JSON 输出开关和 temperature；该文件不含凭据。完整冻结导出对应的 `providers.json`，供 X4 与 X7 使用。

新报告直接保存实际请求配置，后续验证读取报告中的字段。`repeatability.json` 的 `valid` 表示行为与原录制一致且网络调用为零，`byteIdentical` 比较三份输出；`cacheComplete` 和 `sourceCacheMisses` 单独表示缓存完整性。含有缓存缺失的行为复现不能用作完整的模型质量评价。

数据种子为 20261008；bootstrap 为 2000 次、种子 20261007。两种种子分别控制数据与统计。D1 开发集 115 组、保留集 125 组，同一项目只属于一个划分。新增安全灰区仅属于开发集。

## API 配置

复制 `.env.example` 为 `.env`，填写 `MINIMAX_API_KEY`、`TYPESAFE_API_KEY`；X3b 还需 `DEEPSEEK_API_KEY`。离线 replay 使用已有缓存，不需要 key。

```dotenv
MINIMAX_BASE_URL=https://api.minimaxi.com/v1
MINIMAX_MODEL=MiniMax-M3
CONFLICT_GUARD_DEEP_JUDGE=minimax
SIMPLERCP_AGENT_PROVIDER=minimax
DEEPSEEK_MODEL=deepseek-flash
```

当前 key 的站点验证结果为国内站。MiniMax key 按站点区分，自己的 key 需使用对应站点。当前 MiniMax 人类编辑研判和 Agent 运行关闭推理，Agent 写入前检查与任务完成后复检开启推理。底座 Agent provider 默认仍为 DeepSeek，实验命令显式使用 MiniMax。Jev 的有效录制需要可访问 TypeSafe 的运行环境。

MiniMax 国内站标准档价格日期为 2026-10-10，每百万 token 输入 CNY 2.1、输出 CNY 8.4、缓存命中 CNY 0.42。预算用 CNY 7 = USD 1 记账，原币种费用同时报告。预计调用数、费用及停止数量见 `budget.json`。真实调用预算与开发集录制预算分别计算。

## 实验命令

协议中的 `command` 与 `commands` 保存完整命令。每条执行命令追加 `--plan` 可检查参数，调用数为零；`experiment-plan-check.ts` 统一检查这些命令。人工确认后由执行方将状态登记为 `frozen`，重新核验材料，再执行规定条件。确认前入口会终止正式实验。

| 编号 | 入口与条件 | 原始输出 |
|---|---|---|
| X1 | `replay:run`，D1 保留集 P3；`d2:run`，51 来源案例；`rules:summary` 聚合 D1 最终规则 | `X1/d1/results.json`、`X1/d2/raw.json`、`X1/rules/rules.json` |
| X2 | `index:run --experiment X2 --split all --k 1,2,3`；真实候选数量比较用 `replay:counts` | `X2/raw.json`、`X2/candidate-counts/candidate-counts.json` |
| X3 | P3 与 G1–G4 一次 record，三次 replay，三个独立目录各一次 live；`grey:summary` 选取 P3 触发的灰区 | `X3/record/results.json.gz`、`X3/replay/repeatability.json`、`X3/live-*/results.json.gz` |
| X3b | 相同 Jev、替换 DeepSeek 深判，P3/G1/G3，重复方式同 X3 | `X3b/` |
| X4 | 同一入口运行 P0/P1/P2/P3/P*/G2，dev 与 holdout 分别报告 | `X4/<split>/results.json.gz`、`verification.json` |
| X5 | `bench:agents`，P0/P3/P5 × injection on/off × repeat 3，独立项目和目录 | `X5/<policy>/<injection>/<task>-*.json`、`.jsonl` |
| X6 | owner 复用 X5/P5/on 的十个跨属主任务，all-human/all-auto 各三轮真实任务；相同轨迹另做仲裁回放 | `X6/` 与对应 `X5/P5/on/` 原记录 |
| X7 | `ablation:run`，冻结 G2，五条件；no-invariants 每个 split 一次新录制，其余 replay | `X7/<split>/<condition>/`、`X7/d3-no-T3/` |

X3 与 X3b 的 live-2、live-3 使用与 live-1 相同的命令，将缓存与输出目录中的编号同步改为 2、3。每个 live 条件只执行 repeat=1。record/replay 的质量结果与 live 延迟分别报告。

```sh
pnpm --filter @simplercp/conflict-guard grey:summary \
  --record ../../docs/conflict-guard/experiment/X3/record/results.json.gz \
  --out ../../docs/conflict-guard/experiment/X3/grey-quality
```

X5 的 P0 与 P3 条件分别替换协议命令的 `--policy`，每项 injection 使用独立目录。六个条件统计：

```sh
pnpm --filter @simplercp/conflict-guard agents:summary \
  --input ../../docs/conflict-guard/experiment/X5/P0/on \
  --input ../../docs/conflict-guard/experiment/X5/P0/off \
  --input ../../docs/conflict-guard/experiment/X5/P3/on \
  --input ../../docs/conflict-guard/experiment/X5/P3/off \
  --input ../../docs/conflict-guard/experiment/X5/P5/on \
  --input ../../docs/conflict-guard/experiment/X5/P5/off \
  --out ../../docs/conflict-guard/experiment/X5/summary
```

X6 的 all-auto 使用同一命令更改 `--arbitration` 和输出目录。owner 不新增真实调用，直接读取 X5/P5/on。三种条件统计：

```sh
pnpm --filter @simplercp/conflict-guard agents:summary \
  --input ../../docs/conflict-guard/experiment/X5/P5/on \
  --input ../../docs/conflict-guard/experiment/X6/all-human \
  --input ../../docs/conflict-guard/experiment/X6/all-auto \
  --tasks d3-01,d3-02,d3-03,d3-04,d3-05,d3-06,d3-07,d3-08,d3-09,d3-10 \
  --out ../../docs/conflict-guard/experiment/X6/summary
```

各目录保存 `command.txt`、`config.json`、原始输出和 `summary.md`。独立预算文件为 `.test-workspaces/stage8-budget.json`，每次请求和初始或追加 Agent 执行分别计数。达到预算限制后终止并生成 `budget-stop.json`，继续执行需要人工决定。

## 数字与证据位置

| 数字 | 文件与字段 |
|---|---|
| 数据数量、真值分布与安全灰区 | `../evidence/preexperiment/data-check.json` |
| 同一开发集的分区与反事实编辑比较 | `../evidence/preexperiment/impact.json`；原始 `baseline/results.json.gz` 与 `repaired-d1-v2/results.json.gz` |
| 无关系变更单元分母核验 | `../evidence/preexperiment/unit-audit/raw.json` 与 `manual-count.md` |
| 开发集模型质量、费用、失败与订阅 | `../evidence/preexperiment/record/results.json.gz` |
| 校准受阻状态与 recommended=null | `../evidence/preexperiment/calibration/calibration.json`；有效阈值曲线等待快判恢复后生成 |
| 开发模型完整缓存身份 | `../evidence/preexperiment/record/results.json.gz` 与 `bench/model-cache/preexperiment/model-cache.json.gz`；校准后的级联验证尚未执行 |
| MiniMax 型号、站点、参数验证 | `../evidence/minimax-probe/selection.json`、原始探测目录 |
| Agent 工具历史与三项冒烟 | `../evidence/minimax-agent-smoke/verification.json` 和引用的 attempt 目录 |
| 测试、命令参数与冻结完整性 | `validation.json`、`../evidence/preexperiment/entry-check.json`、`freeze.json` |

正式实验尚未产生的数字在完成后登记到对应目录。D3 任务验收未提供逐次持久写入的冲突真值，逃逸率显示 N/A；任务失败单独统计。无缓存条件不能作为消融效果。模型供应方没有不可变发布标识，记录实际响应型号与调用日期。
