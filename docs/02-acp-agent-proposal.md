# SimpleRCPv2 ACP Agent 接入方案

状态：待 Review

更新时间：2026-08-09

## 1. 目标和非目标

### 1.1 目标

在现有 Human-Human 实时协作核心上，加入一个可以替换外部实现的 ACP Coding Agent，使 Agent 像房间成员一样参与任务，但不直接改写共享正文：

```text
用户在 Chat 或编辑器中 @Agent
  -> SimpleRCPv2 Harness 创建一个 Agent Turn
  -> 通过 ACP 调用外部 Coding Agent
  -> Agent 在隔离工作副本中读到共享最新快照
  -> Harness 收集副本 diff，不直接改写共享 workspace
  -> Agent 的多次写入进入 Pending Proposal
  -> 用户在网页中查看多文件 Diff
  -> 用户 Apply 或 Reject
  -> Apply 后才写入 Yjs 和磁盘
```

第一版的成功标准：

1. 用户能够在聊天框输入 `@Agent <任务>` 并触发任务。
2. 用户能够在编辑器选中代码后，通过编辑器内 Agent 输入框提交 `@Agent <任务>`。
3. 外部 ACP Agent 的读请求看到 Yjs 中的最新内容，而不是只读磁盘。
4. Agent 一轮中修改多个文件时，系统按文件聚合成一个 Pending Proposal。
5. Proposal Apply 前，共享 Yjs 正文、其他用户编辑器和磁盘都不改变。
6. 用户能够逐文件查看 Diff，并整体 Apply 或 Reject 一次 Proposal。
7. Agent 的状态、文本消息、文件读写、权限请求、错误和最终报告能在网页中看见。
8. 自动化测试使用 Fake ACP Agent 完成确定性闭环，并生成可回看的 Playwright 视频。
9. 真实 OpenCode + DeepSeek 能在隔离工作副本中修改代码并自动执行测试，Proposal 展示测试命令、退出码和结果摘要。

### 1.2 非目标

第一版明确不做：

- 自研模型或 Agent 规划器。
- 直接接入 DeepSeek 原生 API。接入目标是 ACP Agent 命令；模型供应商由外部 ACP Agent 决定。
- 多 Agent Coordinator、任务拆分和自动角色分工。
- Agent 任意访问 workspace 外部路径。
- 让 Agent 继承或操作网页共享 Terminal；Agent 命令只在隔离工作副本中执行。
- 在没有冲突策略的情况下强行覆盖 Human 的并发编辑。
- 先做复杂的持久化、计费、组织和部署平台。

## 2. 关键边界

ACP、外部 Agent 和 SimpleRCPv2 的职责必须分开：

| 对象 | 负责 | 不负责 |
|---|---|---|
| 外部 ACP Agent | 任务理解、规划、多轮工具循环、生成代码 | 房间成员、Yjs 一致性、Proposal 审阅 |
| ACP | 初始化、会话、Prompt、流式更新、文件/终端请求、权限协议 | 模型质量、协同冲突、操作系统沙箱 |
| SimpleRCPv2 Harness | 子进程、ACP session、上下文、路径权限、Yjs 读代理、Proposal、事件 | 替代外部 Agent 的规划能力 |
| Yjs | Human 协作者共享文档和实时编辑状态 | Agent Proposal 的人工批准语义 |
| 浏览器 UI | @ 入口、运行状态、Diff、Apply/Reject、协作观察 | 保存 API key、启动本地子进程 |

关键设计判断：**ACP Harness 必须运行在 Node.js 服务端，不运行在浏览器中。**原因是它需要访问 Yjs 服务状态、启动本地 ACP 子进程、读取 workspace 边界、保存敏感配置，并对 Agent 的文件写入施加服务端约束。

另一个已经通过真实 smoke test 确认的边界是：ACP 标准支持 `fs/read_text_file` / `fs/write_text_file`，但 OpenCode 的内部 `glob/read/edit` 工具会直接读写自己的工作目录，不经过 ACP 文件请求。因此真实 OpenCode 不能直接使用共享 workspace，第一版必须为它准备隔离工作副本，并在 turn 结束后收集 diff，再生成 Pending Proposal。

