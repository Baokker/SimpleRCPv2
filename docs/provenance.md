# 来源记录

| 文件或模块 | 来源 | 说明 |
|---|---|---|
| `apps/server/src/guard/legacy/parser.ts` | 从 Collaboration Tools 移植 | 保留旧命令名称、路径参数和 Shell 动态语法检查，适配 SimpleRCP 类型。 |
| `apps/server/src/guard/legacy/classifier.ts` | 从 Collaboration Tools 移植 | 保留 safe、risky、dangerous、unknown 分类。 |
| `apps/server/src/guard/roles.ts` | 研究点代码 | 场景角色到权限档位的映射。 |
| `apps/server/src/guard/characterize.ts` | 研究点代码 | 能力、路径分区和可逆性刻画。 |
| `apps/server/src/guard/rules.ts` | 研究点代码 | 角色矩阵与硬性规则。 |
| `apps/server/src/guard/approvals.ts` | 研究点代码 | 单次审批队列和超时处理。 |
| `apps/server/src/guard/snapshots.ts` | 研究点代码 | 工作区文件快照与恢复。 |
| `apps/server/src/guard/llmJudge.ts` | 研究点代码 | DeepSeek OpenAI-compatible 接口调用。 |
