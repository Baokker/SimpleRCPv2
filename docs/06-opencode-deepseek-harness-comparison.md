# OpenCode 与 DeepSeek Harness 比较

状态：讨论稿

更新时间：2026-09-17

## 结论

当前基线需求已经采用“每个人各自调用 Agent”的模型：[05-baseline-product-requirements.md](05-baseline-product-requirements.md) 定义成员任务、独立 session 和项目写入队列。

基线版本应把 Agent 归属从项目改为运行请求发起人：每个用户可以在同一个项目内建立多个任务 session。服务端保留一个项目级 OpenCode Server 进程，运行请求各自建立 OpenCode session。一次新的任务建立新的 session；同一用户对同一任务继续提问时复用原 session。一个 session 可以对应多个 SimpleRCPv2 `AgentRun`，每个 run 保存发起用户、项目、runtime、OpenCode session id、状态和原始事件。

为了控制多人同时修改同一个目录带来的覆盖问题，基线版本允许多个 Agent 会话存在，同时只允许一个会话取得项目写入权。没有写入权的运行请求可以进入队列，服务端不会向 OpenCode 发送会修改文件的 prompt。写入权释放后，队列中的任务按照创建顺序取得写入权。用户可以取消自己的排队任务，也可以取消自己正在运行的任务。项目页面需要显示当前写入者和排队数量。

这个规则保留了“每个人都有自己的 Agent”与“项目文件不会由多个进程同时修改”两个目标。为每一个任务创建独立工作副本会增加文件同步、差异合并和提交回写流程，暂时不加入基线版本。

## OpenCode 能力

OpenCode 官方 Server 文档把 `opencode serve` 定义为无界面 HTTP Server，并提供 OpenAPI 文档。Server 支持一个项目下的多个 session：`POST /session` 创建 session，`GET /session` 列出 session，`POST /session/:id/message` 等待一次回复，`POST /session/:id/prompt_async` 异步发送 prompt，`POST /session/:id/abort` 取消运行，`GET /session/:id/diff` 获取 session 差异。`GET /event` 提供 Server-Sent Events，`GET /global/event` 提供全局事件。官方 SDK 通过 `createOpencode` 建立客户端，类型由 Server 的 OpenAPI 定义生成。

OpenCode 的 session 是 Agent 的持续对话记录。一次 session 可以接收多条消息，也可以通过 session 继续后续任务。新的独立任务应使用新的 session，这样每个用户可以拥有独立上下文和独立 trace。继续同一个任务时复用原 session，事件和差异仍然可以按一个 session 查询。

OpenCode 的 session 隔离主要针对对话、事件和差异。多个 session 仍可以使用同一个项目目录，文件工具和 shell 工具会作用于 Server 当前项目。因此 OpenCode 本身不能替代 SimpleRCPv2 的项目写入调度。基线版本需要在 SimpleRCPv2 服务端保存一个项目写入锁，并在取得写入权后才发送会修改文件的 prompt。

OpenCode Server 支持 `OPENCODE_SERVER_PASSWORD`、`OPENCODE_SERVER_USERNAME`，可以在回环地址上继续增加 HTTP Basic Auth。SimpleRCPv2 不应把 OpenCode 端口暴露给浏览器；浏览器只访问 SimpleRCPv2 的 API 和 WebSocket。

OpenCode 官方文档也说明 Server 支持 Provider 列表、认证接口、配置接口和 Agent 列表。SimpleRCPv2 可以在服务端保存全局 DeepSeek API Key，再通过 OpenCode 的认证接口或受控运行环境提供给 OpenCode。浏览器只读取 Provider 已连接状态、模型名称和 Agent 名称，不读取密钥。Provider 与 Model 可以在服务端配置；基线页面只显示 DeepSeek Provider、一个默认模型和 OpenCode 内置 Agent，后续再增加其他 Provider 或 Agent。

OpenCode 使用 MIT License。接入时应固定 OpenCode CLI 与 `@opencode-ai/sdk` 的版本，并把未识别事件保存为原始 JSON，防止事件类型增加时丢失 trace。

## DeepSeek Harness 能力

DeepSeek Harness 是 DeepSeek AI 发布的 MIT License 开源项目，当前 README 将它标记为 developer preview，并明确提示会发生不兼容变化。项目采用 Cordis 插件架构，包含 Agent、Agent loop、Session、Session persistence、Workspace、Credentials、SDK、API 和 Subagent 等多个包。

`@deepseek-ai/dsh-agent` 提供 `ctx.agents.create()` 和 `ctx.agents.resume()`。创建操作会建立新的 Agent 与 Session；恢复操作会从持久化 Session 重建 Agent。每个 Agent 有自己的 `AgentHandle`、Session、状态、消息队列和 Agent 作用域。`followup()`、`steer()`、`inject()` 和 `cancel()` 可以分别发送后续消息、引导当前步骤、注入下一步上下文和取消运行。这个模型天然支持多个根 Agent 并行存在，每个根 Agent 可以对应一个用户或一个任务。

