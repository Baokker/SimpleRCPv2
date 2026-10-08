# Knowledge MCP

## 服务与认证

`KNOWLEDGE=full` 注册 `/mcp/knowledge`，使用 `@modelcontextprotocol/sdk` 的无会话 Streamable HTTP transport，返回 JSON。HTTP 服务必须绑定 `127.0.0.1`，端点检查连接地址与随机 Bearer 令牌。其他知识模式没有 MCP 路由和 OpenCode MCP 配置。

服务启动时生成令牌，OpenCode 的 remote 配置通过 `headers.Authorization` 发送，认证不能关闭。错误令牌返回 HTTP 401；未登记的工作区返回 MCP 工具错误。工作区参数必须为登记项目的绝对路径。

## 工具

| 工具 | 参数 | 结果 |
| --- | --- | --- |
| `knowledge_search` | `workspace`, `query`, `files?`, `types?`, `limit?` | id、类型、标题、摘要、当前锚点行号和分数。limit 默认 5，最大 10。 |
| `knowledge_get` | `workspace`, `id` | 完整团队卡片、当前锚点、作者、确认成员与可见团队关系，矛盾关系附提示。 |
| `knowledge_propose` | `workspace`, `title`, `summary`, `content`, `type`, `files?` | `{ suggestionId, humanConfirmationRequired: true }`。 |

search/get 只读取 `team` 且 `reviewed` 的卡片。search 使用 `searchKnowledgeCards` 和 Provider 的排序函数，`files` 作为活动文件，遵守 `lexicalScoring`、`ranking` 和 `useActiveFiles` 配置。

`toolEnabled` 默认 true，关闭时三个工具返回空结果并记录调用。`proposeEnabled` 默认 false；开启后 propose 要求项目中存在唯一运行中的任务。建议使用 `origin: agent-self`、`triggerType: agent.proposed`，参与成员为任务发起人。接受生成个人草稿，作者标记 Agent run，确认必须由项目成员完成。

主动提议以 run id、类型、标题、摘要、正文与适用文件集合的 SHA-256 标识来源。同一任务中内容不同的提议分别进入 Inbox；相同内容的重复调用返回同一建议 id。自动捕获的纠正建议使用独立的来源标识。卡片的 provenance 保留 run id 与建议 id。

## 记录与运行关联

每次已定位项目的工具调用写入 `<metadata>/knowledge/tool-calls.jsonl`，包括 tool、query、files、resultIds、开始时间、latencyMs 与错误摘要。search/get 返回的卡片增加 `usage.toolHitCount`，保留原 `updatedAt` 和演化记录。

按照调用开始时间查询项目的运行时间区间：一个任务时记录 runId；多个任务时记录 `runId: ambiguous` 和 candidates，并把同一记录写入候选任务的 `knowledge_tool_call` trace；没有任务时只写项目日志。未知 workspace 无法定位日志目录，返回错误。实验可以通过 OpenCode 工具事件继续确认 ambiguous 记录。

其他成员任务首次通过工具获取卡片时，保存 `firstToolHitByOtherAt`，写 `knowledge_reuse_tool_hit` 活动事件，复用接口与注入、查看时间一起返回。

## OpenCode 配置与权限

OpenCode 1.18.31 的 remote MCP 实现按顺序尝试 Streamable HTTP 和 SSE。本项目使用 Streamable HTTP，并设置 `oauth: false`，由随机令牌认证。OpenCode 工具名称包含服务器前缀：`knowledge_knowledge_search`、`knowledge_knowledge_get`、`knowledge_knowledge_propose`；这三项权限均为 `allow`。propose 仍受项目开关与人工确认控制。

模型提示提供工作区路径与查询提示；关闭卡片注入时工具提示继续存在。完整提示段受 `maxTotalChars` 限制，字符预算不足以容纳完整工具说明时省略该说明。点一集成时需同时保留 `openCodeConfig` 的 provider、mcp 与 permission 字段。

## 静态文件

导出只包括 reviewed/team 卡片，按决策、约束、风险、上下文、负向经验、教程分组；每条包含标题、摘要、正文和适用范围。正文使用 Markdown 引用块保留章节层级，证据章节在导出时清理。确定性导入保留一条卡片对应一条草稿、类型、标题、摘要与适用范围。工作区没有 AGENTS.md 时创建该文件；已经存在时写 AGENTS.knowledge.md。OpenCode 默认读取 AGENTS.md；AGENTS.knowledge.md 需要通过 `instructions: ["AGENTS.knowledge.md"]` 明确配置，或由成员合并内容。全局 OpenCode instructions 会影响多个工作区，实验使用时应记录启用条件。

## 限制

令牌会出现在 OpenCode 进程的配置环境中。一个进程为多个工作区提供工具，因此工具依靠 workspace 参数定位项目，无法凭令牌区分各个 run。MCP 只提供团队知识；propose 在运行关联不唯一时返回错误。

真实验证记录见 `evidence/stage-6/mcp-smoke.json`。显式查询任务调用 search/get/propose；未在任务文本中要求查询的任务调用 search。该观察来自两个任务。
