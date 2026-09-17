# SimpleRCPv2 默认 Coding Agent 运行方式调研

状态：待讨论

更新时间：2026-09-17

## 推荐选择

基线版本采用 **OpenCode**，由 SimpleRCPv2 服务端启动 `opencode serve`，通过官方 HTTP API 与 TypeScript SDK 管理会话，通过 SSE 接收运行事件。

这条接入方式满足当前范围：

1. SimpleRCPv2 与 OpenCode 都以 TypeScript 为主要语言，服务端可以直接使用官方 `@opencode-ai/sdk`。
2. `opencode serve` 提供 OpenAPI、会话、异步 prompt、取消、权限回复、文件差异和 SSE 事件接口。
3. 服务端启动子进程时可以把 `cwd` 设为用户选中的项目目录。`opencode run` 也原生提供 `--dir` 参数，适合命令行验收。
4. OpenCode 支持全局配置、项目配置、运行时配置、默认 Agent、模型选择和 Provider 认证。
5. API Key 可以由服务端写入 OpenCode 的认证存储；浏览器只接收 Provider 已连接状态。
6. OpenCode 同时保留 `opencode acp`，以后需要编辑器互通或接入多个 ACP Agent 时仍有现成入口。
7. OpenCode 使用 MIT License。GitHub 在 2026-09-14 发布 `v1.18.31`，仓库在本次调研时仍持续更新。

OpenHands Agent Server 的事件记录与运行隔离能力更完整，也需要 Python Agent Server、workspace、conversation 持久化和更多配置。它适合后续需要远程运行、多种 Agent、容器运行和长期任务的阶段。当前基线版本以界面简单、启动快速和 Node.js 接入为主要目标，OpenCode 所需组件更少。

## 服务端运行方式

SimpleRCPv2 保持一个内部 `AgentRuntime` 接口，OpenCode 是当前实现。前端不接触 OpenCode 端口、API Key 或子进程命令。

项目进入流程增加以下步骤：

1. 用户选择、导入或创建项目。
2. SimpleRCPv2 得到该项目的绝对路径。
3. 服务端启动 OpenCode 子进程，将进程 `cwd` 设为该项目路径，并绑定回环地址与空闲端口。
4. 服务端调用 `/global/health`，确认版本与服务状态。
5. 服务端创建 OpenCode session，并订阅 `/event` SSE。
6. 用户发送 Agent 任务时，服务端调用异步 prompt 接口。
7. SimpleRCPv2 把事件写入自己的 `AgentRun`，同时推送给房间中的协作者。
8. 用户取消任务时，服务端调用 session abort 接口。
9. 项目无人使用且 Agent 空闲后，服务端关闭 OpenCode 子进程。

建议的启动参数：

```text
opencode serve --hostname 127.0.0.1 --port <allocated-port>
```

SimpleRCPv2 使用 Node.js `spawn` 的 `cwd` 参数指定项目目录。`opencode serve` 当前没有 `--dir` 参数，所以项目目录由父进程指定。命令行验收可以使用：

```text
opencode run --dir <project-path> --agent build --format json "<task>"
```

`opencode run --format json` 适合安装检查与端到端验收。产品运行使用 `opencode serve`，这样可以复用进程、保留 session，并持续接收结构化事件。

## API Key 与 Agent 配置

基线版本只显示一个 Agent 设置页面，名称固定为 `OpenCode`。页面包含：

- 启用状态；
- Provider；
- Model；
- API Key 输入框；
- 连接状态；
- 测试连接按钮。

页面不提供任意可执行文件、任意启动参数或任意环境变量编辑器。默认 Agent 固定为 OpenCode 内置 `build` Agent。这样可以让设置页保持直观，也可以控制服务端启动范围。

API Key 按服务端 Provider 保存，在所有项目中共用。

以下保存流程是本调研阶段的早期方案，**已不再采用**。基线改为只把密钥保存在 SimpleRCPv2 自身的 secrets 文件中，通过环境变量注入 OpenCode 子进程，不调用 OpenCode 的 auth API，理由与最终规则见 [运行系统基线需求](./05-baseline-product-requirements.md) 第 7.0 节第 5 条。此处保留原方案作为历史记录。

