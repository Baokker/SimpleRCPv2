# 阶段五 Agent 协作捕获

阶段五把 Agent 生命周期和工具调用转换为 capture schema 1 事件。新增事件包括：

- `agentRun`：`runId`、成员、会话、提示词、来源、状态、打断关系、文件修改和 `agentRanges`。`agentRanges` 记录运行结束时从工作区快照差异得到的新增文本区间，事件回放时由引擎重新登记归属。
- `agentTool`：`runId`、工具名称、命令、成功状态、退出码和截断后的错误摘要。

服务端在 Agent run 开始、完成、失败、取消或打断时写入事件。运行时 trace 的工具部分由 `message.part.updated` 的 `part.state` 读取：成功状态为 `completed`，失败状态为 `error`，命令来自 `state.input.command`，退出码优先读取 `state.metadata.exitCode`。所有 trace 和证据经过已有的敏感信息清理。

捕获引擎新增五类触发：

| 触发 | 判定 | 冷却或时间范围 |
| --- | --- | --- |
| `agent.interrupted` | 团队 Agent 被打断，或个人 run 被取消后收到成员新任务 | 3 分钟打断窗口 |
| `agent.revised` | 成员在 Agent 区间登记后改写达到区间 30% | 15 分钟，按文件和 run 冷却 |
| `agent.corrected` | 同一会话的后续提示词命中中英文纠正词，并引用上一 run | 10 分钟 |
| `agent.retried` | 失败或取消后，相似提示词再次成功运行 | 30 分钟，相似度默认 0.35 |
| `agent.toolRecovered` | bash 工具失败，文件发生修改，随后同一可执行文件成功 | 网络错误关键词排除 |

Agent 文件归属在 run 结束后完成。服务端比较 run 前后的工作区快照，用文本 diff 提取新增区间，并以 `agent:<runId>` 和 `ownerId` 登记到 `AuthorshipIndex`。运行期间的文件系统回灌继续使用 `filesystem`，这样不会提前触发成员之间的覆写判断。成员改写 Agent 区间时，引擎通过 `onAgentRevised` 回调生成 `human-agent` 建议。建议证据包含 Agent 原任务、运行产生的文件差异、成员改写差异、聊天消息和最近光标；成员把文件完整恢复到运行前内容时也会生成同类建议。

`agent.interrupted`、`agent.revised`、`agent.corrected` 的 AI 草稿默认使用服务端 `extractAgentRecapDraft`。项目设置为 `recapMode: "agent-self"` 时，服务端向已结束 run 的同一 OpenCode session 追加一次复盘请求，只接受符合 schema 且引用证据的 JSON；输出无效时记录失败并返回错误，不调用服务端复盘。服务端复盘失败时最多尝试三次，随后生成 `rule` 为空且带 `fallback: true` 的个人草稿，确认前必须补充规则。引用支持 `evidence.a[0].b`、`evidence.a.0.b` 以及省略 `evidence.` 的写法，单个无效引用会被删除，全部无效时才判定输出失败。`agent.retried` 与 `agent.toolRecovered` 使用普通 `extractKnowledgeCardDraft`。

Agent 建议默认创建为 `personal` 草稿，确认人必须是成员。个人卡片可以请求 `proposedTeam`，第二名成员确认后变为 `team`。团队卡片可以通过关系接口建立 `contradicts`、`supersedes`、`duplicates` 或 `refines` 关系；`supersedes` 会把目标卡片标记为 `superseded`。相同 run、聊天消息或建议来源的建议会合并，注入时同一来源只保留分数最高的卡片。

捕获事件文件仍位于 `<metadata>/knowledge/events.jsonl`，可以直接交给 `replayEvents` 回放。回放使用相同的引擎、配置和虚拟时钟，因此 Agent 触发与线上处理共享判定代码。工具恢复证据保留成功工具的 `traceSeq` 和修改文件列表；事件与证据写入前经过平台敏感信息清理，错误摘要最多保留 2000 个字符。服务端知识模型由 `KNOWLEDGE_LLM_PROVIDER` 选择，默认在存在 `MINIMAX_API_KEY` 时使用 MiniMax，当前兼容地址为 `https://api.minimaxi.com/v1`，默认模型为 `MiniMax-M2`。模型调用记录包含 `provider`、`model`、耗时、用量、完成状态、兜底标记、尝试次数和提示词哈希。MiniMax 返回的 `<think>...</think>` 会在 JSON 解析前清理。

`correctionClassifier: "rules+llm"` 与 `contradictionJudge: "llm"` 当前尚未实现，当前配置不提供这两个取值；后续阶段可以增加模型判定。

复盘证据保留纠正文件的完整 `beforeText` 与 `afterText`，录制重启后恢复这些版本。代码经 TypeScript AST 提取标识符，相对 import 使用 TypeScript 模块解析，并结合项目源文件确定 `Type.method` 或 `Type.field`。提示词列出候选和类型归属，要求规则写明被纠正的具体代码对象。证据 JSON 完整传入模型。

文件名等复杂证据键使用带引号的路径，例如 `evidence.symbolSources["src/storage/inventory-store.ts"]`。路径生成和解析支持文件名中的点号、斜线和引号；解析使用 Lodash `toPath`。K2 使用服务端返回的完整证据评价原始引用，全部原始引用都需要能够读取。

`checkSuggestion` 在匹配 `fileGlob` 的文件全文上验证：至少一个 Agent 版本违反检查，所有纠正版本通过检查，才能保留。正则语法无效、没有完整版本或不能区分两个版本时移除检查，在草稿注明“自动检查未通过验证，已移除”。`llm-calls.jsonl.checkValidation` 保存 `offered`、`retained`、文件与原因，实验可以计算检查保留率。

K4 使用独立实验接口 `POST /api/projects/:projectId/experiments/recap-from-episode`，按已经执行的纠正创建建议并进入同一复盘与人工确认流程。输入包含 `runId`、可选 `correctionRunId`、`correctionAction`、`correctionText` 和完整 `correctionFiles`。接口核验原 run 已结束、纠正 run 的发起人和文件版本，返回 `captureBypassed: true` 与 `naturallyTriggered`，重复提交保留该观察值。K1 使用产品默认纠正词表，遗漏正常计入召回率。

同源建议统一保留原建议 id、阅读状态与成员意见，并写入实验纠正类型及证据。`naturallyTriggered` 只表示该纠正由产品的纠正触发器识别；已有重试或工具恢复建议单独保存在 `naturalEvidence` 中。新增参与成员收到建议通知，重复提交保持同一记录。
