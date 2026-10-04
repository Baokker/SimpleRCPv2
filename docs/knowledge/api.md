# 阶段二知识接口

知识接口位于 `/api/projects/:projectId/knowledge/`。请求需要携带 `X-SimpleRCP-Member`，成员必须属于目标项目。服务端开关为 `KNOWLEDGE=off` 时，这组接口返回 `404`。

## 卡片接口

| 方法 | 路径 | 返回内容 |
| --- | --- | --- |
| `GET` | `/cards?file=&type=&status=&scope=` | `{ cards, resolutions }`。`file` 存在时只返回锚定该文件的卡片，并附带解析结果。 |
| `GET` | `/cards/:id` | `{ card }`。个人卡片与待确认团队卡片只对属主可见。 |
| `POST` | `/cards` | 创建手动卡片。字段包括 `type`、`title`、`summary`、`content`、`tags`、`scope`，锚点使用 `{ file, selection }`。手动卡片直接进入 `reviewed`。 |
| `PATCH` | `/cards/:id` | 修改卡片字段与锚点。属主或确认人可以修改。 |
| `POST` | `/cards/:id/confirm` | 确认草稿。body 可带 `edited` 布尔值。 |
| `POST` | `/cards/:id/archive` | 归档卡片。body 可带 `reason`。 |
| `POST` | `/cards/:id/anchors/:index` | 使用 body 中的 `selection` 重选锚点。 |
| `POST` | `/demo` | 在 Demo 工作区真实文件上生成六张示例卡片。 |

所有写操作把卡片保存到项目元数据目录的 `knowledge/cards/<id>.json`，每次保存使用临时文件后原子替换。`knowledge/inbox/` 只创建目录，阶段二不生成自动捕获内容。

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

## 活动日志

卡片创建、编辑、确认、归档分别写入 `knowledge_card_created`、`knowledge_card_updated`、`knowledge_card_confirmed`、`knowledge_card_archived`。日志顶层保存项目房间、操作者与时间，payload 只保存 `cardId`。