1. 浏览器通过 SimpleRCPv2 管理接口提交 API Key。
2. SimpleRCPv2 服务端调用 OpenCode `PUT /auth/:id` 或 SDK 的 `auth.set()`。
3. OpenCode 将 Provider 凭据保存到自己的认证目录。官方 CLI 文档给出的默认文件是 `~/.local/share/opencode/auth.json`。
4. SimpleRCPv2 只保存 `providerId`、`modelId` 和 `configured: true`，任何读取接口都不返回 API Key。

部署时应给 OpenCode 指定单独的系统用户或单独的数据目录，避免与服务端维护者的个人 OpenCode 配置共用。若服务运行在容器中，认证目录应挂载到受控持久化目录。

OpenCode 配置支持 `OPENCODE_CONFIG`、`OPENCODE_CONFIG_DIR` 和 `OPENCODE_CONFIG_CONTENT`。基线版本建议用 `OPENCODE_CONFIG_CONTENT` 传入由 SimpleRCPv2 生成的运行配置，不向用户项目写入 `opencode.json`。需要保留的字段只有：

```json
{
  "model": "<provider>/<model>",
  "default_agent": "build",
  "share": "disabled"
}
```

项目已有 `opencode.json` 时，OpenCode 会按官方优先级合并配置。SimpleRCPv2 的设置页应显示“项目含有 OpenCode 配置”，并展示当前生效的 Provider、Model 与 Agent，避免用户看到的值和运行值不一致。

## trace 与界面事件

OpenCode Server 提供 `/event` 与 `/global/event` SSE，并提供 session message、status、diff、todo、permission 和 abort 接口。官方 session event 类型还包含：

- prompt 接收；
- Agent 与 Model 切换；
- step 开始、完成与失败；
- 文本增量与完整文本；
- reasoning 增量与完整内容；
- tool 输入、调用、进度、成功与失败；
- shell 命令开始、输出与结束；
- token、费用、文件路径与重试信息。

SimpleRCPv2 不直接把原始事件对象显示给用户。服务端把它们转换为以下 UI 状态：

- `queued`：任务已经创建；
- `running`：Agent 正在处理；
- `message`：Agent 给用户的文本；
- `tool`：工具名称、目标文件或命令、状态、耗时；
- `permission`：需要用户决定的操作；
- `changed_files`：本次 session 的文件差异；
- `completed`：任务完成，显示 token、费用和修改文件；
- `failed`：显示错误位置与可重试信息；
- `cancelled`：用户已经取消任务。

服务端同时保存原始事件。后续分析可以基于 `runId`、`sessionId`、事件类型、时间、tool、文件路径、token、费用和结束状态进行查询。模型的 reasoning 内容由 Provider 决定，界面不能承诺每个模型都会提供完整 reasoning。

OpenCode 的事件类型目前仍在演进。开始开发时应固定 OpenCode 版本和 `@opencode-ai/sdk` 版本，并为未知事件保留忽略与记录能力。升级 OpenCode 时单独运行 Agent E2E，确认事件映射与权限回复接口仍然可用。

## 与 ACP 的关系

ACP 适合“一个编辑器连接多种 Agent”与“一种 Agent 接入多种编辑器”。它定义初始化、session、prompt、流式更新、tool call、文件请求、终端和权限交互。OpenCode 通过 `opencode acp` 提供该能力，传输方式是 stdio 上的 JSON-RPC。

SimpleRCPv2 当前只接入一个 Agent 实现，并且需要 OpenCode 的 session 历史、文件差异、Provider 配置与完整事件流。直接使用 OpenCode Server API 可以少维护一层 stdio 进程通信，也能直接使用官方 TypeScript SDK。

基线版本的选择是：

- SimpleRCPv2 与 OpenCode 之间使用 HTTP、SSE 和官方 SDK；
- SimpleRCPv2 内部只依赖 `AgentRuntime` 接口；
- ACP 暂时保留为后续适配方式；
- 前端只使用 SimpleRCPv2 自己的 Agent API，不感知 OpenCode API 或 ACP。

以下接口草案来自调研阶段。基线最终采用的版本不含 `replyPermission`，见 [运行系统基线需求](./05-baseline-product-requirements.md) 第 6 节。

