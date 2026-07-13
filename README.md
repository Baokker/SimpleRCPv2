# SimpleRCPv2

SimpleRCPv2 是一个本地运行的实时协同编程原型，当前阶段专注于把传统 Human-Human 协作体验做扎实：多人查看和编辑同一个项目、共享光标与选区、聊天、活动记录和共享终端。

此前实验过的 MockAgent、DeepSeek、Scenario、Agent Runs、Tasks 和 Timeline 已从当前产品路径移除。未来如果重新引入 Agent，会优先研究 ACP 等标准协议，把成熟外部 Coding Agent 接入协作会话，而不是继续扩展内置的简化 Agent。

## 当前功能

- 打开任意本地多文件项目作为 workspace。
- 左侧 IDE 风格文件树与磁盘内容保持一致，包括隐藏目录和构建产物，并支持折叠、展开、新建、重命名和删除文件或文件夹。
- 文件树按目录懒加载，只有展开目录时才读取该层内容；磁盘新增、删除或重命名路径后会自动刷新已经加载的目录。
- 文件内容只在点击时加载；二进制文件不会读入编辑器，超过 1 MiB 的文本文件会先请求确认。
- 中间使用 Monaco Editor 编辑代码，标签页可以关闭，并提供 JavaScript、TypeScript、Java、Python 等语言的基础语法支持。
- Python 文件提供关键词和常用结构的轻量候选补全。
- 多个浏览器用户可以实时看到代码内容变化。
- 代码同步使用 Yjs CRDT；多人同时编辑同一文件时会合并操作，而不是用最后一份完整文件覆盖其他人的修改。
- 协作文档由服务端延迟写回磁盘，关闭最后一个协作连接时会立即刷盘。
- 终端命令或外部工具改写正在协作的文本文件后，服务端会把磁盘变化同步回 Yjs 文档和所有协作者。
- 在编辑器中显示其他协作者的光标、选区和姓名。
- Team 页面可以跟随某位协作者；对方切换文件或移动光标时，当前编辑器会自动切换并滚动到对应位置，再次点击即可退出跟随。
- 右侧 Chat 支持多人聊天。
- Team 页面显示在线成员、当前文件、光标行列和自然语言 Activity。
- Session 页面显示 Host、Room 和 workspace 信息；Host 可以在网页中调整 Terminal 与 Guest 权限，Guest 只能查看。
- 底部 Terminal 是所有协作者共享的真实 PTY，支持历史输出、交互输入、窗口尺寸同步和 Host 重启。
- restricted 模式通过白名单 Run 按钮执行命令并把输出广播给所有人；unrestricted 模式还可以直接在终端中输入任意 shell 命令和使用 `Ctrl+C`。
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

后端启动日志还会输出两个地址：

```text
Host URL:  http://127.0.0.1:5173/?hostToken=...
Guest URL: http://127.0.0.1:5173/
```

Host 应通过 `Host URL` 第一次进入。页面会把启动 token 换成当前浏览器会话并从地址栏移除。普通协作者使用 Guest URL，再通过 `?name=名字` 设置显示名称。

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
- `SIMPLERCP_HOST_TOKEN`：可选的固定 Host 启动 token；不设置时服务端会随机生成并打印 Host URL。
- `SIMPLERCP_SHELL`：可选的共享终端 shell 路径；默认使用当前用户的 `SHELL`，自动化测试固定为 `/bin/sh`。
- `PORT`：后端端口，默认 `4000`。

## 使用方式

1. 在左侧按需展开文件夹并点击文件，中间会打开编辑器标签页；构建目录默认不会展开，但仍会完整显示在树中。
2. 点击二进制文件时会显示不可加载提示；点击超过 1 MiB 的文本文件时，可选择是否继续加载。
3. 两位用户打开同一个文件后，一方修改代码，另一方会看到实时内容变化。
4. 移动光标或选择代码，另一方会在 Monaco 中看到带姓名的远端光标和选区。
5. 在 Team 页面点击其他成员右侧的眼睛图标进入跟随模式；再次点击退出跟随。
6. 在右侧 Chat 页面发送消息，所有协作者会看到同一份聊天记录。
7. 在 Team 页面查看成员状态和 Activity，例如谁加入、离开、打开或编辑了文件、发送了什么消息、运行了什么命令。
8. 在底部 Terminal 运行项目测试或构建命令。unrestricted 模式下可以直接操作共享 shell；Host 可点击重启图标重建 PTY。
9. Host 在右侧 Session 页面控制 Terminal 开关、命令模式、命令列表、超时，以及 Guest 的编辑、文件管理和命令权限。

## 测试和构建

运行服务端测试：

```bash
pnpm test
```

运行浏览器多人协作测试：

```bash
pnpm run test:e2e
```

录制完整的双人协作验收过程：

```bash
pnpm run demo:record
```

Playwright 会自动启动隔离的 `4100/5174` 服务、模拟 Host 与 Guest 加入和协作，并把 Host 视角保存为：

```text
artifacts/collaboration-demo.webm
```

录制使用的仍是实际 E2E 流程，不是预制动画；内容包括跟随成员、多人编辑、权限切换、聊天和共享 Terminal。

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
- 折叠目录按需加载，外部创建的文件无需刷新页面即可显示。
- 外部改写已打开文件后，两位协作者会自动看到新内容。
- Host/Guest 身份识别和 Session 设置实时同步。
- Guest 权限关闭后，网页操作和直接 API 调用都会被拒绝。
- 只读 Guest 仍能接收 Yjs 更新，但其本地注入不能修改 Host 或磁盘内容。
- Python 基础代码候选与可关闭编辑器标签页。
- 窄窗口下 Terminal 与 Collaboration 不重叠。

## node-pty 安装问题

共享 Terminal 使用 `node-pty`。如果安装后启动时报 `posix_spawnp failed`，在 macOS 上可强制从源码重建：

```bash
cd /Users/baokker/Documents/SimpleRCPv2

PATH=/Users/baokker/.nvm/versions/node/v22.19.0/bin:$PATH \
npm_config_build_from_source=true \
pnpm --filter @simplercp/server rebuild node-pty
```

源码构建需要已安装 Xcode Command Line Tools。

## 当前限制

- Room、Chat 和 Activity 暂存在服务内存中，服务重启后会清空。
- Yjs 文档状态当前只保存在服务进程内，服务重启后会从磁盘重新初始化，不保留独立的 CRDT 更新历史。
- 文件系统 watcher 当前观察整个 workspace；包含海量频繁变化构建产物的项目仍可能产生较多文件事件。
- 当前只有一个默认 room；已经支持 Host/Guest 权限，但还不支持创建多个会话、Host 转让或踢出成员。
- Terminal 尚未做容器或沙箱隔离；unrestricted 模式等同于让会话成员操作运行服务的本机 shell。
- Agent 和 ACP 接入不属于当前版本范围。

当前目标是先得到一个结构简单、行为可观察、可以可靠验证的实时协同编程原型，再在这个基础上研究更成熟的 Agent 协作方式。
