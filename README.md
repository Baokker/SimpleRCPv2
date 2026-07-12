# SimpleRCPv2

SimpleRCPv2 是一个实时协同编程原型系统，用来探索 human collaborator 和 AI Agent 在同一个项目空间里如何协作开发、运行命令、验证结果。

当前原型采用本地 Web App 形态：浏览器提供轻量 LiveShare 风格的协作 IDE，本地 Node 服务负责真实 workspace 文件访问、房间状态、任务授权、MockAgent / OpenAI-compatible Agent 执行、本地命令运行和事件日志。

## 当前能力

- 打开真实本地项目目录作为 workspace。
- 创建项目级 room，并通过同一个 URL 让多人加入。
- 使用 IDE 风格布局：左侧文件树，中间 Monaco 编辑器，右侧 Agent / 协作面板，底部终端。
- 展示多层文件树和多文件 Monaco 编辑器，并支持新建、重命名、删除文件和文件夹。
- 展示在线成员、离线状态、成员当前文件、活动事件。
- 按“人”聚合在线状态：同一个人打开多个 tab 会显示为一个成员，并标注 `2 tabs`。
- 支持人和人之间的聊天 transcript，也支持通过 `@MockAgent` 从聊天中唤起 Agent。
- 展示 Agent Run 状态，例如 queued、editing、running command、completed。
- 支持内置 scenario runner 和 timeline，让协作过程可以像回放一样观察。
- Activity 日志在限定空间内滚动，不会把聊天输入框挤出视野。
- 支持任务级 Agent 授权。
- 内置 deterministic MockAgent，用于稳定测试 human-agent 协作流程。
- 支持 DeepSeek 等 OpenAI-compatible provider，通过服务端环境变量接入。
- 支持白名单本地命令 runner，也支持显式开启 unrestricted terminal 后执行临时命令。
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
- `SIMPLERCP_COMMAND_MODE`：命令执行模式，默认 `restricted`；设为 `unrestricted` 后底部 Terminal 可输入任意命令。
- `PORT`：后端服务端口，默认是 `4000`。
- `AGENT_PROVIDER`：Agent provider，支持 `mock` 或 `openai-compatible`。
- `AGENT_BASE_URL`：OpenAI-compatible API 地址，例如 `https://api.deepseek.com`。
- `AGENT_API_KEY`：OpenAI-compatible API key，只应放在本地环境变量里。
- `AGENT_MODEL`：模型名，例如 `deepseek-v4-flash`。
- `AGENT_NAME`：Agent 在成员列表、Chat 和 Agent Runs 中显示的名称，DeepSeek 默认是 `DeepSeek`。
- `AGENT_MENTION_ALIASES`：可在 Chat 中唤起该 Agent 的别名，用英文逗号分隔，例如 `DeepSeek,DS`。
- `AGENT_EDITABLE_PATHS`：Chat 唤起 configured Agent 时允许编辑的路径范围，默认 `src/**,tests/**,package.json,README.md`。
- `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` / `DEEPSEEK_BASE_URL`：DeepSeek 便捷别名。

DeepSeek 示例：

```bash
SIMPLERCP_WORKSPACE="$PWD" \
SIMPLERCP_COMMANDS="npm test,npm run build" \
AGENT_PROVIDER="openai-compatible" \
AGENT_BASE_URL="https://api.deepseek.com" \
AGENT_API_KEY="your_deepseek_api_key_here" \
AGENT_MODEL="deepseek-v4-flash" \
AGENT_MENTION_ALIASES="DeepSeek,DS" \
pnpm run dev
```

不要把真实 API key 写进代码、README、测试 fixture、Event Log 或 Git commit。

如果你在早期原型阶段希望 Terminal 能临时执行任何命令，可以这样启动：

```bash
SIMPLERCP_WORKSPACE="$PWD" \
SIMPLERCP_COMMAND_MODE="unrestricted" \
pnpm run dev
```

`unrestricted` 会直接在 `SIMPLERCP_WORKSPACE` 下执行输入的 shell 命令，只适合本机可信 workspace。

## 如何使用

1. 启动项目后，打开 `http://127.0.0.1:5173`。
2. 左侧 explorer 会显示当前 workspace 的文件树，并提供新建文件、新建文件夹、重命名、删除操作。
3. 点击文件，例如 `src/hello.ts`，中间区域会打开 Monaco 编辑器。
4. 右侧 `Collaboration` 面板会显示 People、Scenario、Chat、Agent Runs、Timeline、Tasks 和 Activity。
5. Chat 是多人可见的 transcript。输入 `@MockAgent please update the sample` 会触发 MockAgent，执行过程会显示在 Chat 和 Agent Runs 中。
6. 如果配置了 DeepSeek / OpenAI-compatible Agent，可以在 Chat 输入 `@DeepSeek please run the tests` 或你的自定义别名；如果缺少 API key，Agent Runs 会显示 `blocked`，Chat 会说明原因。
7. Scenario 区域可以运行 `Observable demo`，它会模拟 Bob 唤起 MockAgent、Agent 编辑文件、运行测试、报告结果，并把每一步写入 Timeline。
8. 底部 `Terminal` 面板在默认模式下选择白名单命令并运行；在 unrestricted 模式下可以直接输入临时命令。
9. 底部状态栏会显示连接状态、room id、当前用户和 workspace 名称。

## 模拟多人协作

打开第二个浏览器窗口或标签页，并通过 query 参数指定不同昵称：

```text
http://127.0.0.1:5173/?name=Linus
```

