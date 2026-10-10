# 实验复现

## 环境与版本

- 平台：`/Users/baokker/Work/Master/CSCW/过程性知识管理/code/SimpleRCPv2`
- 数据：`/Users/baokker/Work/Master/CSCW/过程性知识管理/code/knowledge-bench`
- 平台标签：`knowledge-exp-freeze-v2.1`
- 平台提交：`418a4ccc758de803efc5427bea0b0cd09cc26dc5`
- 数据提交：`ea11a85ed344c522fe3b63288cd8577c94fa6498`
- manifest SHA-256：`3e536a77fb0724316e10fee1bf9d0d409f88caf57b13e0a7a189c9a339950137`
- 正式配置哈希：`1251aac44831146db92c9adb574fedb933cfcc2928164e6ec8f5ded51540d0ef`
- Node.js `v24.7.0`、pnpm `9.0.0`、实际 OpenCode runtime `1.18.31`
- 全部新的模型请求：`minimax / MiniMax-M3`

使用上述提交的独立工作目录执行，`formal-run.ts` 要求 HEAD 等于冻结标签。历史记录使用其原有冻结版本与模型，分别统计。完整配置文件哈希见 `freeze-v2.1.md`。

E3 新增 BM25 比较使用 `knowledge-exp-freeze-v2.2`，平台提交 `efda9418f5aefa18780891f2619e154381491fb4`；数据、manifest 和基础配置保持上述值，额外协议哈希为 `289e9e47ce5b4de215680a7098930a36099d5bde3927cff54ab149a9d065fb92`。记录见 `freeze-v2.2.md`，结果在 `E3/report.md`。E3 使用本地 MiniSearch BM25+，无需模型、API key 或实验服务。

## E3 BM25 比较复现

在 v2.2 标签的独立工作目录运行。统计环境由 `experiments/knowledge/analysis/pyproject.toml` 与 `uv.lock` 定义。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @simplercp/knowledge build
uv sync --project experiments/knowledge/analysis --frozen
pnpm --filter @simplercp/experiments experiment k5 \
  --config experiments/knowledge/formal-v21.json \
  --protocol experiments/knowledge/bm25-full-protocol.json \
  --conditions R1,R2,R3,R6,R6-lexical,R2-wrong-file,R3-wrong-file,R6-wrong-file \
  --out experiments/knowledge/runs/E3-k5-bm25-v22
pnpm --filter @simplercp/experiments experiment summarize \
  --config experiments/knowledge/formal-v21.json \
  --source experiments/knowledge/runs/E3-k5-bm25-v22
experiments/knowledge/analysis/.venv/bin/python \
  experiments/knowledge/analysis/analyze.py \
  experiments/knowledge/runs/E3-k5-bm25-v22/results.jsonl \
  --out experiments/knowledge/runs/E3-k5-bm25-v22/analysis/statistics
```

22任务与八条件共176查询，16个陷阱用于 Recall，6个对照仅统计误注入。`bm25-protocol.json` 保存小规模选择与采用标准，`bm25-full-protocol.json` 保存完整比较、三项主检验与未参与小规模比较的任务范围。已保存小规模结果由 `pnpm --filter @simplercp/experiments exec tsx --test test/bm25.test.ts` 重现。完整结果两次执行的全部候选排名相同，独立复跑耗时4.33秒、模型费用0元。

E3 只需使用新标签的源文件。下面的模型矩阵命令继续在 v2.1 独立工作目录执行；当前模型额度不足，E4 保持114条已完成记录，详见 `pause-20261010.md`。为 BM25 新建端到端实验时单独记录冻结版本、配置与目录。

## 凭据与服务

平台根目录的本地 `.env` 设置 `MINIMAX_API_KEY`。API key 由服务端读取；OpenCode 使用本机模型代理。当前接口为 `https://api.minimaxi.com/v1`，模型名为 `MiniMax-M3`。API key 不写入命令参数、任务、实验配置或结果。

在数据目录运行：

```sh
node tools/validate.mjs
```

在平台目录运行：

```sh
pnpm install
pnpm build
pnpm test
pnpm --filter @simplercp/experiments build
pnpm --filter @simplercp/experiments test
pnpm test:e2e
pnpm test:e2e:knowledge
```