## 3. 推荐架构

```text
浏览器
  ├── Chat Composer: @Agent task
  ├── Editor Agent Composer: selection + @Agent task
  ├── Agent Run / Proposal 面板
  └── Apply / Reject 操作
          │ HTTP + existing realtime WebSocket
          ▼
SimpleRCPv2 Server
  ├── AgentRunStore                 任务状态、消息、权限请求
  ├── AgentTriggerService           Chat / Editor 触发解析
  ├── ACPHarness                    spawn、initialize、session/prompt
  ├── ACPTransport                  JSON-RPC over stdio
  ├── WorkspaceDocumentAdapter      pending > Yjs > disk
  ├── AgentWorkspaceManager         快照、隔离 cwd、清理
  ├── WorkspaceDiffCollector        副本变化 -> Proposal
  ├── ProposalStore                 turn/file 基线与最终内容
  ├── ProposalService               diff、冲突检查、Apply/Reject
  └── AgentPolicy                   Agent 文件/终端/权限策略
          │ ACP over stdio
          ▼
  外部 ACP Agent
  └── opencode acp -> OpenCode -> 用户配置的模型 Provider
```

### 3.1 为什么不把 Agent 作为普通浏览器成员实现

产品上 Agent 应该在 Team 里显示为成员，但进程上不应让浏览器直接持有 Agent 的 API key 或启动命令。建议拆成两层：

- **逻辑成员**：Room 中的 `AgentMember`，展示名称、状态和当前任务。
- **运行宿主**：服务端的 ACP Harness，一个 Agent profile 对应一个受控子进程。

这样仍然可以让 Agent 像成员一样出现在 Chat、Team 和 Activity 中，同时保留服务端权限边界。

## 4. Agent Profile 和配置

第一版不把 API key 放在前端，也不把任意环境变量直接广播给房间。Host 在 Session 页面配置 Agent Profile：

```ts
type AgentProfile = {
  id: string;
  displayName: string;
  command: string;
  args: string[];
  cwd?: string;
  verificationCommand?: string;
  envKeys: string[];
  enabled: boolean;
};
```

推荐配置原则：

- `command` 和 `args` 来自服务端启动配置或 Host 白名单，不接受 Guest 输入。
- API key 只存在服务端进程环境或本机 secret store，前端只看到 `configured: true/false`。
- ACP Agent 的 workspace cwd 必须等于或位于 `SIMPLERCP_WORKSPACE` 内。
- OpenCode 可以使用自身的 `bash` 工具在隔离工作副本中执行测试和构建命令。
- Agent 不能继承网页共享 Terminal 的 unrestricted 权限，也不能把命令切换到共享 workspace。
- Harness 必须记录 Agent 的命令、输出摘要、退出码、耗时和成功/失败状态，并关联到对应的 `runId` 和 Proposal。

第一条真实实现建议启动 OpenCode 的 ACP Server。命令和参数仍保留为 profile 配置，以便后续替换 OpenHands、Qwen Code 或其他 ACP Agent：

```bash
SIMPLERCP_AGENT_COMMAND="$HOME/.opencode/bin/opencode"
SIMPLERCP_AGENT_ARGS="acp"
SIMPLERCP_AGENT_NAME="OpenCode"
SIMPLERCP_AGENT_MENTION_ALIASES="OpenCode,OC"
```

OpenCode 的模型 Provider 可以配置为 DeepSeek，例如 `ds/deepseek-v4-flash`。SimpleRCPv2 不直接调用 DeepSeek API，也不把 OpenAI-compatible API 或原生 Chat Completions 调用冒充成 ACP。真实接入前必须在临时 workspace 验证 OpenCode 的 ACP 文件请求、模型选择和权限行为。

## 5. `@Agent` 触发入口

### 5.1 Chat 入口：第一优先级

用户在 Chat 中发送：

```text
@CodingAgent 请检查 src/user.ts 的参数校验，并补充对应测试
```

