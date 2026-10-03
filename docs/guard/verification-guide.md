# Guard 功能验证教程

本文适用于 `feature/terminal-guard` 分支，用于验证共享终端、成员角色、审批队列、快照、Agent 权限继承和 LLM 研判。每个验证项都给出操作、预期结果和检查位置。

## 验证范围

本教程覆盖以下功能：

- 服务端和浏览器客户端的启动配置。
- 同一项目内多个成员连接同一个项目级共享 PTY。
- 命令模式、交互控制和前台程序占用检查。
- `observer`、`student`、`collaborator`、`trusted`、`owner` 五个权限档位。
- `allow`、`allow_snapshot`、`ask`、`deny` 四种 Guard 动作。
- 在线 owner 审批、发起成员本人审批、审批超时和拒绝结果。
- 工作区文件快照、快照恢复和快照保留规则。
- Agent 使用发起成员当前角色的权限，以及发起成员离线后的限制。
- LLM 的 `off`、`suggest`、`auto` 三种研判模式。
- 可拖动的工作区、协作面板和共享终端尺寸。
- Team 审批角标、右下角通知，以及模型判断过程和结果展示。
- `guard-audit.jsonl`、`guard-policy.json`、`activity.json`、快照清单和 Agent `trace.jsonl`。

## 环境要求

- macOS、Linux 或 Windows。
- Node.js 20 或更高版本。
- pnpm 9。
- 两个浏览器窗口。推荐使用普通窗口和隐私窗口，便于创建两个独立成员。
- 验证 Agent 时需要可用的 DeepSeek API Key。
- 验证 LLM 时需要可用的 OpenAI-compatible `chat/completions` 服务。

浏览器验证使用 `http://127.0.0.1` 地址。局域网访问时需要同时修改 `SIMPLERCP_HOST`、`SIMPLERCP_PUBLIC_URL` 和 Vite 的 API 地址，并保证 WebSocket 可以连接。

## 安装和启动

在仓库根目录执行：

```bash
pnpm install
cp .env.example .env
```

编辑 `.env`。下面的配置可以验证完整 Guard 流程：

```dotenv
SIMPLERCP_HOST=127.0.0.1
SIMPLERCP_PUBLIC_URL=http://127.0.0.1:5173
SIMPLERCP_TERMINAL_ENABLED=true
SIMPLERCP_GUARD_MODE=full
SIMPLERCP_GUARD_APPROVAL_TIMEOUT_MS=120000

DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-flash

SIMPLERCP_DATA_DIR=
SIMPLERCP_WORKSPACES_DIR=
SIMPLERCP_IMPORT_ROOTS=
SIMPLERCP_TERMINAL_HOME=
SIMPLERCP_TERMINAL_ENV_ALLOW=
SIMPLERCP_AGENT_ENV_ALLOW=
SIMPLERCP_OPENCODE_PORT=4096
SIMPLERCP_AGENT_RUN_TIMEOUT_MS=600000
```

`DEEPSEEK_API_KEY` 只写在服务端环境变量中。教程中的 `your_deepseek_api_key` 需要替换为实际密钥，密钥不要写入命令、聊天消息、项目文件或截图。

默认数据目录是仓库根目录下的 `.simplercp-data/`。需要使用独立验证数据时，设置一个绝对路径：

```dotenv
SIMPLERCP_DATA_DIR=/Users/baokker/Documents/SimpleRCPv2/.guard-verification-data
```

该目录包含项目元数据和工作区，已经被 Git 忽略。换用新的数据目录可以避免历史成员、审批和快照影响验证结果。

启动完整开发环境：

```bash
pnpm dev
```

也可以使用 Demo 启动命令：

```bash
pnpm dev:demo
```

启动成功时，服务端输出类似下面的内容：

