# 阶段五知识治理

知识卡片的作用域为 `personal`、`proposedTeam` 和 `team`。个人卡片只对属主可见。属主申请升级后，卡片仍按属主权限生效；另一名成员确认后写入 `scopeChanged` 演化记录并变为团队卡片。项目配置 `requireSecondConfirmForTeam` 默认开启，关闭时属主可以完成确认。Agent 不能调用确认接口。

跨属主 Agent 纠正建议把改写者和 Agent run 属主放入 `actors.memberIds`，两人都会收到 Inbox 通知。参与成员可以提交异议，建议进入 `disputed` 状态并保存理由。确认界面应同时展示原始证据和异议内容，团队升级由人选择。

关系候选由 `GET /knowledge/cards/:id/relations/candidates` 从最多 5 张相似的 reviewed 团队卡片中返回，人在面板中选择后调用 `POST /knowledge/cards/:id/relations`。关系类型包括 `contradicts`、`supersedes`、`duplicates` 和 `refines`。系统保存关系供检索和注入使用，`supersedes` 关系会把目标卡片状态设为 `superseded`。互相矛盾的卡片同时命中注入时会加上未裁决标记。

知识面板的“待处理”包含知识建议与待确认升级，后者读取 `GET /knowledge/cards/pending-team`。属主可以申请团队确认，其他成员可以提交第二次确认。卡片展开后可以选择团队卡片建立关系，建议中的参与成员可以提交异议理由。

普通编辑和草稿确认接口不能把个人卡片直接改为团队卡片。必须先调用 `scope/request-team`，再由符合配置要求的成员调用 `scope/confirm-team`。Agent 身份不能确认草稿或团队作用域。

同源去重使用 run id、聊天消息 id 和建议 id。生成建议前发现相同来源的未解决建议时复用原建议；Agent 注入时同一来源的多张卡片只保留一张。

适用范围由成员明确选择：“这段代码”保存 block 级锚点及代码快照；“整个文件”保存路径，快照内容为空；“整个项目或一类文件”保存 `appliesTo`。从选区 Pin 进入时默认关联这段代码，从新建按钮进入时默认整个项目。

`refreshExpired` 在 block 级关联无法定位或范围内改动超过 50% 时，将有效卡片转为 `needsReview`。无法定位并超过配置复核期限时转为 `orphaned`。文件级及 `appliesTo` 规则在文件正文变化时保持有效；文件关联路径不存在时通知属主和确认人检查路径。重命名需要成员更新文件关联。

任务结束、检查点和文件回灌完成后执行关联检查。文件 watcher 更新 Yjs 文档后检查当前共享文本，已打开文件中的关联也参与复核判断；任务前预览随卡片状态变化更新。

界面使用“草稿、有效、待复核、已归档”四种状态。`orphaned` 显示为待复核；`superseded` 显示为已归档并说明替代关系。待复核卡片对成员可见，也显示在本文件范围中，Agent 注入会排除它们，任务预览提供复核入口。

待复核详情显示原因和原代码快照。成员可以重新关联新的选区，改为整个文件，确认仍然有效，或填写可选理由归档。确认仍然有效时使用可信的当前匹配；无法匹配时关联整个文件。操作限属主或确认人，每次写入自然语言历史说明，多锚点卡片须全部有效才恢复可注入状态。

知识动态读取已有活动日志和卡片历史，按捕获、确认、应用、演化分类。已处理建议的捕获记录仍然保留，任务注入、工具读取与任务后核对写入现有活动日志；应用条目只显示请求者可见的卡片。

状态变更时服务端通过 `knowledge_anchor_needs_review` 通知属主和确认人，消息不包含卡片正文。

`correctionClassifier` 与 `contradictionJudge` 当前没有配置项，`rules+llm` 和 `llm` 尚未实现。后续阶段可以在保留人工确认的前提下增加这两项可选能力。

阶段五定义 `KnowledgeEventSink` 接口，支持 `terminal.commandDenied`、`terminal.commandApproved`、`conflict.detected` 和 `conflict.resolved`，事件包含参与者、文件、时间和说明。点一、点二的事件接入留给后续阶段。
