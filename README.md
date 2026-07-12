# SimpleRCPv2

SimpleRCPv2 是一个本地运行的实时协同编程原型，当前阶段专注于把传统 Human-Human 协作体验做扎实：多人查看和编辑同一个项目、共享光标与选区、聊天、活动记录和共享终端。

此前实验过的 MockAgent、DeepSeek、Scenario、Agent Runs、Tasks 和 Timeline 已从当前产品路径移除。未来如果重新引入 Agent，会优先研究 ACP 等标准协议，把成熟外部 Coding Agent 接入协作会话，而不是继续扩展内置的简化 Agent。

## 当前功能

- 打开任意本地多文件项目作为 workspace。
- 左侧 IDE 风格文件树与磁盘内容保持一致，包括隐藏目录和构建产物，并支持折叠、展开、新建、重命名和删除文件或文件夹。
- 文件内容只在点击时加载；二进制文件不会读入编辑器，超过 1 MiB 的文本文件会先请求确认。
- 中间使用 Monaco Editor 编辑代码，标签页可以关闭，并提供 JavaScript、TypeScript、Java、Python 等语言的基础语法支持。
- Python 文件提供关键词和常用结构的轻量候选补全。
- 多个浏览器用户可以实时看到代码内容变化。
- 代码同步使用 Yjs CRDT；多人同时编辑同一文件时会合并操作，而不是用最后一份完整文件覆盖其他人的修改。
- 协作文档由服务端延迟写回磁盘，关闭最后一个协作连接时会立即刷盘。
- 在编辑器中显示其他协作者的光标、选区和姓名。
- 右侧 Chat 支持多人聊天。
- Team 页面显示在线成员、当前文件、光标行列和自然语言 Activity。
- 底部 Terminal 支持白名单命令或本机 unrestricted 模式。
- 同一个用户打开多个标签页时聚合为一个成员，并显示标签页数量。

## 项目结构

```text
SimpleRCPv2/
├── apps/
│   ├── client/       React + Vite + Monaco 前端
│   └── server/       Express + WebSocket 本地服务
├── tests/
│   └── e2e/          Playwright 多人协作测试
└── README.md
```

## 环境要求

- Node.js 20 或更高版本
- pnpm 9

安装依赖：

```bash
cd /Users/baokker/Documents/SimpleRCPv2
pnpm install
```

## 启动 DemoProject

以 `/Users/baokker/Work/DemoProject` 作为协作项目，并允许本机 Terminal 执行任意命令：

```bash
cd /Users/baokker/Documents/SimpleRCPv2

SIMPLERCP_WORKSPACE="/Users/baokker/Work/DemoProject" \
SIMPLERCP_COMMAND_MODE="unrestricted" \
pnpm run dev
```

启动后访问：

```text
http://127.0.0.1:5173/?name=Bob
```

再打开一个浏览器窗口模拟另一位协作者：

```text
http://127.0.0.1:5173/?name=Ada
```

`unrestricted` 会直接在 `SIMPLERCP_WORKSPACE` 下执行网页 Terminal 输入的 shell 命令，只适合本机可信项目。

## 白名单命令模式

默认模式是 `restricted`。可以配置允许执行的命令：

```bash
cd /Users/baokker/Documents/SimpleRCPv2

SIMPLERCP_WORKSPACE="/Users/baokker/Work/DemoProject" \
SIMPLERCP_COMMAND_MODE="restricted" \
SIMPLERCP_COMMANDS="mvn test,mvn package" \
pnpm run dev
```

常用环境变量：

- `SIMPLERCP_WORKSPACE`：要打开的本地项目目录。
- `SIMPLERCP_COMMAND_MODE`：`restricted` 或 `unrestricted`。
- `SIMPLERCP_COMMANDS`：restricted 模式下的命令白名单，使用英文逗号分隔。
- `PORT`：后端端口，默认 `4000`。

## 使用方式

1. 在左侧按需展开文件夹并点击文件，中间会打开编辑器标签页；构建目录默认不会展开，但仍会完整显示在树中。
2. 点击二进制文件时会显示不可加载提示；点击超过 1 MiB 的文本文件时，可选择是否继续加载。
3. 两位用户打开同一个文件后，一方修改代码，另一方会看到实时内容变化。
4. 移动光标或选择代码，另一方会在 Monaco 中看到带姓名的远端光标和选区。
5. 在右侧 Chat 页面发送消息，所有协作者会看到同一份聊天记录。
6. 在 Team 页面查看成员状态和 Activity，例如谁加入、离开、打开或编辑了文件、发送了什么消息、运行了什么命令。
7. 在底部 Terminal 运行项目测试或构建命令。

## 测试和构建

运行服务端测试：

```bash
pnpm test
```

运行浏览器多人协作测试：

```bash
pnpm run test:e2e
```

运行完整构建：

```bash
pnpm build
```

Playwright 测试会验证：

- 两位用户加入同一个会话。
- 实时代码同步。
- 两位用户同时编辑同一文件时，双方和磁盘最终得到一致的合并结果。
- 远端光标和选区同步。
- 多人聊天。
- 自然语言 Activity。
- 共享 Terminal。
- 完整显示构建目录，并保护二进制文件和大文本文件的加载。
- Python 基础代码候选与可关闭编辑器标签页。
- 窄窗口下 Terminal 与 Collaboration 不重叠。

## 当前限制

- Room、Chat 和 Activity 暂存在服务内存中，服务重启后会清空。
- Yjs 文档状态当前只保存在服务进程内，服务重启后会从磁盘重新初始化，不保留独立的 CRDT 更新历史。
- 文件树当前由服务端递归扫描整个 workspace；超大项目还需要改为目录懒加载和文件系统变更监听。
- 当前只有一个默认 room，不支持会话创建和权限管理。
- Terminal 尚未做容器或沙箱隔离。
- Agent 和 ACP 接入不属于当前版本范围。

当前目标是先得到一个结构简单、行为可观察、可以可靠验证的实时协同编程原型，再在这个基础上研究更成熟的 Agent 协作方式。