DeepSeek Harness 的 Session persistence 服务提供单个 Session 的追加事件日志。JSONL backend 为每个 Session 保存独立目录和日志文件；写入句柄只有一个写入所有者，其他写入者会被拒绝。它还提供跨进程文件锁，因此同一个 Session 不会由多个进程同时写入。这个保护只针对同一个 Session 的日志，不能阻止两个 Session 同时修改同一个项目目录。

DeepSeek Harness 的 SDK JSON-RPC Server 为每个 `sessionId` 建立一个 Agent，并通过 `session.event` 推送全部 SessionEvent，通过 `session.status` 推送运行状态。SDK 协议的 `session/prompt` 只返回消息已经进入队列的 `messageId`，不会返回某一个 prompt 的最终结果。协议当前没有单独的 Session 关闭方法或 prompt 取消方法；Agent 直到运行时进程关闭才释放。若使用 `dsh-subagent-dsh-sdk`，每一个运行都会启动一个新的 Harness 子进程、独立配置、独立 Session 和独立工具集合，完整 trace 会留在子进程的 Session root 中，父进程只取得最终文本和安全错误信息。

DeepSeek Harness 的 Credentials 服务可以把 `DEEPSEEK_API_KEY` 作为引用保存，读取接口按每次请求解析当前值；配置界面只能显示是否已配置、来源和是否可写，不能返回密钥。这个能力适合服务端全局密钥，但需要把 Harness Credential store 的配置、持久化目录和权限一起纳入部署设计。

DeepSeek Harness 已经有完整的 SessionEvent 词汇、JSONL persistence、Session 查询和 SDK 事件流，trace 能力强。它的接入成本来自完整插件组成、配置文件、运行时进程、版本变化、Session projection 和较大的模型与工具范围。SimpleRCPv2 如果只需要一个 Coding Agent，需要重复维护一部分已有的会话、事件、凭据和运行控制逻辑。

## 两个 runtime 的选择

### OpenCode

OpenCode 更适合 SimpleRCPv2 的基线版本，原因如下：

- Server API 与 TypeScript SDK 直接提供 session、异步 prompt、取消、差异、权限和 SSE。
- 一个项目 Server 可以承载多个 session，适合把 Agent 会话归属到具体用户和任务。
- 服务端只需要保存 OpenCode session id 与标准化 trace，不需要启动完整 Harness 插件树。
- DeepSeek Provider 已经由 OpenCode 支持，默认 Provider 可以设置为 DeepSeek。
- MIT License，接入时只需要固定 CLI 和 SDK 版本。

OpenCode 的主要限制是 session 不会自动隔离同一个项目目录。SimpleRCPv2 必须自己实现项目写入调度；这项调度属于产品层功能，不能交给 OpenCode session。

### DeepSeek Harness

DeepSeek Harness 更适合以下后续方向：需要完整 SessionEvent 记录、需要多种 Harness 插件、需要子 Agent、需要跨进程 Session persistence，或者希望把 Agent loop、Credentials、Workspace 和工具服务作为统一运行时使用。

它不适合作为当前基线的默认运行组件，原因是它会把完整 Harness 产品能力引入 SimpleRCPv2。当前 API 处于 developer preview，使用 SDK 子进程时每次运行还需要新的进程和 profile。它可以通过多个根 Agent 支持多人运行，但项目目录写入仍然需要 SimpleRCPv2 的项目级调度。

### 推荐

基线版本使用 OpenCode Server API，并在 SimpleRCPv2 内部定义可替换的 `AgentRuntime` 接口。接口只表达产品需要的能力：创建新运行、复用运行会话、订阅标准化事件、取消运行、响应权限、读取差异和释放项目运行时。当前实现为 `OpenCodeRuntime`，以后增加 DeepSeek Harness 时新增 `DeepSeekHarnessRuntime`，不修改项目、用户、任务和 trace 数据结构。

## 基线运行模型

### 用户与会话

每个用户在项目内发起 Agent 任务时，服务端创建：

- 一个 SimpleRCPv2 `AgentRun`；
- 一个新的 OpenCode session；
- 一个 trace 订阅；
- 一个发起用户 id；
- 一个任务提示和创建时间。

同一个用户点击“继续”时，服务端向原 OpenCode session 发送下一条消息，保留上下文、差异和事件序列。用户开始全新任务时建立新的 session，不复用旧任务的上下文。

### 项目写入调度

一个项目可以有多个 AgentRun，但只允许一个 `writing` 状态的 AgentRun。服务端把运行分为 `queued`、`running`、`waiting_permission`、`completed`、`failed`、`cancelled` 六种状态。新任务先进入 `queued`；取得项目写入权后才向 OpenCode 发送 prompt，随后变为 `running`。权限请求暂停当前运行，写入权仍由该运行持有，直到用户回复、取消或运行结束。

