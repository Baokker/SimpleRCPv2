# 知识接口

知识接口位于 `/api/projects/:projectId/knowledge/`。请求需要携带 `X-SimpleRCP-Member`，成员必须属于目标项目。服务端开关为 `KNOWLEDGE=off` 时，这组接口返回 `404`。

## 卡片接口

| 方法 | 路径 | 返回内容 |
| --- | --- | --- |
| `GET` | `/cards?file=&type=&status=&scope=` | `{ cards, resolutions }`。`file` 存在时只返回锚定该文件的卡片，并附带解析结果。 |
| `GET` | `/cards/:id` | `{ card }`。个人卡片与 `proposedTeam` 卡片只对属主可见。 |
| `POST` | `/cards` | 创建手动卡片。字段包括 `type`、`title`、`summary`、`content`、`tags`、`scope`，锚点使用 `{ file, selection }`。手动卡片直接进入 `reviewed`。 |
| `PATCH` | `/cards/:id` | 修改卡片字段与锚点。属主或确认人可以修改。草稿可带 `authorMemberId`、`authorName`，修改作者；候选锚点可使用 `{ file, startLine, endLine }`。 |
| `POST` | `/cards/:id/confirm` | 确认可见草稿。body 可带 `edited`、非负的 `durationMs` 与可选 `patch`；修改与确认在一次原子保存中完成。 |
| `POST` | `/cards/:id/archive` | 归档卡片。body 可带 `reason`。 |
| `POST` | `/cards/:id/anchors/:index` | 使用 body 中的 `selection` 重选锚点。 |
| `POST` | `/demo` | 在 Demo 工作区真实文件上生成六张示例卡片。 |

所有写操作把卡片保存到项目元数据目录的 `knowledge/cards/<id>.json`，每次保存使用临时文件后原子替换。捕获建议使用 `knowledge/inbox/<id>.json`。

## Inbox 与聊天选择

| 方法 | 路径 | 输入与结果 |
| --- | --- | --- |
| `GET` | `/inbox?view=mine` | `{ suggestions, warnings }`。建议默认只列出请求者参与的未处理条目；warnings 只属于请求者，并再次检查关联卡片的可见性。 |
| `GET` | `/inbox?view=all` | 所有成员可以读取项目的未处理建议；warnings 仍只返回请求者自己的条目。 |
| `GET` | `/inbox/:id` | `{ suggestion }`，包括已处理的建议，供重新打开草稿时读取证据。不存在时返回 `404`。 |
| `POST` | `/inbox/read` | `{ ids: string[] }`，每次最多 100 项。标记当前成员已经阅读，更新其未读数量。 |
| `POST` | `/inbox/warnings/read` | `{ ids: string[] }`，每次最多 100 项。只标记当前成员收到的风险提醒。 |
| `POST` | `/inbox/:id/accept` | `{}`，返回 `{ card, suggestion }`。使用确定性草稿，卡片状态为 `draft`。 |
| `POST` | `/inbox/:id/ai-draft` | `{}`，调用配置的模型，返回 `{ card, suggestion }`。未配置模型凭据时使用确定性草稿。HTTP/网络失败报告错误，建议继续保持未处理。 |
| `POST` | `/inbox/:id/discard` | `{}`，返回 `{ ok: true }`，状态改为 `discarded`。 |
| `POST` | `/inbox/:id/merge` | `{ cardId }`，返回 `{ card, suggestion }`。目标必须是请求者可见的 `reviewed` 卡片，追加 `recurrence` 并增加计数。 |
| `POST` | `/from-chat` | `{ messageIds: string[] }`，最多 100 条成员消息，返回 `{ suggestion }`，使用共现推断生成候选锚点。 |

建议包括 `id`、`triggerType`、`createdAt`、`actors`、`evidence`、`suggestedSummary`、`suggestedAnchors`、`dedupe`、`state`、`seenBy`。候选锚点的行数从一开始，包含 `{ file, startLine, endLine, score, reasons }`。接受后增加 `draftCardId`、`resolvedBy`、`resolvedAt`；AI 操作另外记录模型统计。

同一建议同时执行接受、AI 草稿、丢弃或合并时，处理中请求返回 `409`；已经处理的建议也返回 `409`。项目成员可以通过“全部建议”处理条目。卡片仍按作用域规则读取，编辑权限仍要求属主或确认人。

草稿 `provenance.origin` 为 `human-human`；覆写草稿的作者默认为改写者，聊天草稿的作者默认为发言最多的成员。确认者与作者可以不同，属主是接受建议的成员。候选锚点由确认者选择并生成阶段二的完整锚点。

确认请求的 `patch` 使用普通编辑接口的字段规则，作者必须属于当前项目，显示名称由服务端查询。可见团队草稿可以由其他成员提交修改并确认，属主保持原值，确认者加入 `confirmedBy`。字段校验失败时草稿保持原值；普通 `PATCH` 继续要求属主或既有确认人。实际内容、类型、标签、作用域、锚点或作者变化会记录 `editedBeforeConfirm: true`。

## 视图接口

`GET /guide?file=` 返回 `{ items }`，使用阶段一的 Guide 排序。`GET /timeline?file=` 返回 `{ items }`，使用阶段一的 Timeline 排序。卡片可见性过滤在生成视图前完成。

## 锚点解析结果

`resolutions` 中每一项包含 `cardId`、`anchorIndex`、`range`、`status`、`strategy` 与 `confidence`。`status` 为 `ok`、`moved` 或 `needsReview`。解析只在读取时计算，读取过程不会把卡片状态写成 `needsReview`。

## WebSocket

协同 `/ws` 连接收到知识变化时会收到：

```json
{
  "type": "knowledge_changed",
  "projectId": "demo",
  "cardId": "card-id",
  "action": "created"
}
```

