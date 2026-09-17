# ACP Agent 调研

调研日期：2026-08-09

## 调研问题

本次调研关注 ACP 是否适合 SimpleRCPv2 的 Agent 接入，以及直接通过 OpenCode Server 接入时需要保留哪些能力。

## ACP 可以提供的能力

ACP 定义 session、prompt、流式 update、权限请求和部分文件工具。它适合客户端连接多个遵循同一协议的 Agent，也适合把 Agent 作为独立进程运行。

协议本身不能保证 Agent 的全部文件操作都经过客户端文件回调。OpenCode 的内部文件和 shell 工具可以直接访问 session 的 `cwd`。因此，即使接入 ACP，SimpleRCPv2 仍然需要管理项目目录、Agent 进程、文件变化、trace 和并发写入。

## 对基线的结论

基线只接入 OpenCode，直接使用 `opencode serve`、官方 TypeScript SDK、HTTP API 和 SSE。这样可以直接获得 session、异步 prompt、取消、diff、状态和事件流，同时减少 ACP capability 与文件工具映射。

服务端仍然定义通用 `AgentRuntime`，产品数据使用 `runId`、`sessionId` 和标准 trace 事件，不包含 ACP 专用字段。增加其他 Agent 时，可以提供新的 runtime 实现。

ACP 保留为后续 runtime 的可选传输方式。需要接入多个现成 ACP Agent 时，再增加 `AcpAgentRuntime`。

## 保留的设计经验

- Agent 进程只在服务端运行，浏览器不能访问 Agent 端口、启动命令和 API Key。
- 每个新任务创建 session，继续任务复用原 session。
- 原始 Agent 事件和系统标准事件同时保存。
- Agent 直接访问共享项目目录时，必须明确记录成员并行编辑风险。
- 独立工作目录加三方合并可以解决 Agent 过期写入问题，相关方向记录在产品已知问题中。
