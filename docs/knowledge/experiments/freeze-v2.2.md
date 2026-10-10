# knowledge-exp-freeze-v2.2：E3 BM25 比较

## 版本与范围

- 标签：`knowledge-exp-freeze-v2.2`
- 平台提交：`efda9418f5aefa18780891f2619e154381491fb4`
- 数据提交：`ea11a85ed344c522fe3b63288cd8577c94fa6498`
- manifest SHA-256：`3e536a77fb0724316e10fee1bf9d0d409f88caf57b13e0a7a189c9a339950137`
- 输入：16个陷阱、6个对照，卡片与提示保持数据仓库冻结内容。
- Node.js：`v24.7.0`；pnpm：`9.0.0`。
- 产品 OpenCode 配置版本：`1.18.31`；本机 shell 的 `opencode --version` 为 `1.18.15`。E3 未启动或调用 OpenCode。
- 通用实验配置中的 provider/model：`minimax / MiniMax-M3`；本次模型调用0次。
- 检索依赖：MiniSearch `7.2.0`，BM25+ 默认参数 `k=1.2`、`b=0.7`、`d=0.5`。

本标签记录用户授权的 E3 检索调整。结果目录为 `experiments/knowledge/runs/E3-k5-bm25-v22/`，共176条查询。`knowledge-exp-freeze-v2`、`knowledge-exp-freeze-v2.1` 与原有结果保留。E1、E2 和已保存的 E4 M3 数据继续按 v2.1 统计；新的 BM25 端到端实验需要使用独立配置与结果目录。模型额度恢复前保持模型实验暂停。

## 协议与哈希

小规模比较使用四个陷阱、两个对照，共30条查询；采用标准和完整比较计划保存在 `bm25-protocol.json`。采用标准达到后，固定 `bm25-full-protocol.json`，执行22个任务与八个条件。没有调整任务、目标标注、卡片文字、参数或文件加分值。

| 文件或对象 | SHA-256 |
|---|---|
| `formal-v21.json` 文件 | `a5b41fa275d6380c964038cb3c1e2337f225aa61e304f9aa8c91f78077659d0a` |
| 解析后的基础配置（`configHash`） | `1251aac44831146db92c9adb574fedb933cfcc2928164e6ec8f5ded51540d0ef` |
| `bm25-protocol.json` 文件 | `ba68ee9cdec9943a035b42e87e1775330084a56e7f70f04ca52aec9528cb657b` |
| 小规模协议对象 | `83c9a4f87604fb84e5830cf402e43e9d89d5bf597ad332c8a0b5a5d628b2f950` |
| `bm25-full-protocol.json` 文件 | `809013ea2f6a920827b7f4ef535e2ae7a91c02ba581ea122367db96d0c50c814` |
| 完整比较协议对象（`protocolHash`） | `289e9e47ce5b4de215680a7098930a36099d5bde3927cff54ab149a9d065fb92` |
| `packages/knowledge/src/retrieval/bm25.ts` | `cb1ea17be147b187684d2627bcb88dc0bb3dcfb217a600277d80de4208c2f9d0` |
| `packages/knowledge/src/retrieval/ranking.ts` | `085a1f3a0a117cd9d62ff65e4e8935041c4c91f0b3c98e339a5d465668e054ce` |
| `experiments/knowledge/k5.ts` | `7201c60b3d16ce32f7a38703cbf99439b6270fabc1454c947d25ebf0a5f81135` |
| `pnpm-lock.yaml` | `815fe31b8708f5df8fc2fd09f8631d5d28e3946b53997c8054d8925140d3413e` |

文件哈希按原始字节计算；对象哈希按 `JSON.stringify` 的结果计算。每条查询同时保存 `commit`、`manifestHash`、`configHash` 与 `protocolHash`。小规模试跑在新增实现尚未提交时执行，元数据 HEAD 为 `418a4ccc`；其指标与目标排名由本标签的真实产品检索函数全部重现。

## 检查记录

- `pnpm build`：通过。
- `pnpm test`：server160项、knowledge162项、demo2项通过；server9项按配置跳过。
- 实验工具：19项通过，包括3项新增 BM25 测试。
- 统计工具：5项通过。
- `pnpm test:e2e`：24项通过、33项按配置跳过。
- `pnpm test:e2e:knowledge`：25项通过。
- 审阅后针对候选日志修改重新执行 BM25 的3项测试与构建，均通过。
- 原五个条件110条查询的全部候选排名与 v2.1 相同。
- 独立目录复跑176条查询，全部候选排名与指标相同；执行耗时4.33秒。
- 数据仓库工作目录无修改。

测试日志保存在忽略的 `experiments/knowledge/.work/bm25-*.log`，结果核验保存在正式目录 `verification.json`。

## 执行命令

在本标签的独立工作目录执行。平台与数据目录继续相邻，或使用 `KNOWLEDGE_BENCH_ROOT` 指定数据仓库绝对路径。无需配置 API key，也无需启动服务。

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

统计 Python 环境由 `analysis/pyproject.toml` 与 `analysis/uv.lock` 定义。需要全新生成结果时指定一个尚未使用的 `--out` 目录；已有目录仅允许同一提交、数据、基础配置与协议续跑。