两个页面会加入同一个 room。你可以在一个页面打开文件、编辑内容，另一个页面会看到成员状态和编辑同步。

如果同一个昵称在同一个浏览器里打开多个 tab，成员列表会聚合成一行并显示 tab 数量；关闭 tab 后会主动通知后端下线，避免列表不断累积“幽灵用户”。

## 使用 MockAgent

当前 MVP 内置的是 MockAgent，主要用于验证 human-agent 协作闭环，不依赖真实 API key。

使用步骤：

1. 在右侧 Chat 输入 `@MockAgent please update the sample` 并发送，或者点击 `Create MockAgent Task` 手动创建任务。
2. 系统会创建一个任务，并把 `MockAgent` 加入 room。
3. 聊天唤起会自动运行 MockAgent；手动任务可以点击任务里的 `Run Mock`。
4. MockAgent 会在授权范围内修改 `src/hello.ts`。
5. MockAgent 会运行授权命令 `npm test`。
6. 右侧 Chat 会出现 Agent 的确认和最终报告，Agent Runs 会显示当前状态。
7. 底部面板会显示命令输出和最终报告。
8. 右侧活动列表会显示 `task_created`、`agent_plan`、`agent_edited_file`、`command_completed`、`agent_reported` 等事件。

## 使用 DeepSeek / OpenAI-Compatible Agent

配置 `AGENT_PROVIDER=openai-compatible` 和 API 环境变量后，右侧任务列表会出现 `Run Provider` 按钮，Chat 里也可以直接 `@DeepSeek` 或 `@AGENT_MENTION_ALIASES` 中配置的别名。真实 provider 会读取任务描述、授权文件范围、授权命令和近期事件，然后返回结构化动作。

Chat 唤起流程：

1. 用户在 Chat 输入 `@DeepSeek please update the sample and run tests`。
2. 系统把 DeepSeek 加入 room，并创建一条 task。
3. Agent Runs 显示 `queued`、`thinking`、`running command`、`completed`、`failed` 或 `blocked`。
4. DeepSeek 的确认和最终报告会写入 Chat transcript。
5. Timeline 会记录 configured Agent 接受请求、完成、失败或因缺少 API key 被阻塞。

当前真实 provider 的执行边界：

- 只处理用户点击或 Chat mention 触发的一次有限动作循环。
- 只接受 `message`、`edit_file`、`run_command`、`final_report` 四类动作。
- 文件修改必须通过任务的 `editablePaths` 授权。
- 命令运行必须通过任务的 `commandWhitelist` 授权。
- 未授权动作会写入审批/拒绝事件，不会直接执行。
- API key 只在服务端环境变量读取，不会返回前端。

## 验证项目

运行服务端单元测试：

```bash
pnpm test
```

运行协作仿真测试：

```bash
pnpm run test:collab
```

运行可观察协作闭环测试：

```bash
pnpm exec playwright test --config tests/playwright.config.ts tests/e2e/observable.spec.ts
```

该测试会额外生成：

- `artifacts/observable-final.png`：最终 UI 截图。
- `artifacts/observable-timeline.json`：本次 scenario 的 timeline 数据。

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
- 用户 A 新建、重命名、删除文件和文件夹。
- 用户 A 从底部 Terminal 运行 `npm test`。
- 用户 A 创建 MockAgent 任务。
- MockAgent 修改授权文件并运行 `npm test`。
- 测试断言 UI 和 Event Log 中出现预期事件。

`tests/e2e/observable.spec.ts` 会补充验证：

- 同一个 Bob 关闭再进入不会生成多个不可区分的 Bob。
- 同一个人开两个 tab 会显示为一行和 `2 tabs`。
- Chat 消息会在多个浏览器中可见。
- `@DeepSeek` 会通过 fake OpenAI-compatible provider 生成可见的聊天回复、Agent Run 状态和 Timeline 结果。
- `@MockAgent` 会生成可见的聊天回复和 Agent Run 状态。
- unrestricted terminal 可以从 UI 执行临时命令。
- Scenario 会生成 chat、edit、command、result 类型的 timeline。

测试运行时会把 `tests/fixtures/sample-workspace` 复制到系统临时目录，不会污染仓库里的 fixture。

## 安全边界

当前 MVP 会在本机执行命令，因此默认要保持命令白名单尽可能小。

- 文件访问会限制在 `SIMPLERCP_WORKSPACE` 指定的目录内。
- 新建、重命名、删除文件/文件夹都会拒绝 path traversal。
- 默认 `restricted` 模式下，Runner 只执行 `SIMPLERCP_COMMANDS` 中列出的命令。
- `SIMPLERCP_COMMAND_MODE=unrestricted` 会允许任意命令，适合短期原型和可信本机项目，不适合暴露给不可信用户。
- Agent 只能在任务授权的 path 和 command 范围内执行。
- 自动化测试使用临时 workspace，避免修改真实项目。
- 真实 Agent 的 API key 应只保存在服务端环境变量，不应写入前端或 Event Log。

## 当前限制

- 当前真实 provider 是 OpenAI-compatible 的基础版本，支持 DeepSeek 这类接口，但还不是复杂多轮自治 Agent。
- 当前协作同步是 MVP 级 WebSocket 同步，还不是完整离线 CRDT 协作。
- 当前没有账号、权限系统、云端 relay 或 Docker 沙箱。
- 当前没有完整 Git UI，例如 branch、diff、commit、PR 操作。

这些限制是有意保留的，目的是先跑通“真实 workspace + 多人协作 + Agent 任务 + 本地命令 + 自动验收”这条最关键的纵向链路。
