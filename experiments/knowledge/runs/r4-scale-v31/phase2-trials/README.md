# 阶段 2 试跑

命令（成功目录 `c1c2-500d`）：

```sh
KNOWLEDGE_BENCH_ROOT='/Users/baokker/Work/Master/CSCW/过程性知识管理/code/knowledge-bench-r4b' \
pnpm --filter @simplercp/experiments experiment k3 \
  --config experiments/knowledge/r4-trial.json \
  --library trapbench/cards/library-500.json \
  --tasks R1-T01 --conditions C1,C2 \
  --out experiments/knowledge/runs/r4-scale-v31/phase2-trials/c1c2-500d
```

平台提交 `dc30074f`（阶段 2）；数据提交 `e2900ba`，manifest `6ce9dd94…`；配置 `r4-trial.json`（HTTP 4203、MiniMax-M3、1 次重复、并发 1、speed 1）。

## 成功

| 条件 | functional | trapAvoided | jointSuccess | 首请求输入 token | 累计输入 / 输出 / 缓存读 | 费用 CNY | Agent 墙钟 | 流水线墙钟 |
| --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: |
| C1@500 | true | true | true | 74,769 | 104,844 / 4,039 / 1,608,192 | 1.0169 | 315s | 402s |
| C2@500 | true | true | true | 22,771 | 72,060 / 6,852 / 962,816 | 0.8201（含重排 0.0290） | 203s | 277s |

C2 注入 5 张卡片、2,230 字符、558 token；目标卡 `R1-T01-target` 由 BM25 词法路径送达，重排来源 `m3`。C1 的 `AGENTS.md` 为 136,205 字符 / 52,678 token，已由 OpenCode 从项目根加载；首请求 74,769 token，无截断或压缩。

原始记录：`c1c2-500d/raw/<key>/` 含 `run.json`、`trace.json`、`injection.json`、`knowledge-cards.json`、`knowledge-config.json`、`static-export.json`、`judge-output.json`、`workspace.patch`、`llm-calls.json`。工作区快照未提交。

## 失败运行（保留，不覆盖）

| 目录 | 原因 |
| --- | --- |
| `c1c2-500` | 数据目录不在 `SIMPLERCP_IMPORT_ROOTS` |
| `c1c2-500b` | 同上（服务端尚未重启） |
| `c1c2-500c` | 卡片导入上限 100 |

失败目录保留 `failure.json`、`raw/` 与配置；修复后使用新目录 `c1c2-500d` 重跑。

## C1s-prompt

已按确认的规则实现并试跑 C1s@40 与 C1s@500（任务 R1-T01，各 1 次）：

| 条件 | 选中卡片 | 目标卡在内 | 字符数 | 估算 token | jointSuccess | 费用 CNY | Agent 墙钟 |
| --- | ---: | --- | ---: | ---: | --- | ---: | ---: |
| C1s@40 | 40 | true | 8,337 | 2,085 | true | 0.7401 | 150s |
| C1s@500 | 46 | true | 9,818 | 2,455 | true | 0.8283 | 131s |

C1s@40 与 C1@40 内容等价（原有 40 张均无 `appliesTo`，按项目级全部写入）。全任务扫描：R1 任务 activeFiles 均为 0（C1s@500 选 46 张）；R2 任务 activeFiles 1–2 个（选 44–67 张），目标卡均在内。详见 `c1s-40/README.md`、`c1s-500/README.md`。
