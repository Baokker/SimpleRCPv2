# SimpleRCPv2

SimpleRCPv2 是一个以服务端项目目录为代码来源的实时协同编程系统。用户在浏览器中选择项目，进入协作工作区，共同查看和编辑文件、聊天、观察成员状态并使用共享终端。

项目希望把代码、编辑器、终端和协作信息放在同一个页面中。后续接入 Coding Agent 时，Agent 也会使用同一份服务端代码，并在工作区中展示任务状态和 trace。

## 当前功能

- 项目首页：打开或删除已登记项目、创建空白项目、导入服务端已有目录、导入 ZIP。
- 默认 Demo：首次启动时自动复制 `demo/workspace` 并登记为 Demo 项目。
- 服务端代码保存：全部项目位于 `.simplercp-data/projects/`，也可以通过环境变量指定其他绝对路径。
- 文件管理：按需读取文件树，支持创建、重命名和删除文件与目录。
- 代码编辑：使用 Monaco Editor 和 Yjs 同步多人文本编辑、光标和选区，并显示保存与同步状态。
- 实时协作：显示成员、当前文件、聊天消息和 Activity；文件编辑记录包含变化行号与增删行数。
- 共享终端：使用 `node-pty` 在当前项目目录中运行 shell，允许输入任意命令。
- 外部变化同步：监听终端或其他程序产生的文件变化，并更新文件树和已经打开的协作文档。
- 错误恢复：协作连接与终端连接会自动重连，离线后可以手动重试；项目被删除后返回项目首页。
- 工作区控制：文件操作使用应用内确认窗口，Terminal 与 Collaboration 面板可以从状态栏显示或隐藏。
- 日间模式与夜间模式：主题选择保存在当前浏览器中。

## 使用流程

1. 完成下方的安装与启动，打开 `http://127.0.0.1:5173`。
2. 从项目列表打开 Demo、创建空白项目、导入 ZIP，或者填写服务端已有目录的绝对路径。
3. 填写显示名称和可选角色，进入项目工作区。
4. 与其他成员共同编辑文件、聊天和使用终端。

角色只用于界面显示，不改变成员权限。当前系统面向可信成员，进入项目的成员拥有相同的文件与终端能力。

## 安装与启动

环境要求：

- Node.js 20 或更高版本
- pnpm 9

首次使用时安装依赖并启动：

```bash
git clone https://github.com/Baokker/SimpleRCPv2.git
cd SimpleRCPv2
pnpm install
pnpm dev
```

已经安装依赖时，在仓库根目录直接运行：

```bash
pnpm dev
```

默认地址：

- 浏览器：`http://127.0.0.1:5173`
- 服务端：`http://127.0.0.1:4000`

启动命令无需填写 Workspace 参数。首次启动会创建 `.simplercp-data/`，并把仓库中的 `demo/workspace/` 复制到数据目录。浏览器项目列表中会直接显示 Demo。

## Demo 项目

在项目首页打开 `Demo`，填写显示名称后进入工作区。Demo 只使用 Node.js 内置功能，不需要安装额外依赖。

在共享终端中运行：

```bash
npm start
npm test
```

示例代码位于 `src/projectStatus.js`。可以在两个浏览器窗口中使用不同显示名称进入 Demo，同时修改该文件并观察光标、聊天和终端输出。

`pnpm dev:demo` 仍然可以使用，它与 `pnpm dev` 启动相同的应用和默认 Demo。

## 项目数据

默认数据目录为仓库根目录下的 `.simplercp-data/`：

```text
.simplercp-data/
├── projects
│   └── <projectId>
│       ├── project.json
│       └── workspace
└── registry.json
```

`.simplercp-data/` 已经加入仓库的 `.gitignore`。`workspace/` 是浏览器、共享终端和后续 Agent 共同访问的代码目录，也是服务端保存代码的位置。

导入服务端已有目录时，SimpleRCPv2 会把内容复制到新的 `workspace/`，原目录保持不变。导入 ZIP 和已有目录时会过滤 `.git`、`node_modules`、`__MACOSX` 和 `.DS_Store`。这些路径也不会出现在浏览器文件树和文件接口中。

从项目首页删除项目会停止该项目的运行资源，并删除 `.simplercp-data/projects/<projectId>/` 与 Registry 记录。导入项目的原目录不受影响。内置 Demo 始终保留。

可以指定其他数据目录，路径必须为绝对路径：

```bash
SIMPLERCP_DATA_DIR="/srv/simplercp-data" pnpm dev
```

部署时应当把该目录放在持久化存储中，并纳入备份范围。

## 公网访问

