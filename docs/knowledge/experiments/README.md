# 第五章实验目录

第5章使用四组实验，报告位于 `exp1/` 到 `exp4/`。实验一读取已有并发轨迹，实验二读取已有检索记录；实验三使用 `knowledge-exp-freeze-v3.1`，实验四的 T2 扩展使用 `knowledge-exp-freeze-v3.2`。模型均为 `minimax / MiniMax-M3`，OpenCode 为1.18.31。各实验的样本、统计方法与失败清单见对应报告。

| 新编号 | 实验名称 | 原编号 | 数据来源 |
|---|---|---|---|
| [实验一](exp1/report.md) | 并发锚定 | E2 / K7 | `runs/E2-k7-formal-v21-m3/` |
| [实验二](exp2/report.md) | 检索与送达 | E3 / K5 | `runs/E3-k5-bm25-v22/`、`runs/E3-delivery-v241-m3/` |
| [实验三](exp3/report.md) | Agent 复犯 | E4 / K3 | `runs/exp3-freeze-v31/`，198次 |
| [实验四](exp4/report.md) | 跨成员纠正迁移 | E5 / K4，包含自动复盘指标 | `runs/exp4-freeze-v31/` 的 T0/T3 与 `runs/exp4-t2-freeze-v31/` 的 T2；18次Ta与54次Tb |

原 E1、E2、E3、E4、E5、E6 目录保留，用于追溯历史试跑、人工评分和旧冻结版本。原 E1 捕获、原 E6 人工评分、C1、C3、C4、C6、C7 补跑和真人 pilot 不属于本轮四组正式实验。

旧 `knowledge-exp-freeze-v3` 的43条记录保留在 `runs/exp3-freeze-v3/`；历史114次 Agent 运行保留在 `runs/E4-k3-first-formal-v21-m3/`。两者均不进入本轮正式统计。T2 使用 `knowledge-exp-freeze-v3.2`，只读取 v3.1 保存的 episode 原稿，不修改 T0、T3 结果。冻结前端到端检查位于 `freeze-v31-checks/`，独立于正式样本。

