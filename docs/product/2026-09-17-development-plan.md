# SimpleRCPv2 基线开发计划

状态：讨论稿

更新时间：2026-09-17

需求依据见 [基线需求](./2026-09-17-baseline.md)。每个阶段结束时运行对应测试，并保持项目可以启动。

## 1. 修复文件同步

新增 `textDelta.ts` 和 `workspacePolicy.ts`，修改 `collaborativeDocuments.ts`、`workspaceWatcher.ts`、`workspace.ts` 与 `config.ts`。

实现要求：

- 使用固定版本的 `fast-diff` 生成 Y.Text 最小 delta。
- 文件树、文件接口、watcher 和 ZIP 导入共用 `isIgnoredPath()`。
- 每个协作文档维护 revision、排队操作和 retired 状态。
- 成员更新与 watcher 外部变化进入同一文件操作队列，按照到达顺序执行。
- 成员更新操作在执行时读取最新 Yjs 内容并写入磁盘。
- watcher 操作在执行时读取最新磁盘内容；读取期间 revision 改变时重新排队。
- 外部 delta 使用 `FILESYSTEM_ORIGIN`，不再次写入磁盘。
- Agent 启动和终端提交命令之前调用 `awaitIdle()`。
- 删除或类型变化先设置 retired；所有文件替换在提交前再次检查 retired，临时文件不能覆盖删除或二进制结果。
- 大文本文件只读，不使用全文替换处理外部变化。

验收测试：同步期间继续输入不会恢复旧内容；外部多处修改保留未变化区域的 RelativePosition；连续写入不会交错；删除和类型变化不能被排队写入恢复；固定忽略路径不产生协作事件。

## 2. 建立项目注册与运行对象

新增 `projects.ts`、`projectRuntime.ts` 和 `projectRuntimeManager.ts`，按 `projectId` 改写 HTTP、项目 WebSocket 与 Yjs WebSocket。

实现要求：

- `ProjectRegistry` 保存已有项目、空白项目和最近打开时间。
- `ProjectRuntime` 持有单个项目的 room、chat、文档、PTY 和 watcher。
- `ProjectRuntimeManager` 按需创建和释放 runtime。
- 服务启动不再要求 `SIMPLERCP_WORKSPACE`。
- 删除 `listWorkspaceTree`，目录接口只返回下一层。
- 浏览器稳定保存 `userId`，每个标签页使用独立 `connectionId`。
- 服务端按用户保存成员资料，按连接保存在线状态、光标和当前文件；关闭一个标签页不能让同一用户的其他连接离线。
- HTTP 和 WebSocket 消息类型放在 `shared` package，服务端与浏览器共同使用。

验收测试：项目登记在重启后保留；两个项目完全隔离；同名用户保持独立；同一用户两个标签页的连接状态互不覆盖。

## 3. 删除权限与冗余功能

删除 Host token、Host session、Guest 权限、命令模式、命令白名单、快捷命令接口、Session 设置页面、Activity、`eventLog`、Python 手写补全、只读连接分支和独立录制用例。

聊天使用项目 WebSocket 发送和广播，消息带递增编号。进入项目和 WebSocket 重连时，客户端提交最后接收编号，服务端补发后续消息。终端输入输出并入项目 WebSocket；Yjs 保留独立二进制通道。

验收测试：所有成员拥有相同能力；聊天发送一次只产生一条记录；断线期间的聊天在重连后补齐；终端输入输出正常。

## 4. 完成项目首页与 ZIP 导入

新增 `ProjectHome.tsx`、`ImportProject.tsx`、`JoinProject.tsx`、`WorkspacePage.tsx`、`projectApi.ts`、`useProjectSocket.ts` 和服务端 `archiveImport.ts`。

实现要求：

- `/` 显示项目列表和三个新增入口。
- `/projects/:projectId` 显示进入表单和工作区，刷新后保持项目路径。
- `App.tsx` 只负责路由，工作区状态进入页面组件和 hook。
- ZIP 使用成熟库读取条目，在写入前检查路径、类型、数量和声明大小。
- 解压时统计实际字节数，超出限制立即终止并清理未完成目录。
- 全部文件成功写入后再登记项目。

验收测试：已有目录登记、空白项目和正常 ZIP 可以打开；路径越界、特殊条目、数量超限、大小超限和重复项目全部失败；失败后没有项目记录与未完成目录。

## 5. 完成 Agent 设置

新增 `agent/secretStore.ts`、`agent/agentSettingsStore.ts`、`agent/types.ts`、`AgentSettings.tsx` 和 `agentApi.ts`。

实现要求：

- `SecretStore` 保存 API Key，文件权限为 `0600`。
- `AgentSettingsStore` 保存 Provider、Model 和 Enabled。
- 两个 store 使用同目录临时文件和 rename 更新。
- 设置接口不返回密钥明文。
- OpenCode command 与 SDK 固定版本，只监听 `127.0.0.1`。
- 安装检查不调用模型。

验收测试：设置和密钥在重启后保留；权限过宽时服务终止；响应、错误、日志和 trace 不含密钥。

## 6. 完成 Agent 运行与 trace

新增 `agent/openCodeRuntime.ts`、`agent/agentRunManager.ts`、`agent/traceStore.ts` 和 `AgentPanel.tsx`。

实现要求：

- `OpenCodeRuntime` 管理 OpenCode 进程、SDK client、session、SSE、diff 和取消。
- 每个项目一个 FIFO run 队列；不同项目可以同时运行。
- run 支持排队取消、运行取消、10 分钟超时和服务重启清理。
- 新任务创建 session，继续任务复用 session。
- 每个 run 保存 JSONL；sequence 按服务端接收顺序连续增加。
- 标准事件与 raw、summary、data 全部经过敏感值过滤。
- OpenCode 能查询原 session 时允许继续；无法查询时只允许作为新任务继续。
- Agent 文件读取事件记录路径、时间、哈希和 Yjs revision；后续成员修改产生 `concurrent_change`。
- 页面显示任务输入、历史、队列位置、trace、取消、文件跳转和 JSONL 下载。

验收测试：队列、取消、超时、重启清理、session 复用和 trace 顺序通过状态测试；正式 OpenCode 集成测试使用专用 DeepSeek API Key；Playwright Agent 场景使用正式 OpenCode。

## 7. 整理自动化测试

服务端测试保留正确性边界和持久化行为，删除已经移除功能的测试。

Playwright 保留：

- `project-collaboration.spec.ts`
- `agent-run.spec.ts`

测试工作目录统一使用 `.test-workspaces/`。正式 Agent E2E 缺少专用 API Key 时明确报告没有运行，不能用其他 runtime 代替。

## 8. 交付文档

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