E2E 两条命令顺序执行，共用测试端口。启动独立实验服务：

```sh
MINIMAX_MODEL=MiniMax-M3 AGENT_MINIMAX_MODEL=MiniMax-M3 \
SIMPLERCP_KNOWLEDGE_EXPERIMENTS=true EXPERIMENT_SPEED=1 \
SIMPLERCP_DATA_DIR="$PWD/experiments/knowledge/.work/server-v21-m3/data" \
PORT=4203 SIMPLERCP_OPENCODE_PORT=4205 \
pnpm --filter @simplercp/experiments run server
```

复盘单次请求120秒，首次失败后最多重试两次，间隔5秒。工具核验 Agent、知识模块均为 M3，捕获 `speed=1`。

## 正式矩阵

```sh
pnpm --filter @simplercp/experiments exec tsx formal-run.ts E2 E1
pnpm --filter @simplercp/experiments exec tsx formal-run.ts E4-first E4-first
pnpm --filter @simplercp/experiments exec tsx formal-run.ts E5-core E5-core
pnpm --filter @simplercp/experiments exec tsx formal-run.ts E4-second E4-second
pnpm --filter @simplercp/experiments exec tsx formal-run.ts E6 E6
```

| 阶段 | 结果目录（`experiments/knowledge/runs/` 下） | 计划规模 |
|---|---|---:|
| E2 | E2-k7-formal-v21-m3 | 1440轨迹、7200策略评价 |
| E3 | E3-k5-formal-v21-m3 | 110查询 |
| E3 BM25比较（v2.2） | E3-k5-bm25-v22 | 176查询 |
| E1 | E1-k1-formal-v21-m3 | 2脚本、52标注时刻 |
| E4第一批 | E4-k3-first-formal-v21-m3 | 264次 |
| E5核心 | E5-k4-core-formal-v21-m3 | 108组合、每组合3次Agent任务 |
| E4第二批 | E4-k3-second-formal-v21-m3 | 198次 |
| E6 | E6-k2-formal-v21-m3 | 合格纠正episode及52个脚本时刻，各3种草稿 |

每一步完成后查看 `summary.json`、`checkpoint.json` 和 `analysis/statistics/`，检查失败清单。K4 是唯一正式迁移入口，数据仓库工具仅用于校准。E6 人工评分使用 `ratings-a.csv` 与 `ratings-b.csv`，由两名标注者独立填写；未填写时均分与 κ 无数据。

## 统计与续跑

```sh
experiments/knowledge/analysis/.venv/bin/python \
  experiments/knowledge/analysis/analyze.py \
  experiments/knowledge/runs/E4-k3-first-formal-v21-m3/results.jsonl \
  --out experiments/knowledge/runs/E4-k3-first-formal-v21-m3/analysis/statistics
```

逐次结果、任务多数投票、精确 McNemar、任务重采样CI、Holm和任务随机效应 logistic分别保留。对照任务的功能退化单独分析。`targetDelivery` 保存目标卡片的文本命中、文件相关、项目级兜底来源；送达子集的规则遵守与端到端结果分别统计。C1 的静态文档阅读没有注入trace，其送达口径单独注明。

相同命令读取已完成key并跳过；尚未结束的run继续等待。续跑核验代码提交、配置、manifest、provider与模型。保留原始失败记录。冻结内容需要修改时停止运行，由人工决定重新冻结。

## 时间、费用与复现范围

每次任务记录 `wallMs`、用量和人民币估算，供应商账单单独记为未知。M3 按每条请求估算：每百万非缓存输入2.10元、输出8.40元、缓存读取0.42元；单次输入超过512k时按官方价格乘二。Agent `inputTokens` 为非缓存输入，知识请求 `promptTokens` 包含缓存，这两个定义分别处理。运行时 `cost=0` 保留原值。

E1、E2、E3 为确定性运行，可逐条复现。模型输出、token和墙钟时间存在随机差异，以三次重复、任务多数投票和CI报告。任务来自构造项目，真人协作需要独立pilot。各实验耗时和费用以相应正式报告中的实际结果为准。
