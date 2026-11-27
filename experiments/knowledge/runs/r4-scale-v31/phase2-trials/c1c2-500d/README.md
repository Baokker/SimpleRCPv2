# C1@500 / C2@500 试跑

- 任务：`R1-T01`，条件 `C1`、`C2`，各 1 次。
- 平台：`experiment/r4-context`，阶段 2 提交 `dc30074f`；数据：`r4-scaled-kb-v2` 提交 `e2900ba`，manifest `6ce9dd94…`。
- 配置：`experiments/knowledge/r4-trial.json`；HTTP 4203；MiniMax-M3；并发 1；1 次重复。
- 数据：`trapbench/cards/library-500.json`（每项目 500 张）。

结果见 `results.jsonl`。C1：joint success，费用 1.0169 元，Agent 315s；C2：joint success，费用 0.8201 元（含重排 0.0290），Agent 203s。C2 注入 5 张、2,230 字符、558 token，目标卡词法送达。

原始记录在 `raw/R1-T01-C1-1/` 与 `raw/R1-T01-C2-1/`；`workspace/` 快照未保留/未提交。