用户可以查看自己的运行详情，也可以查看项目中其他运行的摘要、状态和修改文件。没有权限的用户不能取消别人的运行，也不能替别人回复权限请求。基线版本继续采用项目成员默认可以协作的模型，不增加复杂的角色系统。

### trace

服务端将 OpenCode 事件保存为 JSONL，每行至少包含 `runId`、`projectId`、`userId`、`sessionId`、事件时间、事件类型和原始事件。界面只显示标准化事件：消息、工具调用、命令、权限请求、修改文件、状态、token、费用、错误和结束原因。未知事件仍保存原始数据，并在界面显示“未识别事件”，保证升级 OpenCode 后仍可以查询原始记录。

### 项目运行时

基线版本按项目启动一个 OpenCode Server，进程使用项目目录作为 `cwd`，监听 `127.0.0.1` 的服务端分配端口。项目没有用户连接且没有运行任务时，服务端关闭该进程。一个项目 Server 承载项目内全部 OpenCode session；session 创建和 trace 订阅由 `AgentRunManager` 管理。

## 对当前需求文档的调整

当前需求文档已经采用以下设计：Agent runtime 属于服务端，任务和 session 属于发起它们的成员；项目只负责安排 Agent 写入顺序。

该设计包含以下内容：

- Agent 配置归属于服务端 runtime，Agent 会话归属于用户发起的 AgentRun。
- 新任务创建新 session，同一任务的继续消息复用原 session。
- 一个项目允许多个 AgentRun，但项目只有一个写入权持有者，其他运行进入队列。
- AgentRun 保存发起用户、session id、写入权状态和 trace。
- 项目页面显示运行列表、当前写入者、队列、自己的运行和自己的继续入口。
- AgentRuntime 接口保持 provider 无关，OpenCode 是当前实现。
- E2E 测试覆盖两个用户同时发起任务、第二个任务排队、第一任务结束后第二任务继续、同一任务继续提问、取消排队任务和保存完整 trace。

暂时不加入多个工作副本、自动合并、冲突解决编辑器、跨项目 Agent、用户自定义命令、任意 runtime 参数编辑器和多 Provider 选择器。这些功能会改变基线的文件一致性模型或增加配置界面数量。

## 产品流程判断

项目首页选择项目、进入协作空间、选择自己的 Agent 任务、观察任务和继续会话，这条流程是合理的。需要把“选择 Agent”改成“发起任务”，这样用户无需先理解 runtime、session 或 ACP。页面只显示当前可用的 OpenCode、DeepSeek Provider、模型和运行状态。

项目进入后，用户可以直接编辑文件、使用终端、聊天或发起 Agent 任务。Agent 任务单独显示在运行栏中；任务消息、工具事件、权限请求和修改文件都在同一条运行详情内。运行结束后，用户可以继续对话，或者建立新的任务。

“每个人有自己的 session，同时项目只有一个写入者”是当前最简洁的多人模型。它没有把 Agent 限制为项目公共对象，也没有让多个 Agent 同时写入同一目录。后续需要多 Agent 并行修改时，可以把写入权从项目目录改为每个 Agent 工作副本，再增加差异合并流程。

## 官方资料与本地资料

- [OpenCode Server 官方文档](https://raw.githubusercontent.com/anomalyco/opencode/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/packages/web/src/content/docs/server.mdx)
- [OpenCode SDK 官方文档](https://raw.githubusercontent.com/anomalyco/opencode/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/packages/web/src/content/docs/sdk.mdx)
- [OpenCode Provider 官方文档](https://raw.githubusercontent.com/anomalyco/opencode/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/packages/web/src/content/docs/providers.mdx)
- [OpenCode MIT License](https://github.com/anomalyco/opencode/blob/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/LICENSE)
- [DeepSeek Harness README](/Users/baokker/Documents/deepseek-harness/README.md)
- [DeepSeek Harness 架构文档](/Users/baokker/Documents/deepseek-harness/docs/architecture.md)
- [DeepSeek Harness Agent 文档](/Users/baokker/Documents/deepseek-harness/packages/core/agent/README.md)
- [DeepSeek Harness Subagent 文档](/Users/baokker/Documents/deepseek-harness/packages/subagent/subagent/README.md)
- [DeepSeek Harness JSONL Session persistence 文档](/Users/baokker/Documents/deepseek-harness/packages/session/session-persistence-jsonl/README.md)
- [DeepSeek Harness Credentials 文档](/Users/baokker/Documents/deepseek-harness/packages/credentials/credentials/README.md)
- [DeepSeek Harness MIT License](/Users/baokker/Documents/deepseek-harness/LICENSE)
