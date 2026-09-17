# SimpleRCPv2 基线实施计划

状态：讨论稿

更新时间：2026-09-17

本文是可交接的执行计划。需求依据见 [运行系统基线需求](./05-baseline-product-requirements.md)，同步部分的设计依据见 [文档同步设计](./07-document-sync-design.md)，Agent 接入依据见 [开源 Agent 与 trace 调研](./04-agent-runtime-research.md)。

接手本计划的人按阶段顺序执行。每个阶段结束时仓库必须处于可运行、可测试、可提交的状态，不允许跨阶段保留两套 workspace 路由或两套权限模型。

## 0. 交接须知

### 0.1 当前代码规模

服务端产品代码约 2,211 行，浏览器产品代码约 3,277 行，测试约 1,593 行。风险集中在四个文件，`App.tsx` 655 行，`createApp.ts` 434 行，`realtime.ts` 375 行，`rooms.ts` 341 行。

### 0.2 本计划会净减少代码

删除的功能链多于新增。Host token 与 Guest 权限、Session 控制、命令白名单与快捷命令 runner、常规 Activity 与轮询、`eventLog`、`listWorkspaceTree`、独立录制用例全部移除。新增的项目入口、同步修复、Agent 三件套在体量上与被删除部分相当。如果实施过程中代码总量显著上升，说明偏离了计划。

### 0.3 不要在阶段之间搭桥

典型错误是在新增 `projectId` 路由时保留旧的单 workspace 路由做兼容。阶段 1 一次性完成切换，旧路由直接删除。E2E 会在阶段末尾统一修复。

## 1. 阶段一，同步层修复

先做同步层，因为它是唯一一处存在已知数据丢失的代码，而且它不依赖任何新功能。修完之后当前版本立刻更可靠，后续所有阶段都建立在正确的同步语义上。

### 1.1 涉及文件

- 改写 `apps/server/src/collaborativeDocuments.ts`
- 新增 `apps/server/src/textDelta.ts`
- 新增 `apps/server/src/workspacePolicy.ts`
- 修改 `apps/server/src/workspaceWatcher.ts`
- 修改 `apps/server/src/index.ts`
- 修改 `apps/server/src/config.ts`

### 1.2 任务

1. 新增依赖 `fast-diff`，固定版本。
2. 新增 `workspacePolicy.ts`，导出 `isIgnoredPath(relativePath)`。固定噪声规则为路径段 `node_modules`、`.git`、`__MACOSX`，文件名 `.DS_Store`。这一份规则同时供文件树、文件接口、watcher 和后续 ZIP 导入使用，不允许出现第二份实现。
3. `workspaceWatcher.ts` 补 `ignored` 选项，复用 `isIgnoredPath`。保留 `awaitWriteFinish`。
4. 新增 `textDelta.ts`，实现文档同步设计 4.5 的 `textDelta(oldText, newText)`，含公共前后缀裁剪与超大文本兜底阈值。
5. 改写 `collaborativeDocuments.ts`。
   - 删除 `persistDelayMs`、`persistTimers`、`schedulePersist`。
   - 每个文档维护 `FileSyncState`，字段为 `recentWriteHashes`（容量 8 的环）、`writing`、`dirty`。
   - `document.on("update", ...)` 改为写穿，origin 为 `FILESYSTEM_ORIGIN` 时直接返回。
   - `reloadPath` 改名为 `applyExternalChange`，按文档同步设计 4.4 实现，回声判据查哈希环，应用使用 `text.applyDelta`。
   - 导出 `FILESYSTEM_ORIGIN` 常量供客户端识别使用。
6. `config.ts` 加入 `SIMPLERCP_SYNC_DIFF_MAX_BYTES`，默认 2 MiB。

### 1.3 验收

文档同步设计第 7 节的 8 条单元测试全部通过，其中第 1 条与第 2 条是数据丢失与光标破坏的回归测试，必须存在。`textDelta` 增加一组属性测试。

## 2. 阶段二，项目注册与运行时隔离

### 2.1 涉及文件

- 新增 `projects.ts`、`projectRuntime.ts`、`projectRuntimeManager.ts`
- 改写 `createApp.ts`、`realtime.ts`、`index.ts`
- 修改 `config.ts`、`types.ts`

