# Agent 并发运行

更新时间：2026-10-05

每个项目维护等待列表、活动 run 集合和活动 session 集合。默认最多同时运行 3 个 run，可通过 `SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS` 设置。调度器按照入队顺序寻找可运行的 run；同一个 `sessionId` 已有活动 run 时，后续 session 仍可以启动。设置为 1 时按入队顺序逐个执行。

取消等待中的 run 会移出等待列表。取消活动 run 只调用对应 session 的 `runtime.cancel`，结束记录仍执行工作区快照归属。项目删除和服务关闭会取消活动 session，并等待活动 Promise 结束。工作区没有 `.git` 时，团队 Agent 的初始化拥有独占调度资格；`prepareWorkspace` 返回后立即释放资格，其他 run 可以继续启动。

运行期间订阅 OpenCode 事件。`edit`、`write`、`patch`、`apply_patch` 和 `multiedit` 工具完成事件从 `state.input.filePath` 或 `path` 读取文件路径。`apply_patch` 没有单独路径字段时，从 `patchText` 的 Update、Add、Delete 和 Move 行提取文件。文件写入完成后读取磁盘内容并计算 SHA-256；读取失败仍记录台账，`contentHash` 为 `null` 并保存读取原因。

run 结束时合并工作区快照差集与 runtime diff。台账中的文件使用 `attribution: "tool"`。某个重叠 run 台账中的文件若不在本 run 台账中，会从本 run 的 `fileChanges` 中移除。剩余文件在整个运行期间没有其他 Agent 活动且没有成员修改同一路径时使用 `exclusive`；存在同期活动或成员修改时使用 `ambiguous`，并写入 `unattributed_change`。只有真实重叠 run 的同路径台账会写入双方 `agent_overlap`。

OpenCode `session.diff` 核实脚本位于 `scripts/verify-opencode-concurrent-diff.mjs`。归属判断不依赖 session diff 的隔离语义，核实输出见 `docs/conflict-guard/evidence/stage-0-session-diff.json`。

设置接口允许运行期间保存新模型。活动 run 继续使用当前 OpenCode 进程模型；活动引用归零后，所有等待中的 `getClient` 和 `createSession` 共享同一个模型切换 Promise。每个 run 的 `model` 字段记录它实际使用的模型。
