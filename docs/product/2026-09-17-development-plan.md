# SimpleRCPv2 基线开发计划

状态：协作功能已完成，下一项工作为 Agent 公共数据与设置

更新时间：2026-09-18

需求依据见 [基线需求](./2026-09-17-baseline.md)。每个阶段结束时运行对应测试，并保持项目可以启动。

## 当前进度与下一项工作

当前仓库已经包含多项目管理、项目导入与删除、Yjs 协作编辑、持久化聊天、Activity、共享终端、主题切换和公共 TypeScript 类型。

当前仓库尚未包含 OpenCode command、OpenCode SDK、Agent 设置接口、Agent run、session、trace、任务队列或 Agent 页面。`.env.example` 中的 `DEEPSEEK_API_KEY` 和 `SIMPLERCP_AGENT_MODEL` 仅用于约定后续配置，当前服务不会读取这些值来调用模型。

下一项开发工作是第 5 节的 Agent 公共数据与设置。该阶段完成以后，服务端能够保存非敏感设置、报告 API Key 是否存在，并提供后续 runtime、run 和 trace 共同使用的数据类型。OpenCode 的安装、进程管理和正式 DeepSeek 调用属于第 6 节。

Agent 各阶段遵循 TDD：为状态变化、持久化和错误条件编写测试，运行测试确认测试能够发现缺失行为，完成实现并运行全部现有测试。OpenCode 集成与 Agent E2E 使用正式 OpenCode 和专用 DeepSeek API Key，不创建替代 runtime 或伪造模型响应。

## 1. 修复文件同步

状态：部分完成。最小 delta、忽略路径、`FILESYSTEM_ORIGIN` 和 retired 文档已经完成；同一文件的异步操作队列与 revision 仍待开发。

新增 `textDelta.ts` 和 `workspacePolicy.ts`，修改 `collaborativeDocuments.ts`、`workspaceWatcher.ts`、`workspace.ts` 与 `config.ts`。

实现要求：

- 使用固定版本的 `fast-diff` 生成 Y.Text 最小 delta。
- 文件树、文件接口、watcher 和 ZIP 导入共用 `isIgnoredPath()`。
- 每个协作文档维护 revision、异步操作队列和 retired 状态。
- 成员更新与 watcher 外部变化进入同一文件操作队列，按照到达顺序执行。
- 成员更新操作在执行时读取最新 Yjs 内容并写入磁盘。
- watcher 操作在执行时读取最新磁盘内容；读取期间 revision 改变时重新排队。
- 外部 delta 使用 `FILESYSTEM_ORIGIN`，不再次写入磁盘。
- Agent 启动之前调用 `awaitIdle()`。
- 删除或类型变化先设置 retired；所有文件替换在提交前再次检查 retired，临时文件不能覆盖删除或二进制结果。
- 超过 1 MiB 的文本文件在成员确认后允许协作编辑；后续需要验证大文件的同步开销。

验收测试：同步期间继续输入不会恢复旧内容；外部多处修改保留未变化区域的 RelativePosition；连续写入不会交错；删除和类型变化不能被排队写入恢复；固定忽略路径不产生协作事件。

## 2. 建立项目注册与运行对象

状态：已经完成。Agent 数据目录在 Agent 功能开发时创建。

新增 `projects.ts`、`projectRuntime.ts` 和 `projectRuntimeManager.ts`，按 `projectId` 改写 HTTP、项目 WebSocket 与 Yjs WebSocket。

实现要求：

- `SIMPLERCP_DATA_DIR` 未设置时使用 SimpleRCPv2 仓库根目录下的 `.simplercp-data/`，设置时只接受绝对路径。
- 数据目录保存项目代码、项目注册记录、聊天、Agent run、trace 和非敏感设置；生产部署可以把整个目录挂载到持久化磁盘。
- 新建项目、ZIP 导入和已有目录导入统一写入 `projects/<projectId>/workspace/`；已有目录导入完成以后使用服务端副本。
- `ProjectRegistry` 保存已有项目、空白项目和最近打开时间。
- `ProjectRuntime` 持有单个项目的 room、chat、文档、PTY 和 watcher。
- `ProjectRuntimeManager` 按需创建和释放 runtime。
- 服务启动不再要求 `SIMPLERCP_WORKSPACE`。
- 删除 `listWorkspaceTree`，目录接口只返回下一层。
- 浏览器稳定保存 `userId`，每个标签页使用独立 `connectionId`。
- 服务端按用户保存成员资料，按连接保存在线状态、光标和当前文件；关闭一个标签页不能让同一用户的其他连接离线。
- HTTP 和 WebSocket 消息类型放在 `packages/shared`，服务端与浏览器共同使用。