### 2.2 任务

1. `projects.ts` 实现 `ProjectRegistry`，负责登记已有目录、创建空白项目、读写元数据。元数据落在 `SIMPLERCP_DATA_DIR/projects.json`，写入通过同目录临时文件加 rename 完成。
2. `projectRuntime.ts` 持有单个项目的 `RoomStore`、`ChatStore`、`CollaborativeDocumentStore`、共享 PTY、watcher，后续阶段再挂入 `AgentRunManager`。
3. `projectRuntimeManager.ts` 按 `projectId` 惰性创建 runtime，最后一位成员离开且无进行中 Agent run 时在空闲超时后释放 PTY、watcher 和文档。项目元数据不受影响。
4. `createApp.ts` 全部路由前缀改为 `/api/projects/:projectId/...`，中间件解析 `projectId` 并注入 runtime。删除旧的单 workspace 路由。
5. 四个文件变更接口不再返回完整递归树。删除 `listWorkspaceTree` 及其调用点，变更接口只返回受影响目录的条目。全量递归树与需求文档的按需加载决定直接冲突，必须一并删除。
6. `index.ts` 启动 registry 与 runtime manager，不再读取 `SIMPLERCP_WORKSPACE`，不再打印 host token URL。
7. `config.ts` 加入 `SIMPLERCP_DATA_DIR`、`SIMPLERCP_PROJECTS_ROOT`。

### 2.3 验收

两个项目拥有彼此独立的 room、终端、聊天与文档。服务启动不要求 `SIMPLERCP_WORKSPACE`。项目登记信息在重启后保留。

## 3. 阶段三，删除权限与冗余功能链

放在这里的原因是阶段二已经重写了 `createApp.ts` 与 `realtime.ts`，此时删除代价最低。

### 3.1 服务端删除项

- `sessionControl.ts` 及其测试。
- `runner.ts`、快捷命令 API 及其测试。
- Host token 领取流程、`hostAccessToken` 配置、`x-simplercp-host-session` 请求头处理、`getHostSession`、`memberCan`。
- Guest 权限字段、命令模式、命令白名单、`SIMPLERCP_COMMANDS`、`SIMPLERCP_COMMAND_MODE`、`SIMPLERCP_HOST_TOKEN`。
- `makeConnectionReadOnly` 与只读连接分支。
- `eventLog.ts`。`events.list()` 目前无上界，而它唯一的消费者是即将删除的 Activity 面板。需要排查问题时读 Agent trace 与服务日志。

### 3.2 浏览器删除项

- Session 页面、Host 页面、Guest 权限设置界面。
- 命令下拉框、Run 按钮、白名单与模式标记，共享终端只保留直接输入与重启按钮。
- Activity 面板与 1.5 秒轮询。
- Python 手写补全与对应断言。
- `window.__simplercpEditors` 全局对象，改为在 E2E 中通过组件内显式暴露的测试钩子访问。

### 3.3 聊天路径收敛

现有聊天同时走 HTTP POST、WebSocket 推送、HTTP 重新拉取和轮询四条路径，其中收到 WebSocket 消息后再发一次 HTTP 请求是明确的反模式。收敛为单一路径，浏览器通过项目 WebSocket 发送消息，服务端写入 `ChatStore` 后广播给房间全体，包括发送者自己。历史消息只在进入项目时拉取一次。

### 3.4 通道收敛

终端的客户端消息已经是 JSON 格式，字段为 `type` 取 `input`、`resize`、`restart`，并入项目 WebSocket 的成本很低。三个 WebSocket 收敛为两个，项目通道承载成员、聊天、文件变化、终端、Agent 事件，Yjs 保留独立通道因为它使用二进制协议且由 `y-websocket` 管理生命周期。

### 3.5 验收

服务端测试中 Host session、Guest 权限组合、命令白名单、快捷命令 runner 相关用例全部删除，其余通过。浏览器进入项目后没有任何权限相关控件。

## 4. 阶段四，项目入口与页面结构

### 4.1 涉及文件

- 新增 `ProjectHome.tsx`、`ImportProject.tsx`、`JoinProject.tsx`、`WorkspacePage.tsx`
- 新增 `projectApi.ts`、`useProjectSocket.ts`
- 新增 `archiveImport.ts`（服务端）
- 改写 `App.tsx`

