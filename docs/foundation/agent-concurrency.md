# Agent 并发运行

更新时间：2026-10-04

## 调度规则

每个项目维护等待列表、活动 run 集合和活动 session 集合。默认最多同时运行 3 个 run，可通过 `SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS` 设置为不小于 1 的整数。调度器按照入队顺序寻找可运行的 run；同一个 `sessionId` 已有活动 run 时，该 run 暂停选择，后面的其他 session 仍然可以启动。设置为 1 时恢复单个项目 FIFO 行为。

取消等待中的 run 会直接移出等待列表。取消活动 run 只调用它对应 session 的 `runtime.cancel`。每个 run 独立记录完成、失败和取消状态，其他活动 run 继续运行。项目删除和服务关闭会取消所有活动 session，并等待活动 Promise 结束。

工作区没有 `.git` 时，团队 Agent 的第一次工作区准备拥有独占调度权。调度器等待项目中的其他活动 run 结束，暂停启动新的 run，完成初始化后恢复调度。个人 Agent 可以在已经开始的 run 结束后继续使用同一目录。

## 修改归属

运行期间订阅 OpenCode 事件。`edit`、`write`、`patch`、`apply_patch` 和 `multiedit` 工具完成事件从 `state.input.filePath` 或 `path` 读取文件路径。文件写入完成后读取磁盘内容，计算 SHA-256，并在 trace 中写入 `agent_write` 台账记录：run、工具调用、相对路径、完成时间和内容哈希。

run 结束时合并工作区快照差集与 runtime diff。台账中的文件使用 `attribution: "tool"`。没有台账的文件在整个运行期间没有其他 Agent 活动且没有成员修改同一路径时使用 `exclusive`；存在同期活动或成员修改时使用 `ambiguous`，并写入 `unattributed_change`。当前运行记录还会与其他 run 的台账按路径匹配，写入 `agent_overlap` 以及双方完成时间。成员并发修改继续写入 `concurrent_change`。

OpenCode `session.diff` 的验证脚本位于 `scripts/verify-opencode-concurrent-diff.mjs`。当前真实运行完成了两个 session 修改不同文件和两个 session 修改同一文件的场景；原始输出中 `differentFiles` 与 `sameFile` 均为两个空数组，工作区实际产生了文件修改。这个结果没有证明 `session.diff` 可以提供按 session 隔离的修改集合，因此当前实现使用工具台账、独占判断和不确定标记。

## 模型切换

设置接口允许运行期间保存新模型。活动 run 继续使用当前 OpenCode 进程模型；运行数归零后才重建进程并启用新模型。`/api/agent/status` 的 `modelChangePending` 为 `true` 时，客户端设置区域显示等待提示。每个 run 的 `model` 字段记录它实际使用的模型。

## 已知局限

共享目录中的 bash 或其他外部命令没有工具完成事件，只能根据快照和同期活动标为 `exclusive` 或 `ambiguous`。多个 Agent 仍然可以覆盖同一文件，成员和 Agent 也可能互相覆盖；系统只记录事实，不执行冲突检测、锁定、合并或撤回。真实 Provider 的 `session.diff` 行为仍需在可用网络和模型服务下单独完成验证。
