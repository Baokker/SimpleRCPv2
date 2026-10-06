# 检查点 B 后续复核

复核基准为 `5d0aa3d...b62f1f8`，分支为 `feature/conflict-guard`。

## A2：审批期间的内容保护

`apps/server/src/agent/conflictGuardEditHandler.ts` 在读取工具输入前保存每个文件的 before 和存在状态。提案还原与批准核验使用同一份 before；批准回调执行前再次检查取消信号。`agentRunManager.ts` 收到 permission.asked 后立即启动审批处理，并保存事件轨迹。

生产参数用例 `captures the disk baseline before awaiting tool input with production persistence timings` 使用 createApp、WebsocketProvider 和磁盘文件：工具输入读取等待 1500 ms，期间人类修改 Cart.add。审批返回要求重新读取的拒绝，磁盘保留人类修改，预约被清理。

`does not activate a write reservation after approval is cancelled during disk validation` 验证异步核验期间的取消：批准回调没有执行，写入预约没有激活，文件内容保持完整。

## A1：连续内部错误计数

`apps/server/src/agent/permissionDispatcher.ts` 在正常处理结束或 PermissionEditRejected 后清理错误计数，同时清理原始路径与规范化路径的记录。达到连续停止条件的请求继续拒绝，并通知属主一次。

`counts internal failures consecutively across ordinary conflict rejections` 验证正常冲突拒绝可以结束内部错误连续计数。`clears a normalization failure after the same path resolves successfully` 使用真实符号链接，依次指向工作区外部、内部、外部、内部；四次回复为 reject、once、reject、once。

## E2：并发研判的录放一致性

`packages/conflict-guard/src/adjudication/service.ts` 分别保存共享请求的完整响应和每个订阅者的等待结果。ProviderSubscription 包含输入哈希、缓存键、角色、请求次数、等待时长、剩余预算与状态。订阅者超时只结束自己的等待；HTTP 调用次数和费用按共享请求统计，失败次数按订阅结果统计。

虚拟时钟用例 `replays staggered subscribers with their own waits and timeout outcomes` 中，两个请求分别在第 0 秒和第 6 秒开始，快判在第 7 秒完成，深判在第 9 秒完成。第一个请求在第 8 秒返回 warn，第二个返回 allow、等待 3000 ms。录制后的串行离线重放得到相同判定与延迟，角色调用总数保持为两次。

服务端保存 provider_subscription 事件。replay-check 按输入哈希与 occurrence 恢复各次研判，包括取消状态；createReplayModelPolicy 在每次回放开始时重新计数。`replays distinct outcomes for repeated inputs and resets occurrences for each replay` 验证相同输入可以对应不同判定，并验证重复回放的字节一致性。

adjudication-run 保存 model.subscriptions，adjudication-verify 自动转交这些记录。CLI 用例分别验证已有 G3 录制和包含订阅记录的报告，三轮重放均一致且网络调用次数为零。README、adjudication.md、agent-guard.md 和 trace-schema.md 已说明对应接口与行为。

## 变异检验

| 编号 | 变异内容 | 验证结果 |
|---|---|---|
| A2 | 在读取工具输入之后读取 before | 生产参数用例失败，审批回复为 once |
| A1 | 正常拒绝后保留连续内部错误计数 | 用例失败，第四次请求没有进入处理函数 |
| A1 | 只清理规范化路径的计数 | 符号链接用例失败，第四次回复为 reject |
| E2 | 禁用订阅记录恢复 | 离线结果的等待时长与录制结果不同，用例失败 |

每次变异后通过文件编辑恢复修复代码。最终分发器 17 项测试通过。

## 验证记录

| 验证 | 结果 |
|---|---|
| pnpm -r build | 通过 |
| conflict-guard 全部测试 | 22 个文件，198 项通过 |
| 服务端全部测试 | 45 个文件，264 项通过 |
| full 模式服务端轨迹核验 | 四项生产参数用例通过 |
| pnpm test:demo | 两项通过 |
| off、observe、rules、full 的 pnpm test:collab | 每种模式两项通过 |
| 已有 Playwright 用例 | 39 项通过，九项按启用条件跳过 |
| 密钥精确值扫描 | 匹配计数 0 |

时序相关用例采用 idleMs=1500 与 300 ms 文件写入延迟。Playwright 覆盖阶段 2 页签、阶段 3 冻结与撤回、阶段 4 界面回放，以及 Agent 审批和 T3。真实端点专用用例按启用条件跳过。本轮真实调用增量为 fast 0、deep 0、Agent run 0；保留集没有执行策略评价。

压缩日志及机器记录保存在 `evidence/checkpoint-b-followup/`。本轮浏览器生成的截图与界面回放记录保存在 `.test-workspaces/review-b-regression-manual/` 和 `.test-workspaces/review-b-regression-stage4-ui/`。
