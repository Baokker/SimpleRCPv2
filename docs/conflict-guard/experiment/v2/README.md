# 语义冲突预防实验

实验包含人与人协作回放、灰区模型研判、六个 Agent 协作场景，以及性能测量。当前进行开发集选择，保留集与 Agent 场景等待阶段确认。

## 开发集选择

选择规则保存在 selection-rule.md，提交为 `d4e735f`。数据为 D1-v3 开发集，119 个有效轨迹、97 个关系组。共同灰区主表使用已登记的 61 个轨迹；新增六个灰区轨迹与全部 67 个灰区轨迹均提供独立质量表。

模型配置保存在 stage-A/config.json、models.json、providers.json。MiniMax-M3 使用国内站直连；Jev 固定 `jev-1.13.0`，通过环境变量 `TYPESAFE_PROXY_URL` 指定代理。

在仓库根目录准备输入：

```sh
pnpm --filter @simplercp/conflict-guard build
pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/stage-a-prepare.ts
```

深判录制与提示词选择：

```sh
TYPESAFE_PROXY_URL="$TYPESAFE_PROXY_URL" ADJUDICATION_BUDGET_SCOPE=stage-a pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/stage-a-evaluate.ts --policy G1 --prompt pair-v4 --mode record
pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/stage-a-summary.ts --phase prompt
```

使用选中的提示词录制快判。选中 pair-v1 后，另行录制该提示词在完整声明输入上的深判，用于同输入比较。级联条件使用相同目录中的快判与深判缓存，在 replay 模式比较阈值 `0、0.2、0.4、0.6、0.8`。每个条件的执行命令和完整配置保存于结果目录。真实录制前需要在环境中配置 `TYPESAFE_PROXY_URL` 与对应的 API key。

真实调用预算记录在 `.test-workspaces/stage-a-call-budget.json`，上限为 400 次深判、600 次快判；三次 Jev 连通验证单独统计。请求失败和超时计入调用次数。缓存与中间日志保存于已忽略的 `.test-workspaces/`，提交时同时保存压缩缓存产物。

## 数据索引

| 文件 | 内容 |
|---|---|
| stage-A/prepared.json.gz | 输入、完整声明、分析证据、本地回放结果与源码哈希 |
| stage-A/pair-v4/G1/results.json.gz | 新提示词的深判结果 |
| stage-A/pair-v1/G1/results.json.gz | 旧提示词在完整声明输入上的深判结果 |
| stage-A/pair-v1/G2/results.json.gz | 同输入的 Jev 快判结果 |
| stage-A/pair-v1/G3-*/results.json.gz | 五个级联阈值的离线回放结果 |
| stage-A/pair-v1/model-cache.json.gz、stage-A/pair-v4/model-cache.json.gz | 含成功与失败请求的原始缓存 |
| stage-A/selection-prompt.json | 两个提示词的共同样本指标与选择 |
| stage-A/selection-final.json | 快判、深判和五个级联阈值的指标与选择 |
| stage-A/human-comparison.json | 开发集上本地方法和完整方法的六项指标 |
| stage-A/summary.md | 阶段 A 的实验说明与结果 |
| stage-A/verification.json | 输入、预算、时限、缓存和指标的验证记录 |
| stage-A/review-validation.json | 当前代码的离线输入核查、录制兼容性与逐轨迹关闭原因 |
| stage-A/review-repairs.md | 本轮修复、验证结果及适用范围 |
| stage-A/call-budget.json | 本阶段实际调用数量与已知费用 |
| ../../evidence/jev-proxy/results.json | 三次代理连通验证的原始响应 |

语法等待时间使用回放轨迹的时间戳，单独报告；模型时延使用真实 HTTP 请求测量，包含代理开销。开发集结果用于选择配置，论文正文结论需要后续保留集验证。

## 离线复现与验证

缓存恢复后，全部离线命令无需模型调用。原始录制对应提交 `4c01a6c`，以下录制复现命令需要使用该提交的源码与构建文件。源码哈希变化时命令会终止。以下命令在仓库根目录执行；目录需要不存在，已有调用日志会触发终止。

```sh
mkdir -p .test-workspaces/stage-a-cache/pair-v1
cp docs/conflict-guard/experiment/v2/stage-A/pair-v1/model-cache.json.gz .test-workspaces/stage-a-cache/pair-v1/model-cache.json.gz
pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/data-artifacts.ts --cache ../../.test-workspaces/stage-a-cache/pair-v1 --restore
pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/stage-a-evaluate.ts --policy G2 --prompt pair-v1 --mode replay --out ../../.test-workspaces/stage-a-reproduced/G2
pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/stage-a-evaluate.ts --policy G3 --prompt pair-v1 --mode replay --threshold 0.4 --out ../../.test-workspaces/stage-a-reproduced/G3-0.4
```

`--out` 指定独立的结果目录。回放读取录制时的 HTTP 时延，并按 8 秒总时限执行级联。快判和深判回放必须指定 `--out`；每个条件的调用日志使用独占创建方式，保留已有实验产物。

以下命令验证已提交结果，并重新生成统计报告：

```sh
pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/stage-a-summary.ts --phase final
pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/stage-a-review.ts
pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/stage-a-write-report.ts
pnpm --filter @simplercp/conflict-guard exec node --experimental-strip-types scripts/stage-a-verify.ts
```

报告生成读取本机预算文件 `.test-workspaces/stage-a-call-budget.json`；在其他机器上可依据 `stage-A/call-budget.json` 的 `fast`、`deep` 字段创建该文件。验证直接读取已提交的预算和结果，不依赖本机预算文件。原始录制、输入与模型配置的对应关系保存在各条件的 `config.json` 与 `results.json.gz` 中。

`stage-a-review.ts` 使用当前代码与已有响应进行独立核查，新增模型调用为零。缺少对应录制的输入在 `review-validation.json` 中列明，相关离线运行仅用于检查调度、声明整理与关闭原因。灰区质量表使用原始录制；当前代码的模型质量需要对应输入的有效响应。