服务端和客户端的监听地址都可以配置：

```bash
SIMPLERCP_HOST="0.0.0.0" \
SIMPLERCP_PUBLIC_URL="https://code.example.com" \
VITE_SIMPLERCP_CLIENT_HOST="0.0.0.0" \
VITE_SIMPLERCP_API_ORIGIN="http://127.0.0.1:4000" \
pnpm dev
```

公网部署建议由同一个域名提供页面和接口。反向代理需要转发普通 HTTP 路径 `/api`，并为 `/ws`、`/yjs` 和 `/terminal` 开启 WebSocket 转发。页面使用 HTTPS 时，浏览器会自动使用 WSS。

当前版本允许项目成员运行任意 shell 命令，并直接访问服务端项目目录。公网部署需要在可信网络、VPN 或外部身份认证之后提供访问，不应直接开放为匿名公共服务。相关限制见 [已知问题](./docs/product/known-issues.md)。

## 配置

- `SIMPLERCP_DATA_DIR`：项目数据目录，默认值为仓库根目录下的 `.simplercp-data/`，设置值必须为绝对路径。
- `SIMPLERCP_HOST`：服务端监听地址，默认值为 `127.0.0.1`。
- `SIMPLERCP_PUBLIC_URL`：用户访问的浏览器地址，默认值为 `http://127.0.0.1:5173`。
- `SIMPLERCP_SHELL`：共享终端使用的 shell 路径，默认读取当前进程的 `SHELL`，随后使用 `/bin/sh`。
- `PORT`：服务端端口，默认值为 `4000`。
- `VITE_SIMPLERCP_CLIENT_HOST`：开发客户端监听地址，默认值为 `127.0.0.1`。
- `VITE_SIMPLERCP_CLIENT_PORT`：开发客户端端口，默认值为 `5173`。
- `VITE_SIMPLERCP_API_ORIGIN`：开发客户端代理连接的服务端地址，默认值为 `http://127.0.0.1:4000`。

## 项目结构

```text
.
├── README.md
├── apps
│   ├── client
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── src
│   │   └── vite.config.ts
│   └── server
│       ├── package.json
│       ├── src
│       └── vitest.config.ts
├── demo
│   └── workspace
├── docs
│   ├── product
│   └── research
├── scripts
│   └── start-demo.mjs
├── tests
│   ├── e2e
│   ├── fixtures
│   └── playwright.config.ts
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

主要目录职责：

- `apps/client/`：React 浏览器客户端，包含项目首页、协作工作区、Monaco Editor、Yjs 客户端和共享终端界面。
- `apps/server/`：Express 与 WebSocket 服务，负责项目注册、代码保存、Room、Yjs 文档、终端和文件监听。
- `demo/workspace/`：首次启动时导入的数据示例项目。
- `docs/product/`：基线需求、开发计划、已知问题和后续改进方向。
- `docs/research/`：Agent runtime、文档同步和并行 Agent 等调研记录。
- `scripts/`：仓库启动辅助命令。
- `tests/e2e/`：项目流程、多人协作和主题的 Playwright 测试。
- `tests/fixtures/`：自动化测试使用的项目文件。

## 测试与构建

运行服务端测试、Demo 测试和启动测试：

```bash
pnpm test
```

运行浏览器自动化测试：

```bash
pnpm test:e2e
```

运行 TypeScript 检查并构建客户端与服务端：

```bash
pnpm build
```

## 文档

- [文档索引](./docs/README.md)：全部产品与调研文档入口。
- [基线需求](./docs/product/2026-09-17-baseline.md)：完整产品流程、功能范围和验收条件。
- [开发计划](./docs/product/2026-09-17-development-plan.md)：模块职责、开发顺序和测试范围。
- [已知问题](./docs/product/known-issues.md)：成员、终端和 Agent 同时修改文件等当前限制。
- [改进方向](./docs/product/improvement-roadmap.md)：并行 Agent、任务目录、运行恢复和 trace 分析方向。
- [Agent runtime 调研](./docs/research/2026-09-17/agent-runtime.md)：OpenCode、DeepSeek、session 和 trace 调研。
- [文档同步调研](./docs/research/2026-09-17/document-sync.md)：磁盘、Yjs、终端和 Agent 同时修改文件时的同步处理。
- [Agent 并行执行调研](./docs/research/2026-09-17/parallel-agent.md)：多 session、独立工作目录和并行处理方式。

Agent 配置、Agent run、session 延续和 trace 页面仍在开发计划中。当前代码已经提供多项目与协作基础，每个项目拥有独立的 Room、Yjs 文档、共享终端和文件监听器。
