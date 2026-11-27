# 阶段 A 第一段（中止）

- 任务：R1-T01..R1-T04 × C1/C2/C1s/C1-NT500/C2-NT500 × 3，计划 60 次。
- 实际完成：1 次（`R1-T01-C1s-1`，joint success，1.2097 元，186s）。
- 中止原因：C1/C2/C1-NT 运行超过试跑时长（13+ 分钟），C1 被取消时已 1.93 元；C1-NT 轨迹已有最终回答但 run 未 settle，费用 2.09 元；服务端 settle 请求挂起。C1-NT 的 trace 显示 Agent 修改了 `AGENTS.md`（+27 行），疑似知识文件可写导致循环/额外轮次。
- 处理：保留 `raw/` 与 `anomaly-aborted.json`，不删除；未完成运行不计入结果，后续可用同一 key 重跑。
- 建议：将 AGENTS.md 设为只读（或 OpenCode 禁止 edit AGENTS.md），并发降到 2，再继续阶段 A。

| key | 状态 | 费用 CNY | 输入 token | 缓存读 | 备注 |
| --- | --- | ---: | ---: | ---: | --- |
| R1-T01-C1s-1 | completed | 1.2097 | 82,496 | 1,902,903 | joint success |
| R1-T01-C1-1 | cancelled | 1.9317 | 135,375 | 3,401,984 | 13+ min，疑似 AGENTS.md 编辑循环 |
| R1-T01-C2-1 | running→stopped | 0.9804 | 73,884 | 1,436,160 | 服务停止，未 settle |
| R1-T01-C1-NT500-1 | running→stopped | 2.0908 | 446,778 | 2,456,496 | 轨迹有最终回答；AGENTS.md +27 行 |
| R1-T01-C2-NT500-1 | not-started | 0 | 0 | 0 | 中止前未开始 |
