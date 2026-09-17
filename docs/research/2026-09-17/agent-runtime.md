# Agent Runtime 调研

调研日期：2026-09-17

## 目标

选择一个支持服务端运行、多人分别创建 session、持续读取 trace、方便二次开发的开源 Coding Agent。

## OpenCode

OpenCode 提供服务端模式、官方 TypeScript SDK、HTTP API 和 SSE。可用能力覆盖：

- 创建、查询和继续 session。
- 异步 prompt 与取消。
- session status 与 diff。
- 消息、工具、命令、文件变化、费用、token 和错误事件。
- Provider 与 Model 配置。
- 服务端进程管理。

SimpleRCPv2 可以把 OpenCode 绑定到回环地址，由服务端持有 SDK client，并把 SSE 转换成自身 trace 事件。每位成员拥有独立 session，同一服务进程可以管理多个 session。

## DeepSeek Harness

DeepSeek Harness 的 session event、JSONL 保存、fork、Credentials 和子 Agent 设计较完整，适合需要更深运行控制的系统。当前组件数量和开发预览状态会增加基线维护范围。

## 选择

基线采用 OpenCode，Provider 使用 DeepSeek。DeepSeek Harness 可以作为新的 `AgentRuntime` 实现加入，不改变项目、run 和 trace 数据结构。

## 配置结论

- Agent 固定为 OpenCode 内置 `build` Agent。
- Provider 固定为 DeepSeek。
- Model 允许在系统设置中修改。
- API Key 只保存在 SimpleRCPv2 的服务端 secrets 文件。
- OpenCode 端口不提供给浏览器。
- 安装检查不调用模型。

## session 与并发结论

- 新任务创建新 session。
- 继续任务复用原 session。
- 每位成员可以拥有多个 session。
- 多位成员可以同时提交 run。
- 基线为每个项目维护一个 FIFO 队列，避免多个 Agent 同时修改同一项目目录；不同项目可以同时执行。
- 队列需要取消、超时和服务重启清理。

同一项目并行执行的调研见 [Agent 并行执行调研](./parallel-agent.md)。

## trace 结论

每个 run 保存 JSONL，包含原始事件和系统标准事件。标准事件至少覆盖消息、工具、命令、文件变化、权限记录、状态、token、费用、错误和结束原因。未知事件继续保存，便于 OpenCode 升级后检查。