```text
SimpleRCPv2 server listening on http://127.0.0.1:4000
Open http://127.0.0.1:5173
Project data: /absolute/path/to/.simplercp-data
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。项目列表中应该有 `Demo`。使用下面的命令检查服务端：

```bash
curl http://127.0.0.1:4000/api/health
```

响应中的 `ok` 应为 `true`，`features.terminal` 应为 `true`。

### 三种 Guard 运行模式

| `SIMPLERCP_GUARD_MODE` | 人员终端 | Agent | 适合的验证内容 |
| --- | --- | --- | --- |
| `full` | 角色、路径、审批和交互控制全部启用 | 同一 Guard 策略全部启用 | 本教程的完整验证 |
| `human-only` | 角色、路径、审批和交互控制全部启用 | Agent 请求直接允许 | 对比 Agent 管控范围 |
| `off` | 维持无 Guard 的终端行为 | OpenCode 工具权限直接允许 | 对比旧行为 |

每次修改运行模式都需要重新启动服务端。正式通过 `loadConfig()` 启动时，未填写 `SIMPLERCP_GUARD_MODE` 使用 `full`。为了让验证结果清晰，建议显式填写 `SIMPLERCP_GUARD_MODE=full`。

### 启动检查清单

- [ ] `pnpm install` 成功完成。
- [ ] `.env` 存在，`SIMPLERCP_TERMINAL_ENABLED=true`。
- [ ] `pnpm dev` 持续运行，没有端口错误。
- [ ] 浏览器可以打开项目首页。
- [ ] `Demo` 项目可以打开。
- [ ] 工作区底部显示 `Terminal`，终端状态最终显示 `Shared · Connected`。
- [ ] `SIMPLERCP_GUARD_MODE=full` 时，终端面板显示命令输入框。

### 验证可调布局

进入项目后，在以下边界上移动鼠标，光标会变为调整方向：

1. 工作区与编辑器之间的竖直边界：调整左侧工作区宽度。
2. 编辑器与协作面板之间的竖直边界：调整右侧协作面板宽度。
3. 编辑器与终端之间的水平边界：调整底部终端高度。

拖动过程中松开鼠标，页面会保留当前尺寸；刷新项目后尺寸仍然保留。每个尺寸有最小值和最大值，编辑器会始终保留可用空间。隐藏协作面板或终端后重新显示，之前的尺寸会继续使用。

## 创建验证成员

1. 在项目首页打开 `Demo`。
2. 在加入页面填写显示名，例如 `Owner Alice`。
3. 在 `Role` 下拉框中选择 `teacher (owner)`，点击 `Enter project`。
4. 使用第二个浏览器窗口打开同一个项目。
5. 选择 `Create a new participant`，填写 `Student Bob`，选择 `student (student)`，点击 `Enter project`。
6. 需要完整权限矩阵时，再创建以下成员：

| 显示名 | Role | 权限档位 |
| --- | --- | --- |
| `Observer Carol` | `auditor` | `observer` |
| `Developer Dan` | `developer` | `collaborator` |
| `Trusted Erin` | `maintainer` | `trusted` |
| `Owner Alice` | `teacher` | `owner` |

`Role` 选项按教学、团队协作、面试考核、黑客松和运维排障场景分组。未选择 Role 或填写未知值时使用 `collaborator` 档位。成员列表中的在线状态、Role 和多标签页数量可以用于确认身份是否正确。

同一成员可以在多个标签页中继续自己的身份。要验证两个独立发起成员，使用 `Create a new participant` 创建两个成员，不要在两个窗口中选择同一个已有成员。

## 启动完成后的新增功能

### 项目级共享终端

每个项目有一个共享 PTY。多个成员可以各自打开浏览器连接同一项目，每个连接都能看到相同的滚动输出和终端状态。命令模式通过输入框提交整行命令，命令会先进入 Guard 判定。

### 交互控制

Guard 启用时，原始按键输入只对交互控制持有者开放。owner 可以在 `People` 区域向在线成员授予十分钟控制权，同一时间只有一个持有者。控制到期、被收回或持有者离线后，终端恢复命令模式。

### 角色和权限

成员 Role 会映射到五个权限档位。读取、写入、删除、执行、网络、历史修改、进程控制、提权和安装操作分别判定。每次请求都会读取发起成员当前 Role。

### 审批队列

`ask` 请求进入审批队列。普通人员请求需要在线 owner 处理；Agent 因不可逆操作或网络加执行提高的审批请求交给发起成员本人。审批卡片展示来源、命令或路径、命中的规则，并提供 `Approve` 和 `Reject`。当前成员属于审批人时，Team 页签显示待处理数量角标，页面右下角显示通知；点击 Team 后角标清除，审批卡片仍保留到请求结束。

### 文件快照

`allow_snapshot` 请求执行前会复制工作区文件，并在项目元数据目录的 `snapshots/` 下写入清单。快照用于恢复文件内容，最近 20 项会被保留。

### Agent Guard

OpenCode 的 `bash`、`edit`、`read` 和 `webfetch` 请求都经过同一 Guard 服务。Agent 使用发起成员当前的 Role。批准 OpenCode 权限时只回复 `once`，每次新请求都会重新判定。

### LLM 研判

LLM 只接收已经进入 `ask` 的请求。模型结果包含风险、置信度和理由。请求等待模型响应时，Team 卡片和 Activity 会显示判断进行中；模型返回后，卡片会显示风险、置信度、理由和是否已经自动处理。自动批准或自动拒绝会在右下角通知中显示结果。

## 验证共享终端

### 多成员看到同一输出

在 `Owner Alice` 窗口的终端命令输入框提交：

```bash
printf 'owner-message\n'
```

在 `Student Bob` 窗口提交：

```bash
printf 'student-message\n'
```

预期结果：

- 两个窗口都能看到两行输出。
- 两个窗口的终端状态都是 `Shared · Connected`。
- `People` 区域显示两个在线成员。
- `Activity` 中出现终端相关活动。

继续验证滚动输出同步：

```bash
printf 'line-1\nline-2\nline-3\n'
```

刷新其中一个浏览器窗口。刷新完成后，终端应该收到 `terminal_snapshot`，并继续显示刷新前的滚动内容。

### 每个成员提交命令

在没有交互控制持有者时，`full` 模式下每个在线成员都可以使用命令输入框提交普通命令。分别提交：

```bash
pwd
```

```bash
printf 'command-from-bob\n'
```

预期结果：每条命令都会在同一个项目工作区执行，并且所有连接都会看到输出。命令执行者会出现在 `Activity` 记录中。

### 终端重启权限

在 `Owner Alice` 窗口点击终端标题栏中的重启按钮。终端会重新创建 PTY。

在 `Student Bob` 窗口查看同一个按钮：

- `full` 或 `human-only` 模式下按钮不可用。
- owner 重启后，其他窗口会收到新的终端状态和输出。

把 `SIMPLERCP_GUARD_MODE` 设置为 `off` 后，可用 `off` 模式重复此项。`off` 模式允许成员直接使用终端输入和重启按钮。

### 前台程序占用

用 owner 向在线成员授予交互控制，方法见下一节。控制持有者运行：

```bash
node
```

在另一个成员窗口的命令输入框提交：

```bash
pwd
```

预期结果：第二个请求收到 `guard_decision`，动作是 `deny`，理由为 `终端正忙`。前台程序退出后，例如在 Node REPL 输入 `.exit`，命令模式恢复。

## 验证交互控制

### 授予和收回控制

1. 在 `Owner Alice` 窗口打开 `People` 区域。
2. 找到 `Student Bob`，点击 `Grant interactive control`。
3. 在 Bob 窗口确认终端状态区域显示 `Interactive control until ...`。
4. 在 Bob 的终端中运行交互程序：

   ```bash
   node
   ```

5. 输入 `1 + 1`，预期返回 `2`。
6. 输入 `.exit` 退出 Node。
7. 回到 Alice 窗口点击 `Revoke control`。

预期结果：

- 只有 Bob 的终端输入可以直接写入 PTY。
- Alice 和其他成员仍然可以看到 Bob 的输入和输出。
- 收回后 Bob 的原始终端输入被拒绝，终端命令输入框继续按照 Guard 规则工作。
- `Activity` 中出现授予和收回交互控制的事件。

### 单一控制持有者

Alice 继续把控制授予 `Developer Dan`。预期结果：Bob 的控制状态结束，Dan 成为唯一持有者。再把控制授予另一个在线成员，前一个持有者立即失去控制。

关闭持有者浏览器窗口，等待成员状态变为离线。预期结果：交互控制立即被收回，`Activity` 中出现控制因成员离线而结束的事件。

### 非 owner 操作控制

在 Bob 窗口查看 `People` 区域。Bob 的成员条目不显示 `Grant interactive control`。如果通过 HTTP 请求尝试设置控制，服务端返回 `Owner permission is required`，控制状态保持不变。

## 验证角色和权限矩阵

下面的命令都在当前项目工作区中执行。对会修改文件的验证，使用临时文件名，例如 `guard-role-check.txt`。

| Role 示例 | 读取工作区文件 | 写入工作区 | 删除工作区文件 | 网络 | 提权 |
| --- | --- | --- | --- | --- | --- |
| `auditor` | `allow` | `deny` | `deny` | `deny` | `deny` |
| `student` | `allow` | `allow_snapshot` | `ask` | `ask` | `deny` |
| `developer` | `allow` | `allow_snapshot` | `allow_snapshot` | `allow` | `deny` |
| `maintainer` | `allow` | `allow` | `allow_snapshot` | `allow` | `ask` |
| `teacher` | `allow` | `allow` | `allow` | `allow` | 高风险外部操作仍可能 `ask` |

### observer 验证

把当前成员设置为 `auditor`，提交：

```bash
pwd
```

预期结果是 `allow`，命令输出当前项目工作区路径。然后提交：

```bash
touch guard-role-check.txt
```

预期结果是 `deny`，文件不会创建，`Activity` 出现 Guard 拒绝记录。删除操作也应为 `deny`。

### student 验证

把当前成员设置为 `student`，提交：

```bash
touch guard-role-check.txt
```

预期结果是 `allow_snapshot`。命令执行前创建快照，命令完成后文件存在。

提交：

```bash
rm guard-role-check.txt
```

预期结果是 `ask`。Alice 的 `People` 区域出现审批卡片，点击 `Reject` 后文件仍然存在，点击 `Approve` 后文件被删除。

提交：

```bash
sudo -n true
```

预期结果是 `deny`，命中 `role.student.privilege` 或相关硬规则。

### collaborator 和 trusted 验证

将成员切换为 `developer`，重复 `touch` 和 `rm`。两条修改命令都应产生 `allow_snapshot`，并在执行前各自创建快照。

将成员切换为 `maintainer`，提交：

```bash
chmod 600 guard-role-check.txt
```

预期结果是 `ask`，因为 `trusted` 对提权能力需要确认。

### owner 的高风险确认

将成员切换为 `teacher`，提交：

```bash
git push
```

预期结果是 `ask`，命中 `hard.owner.irreversible-external` 或网络相关规则。owner 的高权限不会绕过网络写入、提权、安装和不可逆操作的确认。

## 验证路径保护和隐私边界

### 受保护文件

受保护路径默认包括：

```text
.env*
*.pem
*.key
.git/hooks/**
.git/config
```

提交：

```bash
cat .env
```

即使文件不存在，也应该先进入 `ask`。审批卡片的 `matchedRules` 应包含 `hard.protected`。拒绝后不会执行命令。

### 项目元数据

在默认工作区中提交：

```bash
cat ../../registry.json
```

预期结果是 `deny`，命中 `hard.metadata`。项目元数据包含成员和 Guard 审计文件，终端与 Agent 都不能通过工作区路径读取这些内容。

### 工作区外路径

提交：

```bash
cat /etc/hosts
```

预期结果至少是 `ask`，命中 `hard.outside`。拒绝请求，确认命令没有输出系统文件内容。

### 动态 Shell 语法

提交：

```bash
printf 'hello\n' | cat
```

预期结果至少是 `ask`，命中 `hard.dynamic`。这项验证用于确认管道、变量展开、命令替换和解释器内联代码会提高风险等级。

### 终端环境变量过滤

终端会过滤包含 `KEY`、`TOKEN`、`SECRET`、`PASSWORD`、`COOKIE` 的环境变量。提交：

```bash
printenv DEEPSEEK_API_KEY
```

预期结果为空。可以用下面的命令确认普通变量仍然存在：

```bash
printenv PATH
```

预期结果包含终端运行所需的 PATH。不要把 API Key 写入工作区文件，也不要把密钥作为命令参数提交。

当前隐私边界还包括一项 Agent 运行时行为：OpenCode 进程需要使用 `DEEPSEEK_API_KEY` 访问 Provider，因此该进程会继承模型密钥环境变量。Guard 会控制 Agent 的工具请求和审批流程，已批准的 Agent `bash` 仍可能读取自己的进程环境。验证隐私性时不要让 Agent 执行 `env`、`printenv` 或读取密钥文件，并把 Agent 输出视为可能包含敏感信息的内容。

## 验证审批流程

### 终端审批

保持 Alice 在线，把 Bob 设置为 `student`。Bob 提交：

```bash
rm guard-role-check.txt
```

验证顺序：

1. Bob 的终端状态显示 `Waiting for approval`。
2. Alice 的 `People` 区域出现 `terminal approval` 卡片。
3. 卡片显示命令和命中的规则，例如 `role.student.delete`。
4. 点击 `Reject`，Bob 收到拒绝结果，文件保持原样。
5. 再次提交同一命令，点击 `Approve`，命令执行一次。
6. 审批卡片从两个窗口消失，`Activity` 出现审批结果。

批准只对当前请求有效。重复提交同一命令会产生新的审批卡片。

### Agent 审批

Agent 的审批卡片 `source` 为 `agent`。审批数据中的 `request.agentRunId` 会关联对应的 Agent 运行记录，详细关联信息可以在 `guard-audit.jsonl` 和 `trace.jsonl` 中查看。点击 `Approve` 后，OpenCode 只收到当前请求的一次允许；后续同类请求重新进入 Guard。

### 审批超时

停止服务端，在 `.env` 中设置：

```dotenv
SIMPLERCP_GUARD_APPROVAL_TIMEOUT_MS=5000
```

重新启动服务端。再次创建一个 `ask` 请求，五秒内不点击审批按钮。

预期结果：请求自动拒绝，终端收到拒绝结果，`guard-audit.jsonl` 中有 `result` 为 `rejected` 的记录。验证结束后恢复 `120000`，避免后续验证等待时间过短。

## 验证快照和恢复

### 创建快照

1. 使用 `developer` 或 `student` 成员提交：

   ```bash
   touch guard-restore.txt
   ```

2. 等待命令完成。
3. 在项目元数据目录查看 `snapshots/`。

项目元数据目录通常是：

```text
.simplercp-data/projects/<projectId>/
```

每个快照目录包含 `manifest.json` 和被复制的工作区文件。清单记录 `id`、创建时间、成员、命令、文件路径、SHA-256 和文件大小。

### 恢复文件内容

使用编辑器创建 `guard-restore.txt`，写入 `before` 并保存。再次提交一次会产生 `allow_snapshot` 的命令，例如：

```bash
touch guard-restore.txt
```

然后在编辑器中把内容改为 `after` 并保存。使用下面的 API 查询快照：

```bash
curl \
  -H 'x-simplercp-member: <MEMBER_ID>' \
  http://127.0.0.1:4000/api/projects/<PROJECT_ID>/guard/snapshots
```

从响应中取出刚才命令创建的 `id`，执行恢复：

```bash
curl -X POST \
  -H 'x-simplercp-member: <MEMBER_ID>' \
  http://127.0.0.1:4000/api/projects/<PROJECT_ID>/guard/snapshots/<SNAPSHOT_ID>/restore
```

预期结果：`guard-restore.txt` 内容恢复为 `before`。恢复只覆盖快照中存在的文件，快照创建后新增的文件会继续保留。发起成员可以恢复自己的快照，owner 可以恢复项目中的快照，其他成员会收到权限错误。

## 验证 Agent 权限继承

### 前置条件

确认 `.env` 已填写 `DEEPSEEK_API_KEY`，服务端可以连接 `DEEPSEEK_BASE_URL`。打开项目右侧的 `Agent` 页签，创建一个 session。

### 读取请求

以 `student` 成员创建任务，提示 Agent：

```text
Read package.json and report the available scripts. Do not change any file.
```

预期结果：读取工作区文件，任务可以完成，Guard 审计中的 action 为 `allow`，没有审批卡片。

### 写入请求

先由当前成员在工作区创建一个临时文件，再提交 Agent 任务：

```text
Delete guard-agent-check.txt and report whether it was removed.
```

预期结果：

- `student` 或 `collaborator` 发起时，请求进入审批或产生快照，具体动作由请求能力和路径决定。
- `observer` 发起时，写入或删除请求被拒绝。
- 将成员 Role 改为 `teacher` 后重新创建任务，Agent 使用新的 owner 档位重新判定。

同一个 Agent session 在不同请求中读取发起成员当前 Role。修改成员 Role 后重新发送任务，检查 `guard-audit.jsonl` 中的 `memberId`、`action` 和 `matchedRules`。

### 发起成员离线

以 `student` 成员提交一个会触发写入或删除的 Agent 任务，在审批卡片出现后关闭该成员的浏览器窗口。预期结果：成员变为离线，非读取请求被拒绝，审计命中 `agent.initiator-offline`。重新打开成员窗口后，创建新的任务进行验证。

### Agent 的 OpenCode 权限回复

在 `trace.jsonl` 中检查 OpenCode 事件和任务结果。Guard 允许请求时，服务端向 OpenCode 回复 `once`；Guard 拒绝或超时时回复 `reject`。代码中不会发出 `always`，因此一次批准不会变成会话级永久允许。

## 验证 LLM 自动研判

### 策略模式

项目策略保存在：

```text
.simplercp-data/projects/<projectId>/guard-policy.json
```

默认策略类似：

```json
{
  "protectedPaths": [".env*", "*.pem", "*.key", ".git/hooks/**", ".git/config"],
  "llmMode": "suggest"
}
```

修改策略需要在线 owner。先从浏览器加入项目的成员文件或项目元数据中取得 `<OWNER_MEMBER_ID>`，再执行：

项目 ID 可以通过下面的接口查看：

```bash
curl http://127.0.0.1:4000/api/projects
```

成员 ID 可以从 `.simplercp-data/projects/<PROJECT_ID>/members.json` 查看，或者从浏览器对 `/api/projects/<PROJECT_ID>/me` 的响应中查看。

```bash
curl -X PUT \
  -H 'Content-Type: application/json' \
  -H 'x-simplercp-member: <OWNER_MEMBER_ID>' \
  -d '{"llmMode":"off"}' \
  http://127.0.0.1:4000/api/projects/<PROJECT_ID>/guard/settings
```

读取当前策略：

```bash
curl \
  -H 'x-simplercp-member: <OWNER_MEMBER_ID>' \
  http://127.0.0.1:4000/api/projects/<PROJECT_ID>/guard/settings
```

### `off` 模式

将 `llmMode` 设为 `off`，让 student 提交删除命令：

```bash
rm guard-llm-check.txt
```

预期结果：请求按角色和硬规则进入 `ask`，审批卡片的 `decision.llm` 不存在，审计记录不包含模型结论。

### `suggest` 模式

将 `llmMode` 设为 `suggest`，重复一个 `ask` 请求。在审批卡片出现后，用 API 查看当前审批：

```bash
curl \
  -H 'x-simplercp-member: <OWNER_MEMBER_ID>' \
  http://127.0.0.1:4000/api/projects/<PROJECT_ID>/guard/approvals
```

预期结果：

- `decision.action` 仍然是 `ask`。
- `decision.llm` 包含 `mode`、`risk`、`confidence`、`reason` 和 `applied`。
- `applied` 为 `false`。
- 审批卡片仍然需要人工点击 `Approve` 或 `Reject`。

### `auto` 模式

将 `llmMode` 设为 `auto`，提交一个由角色矩阵产生、可逆、位于工作区内、没有动态 Shell 语法的 `ask` 请求。例如 student 使用普通网络读取请求：

```bash
curl https://example.com
```

自动放行必须同时满足以下条件：

- `decision.autoEligible` 为 `true`。
- 模型 `risk` 为 `low` 时自动批准，模型 `risk` 为 `high` 时自动拒绝。
- 人员终端的 `confidence >= 0.85`。
- Agent 的 `confidence >= 0.95`。
- 请求没有不可逆操作、工作区外路径、受保护路径、动态 Shell、硬规则或 Agent 上限规则。

满足条件时，`decision.llm.applied` 为 `true`。原始动作是 `ask` 时，低风险结果会变为 `allow` 或 `allow_snapshot`，高风险结果会变为 `deny`。中风险结果、置信度不足或请求不满足 `autoEligible` 条件时，最终动作继续是 `ask`。

下面是服务端识别的模型返回结构：

```json
{
  "risk": "low",
  "confidence": 0.93,
  "reason": "The command performs a read-only request and does not modify the workspace."
}
```

服务端把结构加入决定结果后，审批或审计中类似下面：

```json
{
  "mode": "auto",
  "risk": "low",
  "confidence": 0.93,
  "reason": "The command performs a read-only request and does not modify the workspace.",
  "applied": true
}
```

以下结果会继续人工审批：

```json
{
  "risk": "low",
  "confidence": 0.90,
  "reason": "The request is readable, but the confidence is below the Agent threshold.",
  "applied": false
}
```

```json
{
  "risk": "high",
  "confidence": 0.99,
  "reason": "The command can change remote state or remove data.",
  "applied": true
}
```

模型请求失败、超时或 JSON 结构不符合要求时，服务端把模型结果视为缺失，原始 `ask` 动作继续等待审批。此时 `decision.llm` 不存在，审计文件中也没有模型结论。

### LLM 不能自动放行的请求

逐项提交下面的命令，并在 `auto` 模式检查最终动作：

```bash
cat ../../registry.json
```

```bash
cat .env
```

```bash
git reset --hard HEAD
```

```bash
printf 'x\n' | cat
```

预期结果分别涉及 `metadata`、`protected`、不可逆历史修改和动态 Shell。即使模型返回 `low` 与高置信度，最终动作也不能自动变为 `allow`。

## 检查审计和活动文件

项目的元数据路径可以从启动日志的 `Project data` 找到。默认 Demo 项目的文件位于：

```text
.simplercp-data/projects/demo/
```

常用检查命令：

```bash
find .simplercp-data/projects/<PROJECT_ID> -maxdepth 3 -type f | sort
```

### `guard-audit.jsonl`

每行是一个 JSON 对象，包含：

- `timestamp`、`projectId`、`memberId`、`source`。
- `agentRunId`、`command`、`paths`。
- `action`、`matchedRules`、`approver`、`result`。
- `durationMicros`。
- LLM 研判时的 `model`，其中包含 `mode`、`risk`、`confidence`、`reason` 和 `applied`。

查看最近记录：

```bash
tail -n 10 .simplercp-data/projects/<PROJECT_ID>/guard-audit.jsonl
```

确认以下情况：

- `allow`、`allow_snapshot`、`ask` 和 `deny` 都有决策记录。
- 审批完成后新增一条带 `result` 的记录。
- Agent 请求包含 `source: "agent"` 和 `agentRunId`。
- API Key 等敏感值经过脱敏，不出现在文件中。

### `guard-policy.json`

该文件保存 `protectedPaths` 和 `llmMode`。修改 API 策略后重新读取文件，确认 JSON 与 API 响应一致。

### `activity.json`

该文件保存文件操作、文件编辑、终端输入次数、审批结果、交互控制和 Agent 状态摘要。`allow` 决策只写审计文件，`allow_snapshot`、`ask`、`deny` 和审批结果同时出现在 Activity。

### 快照和 Agent trace

```text
.simplercp-data/projects/<PROJECT_ID>/snapshots/<SNAPSHOT_ID>/manifest.json
.simplercp-data/projects/<PROJECT_ID>/agent-runs/<RUN_ID>/trace.jsonl
```

快照清单用于确认创建时间、成员和文件哈希。Agent `trace.jsonl` 用于确认 OpenCode 事件、权限请求、文件变化、并发修改提示和最终输出。

## 验证记录表

把每项验证的实际结果填入下表，方便 review：

| 编号 | 验证项 | 操作 | 预期结果 | 实际结果 | 证据位置 |
| --- | --- | --- | --- | --- | --- |
| G-01 | 启动 | `pnpm dev` | 两个服务可访问 |  | 终端输出、`/api/health` |
| G-02 | 多成员共享输出 | 两个窗口提交 `printf` | 两个窗口看到同一输出 |  | 两个窗口、`activity.json` |
| G-03 | 交互控制 | owner 授予 Bob 控制 | Bob 可以运行 Node REPL |  | `Activity`、终端状态 |
| G-04 | 非 owner 控制 | Bob 查看 People | 没有授予控制按钮 |  | People 区域 |
| G-05 | observer | `touch guard-role-check.txt` | `deny` |  | 终端状态、审计 |
| G-06 | student 写入 | `touch guard-role-check.txt` | `allow_snapshot` |  | `snapshots/` |
| G-07 | owner 审批 | student 删除文件 | 审批卡片出现 |  | People 区域、审计 |
| G-08 | 路径保护 | `cat .env` | `ask`，命中 `hard.protected` |  | 审批卡片、审计 |
| G-09 | 元数据保护 | `cat ../../registry.json` | `deny`，命中 `hard.metadata` |  | 终端状态、审计 |
| G-10 | Agent 继承 | student 创建删除任务 | 按 student 规则判定 |  | Agent、审计、trace |
| G-11 | Agent 离线 | 审批等待时关闭发起成员 | `agent.initiator-offline` |  | 审计、run 状态 |
| G-12 | LLM suggest | 设置 `llmMode=suggest` | 返回模型字段，仍需人工审批 |  | approvals API、审计 |
| G-13 | LLM auto | 设置 `llmMode=auto` | 仅满足阈值的请求自动放行 |  | terminal 状态、审计 |
| G-14 | 审批超时 | 设置 5000 毫秒并等待 | 自动拒绝 |  | 审计 `result` |
| G-15 | 快照恢复 | 修改后恢复快照 | 快照文件内容恢复 |  | 文件内容、manifest |

## 失败定位

### 浏览器无法打开

- 确认客户端端口仍是 `5173`，服务端端口仍是 `4000`。
- 检查 `pnpm dev` 的两个进程是否都持续运行。
- 使用 `curl http://127.0.0.1:4000/api/health` 检查服务端。
- 如果修改过端口，设置 `VITE_SIMPLERCP_API_ORIGIN` 和 `VITE_SIMPLERCP_CLIENT_PORT`。

### 终端区域没有显示

检查 `.env` 中的 `SIMPLERCP_TERMINAL_ENABLED=true`，然后重新启动服务端和客户端。设置为 `false` 时，服务端不会创建 PTY，页面也不会显示终端区域。

### 审批卡片没有出现

- 确认服务端运行模式是 `full` 或 `human-only`。
- 确认 owner 浏览器窗口在线。
- 确认当前命令确实会触发 `ask`，例如 student 删除文件或读取受保护路径。
- 检查 `guard-audit.jsonl` 是否已经写入决策记录。

### Agent 没有启动

检查 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`，并确认 `SIMPLERCP_OPENCODE_PORT` 没有被其他进程占用。

### LLM 字段没有出现

确认项目策略的 `llmMode` 为 `suggest` 或 `auto`，服务端进程拥有 `DEEPSEEK_API_KEY`，并且 `DEEPSEEK_BASE_URL/chat/completions` 可以访问。模型只接收 `ask` 请求，`allow` 和 `deny` 请求不会调用模型。

## 自动化检查

完成浏览器手工验证后，可以运行仓库已有检查：

```bash
pnpm --filter @simplercp/server test
pnpm build
pnpm test:demo
```

需要运行 Playwright 浏览器测试时：

```bash
pnpm exec playwright install
pnpm test:e2e
```

终端关闭行为单独验证：

```bash
pnpm test:e2e:terminal-disabled
```

测试结束后检查工作区状态，确认验证产生的数据目录仍然被 Git 忽略：

```bash
git status --short
git diff --check
```