### 4.2 任务

1. 引入路由。`/` 是项目列表，`/projects/:projectId` 是工作区。刷新页面不丢失当前项目。
2. `App.tsx` 只保留路由与页面切换。工作区状态迁入 `WorkspacePage`，现有 16 组 state 与 9 个 ref 按职责拆到 `WorkspacePage`、`useProjectSocket` 与各面板组件。拆分后单文件不超过 400 行。
3. 显示名称与可选角色从进入表单获取，不再从 URL 查询参数读取。角色为空时显示 `Collaborator`，只用于成员列表与 Agent 任务上下文，不参与任何判定。
4. `archiveImport.ts` 实现 ZIP 导入，大小与数量限制、条目路径校验、固定过滤、原子解压、失败清理，规则见基线需求 5.1。过滤规则复用 `workspacePolicy.ts`。

### 4.3 验收

项目列表可以打开、登记、新建、导入。刷新工作区页面后仍在同一项目。导入失败后项目列表不残留半成品。

## 5. 阶段五，Agent 配置与密钥

### 5.1 涉及文件

- 新增 `agent/secretStore.ts`、`agent/types.ts`
- 新增 `AgentSettings.tsx`、`agentApi.ts`
- 修改 `config.ts`、`createApp.ts`

### 5.2 密钥存储的唯一位置

调研文档 04 曾提出把密钥交给 OpenCode 的 auth API 保存，基线需求文档则要求服务端自行保存。两者并存会造成同一密钥存在两份副本，轮换时容易漏掉一处。基线采纳后者，调研文档中的对应段落作为历史方案保留。

具体规则如下。密钥只存在于 `SIMPLERCP_DATA_DIR/secrets.json`，文件权限 0600，进程启动时校验权限并在过宽时拒绝启动。传递给 OpenCode 子进程只通过环境变量，不调用 OpenCode 的 auth API，不写入项目目录的任何文件。任何 HTTP 响应、日志、trace、聊天消息、错误消息都不得包含密钥，读取接口只返回 `configured: true`。

### 5.3 任务

1. `secretStore.ts` 实现写入、读取、清除与权限校验。
2. 新增 `GET /api/agent/settings`、`PUT /api/agent/settings`、`GET /api/agent/installation`。安装检查只做命令可用性、版本读取与配置完整性判断，不调用模型，不产生费用。
3. `AgentSettings.tsx` 实现设置页。Agent 固定 `OpenCode`，mode 固定 `build`，Provider 固定 `DeepSeek`，Model 可改，API Key 写入后只显示 `Configured`。

### 5.4 验收

密钥文件权限为 0600。设置接口与安装检查接口的响应中不含密钥明文。权限过宽时服务拒绝启动。

## 6. 阶段六，Agent 运行与 trace

### 6.1 涉及文件

- 新增 `agent/openCodeRuntime.ts`、`agent/agentRunManager.ts`、`agent/traceStore.ts`、`agent/fakeAgentRuntime.ts`
- 新增 `AgentPanel.tsx`

### 6.2 单表运行模型

原设计有 `AgentRunRecord` 与 `AgentSessionRecord` 两张表，并为 session 提供三个独立接口。session 的全部可观测属性都可以从 run 记录推导，`createdAt` 是该 session 第一条 run 的 `startedAt`，`lastUsedAt` 是最后一条 run 的 `startedAt`，成员归属在每条 run 上都有。独立表带来的是一份需要同步维护的派生数据。

基线只保留 `AgentRunRecord`，`sessionId` 作为其字段。新任务由服务端生成新的 `sessionId`，继续任务沿用调用方传入的 `sessionId`。session 列表通过对 run 记录按 `sessionId` 分组得到。

Agent 接口由 9 个减为 5 个。

- `POST /api/projects/:projectId/agent/runs`，请求体可选携带 `sessionId`，缺省表示新任务。
- `GET /api/projects/:projectId/agent/runs`，支持按 `sessionId` 过滤。
- `GET /api/projects/:projectId/agent/runs/:runId`
- `GET /api/projects/:projectId/agent/runs/:runId/trace`
- `POST /api/projects/:projectId/agent/runs/:runId/cancel`