服务端按成员 display name 和 mention alias 解析目标 Agent，生成 `AgentRun`。普通人类聊天不触发 Agent。消息仍然写入 Chat，另外生成一个 Agent Run 事件，保证所有协作者知道是谁召唤了 Agent。

### 5.2 Editor 入口：基于选区的 Agent Composer

不建议把 `@Agent` 直接永久写进源代码，因为这会污染共享文档、触发重复执行，也会让“任务指令”和“代码内容”难以区分。

推荐在 Monaco 选中代码后提供编辑器内的临时 Agent Composer：

```text
选中代码
  -> 打开 Ask Agent 输入框
  -> 输入 @CodingAgent 优化这段代码并补测试
  -> 发送 selection、path、range、任务文本
```

这仍然是在代码区域中 `@Agent`，但指令不会进入 Yjs 正文。若后续确实需要注释触发，再单独设计一次性消费和去除规则。

### 5.3 触发去重和并发

- 每个 Agent 维护 `idle | running | waiting_permission | completed | failed | cancelled` 状态。
- 同一个 Agent 同时只运行一个 turn；新请求进入队列或明确提示忙碌，第一版采用拒绝并提示。
- 每条触发消息生成唯一 `runId` 和 `turnId`，所有 ACP 更新、Proposal 和 Activity 都携带这两个 ID。
- Agent 离线、进程退出或 WebSocket 断开时，运行标记为 failed/cancelled，Pending Proposal 不自动 Apply。

## 6. ACP Harness 生命周期

```text
ensureAgentProcess(profile)
  -> spawn(command, args, { cwd, env, stdio: pipe })
  -> line-buffered JSON-RPC transport
  -> initialize
  -> session/new
  -> ready

startTurn(runId, input)
  -> capture BaseSnapshot for referenced files
  -> create isolated Agent Workspace
  -> build stable + dynamic context
  -> session/prompt
  -> handle Agent fs/read_text_file / fs/write_text_file when supported
  -> handle session/update / tool / permission request
  -> prompt response
  -> run verificationCommand in isolated workspace
  -> collect diff and verification evidence
  -> finalize Proposal records
```

### 6.1 传输层要求

ACP over stdio 不能假设一次 stdout data 就是一条 JSON。需要：

- 按换行维护输入缓冲区；
- 支持一个 chunk 多条消息和一条消息跨多个 chunk；
- 区分 response、notification 和 server request；
- 为每个 JSON-RPC request 保存 pending promise；
- 子进程 stderr 只进日志，不混入协议解析；
- 子进程退出时拒绝所有未完成请求并结束当前 Agent Run。

### 6.2 Agent Workspace 策略

对真实 OpenCode，Harness 在每个 Agent turn 开始时创建一次隔离工作副本：

1. 读取房间中当前 Yjs 文档快照和文件树。
2. 将允许访问的文本文件、必要的目录结构和基础元数据复制到临时目录。
3. 以该临时目录作为 OpenCode ACP session 的 `cwd`。
4. Agent 运行期间由 Harness 记录 ACP update、工具调用、错误和退出状态。
5. Turn 结束后比较 Base Snapshot 与隔离副本，按文件聚合为 `PendingFileChange`。
6. 删除临时目录；Proposal 只保存 Review 所需的 base、agent 和 diff 内容。

副本目录必须位于服务端管理的临时根目录内，并绑定 `runId`。Agent 进程退出、超时或取消时，副本可以直接丢弃，不能将其内容自动同步到共享文档。

对于确实通过 ACP 文件回调读写的 Fake Agent，仍然使用下面的内容优先级；两种实现最后都进入同一个 ProposalStore。

```text
ProposalBuffer[runId][path].latestContent
  > Yjs shared text
  > workspace disk
```

读取必须经过统一的 `WorkspacePathPolicy`：规范化路径、阻止 workspace 外访问、阻止目录读取冒充文本文件，并记录 `agent_file_read` Activity。对于能够通过 ACP 回调接管的 Agent，使用上面的优先级；对于绕过 ACP 直接访问磁盘的 Agent，先把 Yjs 快照同步到隔离工作副本，再从副本读取。