验收测试：项目登记在重启后保留；两个项目完全隔离；同名用户保持独立；同一用户两个标签页的连接状态互不覆盖。

## 3. 删除权限与冗余功能

状态：已经完成。

删除 Host token、Host session、Guest 权限、命令模式、命令白名单、快捷命令接口、Session 设置页面、Python 手写补全、只读连接分支和独立录制用例。

聊天使用项目 WebSocket 发送和广播。Activity 保留成员进入、离开、文件操作和文件编辑记录；文件编辑记录显示变化行号与增删行数。共享 PTY 使用独立 Terminal WebSocket，Yjs 使用独立二进制通道。

验收测试：所有成员拥有相同能力；聊天发送一次只产生一条记录；Activity 可以打开相关文件；终端输入输出正常。

## 4. 完成项目首页、主题与 ZIP 导入

状态：已经完成。

主要文件为 `ProjectHome.tsx`、`App.tsx`、`api.ts`、`socket.ts` 和服务端 `archiveImport.ts`。

实现要求：

- `/` 显示项目列表和三个新增入口。
- 项目列表支持删除非 Demo 项目；删除时停止对应 runtime 并删除服务端副本。
- `/projects/:projectId` 显示进入表单和工作区，刷新后保持项目路径。
- 无效项目地址显示错误、重试和返回项目列表操作。
- 状态栏提供日间模式与夜间模式图标按钮，默认使用夜间模式，并把选择保存到 `localStorage`。
- 状态栏提供 Terminal 与 Collaboration 面板显示控制。
- 文件操作使用应用内窗口，显示项目根目录路径说明和请求错误。
- 编辑器显示保存状态；协作连接、Yjs 和 Terminal 显示连接状态。
- 页面使用 CSS variables 定义两套颜色；Monaco 与共享终端跟随当前主题。
- ZIP 使用成熟库读取条目，在写入前检查路径、类型、数量和声明大小。
- 解压时统计实际字节数，超出限制立即终止并清理未完成目录。
- 全部文件成功写入后再登记项目。

验收测试：已有目录登记、空白项目和正常 ZIP 可以打开；项目可以删除，已打开项目在其他客户端删除后显示提示；无效项目地址可以恢复；路径越界、特殊条目、数量超限、大小超限和重复项目全部失败；失败后没有项目记录与未完成目录；主题可以切换并在刷新后保持。

## 5. 完成 Agent 公共数据与设置

状态：下一项工作，尚未开发。

新增 `agent/agentSettingsStore.ts` 和 Agent 设置接口。公共数据类型放在 `packages/shared`。

实现要求：

- 在 `packages/shared` 定义 `AgentSettings`、`AgentRuntimeStatus`、`AgentRun`、`AgentSession`、`AgentTraceEvent` 和接口响应类型。
- run 状态使用 `queued`、`running`、`completed`、`failed` 和 `cancelled`；终止状态不能返回运行状态。
- 服务端从环境变量 `DEEPSEEK_API_KEY` 读取 API Key；本地开发读取仓库根目录 `.env`。
- `AgentSettingsStore` 把 Provider、Model 和 Enabled 保存到 `SIMPLERCP_DATA_DIR/agent/settings.json`。
- 设置存储使用同目录中间文件和 rename 更新。
- `GET /api/agent/settings` 返回 Provider、Model、Enabled 和 `apiKeyConfigured`。
- `PUT /api/agent/settings` 只允许修改非敏感设置，不接收或返回密钥明文。
- 配置缺失或内容无效时在对应请求位置报告明确错误。

验收测试：默认设置正确；设置在重启后保留；无效 Provider、Model 和 Enabled 被拒绝；接口、错误与日志不含密钥。

## 6. 验证并接入 OpenCode runtime

状态：尚未开发，仓库内没有 OpenCode 依赖与运行代码。

新增 `agent/agentRuntime.ts`、`agent/openCodeRuntime.ts` 和 `agent/openCodeProcess.ts`。

实现要求：

