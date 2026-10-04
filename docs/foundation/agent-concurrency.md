# Agent 并发运行

更新时间：2026-10-05

每个项目维护等待列表、活动 run 集合和活动 session 集合。默认最多同时运行 3 个 run，可通过 `SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS` 设置。调度器按照入队顺序寻找可运行的 run；同一个 `sessionId` 已有活动 run 时，后续 session 仍可以启动。设置为 1 时按入队顺序逐个执行。

取消等待中的 run 会移出等待列表。取消活动 run 只调用对应 session 的 `runtime.cancel`，结束记录仍执行工作区快照归属。项目删除和服务关闭会取消活动 session，并等待活动 Promise 结束。工作区没有 `.git` 时，团队 Agent 的初始化拥有独占调度资格；`prepareWorkspace` 返回后立即释放资格，其他 run 可以继续启动。

运行期间订阅 OpenCode `message.part.updated` 事件，按 `sessionID` 过滤。`edit`、`write`、`patch` 和 `multiedit` 工具完成事件从 `state.input.filePath` 或 `path` 读取路径。`apply_patch` 使用完成事件的 `state.metadata.files`，每项包含 `filePath`，移动文件时还包含 `movePath`。台账同时登记原路径与目标路径。文件写入完成后读取磁盘内容并计算 SHA-256；文件已被删除或移动时记录 `contentHash: null` 与原因，其他读取错误直接传播。

每个 run 保存完整的 `overlappingRunIds`，包括后启动且提前结束的 run。完成、取消、失败和超时共用 `recordFinishedFileChanges`，合并工作区快照差集与 runtime diff。台账中的文件使用 `attribution: "tool"`。某个重叠 run 台账中的文件若不在本 run 台账中，会从本 run 的 `fileChanges` 中移除。剩余文件在整个运行期间没有其他 Agent 活动且没有成员修改同一路径时使用 `exclusive`；存在同期活动或成员修改时使用 `ambiguous`，并写入 `unattributed_change`。每个文件只登记一次。成员 revision 增加时登记 `concurrent_change`；真实重叠 run 的同路径台账写入双方 `agent_overlap`。关联的全部 run 结束后清理台账，项目与服务关闭时清理相关状态。

OpenCode `session.diff` 核实脚本位于 `scripts/verify-opencode-concurrent-diff.mjs`。归属判断不依赖 session diff 的隔离语义，核实输出见 `docs/conflict-guard/evidence/stage-0-session-diff.json`。

设置接口允许运行期间保存新模型。活动 run 继续使用当前 OpenCode 进程模型；跨项目全局活动引用归零后，所有等待中的 `getClient` 和 `createSession` 共享同一个模型切换 Promise。每个 run 的 `model` 字段记录它实际使用的模型。事件监听与模型切换的错误直接传播。

调度循环位于 `agentScheduler.ts`，等待任务选择位于 `agentRunSelection.ts`。无效 session 的任务进入 failed。AgentPanel 顶部显示运行中任务，当前会话的对话仅包含自己的 run。

代码提交为 `11d2947`，验收使用产品提交 `0cd88f6`。测试配置、完整命令和真实 runtime 证据见 [阶段 0 验收报告](../conflict-guard/stage-0.md) 与 [原始输出说明](../conflict-guard/evidence/self-acceptance/README.md)。