### 6.3 文件写入策略

ACP `fs/write_text_file` 收到完整文本时，不直接调用 `writeWorkspaceFile`，也不直接写 Yjs。先写入当前 turn 的 Proposal Buffer：

```ts
type PendingFileChange = {
  path: string;
  baseContent: string | null;
  latestContent: string | null;
  baseHash: string;
  operation: "create" | "update" | "delete";
};

type Proposal = {
  id: string;
  runId: string;
  turnId: string;
  status: "pending" | "applying" | "applied" | "rejected" | "conflict" | "expired";
  files: PendingFileChange[];
  verification: {
    command: string | null;
    exitCode: number | null;
    output: string;
    durationMs: number | null;
    status: "not_run" | "passed" | "failed" | "timed_out";
  };
};
```

同一 turn 内同一文件重复写入时保留第一次 `baseContent`，只更新 `latestContent`。Agent 后续读取该文件时返回 `latestContent`，保证它能在临时态上继续工作。

如果外部 Agent 的内部工具直接写入隔离工作副本，则 Harness 在 turn 完成或 Agent 空闲时扫描副本与 Base Snapshot 的差异，将差异转换为同样的 `PendingFileChange`。两种路径最终必须汇聚到同一个 ProposalStore，不能分别实现两套 Apply 语义。

## 7. Proposal 生命周期

### 7.1 状态机

```text
running
  -> pending_review
  -> applying -> applied
  -> rejected
  -> conflict
  -> expired

running -> failed
running -> cancelled
```

规则：

- `running` 时共享正文不变；
- `pending_review` 时用户可以查看多文件 diff；
- `rejected` 只保留审计信息，不改变 Yjs；
- `applied` 才把每个文件写入当前协同文档；
- Proposal 超时或 Agent 断开后变成 `expired/failed`，不得自动写入；
- 同一个 Proposal 的 Apply 必须幂等，重复点击不能重复写入。

### 7.2 Apply 的并发策略

第一版建议采用保守策略：

1. Proposal 生成时保存每个文件的 `baseHash` 和 `baseContent`。
2. Apply 时读取当前 Yjs 文本并计算 `currentHash`。
3. 如果 `currentHash === baseHash`，直接把 `latestContent` 作为一次受控 Yjs transaction 合入。
4. 如果 hash 不一致，Proposal 进入 `conflict`，不覆盖当前协同内容。
5. UI 展示 Base、Current、Agent 三方内容；第一版要求人工解决冲突后重新 Apply。

这比直接覆盖可靠，虽然第一版无法自动处理所有不重叠修改。后续再增加 diff3 自动合并：无冲突自动合入，有冲突保留人工选择。

### 7.3 Apply 的文件操作

- 新文件：Proposal 中 `baseContent = null`，Apply 时通过 workspace 文件服务创建，并初始化对应 Yjs 文档。
- 已有文件：只允许通过 Yjs 文档 transaction 更新，随后由已有持久化机制写盘。
- 删除文件：第一版不让 Agent 通过 `fs/write_text_file` 删除；需要单独的受控 capability 和 Proposal 文件操作。
- 重命名：第一版不允许 Agent 自动重命名；先通过 Chat/Host 文件操作完成，避免路径引用和 Yjs 文档名失配。

## 8. UI 设计

### 8.1 Chat

Chat 消息保留原有多人聊天语义。检测到 Agent mention 后，旁边生成一条 Agent Run 卡片，而不是把 Agent 回复伪装成人类消息：

- `@CodingAgent` 触发人和任务摘要；
- Agent 状态：Starting、Planning、Reading、Writing、Waiting for review、Completed、Failed；
- 可展开查看 Agent 消息、文件读取/写入和权限请求；
- Proposal 生成后显示“Review changes”。

### 8.2 Team

Agent 在 People 中显示为特殊成员：

```text
Coding Agent   Agent   Waiting for review
```

Team Activity 增加自然语言事件：

- `Coding Agent joined the session`；
- `Ada asked Coding Agent to ...`；
- `Coding Agent read src/user.ts`；
- `Coding Agent proposed changes to 3 files`；
- `Ada applied proposal ...`。