删除的接口为 session 列表、session 创建、session 重置，以及权限回复接口。

### 6.3 删除权限交互

基线需求原先保留了 Agent 权限请求的内联 `Allow once` 与 `Deny` 按钮。删除理由有两条。第一，服务只运行在可信网络，共享终端本来就允许任意命令，对 Agent 命令单独设卡在威胁模型上不成立。第二，它是队列之外的第二个死锁来源，发起者离开页面后 run 会无限期停在等待回复的状态，而队列会被它一直占用。

改为在 OpenCode 配置中全部放行，权限事件仍然记入 trace 供事后审查。`AgentRuntime` 接口去掉 `replyPermission`。

### 6.4 队列与终止性

FIFO 保留在 run 粒度。一次 run 内部是读取、判断、修改、验证的有状态序列，交错执行会让 Agent 基于过期读取行动，因此不能按文件或按工具拆细。run 内部仍允许 OpenCode 按自身能力并行调用工具。

原设计缺少三样东西，必须补上，否则队列会变成故障放大器。

1. **硬超时与强制释放。** 每个 run 有 `SIMPLERCP_AGENT_RUN_TIMEOUT_MS` 上限，默认 10 分钟。超时后调用 session abort，标记 `failed`，无论 abort 是否成功都释放队列。没有这条，一个卡住的 OpenCode 进程会永久阻塞该项目的 Agent 能力。
2. **队列可见与排队中可取消。** 队列位置、前面的成员与任务在界面上可见。处于 `queued` 状态的 run 可以直接取消，不需要等它开始运行。
3. **重启清理。** 服务启动时把 trace 索引里状态为 `running` 或 `queued` 的记录统一标记为 `failed`，原因写 `server_restarted`。没有这条，重启后会留下永远不会结束的假运行记录。

### 6.5 并发警告

run 开始时记录本次任务涉及路径的内容哈希，Agent 写入某路径时与记录值比较，不一致则在 run 记录上打 `concurrent_change`，在 trace 与该文件的编辑器标签页显示警告。保留磁盘最终内容，不自动回退，不自动合并。语义分析见文档同步设计第 5 节。

### 6.6 进程模型

基线采用全局单个 OpenCode 进程加全局单个队列，而不是每个项目一个进程。每项目一个进程需要额外实现进程数上限、内存上限、LRU 回收、空闲超时与端口分配，这些机制与产品目标无关，只服务于进程管理本身。全局单进程把这些一起消掉，代价是跨项目的 Agent 任务也要排队。在可信小团队的使用强度下这个代价可以接受。

如果后续确实需要按项目隔离进程，先验证 `opencode serve` 是否会输出实际监听端口。能输出就用 `--port 0` 让操作系统分配，避免预先占用端口带来的竞态。

### 6.7 FakeAgentRuntime

基线需求原先禁止 Mock Agent，要求 Agent 测试一律使用真实 OpenCode 与真实 Provider。这条规则对端到端验收成立，对单元测试不成立。

队列顺序、trace 顺序、取消、超时、`concurrent_change`、重启清理是本阶段最容易出错的六处状态机，它们全都不依赖真实模型。用真实模型覆盖它们有三个问题，结果不确定、需要花钱、在没有密钥的环境下无法运行，最终必然被跳过。

因此新增 `agent/fakeAgentRuntime.ts`，实现同一 `AgentRuntime` 接口，按脚本产生事件序列，可以模拟慢速运行、写入指定文件、抛错、卡住不返回。它服务于单元测试与 CI。真实 Agent E2E 保持不变，仍使用正式 OpenCode 与正式 Provider，作为发布验收的必须项。

### 6.8 任务

1. `traceStore.ts` 实现每 run 一个 JSONL 文件与同目录 `index.json`，写入顺序由单个 run writer 保证。原始事件与标准事件都保留。
2. `openCodeRuntime.ts` 实现进程管理、SDK client、SSE 订阅、事件转换、diff 读取与取消。未知事件保留为原始事件，缺少关键字段时立即把 run 标记 `failed`。
3. `agentRunManager.ts` 实现 run 创建、FIFO 队列、超时、取消、并发哈希比较、状态广播与重启清理。
4. `fakeAgentRuntime.ts` 按 6.7 实现。
5. `AgentPanel.tsx` 实现任务输入、新任务与继续、run 列表、trace 顺序列表、队列位置、取消、文件路径跳转、trace 下载。