```ts
interface AgentRuntime {
  startProject(projectPath: string): Promise<void>;
  createRun(input: AgentRunInput): Promise<AgentRun>;
  subscribe(runId: string): AsyncIterable<AgentRunEvent>;
  replyPermission(runId: string, input: PermissionReply): Promise<void>;
  cancel(runId: string): Promise<void>;
  getDiff(runId: string): Promise<AgentFileDiff[]>;
  stopProject(projectPath: string): Promise<void>;
}
```

以后增加 ACP Agent 时新增 `AcpAgentRuntime` 即可。现有房间、聊天、项目与 Agent Run 数据结构无需跟随通信方式变化。

## OpenCode 适用情况

### CLI 与项目目录

`opencode run` 支持 `--dir`、`--agent`、`--model`、`--format json` 和 `--attach`。`opencode serve` 提供常驻 HTTP 服务。服务端可以按项目路径启动一个 OpenCode 进程，也可以在进程空闲后关闭它。

### API Key

OpenCode 支持 `opencode auth login`、环境变量、项目 `.env`、Provider 配置和 Auth API。SimpleRCPv2 应使用 Auth API 或独立认证目录，不让 API Key 进入项目文件。

### trace

HTTP Server 提供 SSE、session messages、session status、session diff 与 permission reply。事件类型覆盖文本、reasoning、tool、shell、step、token、费用、重试与失败，适合实时界面和后续分析。

### 二次开发

官方 SDK 提供 TypeScript 类型，类型由 OpenAPI 生成。SimpleRCPv2 服务端可以直接创建 session、发送 prompt、订阅事件、取消任务和提交权限决定。OpenCode 自身也使用客户端连接同一 Server API，这个接口是其多客户端设计的一部分。

### 许可证与维护

MIT License。`v1.18.31` 发布于 2026-09-14，GitHub 仓库在 2026-09-17 仍有提交。

## OpenHands 适用情况

当前 OpenHands 主仓库提供 Agent Canvas。Agent Canvas 可以连接 OpenHands、Claude Code、Codex、Gemini 与 ACP Agent，并通过 OpenHands Agent Server 运行会话。

OpenHands Software Agent SDK 提供 Python、TypeScript 和 REST API。Agent Server 提供 conversation CRUD、事件查询、WebSocket 事件流、webhook、本地事件文件、workspace 和 API Key 认证。它也支持 completion logging 与 OpenTelemetry tracing，分析能力完整。

与 SimpleRCPv2 当前范围有关的成本包括：

- 需要运行 Python Agent Server；
- conversation、workspace、事件和 secret 都有独立的数据模型；
- 官方 TypeScript Client 明确标记为 alpha，API 可能发生不兼容变化；
- Agent Canvas 已经覆盖多后端、自动任务与远程运行，和 SimpleRCPv2 的项目协作界面存在较多重复能力。

OpenHands SDK 与 Agent Server 使用 MIT License。SDK `v1.49.0` 发布于 2026-09-16，维护频率很高。后续若需求进入远程 Agent、多 Agent、容器 workspace 或跨机器长任务，可以再次评估 OpenHands Agent Server。

## Aider 适用情况

Aider 的命令行运行直接，进入项目目录后可以用 `aider --message` 执行单次任务，也支持 `--model`、`--api-key`、`--yes-always`、lint、test 与 Git 提交。

它提供终端流式输出、chat history、LLM history 与 analytics log。官方配置选项没有提供稳定的 HTTP Server、SSE、WebSocket 或带类型的 tool 事件接口。SimpleRCPv2 若使用 Aider，需要解析命令行文本，或直接依赖 Aider 的 Python 内部模块。这会增加版本升级与事件映射的维护内容。

Aider 使用 Apache-2.0 License。最新 GitHub Release `v0.86.0` 发布于 2025-08-09，仓库最近一次 push 时间为 2026-05-22。它适合作为终端配对编程工具，当前不作为 SimpleRCPv2 的默认运行组件。

## SWE-agent 适用情况

SWE-agent 面向给定问题后自主修改仓库。`sweagent run` 通过层级参数指定 Model、问题和 repo，默认使用 Docker 运行环境。每次运行会保存 trajectory，里面包含完整任务过程，适合研究与离线分析。