### 8.3 Editor

- 选区上方或编辑器工具栏提供 Agent Composer。
- Composer 自动带上 path、range、selectionText 的摘要；完整文件仍由 Agent 通过 ACP read 请求按需获取。
- Proposal Review 使用右侧或中间的 Diff 视图，不覆盖当前共享正文。
- Apply/Reject 状态在所有协作者之间同步；只有 Host 或拥有审阅权限的人能 Apply。

### 8.4 Session

Host 配置 Agent Profile 和权限：

- 是否启用 Agent；
- Agent display name / mention aliases；
- ACP command 和 args 是否来自服务端 profile；
- 文件读、文件提案写、终端、删除/重命名等 capability；
- 单 turn 超时和最大修改文件数。

API key 不在前端显示，也不写入 Chat、Activity 或 Proposal。

## 9. 服务端模块拆分

推荐新增目录：

```text
apps/server/src/agent/
├── acpTransport.ts          # JSON-RPC over stdio
├── acpHarness.ts            # initialize/session/prompt 生命周期
├── agentProfiles.ts         # profile 和服务端安全配置
├── agentTriggers.ts         # Chat/Editor mention 解析
├── agentRuns.ts             # run/turn 状态和事件
├── proposalStore.ts         # pending proposal 内存状态
├── proposalService.ts       # diff、hash、Apply/Reject、冲突
├── workspaceAdapter.ts      # pending > Yjs > disk 和路径策略
├── agentWorkspace.ts        # 隔离副本创建、生命周期和清理
└── workspaceDiff.ts         # Base Snapshot 与副本 diff 收集
```

已有模块的最小扩展：

- `collaborativeDocuments.ts`：提供 `readText(roomId, path)`、`getTextSnapshot()`、`applyTextTransaction()` 等服务端接口。
- `realtime.ts`：广播 Agent Run、Proposal 和审阅状态事件。
- `createApp.ts`：增加 Agent trigger、run、proposal review API，并复用现有权限判断。
- `types.ts`：增加 AgentMember、AgentRun、AgentUpdate、Proposal 类型。
- `CollaborationPanel.tsx`：增加 Agent Run/Proposal tab 或卡片。
- `EditorArea.tsx`：增加选区上下文 Agent Composer 和 Diff review 状态。

## 10. API 和事件草案

### 10.1 HTTP API

```text
POST /api/agent/triggers
  body: { source: "chat" | "editor", text, path?, selection? }
  -> { run }

GET /api/agent/runs/:runId
  -> { run, updates, proposals }

GET /api/proposals/:proposalId
  -> { proposal, files }

POST /api/proposals/:proposalId/apply
POST /api/proposals/:proposalId/reject
  body: { reviewerId, reason? }
```

所有写 API 都必须服务端校验 room member、Agent profile、reviewer 权限和 run/proposal 状态。

### 10.2 Realtime 事件

```ts
type AgentRealtimeEvent =
  | { type: "agent_member_changed"; member: AgentMember }
  | { type: "agent_run_updated"; run: AgentRun }
  | { type: "agent_message"; runId: string; text: string }
  | { type: "agent_tool_call"; runId: string; tool: string; path?: string }
  | { type: "agent_permission_requested"; request: PermissionRequest }
  | { type: "proposal_created"; proposal: ProposalSummary }
  | { type: "proposal_updated"; proposal: ProposalSummary };
```

Activity 应该展示摘要；完整 Agent update 和 diff 通过 run/proposal 详情加载，避免 Team feed 无限堆叠。

## 11. 分阶段实施计划

### Phase 0：契约和 Fake ACP Agent

目标是先锁定协议边界，不接真实模型。

- 定义 AgentProfile、AgentRun、PendingFileChange、Proposal 状态。
- 写一个 Fake ACP Agent 子进程，支持固定的 initialize/session/new/session/prompt 和 read/write 请求。
- 约定事件和错误状态。
- 为 `pending > Yjs > disk`、重复写、多文件写和子进程异常写服务端测试。