- `AgentRuntime` 定义创建 session、继续 session、启动 run、订阅事件、取消、查询 diff 和释放资源，不包含 OpenCode 专用字段。
- 根据 OpenCode 当前正式文档确认 command、TypeScript SDK、许可证、DeepSeek Provider 配置、工作目录参数、session、异步 prompt、SSE、diff 与取消接口。
- 把确认后的 OpenCode command 与 SDK 版本写入依赖和调研文档，`pnpm install` 完成安装。
- `OpenCodeProcess` 由服务端启动，只监听 `127.0.0.1`，检查启动、版本、退出和服务关闭清理。
- OpenCode 使用当前项目的 `workspace/` 作为工作目录，API Key 只传给 OpenCode 进程。
- `OpenCodeRuntime` 实现 `AgentRuntime`，管理 SDK client、session、SSE、diff 和取消。
- 安装与状态检查不调用模型；正式连通测试使用专用 DeepSeek API Key 发起一个无文件修改任务。
- 缺少 command、版本不符、缺少 API Key、进程退出和 Provider 错误均返回可识别的错误代码。

验收测试：服务端能够启动和关闭指定版本的 OpenCode；正式连通测试能够创建 session、收到有序事件并完成取消；响应、错误与日志不含密钥。

## 7. 完成 Agent run、session 与 trace

状态：尚未开发。

新增 `agent/agentRunStore.ts`、`agent/agentRunManager.ts` 和 `agent/traceStore.ts`。

实现要求：

- 每个项目一个 FIFO run 队列；不同项目可以同时运行。
- 每位成员可以创建自己的 session 和 run，run 记录保存 `memberId`、`sessionId`、`projectId`、runtime、Provider 与 Model。
- run 支持排队取消、运行取消、10 分钟超时和服务重启清理。
- 新任务创建 session，继续任务复用 session。
- run 元数据保存到 `projects/<projectId>/agent-runs/<runId>/run.json`。
- 每个 run 保存 JSONL；sequence 按服务端接收顺序连续增加。
- 标准事件与 raw、summary、data 全部经过敏感值过滤。
- OpenCode 能查询原 session 时允许继续；无法查询时只允许作为新任务继续。
- Agent 文件读取事件记录路径、时间、哈希和 Yjs revision；后续成员修改产生 `concurrent_change`。
- 创建 run 之前等待项目协作文档的 `awaitIdle()` 完成。
- 提供设置、run 列表、run 创建、run 继续、run 详情、trace 下载和取消接口。

验收测试：同项目任务依次运行，不同项目任务可以同时运行；成员任务归属、取消、超时、重启清理、session 复用、trace 顺序、敏感值过滤和 `concurrent_change` 均通过服务端测试。

## 8. 完成 Agent 页面与实时事件

状态：尚未开发。

新增 `AgentPanel.tsx` 和 `agentApi.ts`，扩展项目 WebSocket 的公共消息类型。

实现要求：

- 全局设置入口显示 OpenCode 版本、运行状态、Provider、Model、Enabled 和 API Key 是否存在。
- 项目工作区提供 Agent 页签，成员可以输入任务、创建新 session 或继续已有 session。
- 页面显示当前成员的任务与项目任务，明确显示创建者、状态、队列位置和 session 关系。
- 页面显示 trace、运行输出、文件变化、错误、取消、相关文件跳转和 JSONL 下载。
- 项目 WebSocket 广播 run 状态与新增 trace sequence；断线重连后通过 HTTP 读取当前 run 与缺失 trace。
- Agent 功能关闭、API Key 缺失、OpenCode 不可用和任务失败时提供明确操作说明。

验收测试：两位成员可以分别创建任务并查看归属；刷新与断线重连后恢复任务状态；取消、文件跳转和 trace 下载可以使用。

## 9. 整理自动化测试

状态：协作测试已经完成，Agent 测试随第 5 至第 8 节增加。

服务端测试保留正确性边界和持久化行为，删除已经移除功能的测试。

当前 Playwright 文件：

- `projects.spec.ts`
- `collaboration.spec.ts`
- `editor-permissions.spec.ts`
- `theme.spec.ts`
- `demo.spec.ts`

Agent 接入时新增 `agent-run.spec.ts`。

测试工作目录统一使用 `.test-workspaces/`。`agent-run.spec.ts` 使用正式 OpenCode 与专用 DeepSeek API Key，覆盖设置、创建任务、项目 FIFO、两位成员任务归属、session 继续、trace、取消和文件变化。缺少专用 API Key 时明确报告没有运行，不能用其他 runtime 代替。

## 10. 交付文档

状态：持续维护。

代码完成时同步维护：

- [基线需求](./2026-09-17-baseline.md)
- [已知问题](./known-issues.md)
- 项目安装与启动说明
- 服务端环境变量说明
- Agent 配置与 OpenCode 版本说明
- HTTP、WebSocket 和 trace 类型说明
- 自动化测试与发布验收说明
- `docs/research/YYYY-MM-DD/` 中的调研记录

新增的限制与改进方向写入已知问题，不把未来能力混入基线验收。