SWE-agent 官方 README 已说明主要开发工作转向 mini-SWE-agent，并建议新用户使用 mini-SWE-agent。SWE-agent 最新 GitHub Release `v1.1.0` 发布于 2025-05-22。它没有面向协作界面的常驻服务与实时事件接口，启动参数和运行环境也比 OpenCode 多。

SWE-agent 使用 MIT License。它适合基准测试、批量问题处理与 trajectory 研究，当前不作为 SimpleRCPv2 的默认运行组件。

## 开发边界

基线版本只实现以下能力：

1. 一个可替换的 OpenCode runtime；
2. 一个服务端范围的 Provider 与 API Key；
3. 每个项目多个成员任务进入一个写入队列；
4. Agent 直接操作项目目录；
5. OpenCode SSE 转换为 SimpleRCPv2 `AgentRunEvent`；
6. 聊天输入、取消、权限回复、运行记录与文件差异；
7. 一个真实 Agent E2E，使用测试项目和专用 API Key；
8. 普通逻辑测试覆盖事件转换、状态变化和敏感字段过滤。

暂时不加入 Agent 命令编辑器、多 Agent 选择、ACP Harness、远程 Agent Server、自动任务、Agent marketplace 与多层角色权限。

Agent 直接修改项目目录时，现有文件 watcher 会把变化同步到协作文档。开发前需要确认 Yjs 与 watcher 对外部写入的处理顺序，并在 E2E 中验证：两名用户在线、Agent 修改当前打开文件、两端内容一致、运行记录显示对应文件差异。

## 原始资料

### OpenCode

- [CLI 文档](https://github.com/anomalyco/opencode/blob/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/packages/web/src/content/docs/cli.mdx)
- [Server API 文档](https://github.com/anomalyco/opencode/blob/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/packages/web/src/content/docs/server.mdx)
- [TypeScript SDK 文档](https://github.com/anomalyco/opencode/blob/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/packages/web/src/content/docs/sdk.mdx)
- [配置文档](https://github.com/anomalyco/opencode/blob/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/packages/web/src/content/docs/config.mdx)
- [ACP 文档](https://github.com/anomalyco/opencode/blob/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/packages/web/src/content/docs/acp.mdx)
- [Session event 类型](https://github.com/anomalyco/opencode/blob/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/packages/schema/src/session-event.ts)
- [MIT License](https://github.com/anomalyco/opencode/blob/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/LICENSE)
- [GitHub 仓库信息](https://api.github.com/repos/anomalyco/opencode)
- [`v1.18.31` Release](https://github.com/anomalyco/opencode/releases/tag/v1.18.31)

### OpenHands

- [Agent Canvas README](https://github.com/OpenHands/OpenHands/blob/a0403035a20c91decadd011b907ee5b489f6788b/README.md)
- [Software Agent SDK README](https://github.com/OpenHands/software-agent-sdk/blob/7ae26ccb7f13304f826d32a66d5a2a2f97784747/README.md)
- [Agent Server README](https://github.com/OpenHands/software-agent-sdk/blob/7ae26ccb7f13304f826d32a66d5a2a2f97784747/openhands-agent-server/openhands/agent_server/README.md)
- [TypeScript Client README](https://github.com/OpenHands/software-agent-sdk/blob/7ae26ccb7f13304f826d32a66d5a2a2f97784747/clients/typescript/README.md)
- [MIT License](https://github.com/OpenHands/software-agent-sdk/blob/7ae26ccb7f13304f826d32a66d5a2a2f97784747/LICENSE)
- [SDK `v1.49.0` Release](https://github.com/OpenHands/software-agent-sdk/releases/tag/v1.49.0)

### Aider

- [Aider README](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/README.md)
- [配置选项](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/website/docs/config/options.md)
- [Apache-2.0 License 与仓库信息](https://api.github.com/repos/Aider-AI/aider)
- [`v0.86.0` Release](https://github.com/Aider-AI/aider/releases/tag/v0.86.0)

### SWE-agent

- [SWE-agent README](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/README.md)
- [命令行入门](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/docs/usage/hello_world.md)
- [MIT License](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/LICENSE)
- [`v1.1.0` Release](https://github.com/SWE-agent/SWE-agent/releases/tag/v1.1.0)