验收：服务端测试能够证明“Fake Agent 读到 Yjs 最新内容，写入没有改变 Yjs，任务结束形成 Proposal”。

### Phase 1：单 Agent ACP Harness

- 实现 line-buffered JSON-RPC transport。
- 启动一个可配置 ACP command，建立持续 session。
- 实现 Fake Agent 的文件 read/write adapter，先只开放文本文件。
- 实现真实 Agent Workspace、共享快照复制和 diff collector。
- Agent 作为逻辑成员加入 Room，广播运行状态。

验收：使用 Fake Agent 完成一个 turn，并在 Activity 中看到启动、读取、写入和完成；真实 OpenCode 在隔离工作副本完成一个 turn，副本 diff 能形成 Proposal，原 workspace 保持不变。

### Phase 2：Chat 和 Editor 两个入口

- Chat 支持 mention alias 解析。
- Editor 增加选区 Agent Composer，不污染 Yjs 源码。
- 一个 Agent 同时只允许一个 running turn。
- 任务执行过程在 Chat/Team 中流式展示。

验收：同一任务从 Chat 和 Editor 都可触发；普通人类聊天不误触发；重复提交有明确状态。

### Phase 3：Proposal Review

- 多文件 Proposal 详情和 Diff。
- Apply/Reject 权限和幂等性。
- Apply 前共享正文不变；Apply 后写入 Yjs 并由已有机制写盘。
- Base hash 不一致时进入 conflict，不直接覆盖。

验收：能演示一个两文件修改的完整 Pending -> Review -> Apply，以及 Reject 后文件不变。

### Phase 4：OpenCode ACP + DeepSeek 和可视化回放

- 在用户本机安装 OpenCode CLI，并配置 OpenCode 的 DeepSeek Provider。
- 启动 `opencode acp`，确认 `session/new` 使用 `ds/deepseek-v4-flash`。
- 以共享 Yjs 快照创建隔离 Agent Workspace；OpenCode 不得直接使用共享 workspace。
- 允许 OpenCode 在隔离副本中自动执行测试或构建命令。
- 展示真实 Agent 的流式 update、工具调用、测试命令、输出摘要、退出码、权限请求和错误。
- 扩展 Playwright demo，录制 Chat 触发、Agent 读写、Proposal Review、Apply/Reject。
- 保留 Fake Agent 作为稳定回归基线；真实 Agent 端到端验收允许通过显式环境开关自动运行，避免日常测试消耗 API 配额。

验收：OpenCode + DeepSeek 能基于隔离共享快照修改至少两个文件，自动执行项目测试，并生成附带测试证据的 Proposal；原 workspace 在 Review 前不变，自动化视频可以复盘完整过程。

### Phase 5：并发和安全增强

- Base/Current/Agent 三方合并和冲突 UI。
- Proposal 过期、取消、超时、重试。
- Agent 文件 ownership 或同文件串行队列。
- Agent terminal capability 和 OS/容器沙箱。
- 运行和 Proposal 审计持久化。

## 12. 测试闭环

测试不直接依赖真实外部 Agent 或 API key。使用 Fake ACP Agent 模拟标准输入输出：

```text
Fake Agent initialize
  -> session/new
  -> session/prompt
  -> request fs/read_text_file
  -> request fs/write_text_file for src/a.ts
  -> request fs/write_text_file for tests/a.test.ts
  -> prompt response
```

必须覆盖：

1. Fake Agent 能读到 Human 尚未落盘的 Yjs 修改。
2. 同一文件多次 write 只产生一个最终 Proposal。
3. 多文件和新文件 Proposal 都能展示。
4. Proposal pending 时 Yjs 和磁盘都不改变。
5. Apply 后两位 Human 的编辑器和磁盘一致。
6. Reject 后 Yjs、磁盘和文件树保持不变。
7. Apply 时 Base hash 过期会进入 conflict，不覆盖 Human 新改动。
8. ACP JSON 跨 chunk、多消息、stderr 和子进程异常都能处理。
9. Agent 无法越过 workspace 路径边界。
10. Playwright 视频能看到 Agent 状态、文件变化和 Review 操作。
11. 真实 Agent 验收能证明 OpenCode + DeepSeek 在隔离副本中自动执行测试，且页面展示命令、退出码和结果摘要。

