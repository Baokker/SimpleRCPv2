# ACP Coding Agent 选型调研

状态：待 Review

更新时间：2026-08-09

## 1. 调研结论

SimpleRCPv2 不应该直接把 DeepSeek 的 OpenAI-compatible API 调用写进自己的服务端，然后把它称为 ACP。更合适的职责划分是：

```text
SimpleRCPv2 ACP Client / Harness
  -> 启动一个 ACP Agent 子进程
  -> Agent 自己选择模型 Provider
  -> ACP 传递会话、工具事件、权限请求和文件操作
  -> SimpleRCPv2 将文件写入收集为 Pending Proposal
```

当前推荐的第一条真实 Agent 路线是：

```text
OpenCode ACP
  -> OpenCode 的 DeepSeek Provider
  -> ds/deepseek-v4-flash
```

推荐它的原因不是“DeepSeek 本身实现了 ACP”，而是 OpenCode 原生提供 ACP Server，且本机已经存在 OpenCode Desktop 和 DeepSeek Provider 配置。DeepSeek 只负责模型推理，OpenCode 负责 Coding Agent 的工具循环，SimpleRCPv2 负责协作态、权限和 Proposal Review。

自动化回归仍然使用仓库内的 Fake ACP Agent，不依赖真实模型或 API key。OpenCode + DeepSeek 则必须完成真实验收：在隔离工作副本中修改代码、自动执行测试，并生成包含文件 diff 和测试结果的 Pending Proposal。真实 Agent 不能作为唯一回归基线，但也不能只停留在握手 smoke test。

## 2. ACP 的接入方式

ACP 是 Agent Client Protocol，采用 JSON-RPC over stdio 的 Client/Agent 交互模型。SimpleRCPv2 在这个关系中是 ACP Client，外部 Coding Agent 是 ACP Server：

```text
SimpleRCPv2 Server
  spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] })
  -> initialize
  -> session/new { cwd }
  -> session/prompt { prompt }
  <- session/update
  <- fs/read_text_file / fs/write_text_file
  <- requestPermission
```

第一版需要特别确认一个实现边界：OpenCode 的 ACP 文档同时支持文件工具和 Terminal 工具，但 SimpleRCPv2 不应让外部 Agent 直接绕过 Harness 访问共享磁盘或继承共享 Terminal 权限。这个边界已经通过临时 fixture workspace 验证，真实 OpenCode 的内部工具会直接访问它自己的 `cwd`，因此不能把共享 workspace 直接作为 OpenCode 的工作目录。

## 3. 候选 Agent 比较

| Agent | ACP 方式 | DeepSeek 可用性 | 本地成本 | 文件代理兼容性 | 当前建议 |
|---|---|---|---|---|---|
| OpenCode | 原生 `opencode acp`，stdio | 高：可配置 OpenAI-compatible Provider；本机已有 `ds` 配置 | 低到中，取决于 DeepSeek 用量 | ACP 会话和工具事件可用；文件与终端需隔离工作副本 | **第一选择** |
| OpenHands | 官方提供 ACP 使用方式 | 中：需要确认其当前 Provider/模型配置和工具调用质量 | 中到高，依赖较多 | 高，但运行时更重，先不作为 MVP | 第二阶段评估 |
| Gemini CLI | 官方 ACP 实现 | 低到中：主要面向 Gemini，DeepSeek 不是默认路径 | 中，取决于 Google 账号/API | 中到高，需验证 ACP 文件请求和权限行为 | 后续对比 |
| Qwen Code | 在 ACP Agent 列表中 | 中到高：模型生态更偏 Qwen，也可研究兼容 Provider | 低到中 | 待真实 smoke test | 后续对比 |
| Kimi CLI | 在 ACP Agent 列表中 | 中：主要使用 Moonshot/Kimi Provider | 低到中 | 待真实 smoke test | 后续对比 |
| Goose | 官方支持作为 ACP Client 使用 Agent | 中：Provider 可配置性较好，但需确认 DeepSeek 工具调用 | 低到中 | 中到高，需核对其 ACP Server/Client 角色和文件代理方式 | 后续对比 |
| Codex CLI | 通过 Zed 的 `codex-acp` 适配器 | 低：默认依赖 OpenAI/Codex 体系 | 中到高 | 高，适配器成熟度需单独核验 | 不作为当前路线 |
| Claude Agent | 通过 Zed 的 Claude ACP 适配器 | 低：不符合当前成本和模型偏好 | 高或需订阅/API | 高 | 明确不作为当前路线 |
| Cline / Cursor / Copilot 等 | 官方 ACP 列表中的实现或预览能力 | 取决于各自账号和 Provider | 中到高 | 需要逐个确认许可、CLI 形态和回调能力 | 不进入第一阶段 |

