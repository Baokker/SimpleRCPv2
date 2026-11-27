# C1s@500 试跑

- 任务：`R1-T01`，条件 `C1s`，1 次。
- 配置：`r4-trial.json`；数据 `library-500.json`（每项目 500 张）；平台 `dc30074f`。
- 选择：activeFiles 为空；写入 40 张原有项目级卡片 + 6 张新项目级卡片 = 46 张；目标卡在内。
- 结果：joint success；字符 9,818；估算 token 2,455；费用 0.8283 元；Agent 131s。
- 原始记录：`raw/R1-T01-C1s-1/`（`c1s-selection.json`、`static-export.json`、`trace.json`、`run.json`、`judge-output.json`）。
- 全任务扫描：R1 任务 activeFiles 均为 0（选 46 张）；R2 任务 activeFiles 1–2 个（选 44–67 张），路径匹配生效。