## 13. Review Gate

在开始写 Agent 代码之前，需要确认以下决策：

### 必须确认

1. **第一版外部 Agent**：是否采用 OpenCode ACP，并让 OpenCode 使用 `ds/deepseek-v4-flash`；Fake ACP Agent 仍作为自动化测试实现。
2. **Editor 入口**：是否采用选区上的临时 Agent Composer，而不是把 `@Agent` 写进源文件。
3. **Apply 权限**：第一版是否只允许 Host Apply/Reject，还是所有有编辑权限的 Human 都可以审阅。
4. **冲突策略**：第一版是否接受 Base hash 不一致就进入 conflict，暂不自动 diff3。
5. **Agent Terminal**：是否允许 OpenCode 在隔离工作副本中运行测试和构建命令，同时禁止它接入网页共享 Terminal。
6. **配置方式**：Agent command/args 是否由服务端启动配置提供，网页只配置启用状态和可见名称，不让浏览器保存 API key。
7. **工作目录策略**：是否接受真实 OpenCode 使用隔离工作副本，由 Harness 通过副本 diff 生成 Proposal；共享 Yjs 和磁盘在 Review 前保持不变。

### 建议默认值

```text
外部 Agent：可配置 ACP command，第一条真实路径为 OpenCode ACP + DeepSeek
自动化：Fake ACP Agent 必须先通过
Editor 入口：选区 Agent Composer
Apply 权限：Host only
并发：一个 Agent 一个 running turn；同文件串行
冲突：base hash 不一致 -> conflict
Terminal：Agent 仅可在隔离副本中运行命令，不接入网页共享 Terminal
Proposal：服务端内存存储，后续再持久化
工作目录：真实 OpenCode 使用隔离副本；Fake Agent 可走 ACP 文件回调
```

## 14. 本方案的主要风险

| 风险 | 影响 | 第一版处理 |
|---|---|---|
| ACP 外部命令输出不符合预期 | Agent 无法启动或消息卡死 | Fake Agent + transport contract test + stderr 日志 |
| Agent 读到旧状态 | 生成错误修改 | Fake Agent 走统一 adapter；真实 Agent 从 Yjs 导出一致快照到隔离副本 |
| Proposal 覆盖 Human 修改 | 丢代码 | Apply 做 base hash 检查，过期进入 conflict |
| Agent 进程越过 workspace | 数据泄露或破坏 | cwd、路径校验、默认无 terminal、子进程清理 |
| 真实 Agent 不稳定或产生 API 成本 | 日常 E2E 不稳定 | Fake Agent 作为主回归；真实端到端验收通过显式环境开关运行 |
| Chat 误触发 Agent | 产生不可预期任务 | 严格 mention 解析、显式状态和唯一 runId |
| 多个 Agent 互相覆盖 | Proposal 冲突 | MVP 单 Agent、同文件串行 |

## 15. 开发顺序和下一步

本轮只完成方案，不开始实现。方案 Review 通过后，下一轮从 Phase 0 开始，建议顺序如下：

1. 先补领域类型和 Fake ACP Agent。
2. 再实现 ACP transport 的单元/契约测试。
3. 再把 Yjs 文档封装成可读取的 `WorkspaceDocumentAdapter`。
4. 再实现单 Agent turn 和 Proposal Buffer。
5. 最后接 Chat 触发和网页 Review UI。

第一条垂直切片的明确验收条件：

```text
Fake ACP Agent 收到 task
  -> 从 Yjs 读到未落盘文本 "human-edit"
  -> 写入 src/hello.ts 和 tests/hello.test.ts
  -> 页面显示一个 pending proposal
  -> Yjs 和磁盘在 Apply 前仍为旧内容
  -> Host Apply 后两文件、编辑器和磁盘一致
```

这条切片通过之前，不接真实 OpenCode、DeepSeek 或多 Agent 编排。
