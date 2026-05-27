# SimpleRCPv2

SimpleRCPv2 是一个实时协同编程原型系统，用来探索 human collaborator 和 AI Agent 在同一个项目空间里如何协作开发、运行命令、验证结果。

当前 MVP 采用本地 Web App 形态：浏览器提供轻量 LiveShare 风格的协作 IDE，本地 Node 服务负责真实 workspace 文件访问、房间状态、任务授权、MockAgent 执行、本地命令运行和事件日志。

## 当前能力

- 打开真实本地项目目录作为 workspace。
- 创建项目级 room，并通过同一个 URL 让多人加入。
- 展示多层文件树和多文件 Monaco 编辑器。
- 展示在线成员、成员当前文件、活动事件。
- 支持基础聊天面板。
- 支持任务级 Agent 授权。
- 内置 deterministic MockAgent，用于稳定测试 human-agent 协作流程。
- 支持白名单本地命令 runner，例如 `npm test`。
- 记录结构化 Event Log，用于调试、研究和自动化验收。
- 内置 Playwright 协作仿真测试，帮助 AI 在开发本项目时自动验证核心功能。

## 环境准备

需要 Node.js 和 pnpm。推荐使用 Corepack 启用 pnpm：

```bash
corepack enable
corepack prepare pnpm@9.0.0 --activate
```

安装依赖：

```bash
pnpm install
```

## 启动项目

最常见的启动方式是把当前仓库作为 workspace：

```bash
SIMPLERCP_WORKSPACE="$PWD" SIMPLERCP_COMMANDS="npm test,npm run build" pnpm run dev
```

启动后打开：

```text
http://127.0.0.1:5173
```

也可以指定任意本地项目目录作为 workspace：

```bash
SIMPLERCP_WORKSPACE="/path/to/your/project" SIMPLERCP_COMMANDS="npm test,npm run build" pnpm run dev
```

常用环境变量：

- `SIMPLERCP_WORKSPACE`：要打开的本地项目目录。
- `SIMPLERCP_COMMANDS`：允许 runner 执行的命令白名单，用英文逗号分隔。
- `PORT`：后端服务端口，默认是 `4000`。

## 如何使用

1. 启动项目后，打开 `http://127.0.0.1:5173`。
2. 左侧 `Workspace` 面板会显示当前 workspace 的文件树。
3. 点击文件，例如 `src/hello.ts`，中间区域会打开 Monaco 编辑器。
4. 右侧 `Collaboration` 面板会显示在线成员、任务、活动事件和聊天框。
5. 底部 `Terminal / Tests` 面板会显示命令输出和 Agent 执行报告。

## 模拟多人协作

打开第二个浏览器窗口或标签页，并通过 query 参数指定不同昵称：

```text
http://127.0.0.1:5173/?name=Linus
```

两个页面会加入同一个 room。你可以在一个页面打开文件、编辑内容，另一个页面会看到成员状态和编辑同步。

## 使用 MockAgent

当前 MVP 内置的是 MockAgent，主要用于验证 human-agent 协作闭环，不依赖真实 API key。

使用步骤：

1. 在右侧 `Collaboration` 面板点击 `Create MockAgent Task`。
2. 系统会创建一个任务，并把 `MockAgent` 加入 room。
3. 点击任务里的 `Run MockAgent`。
4. MockAgent 会在授权范围内修改 `src/hello.ts`。
5. MockAgent 会运行授权命令 `npm test`。
6. 底部面板会显示命令输出和最终报告。
7. 右侧活动列表会显示 `task_created`、`agent_plan`、`agent_edited_file`、`command_completed`、`agent_reported` 等事件。

## 验证项目

运行服务端单元测试：

```bash
pnpm test
```

运行协作仿真测试：

```bash
pnpm run test:collab
```

运行完整构建：

```bash
pnpm build
```

推荐在改动核心逻辑后运行：

```bash
pnpm test && pnpm run test:collab && pnpm build
```

## 协作仿真测试说明

`pnpm run test:collab` 会自动启动前后端，并用 Playwright 模拟完整流程：

- 用户 A 和用户 B 加入同一个 room。
- 两个用户看到彼此在线。
- 用户 A 和用户 B 打开同一个文件。
- 用户 A 修改编辑器内容，用户 B 看到同步后的内容。
- 用户 A 创建 MockAgent 任务。
- MockAgent 修改授权文件并运行 `npm test`。
- 测试断言 UI 和 Event Log 中出现预期事件。

测试运行时会把 `tests/fixtures/sample-workspace` 复制到系统临时目录，不会污染仓库里的 fixture。

## 安全边界

当前 MVP 会在本机执行命令，因此要保持命令白名单尽可能小。

- 文件访问会限制在 `SIMPLERCP_WORKSPACE` 指定的目录内。
- Runner 只执行 `SIMPLERCP_COMMANDS` 中列出的命令。
- 自动化测试使用临时 workspace，避免修改真实项目。
- 未来真实 Agent 的 API key 应只保存在服务端，不应写入前端或 Event Log。

## 当前限制

- 当前 Agent 是 deterministic MockAgent，还不是 DeepSeek/GLM/OpenAI 等真实 provider。
- 当前协作同步是 MVP 级 WebSocket 同步，还不是完整离线 CRDT 协作。
- 当前没有账号、权限系统、云端 relay 或 Docker 沙箱。
- 当前没有完整 Git UI，例如 branch、diff、commit、PR 操作。

这些限制是有意保留的，目的是先跑通“真实 workspace + 多人协作 + Agent 任务 + 本地命令 + 自动验收”这条最关键的纵向链路。
