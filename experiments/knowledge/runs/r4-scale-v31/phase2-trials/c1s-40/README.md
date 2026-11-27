# C1s@40 试跑

- 任务：`R1-T01`，条件 `C1s`，1 次。
- 配置：`r4-trial.json`；数据 `library.json`（原有 40 张 active）；平台 `dc30074f`。
- 选择：activeFiles 为空；40 张原有卡片均无 `appliesTo`，按项目级全部写入；目标卡在内。
- 结果：joint success；字符 8,337；估算 token 2,085；费用 0.7401 元；Agent 150s。
- 原始记录：`raw/R1-T01-C1s-1/`（`c1s-selection.json`、`static-export.json`、`trace.json`、`run.json`、`judge-output.json`）。
- 说明：C1s@40 与 C1@40 内容等价；这是原有卡片缺少 `appliesTo` 的结构性结果，不是实现错误。
