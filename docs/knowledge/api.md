# 知识接口

知识接口位于 `/api/projects/:projectId/knowledge/`。请求需要携带 `X-SimpleRCP-Member`，成员必须属于目标项目。服务端开关为 `KNOWLEDGE=off` 时，这组接口返回 `404`。

## 卡片接口

| 方法 | 路径 | 返回内容 |
| --- | --- | --- |
| `GET` | `/cards?file=&type=&status=&scope=` | `{ cards, resolutions }`。`file` 存在时只返回锚定该文件的卡片，并附带解析结果。 |
| `GET` | `/cards/:id` | `{ card }`。个人卡片与 `proposedTeam` 卡片只对属主可见。 |
| `POST` | `/cards` | 创建手动卡片。字段包括 `type`、`title`、`summary`、`content`、`tags`、`scope`，锚点使用 `{ file, selection }`。手动卡片直接进入 `reviewed`。 |
| `PATCH` | `/cards/:id` | 修改卡片字段与锚点。属主或确认人可以修改。草稿可带 `authorMemberId`、`authorName`，修改作者；候选锚点可使用 `{ file, startLine, endLine }`。 |
| `POST` | `/cards/:id/confirm` | 确认草稿。body 可带 `edited` 布尔值及非负的 `durationMs`。 |
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

## 活动日志

卡片创建、编辑、确认、归档分别写入 `knowledge_card_created`、`knowledge_card_updated`、`knowledge_card_confirmed`、`knowledge_card_archived`。日志顶层保存项目房间、操作者与时间，payload 只保存 `cardId`。

捕获增加 `knowledge_suggestion_created`、`knowledge_suggestion_resolved`、`knowledge_notification`、`knowledge_warning_read` 与 `mirror_resync`。确认另外写入 `knowledge_review_completed`，保存 `cardId`、`editedBeforeConfirm`、`durationMs`。模型统计独立写入 `knowledge/llm-calls.jsonl`，包含模型、耗时、累计 token、完成标志、兜底标志、尝试次数与提示词哈希。活动日志和模型统计不保存卡片正文或完整提示词。