上表中的“可用性”表示架构上的可行性，不等于已经在 SimpleRCPv2 中验证成功。尤其是 DeepSeek 的 tool calling、长上下文、连续文件修改和错误恢复，必须通过真实 smoke test 才能下结论。

## 4. 为什么选 OpenCode + DeepSeek

### 4.1 OpenCode 是 ACP Agent Runtime

OpenCode 官方 ACP 文档提供：

- `opencode acp` 启动 ACP-compatible subprocess；
- `initialize`、`session/new`、`session/prompt` 等会话能力；
- 文本消息、推理消息、工具调用和工具结果的流式更新；
- 文件工具、Terminal、Custom tools、Slash commands、MCP、`AGENTS.md`、Formatter/Linter 和权限系统。

这使 OpenCode 负责“像 Coding Agent 一样工作”，SimpleRCPv2 不必重新实现规划、工具循环和模型上下文编排。

### 4.2 DeepSeek 只作为 Provider

本机 `~/.config/opencode/opencode.json` 中已存在一个自定义 Provider：

```json
{
  "provider": {
    "ds": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.deepseek.com/v1"
      },
      "models": {
        "deepseek-v4-flash": {},
        "deepseek-v4-pro": {}
      }
    }
  }
}
```

文档中只记录配置结构，不记录 API key。密钥应由 OpenCode 自己的认证存储或运行环境提供，不能进入仓库、浏览器、Chat、Activity 或 Proposal。

项目级 `opencode.json` 可以指定模型：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "ds/deepseek-v4-flash"
}
```

是否采用项目级配置，要等用户确认是否允许在被协作的 workspace 中新增 OpenCode 配置文件。另一种不修改项目的方式，是在 ACP `session/new` 后使用 OpenCode 暴露的 session model/config option 选择模型；Harness 应把模型选择设计成 Agent Profile 配置，而不是写死。

## 5. 本机 OpenCode 的实际状态

已核验：

- CLI 路径：`/Users/baokker/.opencode/bin/opencode`；
- CLI 版本：`1.18.15`；
- `opencode acp --help` 可正常执行；
- `~/.config/opencode/opencode.json` 已配置 `ds` Provider 和 DeepSeek 模型名；
- 新 ACP session 默认模型是 `opencode/big-pickle`，不是 DeepSeek；
- 通过 `session/set_config_option` 将 `model` 设置为 `ds/deepseek-v4-flash` 成功。

当前 shell 的 PATH 可能尚未刷新。新终端可以直接使用 `opencode`；服务端配置应允许用户使用绝对路径，或者让用户重启终端后使用 PATH 中的 `opencode`。该路径是 OpenCode CLI 的安装位置，不是 SimpleRCPv2 的固定项目路径。

## 6. 已完成的本机 ACP Smoke Test

使用临时 fixture workspace，未连接用户的真实项目，完成了以下验证：

1. `initialize` 成功，协议版本为 ACP v1，Agent 信息为 OpenCode 1.18.15。
2. `session/new` 成功，并返回可选模型列表。
3. 新会话默认模型为 `opencode/big-pickle`；显式选择后模型为 `ds/deepseek-v4-flash`。
4. 只读任务能完成 `glob -> read -> agent_message` 工具链，fixture 文件保持不变。
5. 写入任务能完成 `glob -> read -> edit` 工具链，fixture 文件被实际修改。
6. 写入过程中没有收到 `fs/read_text_file`、`fs/write_text_file` 或 `session/request_permission` 请求。

因此，OpenCode 的实际文件工具会直接读写它自己的 `cwd`，不能假设 ACP Client 已经接管所有文件 I/O。若把真实共享 workspace 直接作为 `cwd`，OpenCode 可能在 Proposal Review 前修改磁盘，并被 workspace watcher 传播给协作者。

真实 Agent 的第一版必须采用以下隔离策略：

```text
Yjs 当前共享快照
  -> 创建隔离 Agent Workspace
  -> OpenCode 在隔离目录中运行
  -> Harness 收集 session/update 和副本文件变化
  -> Base Snapshot 与副本做 diff
  -> 生成 Pending Proposal
  -> Review 后才写回 Yjs 和磁盘
