# 阶段五知识治理

知识卡片的作用域为 `personal`、`proposedTeam` 和 `team`。个人卡片只对属主可见。属主申请升级后，卡片仍按属主权限生效；另一名成员确认后写入 `scopeChanged` 演化记录并变为团队卡片。项目配置 `requireSecondConfirmForTeam` 默认开启，关闭时属主可以完成确认。Agent 不能调用确认接口。

跨属主 Agent 纠正建议把改写者和 Agent run 属主放入 `actors.memberIds`，两人都会收到 Inbox 通知。参与成员可以提交异议，建议进入 `disputed` 状态并保存理由。确认界面应同时展示原始证据和异议内容，团队升级由人选择。

关系候选由 `GET /knowledge/cards/:id/relations/candidates` 从最多 5 张相似的 reviewed 团队卡片中返回，人在面板中选择后调用 `POST /knowledge/cards/:id/relations`。关系类型包括 `contradicts`、`supersedes`、`duplicates` 和 `refines`。系统保存关系供检索和注入使用，`supersedes` 关系会把目标卡片状态设为 `superseded`。互相矛盾的卡片同时命中注入时会加上未裁决标记。

知识面板的“待确认”视图读取 `GET /knowledge/cards/pending-team`，属主可以申请团队确认，其他成员可以提交第二次确认。卡片展开后可以选择团队卡片建立关系，Inbox 中的参与成员可以提交异议理由。

普通编辑和草稿确认接口不能把个人卡片直接改为团队卡片。必须先调用 `scope/request-team`，再由符合配置要求的成员调用 `scope/confirm-team`。Agent 身份不能确认草稿或团队作用域。

同源去重使用 run id、聊天消息 id 和建议 id。生成建议前发现相同来源的未解决建议时复用原建议；Agent 注入时同一来源的多张卡片只保留一张。

`refreshExpired` 根据锚点解析结果把无法定位的 reviewed 卡片转为 `needsReview`。超过配置的复核期限后转为 `orphaned`。重新锚定会写入 `reviewed` 演化记录并恢复可注入状态。

状态变更时服务端通过 `knowledge_anchor_needs_review` 通知属主和确认人，消息不包含卡片正文。

阶段五定义 `KnowledgeEventSink` 接口，支持 `terminal.commandDenied`、`terminal.commandApproved`、`conflict.detected` 和 `conflict.resolved`，事件包含参与者、文件、时间和说明。点一、点二的事件接入留给后续阶段。