### 6.9 验收

基线需求 13.3 全部满足，并补充三条。超时的 run 会被标记 `failed` 且队列得到释放。`queued` 状态的 run 可以取消。重启后不存在状态为 `running` 或 `queued` 的历史记录。

## 7. 阶段七，测试整理

### 7.1 单元测试

保留并补齐基线需求 12 列出的服务端测试，其中同步部分以文档同步设计第 7 节为准。Agent 状态机测试使用 `FakeAgentRuntime`。删除 Host session、Guest 权限组合、命令白名单、快捷命令 runner 相关用例。

### 7.2 E2E

现有 579 行的协作 E2E 同时验证十余项内容，一次失败难以定位。拆为两个场景。

1. `project-collaboration.spec.ts`。登记项目，两位用户进入，打开同一文件，同步编辑，查看远端光标，聊天，在共享终端执行写文件命令，确认另一端编辑器实时更新且光标未跳位。最后一条断言是同步层修复的端到端证据，必须包含。
2. `agent-run.spec.ts`。配置真实 OpenCode 与密钥，两位成员分别发起任务，任务进入 FIFO 队列并依次修改指定文件，双方持续看到各自 trace，另一位用户看到文件变化，run 完成后可下载 JSONL。

删除独立录制用例、Host 与 Guest 权限切换、命令模式与白名单、Python 补全、Activity 文案，以及同一功能在多个界面位置的重复断言。

测试工作目录统一使用仓库内被 `.gitignore` 排除的 `.test-workspaces/`，不使用系统临时目录。

### 7.3 验收

`pnpm build` 通过。服务端测试通过。项目协作 E2E 通过。配置密钥的环境中 Agent E2E 通过，无密钥环境明确报告该场景未运行。

## 8. 阶段依赖与可并行性

```
阶段一（同步层）  ──┐
                    ├─> 阶段二（项目隔离） ──> 阶段三（删除） ──> 阶段四（入口）
阶段五（密钥）    ──┘                                              │
                                                                   v
                                                        阶段六（Agent 运行）
                                                                   │
                                                                   v
                                                        阶段七（测试整理）
```

阶段一与阶段五互不依赖，可以并行。阶段二到阶段四必须顺序执行，因为它们都改写同一批文件。阶段六依赖前面全部阶段。

## 9. 需求文档与本计划的差异记录

以下条目是本计划对原基线需求的修订，已同步回需求文档，列在此处便于评审时集中核对。

| 项 | 原需求 | 本计划 | 理由 |
| --- | --- | --- | --- |
| Agent 启动前刷盘 | 调用 `flushAll` | 删除该概念 | 写穿后磁盘永远最新 |
| 运行数据模型 | run 表加 session 表 | 只保留 run 表 | session 属性可从 run 推导 |
| Agent 接口数量 | 9 个 | 5 个 | 随 session 表删除 |
| 权限交互 | 保留 Allow once 与 Deny | 删除，事件仍入 trace | 与可信网络前提矛盾，且是第二个死锁源 |
| WebSocket 通道 | 3 个 | 2 个 | 终端消息已是 JSON，并入项目通道 |
| 聊天路径 | HTTP 加 WS 加重新拉取加轮询 | 单一 WS 路径 | 消除 WS 触发 HTTP 的反模式 |
| `eventLog` | 保留 | 删除 | 无界增长且唯一消费者被删除 |
| 全量文件树接口 | 四处变更接口返回递归树 | 删除 | 与按需加载决定冲突 |
| 密钥存储位置 | 需求与调研文档不一致 | 只存服务端 secrets 文件 | 避免同一密钥两份副本 |
| OpenCode 进程模型 | 每项目一个 | 全局单进程单队列 | 消掉进程上限、LRU、端口竞态 |
| Mock Agent | 一律禁止 | 单元测试用 FakeAgentRuntime | 状态机测试不应依赖真实模型 |
| run 终止性 | 未定义 | 硬超时、强制释放、重启清理 | 避免队列被永久占用 |
| 队列可见性 | 未定义 | 可见且排队中可取消 | 避免用户无从判断等待原因 |