```

ACP 的 `fs/read_text_file` / `fs/write_text_file` 仍然保留为 Fake Agent 或其他确实使用 ACP 文件回调的 Agent 路径，但不能作为 OpenCode 第一版的唯一保护边界。

## 7. 实施建议

当前不同时接入多个真实 Agent，开发顺序建议固定为：

```text
Fake ACP Agent
  -> ACP transport contract test
  -> Yjs read adapter + 隔离 Workspace + diff collector
  -> Chat @OpenCode 触发
  -> Proposal Review / Apply / Reject
  -> OpenCode ACP + DeepSeek 真实开发与自动测试验收
  -> 再评估 OpenHands / Qwen Code / Kimi CLI
```

Fake Agent 的存在不是临时替代品，而是保证协同和 Review 语义可回归的测试实现。OpenCode 的模型质量和运行时行为属于外部依赖，不能让它决定核心测试是否稳定。

## 8. 主要来源

- [Agent Client Protocol: Agents](https://agentclientprotocol.com/get-started/agents)：ACP 官方列出的 Agent 和适配器。
- [Agent Client Protocol: Specification](https://agentclientprotocol.com/protocol/overview)：协议角色、会话和 JSON-RPC 通信模型。
- [OpenCode: ACP Support](https://opencode.ai/docs/acp/)：`opencode acp`、支持的工具和 ACP 运行能力。
- [OpenCode: Providers](https://opencode.ai/docs/providers/)：Provider、API key、OpenAI-compatible endpoint 和 DeepSeek 配置。
- [OpenCode: Config](https://opencode.ai/docs/config/)：全局配置、项目配置、`model` 和 Provider 选择。
- [OpenCode 1.18.15 ACP source: `acp.ts`](https://github.com/anomalyco/opencode/blob/v1.18.15/packages/opencode/src/cli/cmd/acp.ts)：ACP 命令的 stdio 入口。
- [OpenCode 1.18.15 ACP source: `service.ts`](https://github.com/anomalyco/opencode/blob/v1.18.15/packages/opencode/src/acp/service.ts)：initialize、session 和模型配置能力。
- [OpenCode 1.18.15 ACP source: `event.ts`](https://github.com/anomalyco/opencode/blob/v1.18.15/packages/opencode/src/acp/event.ts)：文本、推理、工具和权限事件转发。
- [OpenCode 1.18.15 `read` tool](https://github.com/anomalyco/opencode/blob/v1.18.15/packages/core/src/tool/read.ts)：OpenCode 内部文件读取路径。
- [OpenCode 1.18.15 `edit` tool](https://github.com/anomalyco/opencode/blob/v1.18.15/packages/core/src/tool/edit.ts)：OpenCode 内部文件编辑路径。
- [OpenCode 1.18.15 `bash` tool](https://github.com/anomalyco/opencode/blob/v1.18.15/packages/core/src/tool/bash.ts)：OpenCode 内部本地命令执行路径。
- [OpenCode installer](https://opencode.ai/install)：CLI 默认安装路径和安装方式。

## 9. Review Gate

请先确认以下决定，再开始写 Agent 功能代码：

1. 第一条真实 Agent 路线采用 OpenCode ACP，模型使用本机已配置的 `ds/deepseek-v4-flash`。
2. Fake ACP Agent 负责确定性自动化回归；真实 OpenCode + DeepSeek 必须完成改代码、运行测试和生成 Proposal 的端到端验收。
3. SimpleRCPv2 作为 ACP Client/Harness，不直接调用 DeepSeek API。
4. OpenCode 第一版采用隔离工作副本；Harness 收集副本 diff，Proposal Review 前不改动 Yjs 和共享 workspace。
5. OpenCode 可以在隔离工作副本中执行测试命令，但不能继承或操作网页共享 Terminal；命令、输出、退出码和耗时必须进入 Agent Run 记录。
6. 本机 CLI 和临时 fixture smoke test 已完成；方案通过后从 Fake ACP Agent 和隔离 Workspace Phase 开始实现。

真实 Agent 验收不能只读取 Agent 的最终文本。Harness 必须在隔离副本中执行预先配置的验证命令，记录命令、退出码、耗时和截断后的输出，并将这份证据与 Proposal 一起展示。这样“Agent 修改了代码”和“修改后的代码确实通过测试”是两个可独立核验的事实。
