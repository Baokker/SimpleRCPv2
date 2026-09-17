# SimpleRCPv2 当前实现盘点

更新时间：2026-08-09

本文只记录当前仓库代码已经实现并经过测试的能力。关于 ACP Agent 的内容不写成现状，统一放在 [ACP Agent 接入方案](./02-acp-agent-proposal.md) 中。

## 1. 项目定位

SimpleRCPv2 当前是一个本地运行的多人实时协同编程原型。它的产品重点已经从早期的 Mock Agent 和内置 Agent 任务，收敛到传统 Human-Human 协作：让多个浏览器用户共同查看和编辑一个真实的多文件 workspace，并观察彼此的编辑、光标、聊天和终端操作。

当前系统不是一个已经接入 ACP 的 Agent IDE，也没有在当前仓库中实现 DeepSeek、Claude Code 或其他外部 Agent 的调用。

## 2. 当前架构

```text
浏览器用户
  ├── React + Vite
  ├── Monaco Editor
  ├── Yjs / y-monaco
  ├── Chat / Team / Session
  └── xterm.js
          │ HTTP + WebSocket
          ▼
本地 Node.js 服务
  ├── Express API
  ├── 房间、成员、聊天、Activity 内存状态
  ├── Yjs WebSocket 与协作文档持久化
  ├── workspace 文件服务与 chokidar watcher
  ├── Host / Guest 权限控制
  └── node-pty 共享终端
          │
          ▼
本地 workspace 磁盘目录
```

主要代码位置：

| 模块 | 代码 | 当前职责 |
|---|---|---|
| 前端入口 | `apps/client/src/App.tsx` | 启动、加入房间、文件操作、聊天、跟随、终端编排 |
| 编辑器 | `apps/client/src/components/EditorArea.tsx` | Monaco、Yjs 绑定、远端光标和选区 |
| 文件树 | `apps/client/src/components/WorkspaceExplorer.tsx` | 懒加载目录、文件和文件夹管理 |
| 协作面板 | `apps/client/src/components/CollaborationPanel.tsx` | Chat、Team、Session、成员跟随和 Activity |
| 共享终端 | `apps/client/src/components/SharedTerminal.tsx` | xterm.js UI、终端输入、尺寸同步和重启请求 |
| 房间 WebSocket | `apps/server/src/realtime.ts` | Presence、事件、Yjs 和 Terminal WebSocket |
| 协作文档 | `apps/server/src/collaborativeDocuments.ts` | Yjs 文档初始化、延迟写盘、watcher 回写 |
| 共享 PTY | `apps/server/src/sharedTerminal.ts` | 单个 workspace 共享 PTY、广播输出和滚动缓存 |
| 文件 API | `apps/server/src/workspace.ts` / `createApp.ts` | 读取、创建、重命名、删除和路径校验 |
| 会话权限 | `apps/server/src/sessionControl.ts` | Host/Guest、终端模式和 Guest 权限 |

## 3. 已实现能力

### 3.1 多文件 workspace

- 服务启动时通过 `SIMPLERCP_WORKSPACE` 指定本地项目目录。
- 左侧文件树展示磁盘上的文件和目录，包括构建产物；目录按需展开。
- 支持新建文件、新建文件夹、重命名和删除。
- 文本文件点击后才加载到 Monaco；二进制文件提示不可编辑；大文本文件需要确认后加载。
- 外部命令或其他程序改变 workspace 后，文件树和已经打开的协作文档会通过 watcher 刷新。

### 3.2 实时协同编辑

- 每个文本文件映射为一个 Yjs 文档，并通过 `y-websocket` 在多个浏览器之间同步。
- 多人同时编辑通过 Yjs CRDT 合并，而不是用最后一次完整文件覆盖。
- 协作文档延迟写回磁盘，关闭最后一个连接时会刷盘。
- Host 和允许编辑的 Guest 都可以写入；关闭 Guest 编辑权限后，服务端会拒绝只读 Guest 的 Yjs 写入。

### 3.3 可见的协作状态

- Team 展示成员在线状态、角色、当前文件和连接的 tab 数量。
- Monaco 展示远端协作者的光标、选区和姓名标签。
- Follow 模式可以自动打开被跟随者当前文件，并把编辑器滚动到其光标位置。
- Chat 是房间级的人与人聊天记录。
- Activity 展示加入、离开、打开文件、编辑文件、聊天、文件管理和命令执行等事件。

### 3.4 共享 Terminal

- 服务端创建一个位于 workspace 根目录的真实 `node-pty`。
- 所有已加入成员看到同一份终端输出和滚动缓存。
- `unrestricted` 模式下允许有权限的成员直接输入 shell 命令，包括交互输入和 `Ctrl+C`。
- `restricted` 模式下通过命令白名单和 Run 按钮执行命令，结果也会写入共享终端。
- Host 可以重启共享 PTY。
- 当前 Terminal 没有容器或操作系统级沙箱，`unrestricted` 只适用于可信的本地会话。

### 3.5 自动化验证和回放

- 服务端有房间、权限、文件、CRDT、命令运行和共享 PTY 的 Vitest 测试。
- Playwright 会启动隔离的服务和浏览器，验证两位 Human 协作者的完整流程。
- `pnpm run demo:record` 会录制 Host 视角的协作过程，覆盖加入、跟随、编辑、聊天和共享终端。
- 录制脚本和测试使用确定性的 fixture workspace，不依赖外部模型或 API key。

## 4. 当前尚未实现

以下能力不能从当前代码中宣称已经存在：

- ACP Client 和外部 Coding Agent 子进程管理。
- Agent 作为房间成员加入并显示 Agent 身份。
- Chat 或编辑器中的 `@Agent` 触发解析。
- 从 Yjs 读取共享最新内容并提供给 Agent 的文件系统代理。
- Agent 写入的按 turn、按文件 Pending Proposal。
- Proposal Diff、Apply、Reject 和审阅状态同步。
- Agent 运行过程中的计划、工具调用、权限请求、错误和最终报告展示。
- Agent 任务取消、超时、重试和进程清理。
- Agent Proposal 与 Human 并发编辑之间的三方合并。
- 多 Agent 编排、Agent ownership、任务队列和跨 Agent 冲突调度。
- Agent 使用 Terminal 的独立权限边界和强沙箱。

## 5. 已有验证

截至本文更新时间，最近一次代码状态已经验证：

```text
pnpm test       -> 服务端 35 个测试通过
pnpm build      -> 前后端构建通过
pnpm run test:e2e -> Human 协作 E2E 通过，录制用例默认跳过
pnpm run demo:record -> 双浏览器协作视频生成成功
```

这里的测试证明的是 Human-Human 协作核心，不证明 ACP Agent 已经接入。

## 6. 当前主要技术债

1. 房间、Chat、Activity 和 Session 状态仍在内存中，服务重启会丢失。
2. 当前只有一个默认房间，还没有创建房间、房间持久化和多房间隔离。
3. 共享 Terminal 是真实 PTY，但没有容器、用户隔离或命令审计策略。
4. 文件 watcher 观察整个 workspace，构建产物频繁变化时可能产生较多事件。
5. Chat 和部分 Activity 仍通过轮询刷新，实时事件模型还可以进一步统一。
6. Agent/ACP 尚未进入当前产品代码，需要先完成下一份方案的 Review Gate，再开始实现。
