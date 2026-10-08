# 双人双 Agent 修复验证

分支 `feature/conflict-guard`，修改基准 `5cd3909`。原始轨迹与最终真实验收的统计见 [验证目录](evidence/round2-dual-agent/)。

| 要求 | 实现位置 | 验证位置 |
|---|---|---|
| 批次符号聚合与共享类型过滤 | `routing/candidates.ts` | `routing/dualAgent.test.ts`，含第三位参与者修改共享类型的情况；`original-replay/candidate-counts.json` |
| 判定缓存、公开结果去重与判定队列 | `coordination/pairState.ts`、服务端 `projectAgentGuard.ts` | 每批最多 20 次、跨协调器缓存、重复 T2 判定只发布一次 |
| 真实导出误阻断 | `semantic/changes.ts`、`rules/runtime-export-removed.ts` | 原审批 diff 与重复公开声明、真实声明无法解析两项回归 |
| 符号簇的全部输入与严重结论 | `coordination/agentGuard.ts`、`adjudication/invariants.ts` | 两项簇内灰区与签名不兼容用例 |
| 审批插入内容保持对手坐标 | `coordination/agentGuard.ts` | 在 DoubleElevenPromotion 前新增 Promotion618Options 时放行 |
| 通用工具活动、推理与等待提示 | `agentProgress.ts`、`AgentRunProgress.tsx` | `agentProgress.test.ts`；`agent-progress.spec.ts` 两项浏览器测试 |
| 失败结构化记录与已有修改 | `agentRunFailure.ts`、`agentRunManager.ts` | cause、HTTP、errno、认证、禁止端口；并发失败测试检查文件和 trace |
| 同一对手连续拒绝 | `projectAgentGuard.ts`、`notificationStore.ts` | 第三次拒绝停止修改、一次需要处理的通知、通知级别持久保存 |
| 双人双 Agent 完成任务 | `round2-dual-agent.spec.ts` | 两个真实 Chromium 上下文、两个真实 Agent、4 次公开判定、全部优惠验收通过 |

真实运行中曾出现的重复公开声明误阻断，已记录于 [stage-3.md](stage-3.md)。原 `fetch failed` 的历史原因缺少可核验数据，诊断边界与当前字段见 [网络错误说明](known-issues/agent-network.md)。

真实调用用例要求显式开启 `SIMPLERCP_LIVE_AGENT_TESTS=1`。最终双 Agent 浏览器验收使用 `SIMPLERCP_ROUND2_LIVE=1`；日常回归保持关闭。调用预算情况与回归结果见阶段报告和验证记录。
