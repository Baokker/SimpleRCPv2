# Agent 并发运行

更新时间：2026-10-05

每个项目维护等待列表、活动 run 集合和活动 session 集合。默认最多同时运行 3 个 run，可通过 `SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS` 设置。调度器按照入队顺序寻找可运行的 run；同一个 `sessionId` 已有活动 run 时，后续 session 仍可以启动。设置为 1 时按入队顺序逐个执行。

取消等待中的 run 会移出等待列表。取消活动 run 只调用对应 session 的 `runtime.cancel`，结束记录仍执行工作区快照归属。项目删除和服务关闭会取消活动 session，并等待活动 Promise 结束。工作区没有 `.git` 时，团队 Agent 的初始化拥有独占调度资格；`prepareWorkspace` 返回后立即释放资格，其他 run 可以继续启动。

运行期间订阅 OpenCode `message.part.updated` 事件，按 `sessionID` 过滤。`edit`、`write`、`patch` 和 `multiedit` 工具完成事件从 `state.input.filePath` 或 `path` 读取路径。`apply_patch` 使用完成事件的 `state.metadata.files`，缺少元数据时解析 patch 文本中的文件行。台账同时登记原路径与目标路径。文件写入完成后读取磁盘内容并计算 SHA-256；文件已被删除、路径为目录或读取失败时记录 `contentHash: null` 与原因，协作流程继续运行。

每个 run 保存完整的 `overlappingRunIds`，包括后启动且提前结束的 run。完成、取消、失败和超时共用 `recordFinishedFileChanges`，文件归属只使用工作区快照差集，runtime diff 只记录为 `session_diff_observed`。台账中的文件使用 `attribution: "tool"`。某个重叠 run 台账中的文件若不在本 run 台账中，会从本 run 的 `fileChanges` 中移除。剩余文件在整个运行期间没有其他 Agent 活动且没有成员修改同一路径时使用 `exclusive`；存在同期活动或成员修改时使用 `ambiguous`，并写入 `unattributed_change`。每个文件只登记一次。成员 revision 增加时登记 `concurrent_change`；真实重叠 run 的同路径台账写入双方 `agent_overlap`。关联的全部 run 结束后清理台账，项目与服务关闭时清理相关状态。

OpenCode `session.diff` 核实脚本位于 `scripts/verify-opencode-concurrent-diff.mjs`。归属判断不依赖 session diff 的隔离语义，核实输出见 `docs/conflict-guard/evidence/stage-0-session-diff.json`。

设置接口允许运行期间保存新模型。活动 run 继续使用当前 OpenCode 进程模型；跨项目全局活动引用归零后，所有等待中的 `getClient` 和 `createSession` 共享同一个模型切换 Promise。每个 run 的 `model` 字段记录它实际使用的模型。事件监听与模型切换错误会记录，模型切换失败时保留旧进程并在下一次空闲时重试。

调度循环位于 `agentScheduler.ts`，等待任务选择位于 `agentRunSelection.ts`。无效 session 的任务进入 failed。AgentPanel 顶部显示运行中任务，当前会话的对话仅包含自己的 run。

本轮修复基于 `36c3ba7`，未推送。测试配置、完整命令和 runtime 证据见 [阶段 0 验收报告](../conflict-guard/stage-0.md) 与 [原始输出说明](../conflict-guard/evidence/self-acceptance/README.md)。

## Agent 修改审批与结束检查

`rules`、`full` 中，OpenCode 的 edit 类工具需要审批；`off`、`observe` 保持 allow。权限分发器按顺序执行处理函数，只回复 once 或 reject。审批时间单独累计，run 执行超时暂停计时。取消、删除项目与服务关闭中止当前权限检查。

Agent 以 runId 为身份，ownerId 为触发成员。批准的路径与内容哈希用于文件回灌归属，Agent 活跃变更集保持至 T3 结束。T2 使用当前共享文本检查提案，已有审批预约参与并发检查；人与 Agent 冲突时只拒绝 Agent 并通知属主，人的编辑保持可用。

完成、失败、取消及超时均执行 T3，只选择运行期间被他人改变的相关符号。未经过审批的文件变化由工作区快照补充，归属不明的变化需要人工检查。服务端按完整行撤回仍保持 Agent 版本的块，保存撤回及跳过原因，原 run 状态保持任务结果。observe 记录 shadow，不执行撤回。

接口、配置、拒绝消息与使用限制见 [Agent 冲突预防](../conflict-guard/agent-guard.md)。