消息只包含卡片标识和动作，不包含卡片正文。客户端收到消息后按自己的成员身份重新读取列表，个人卡片内容不会通过广播泄露给其他成员。

捕获建议只向 `actors.memberIds` 对应的连接发送：

```json
{ "type": "knowledge_suggestion", "suggestionId": "capture-id", "popup": false }
```

`popup` 表示是否立即显示非模态提示。推迟和达到每小时上限时仍发送刷新通知，Inbox 的未读数量会更新。条目处理或阅读时同样刷新相应成员。提醒刷新可以使用空 `suggestionId`，客户端重新读取自己的 Inbox。

风险提醒只向相关成员发送，不包含卡片正文：

```json
{ "type": "knowledge_risk_warning", "warningId": "warning-id", "cardId": "card-id", "file": "package.json", "popup": true }
```

每条风险提醒保存在活动日志中，由 Inbox 返回 `{ id, cardId, file, createdAt, seen }`。推迟或受到每小时上限限制的提醒仍可在 Inbox 打开。

锚点解析失败或长期未复核时，服务端向卡片属主和确认人发送：

```json
{ "type": "knowledge_anchor_needs_review", "cardId": "card-id", "file": "src/example.ts", "status": "needsReview" }
```

`status` 为 `needsReview` 或 `orphaned`。客户端收到后刷新知识列表并提示重新锚定。

## 活动日志

卡片创建、编辑、确认、归档分别写入 `knowledge_card_created`、`knowledge_card_updated`、`knowledge_card_confirmed`、`knowledge_card_archived`。日志顶层保存项目房间、操作者与时间，payload 只保存 `cardId`。

捕获增加 `knowledge_suggestion_created`、`knowledge_suggestion_resolved`、`knowledge_notification`、`knowledge_warning_read` 与 `mirror_resync`。确认另外写入 `knowledge_review_completed`，保存 `cardId`、`editedBeforeConfirm`、`durationMs`。Agent 复用时间点写入 `knowledge_reuse_confirmed`、`knowledge_reuse_viewed` 与 `knowledge_reuse_injected`。模型统计独立写入 `knowledge/llm-calls.jsonl`，包含模型、耗时、累计 token、完成标志、兜底标志、尝试次数与提示词哈希。活动日志和模型统计不保存卡片正文或完整提示词。
## Agent 知识注入

| 方法 | 路径 | 输入与返回 |
| --- | --- | --- |
| `GET` | `/api/projects/:projectId/knowledge/config` | 返回项目 Agent 知识注入配置。 |
| `PUT` | `/api/projects/:projectId/knowledge/config` | 更新 `injectEnabled`、字符预算、`lexicalScoring`、`ranking`、`statuses`、`fixedCardIds`、任务后核对、在途提醒、团队二次确认、复盘、矛盾判定、锚点孤立期限和 `riskWarning`。`lexicalScoring` 与 `ranking` 独立。`riskWarning` 包含 `files`、`lexicalThreshold`、`vectorThreshold`、`cooldownMs`、`dedupeThreshold`。 |
| `POST` | `/api/projects/:projectId/knowledge/preview` | 输入 `{ prompt, contexts, knowledge? }`，返回活动文件、排除卡片、候选记录和字符数量。 |
| `POST` | `/api/projects/:projectId/knowledge/cards/:id/view` | 记录当前成员首次打开卡片，用于复用延迟。 |
| `GET` | `/api/projects/:projectId/knowledge/metrics/reuse` | 返回知识时刻、确认、首次查看和首次注入时间点。 |

Agent run 创建请求可附带 `knowledge: { excludeCardIds?: string[]; disabled?: boolean }`。个人 Agent 预览使用 `/api/projects/:projectId/agent/knowledge/preview`，返回结构与知识预览接口一致。run trace 中的 `knowledge_injected` 不包含完整卡片正文，`knowledge_post_check` 只包含卡片 id、文件、行段和检查结果。

在途提醒使用 `/ws` 消息：

```json
{ "type": "knowledge_update_available", "runId": "run-id", "cardId": "card-id" }
```

## Agent 协作捕获与治理

Agent 运行期间服务端把生命周期和工具调用写入 `knowledge/events.jsonl`。生命周期事件包含 `agentRun`，工具事件包含 `agentTool`。触发建议继续通过 `/inbox` 读取，`triggerType` 可以是 `agent.interrupted`、`agent.revised`、`agent.corrected`、`agent.retried` 或 `agent.toolRecovered`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/projects/:projectId/knowledge/inbox/:id/dispute` | `{ reason }`，参与成员提交异议，建议进入 `disputed`。 |
| `POST` | `/api/projects/:projectId/knowledge/cards/:id/scope/request-team` | 属主把 personal 卡片变为 proposedTeam。 |
| `POST` | `/api/projects/:projectId/knowledge/cards/:id/scope/confirm-team` | 非属主成员确认 proposedTeam，或在关闭二次确认时由属主确认。 |
| `POST` | `/api/projects/:projectId/knowledge/cards/:id/relations` | `{ kind, cardId }`，建立 `contradicts`、`supersedes`、`duplicates` 或 `refines`。 |
| `GET` | `/api/projects/:projectId/knowledge/cards/:id/relations/candidates` | 返回最多 5 张相似的 reviewed 团队卡片，供人工选择关系。 |
| `GET` | `/api/projects/:projectId/knowledge/cards/pending-team` | 返回当前成员以外属主提交的 proposedTeam 卡片。 |

`KnowledgeEventSink` 为点一、点二预留 `terminal.commandDenied`、`terminal.commandApproved`、`conflict.detected` 和 `conflict.resolved` 事件。事件只携带参与者、文件、时间与说明。
