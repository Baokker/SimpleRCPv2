# R4 各目标约定的禁止线索

标准：`r4-leak-v2`。禁止线索来自每条约定的参考正确补丁与基线源码。

## R1-T01

- 约定：一次批量库存操作在独立事务状态中完成，任何项失败后原始状态保持不变。
- 参考实现：InventoryService.reserveBatch 使用 this.store.transaction(isolated => rows.map(row => new InventoryService(isolated,this.now).reserve(row)))。
- 禁止点名的标识符/常量：InventoryService.reserveBatch, reserveBatch, InventoryStore.transaction, transaction, isolated, snapshotRevision, Inventory transaction conflict, InventoryService.transfer, transfer
- 禁止透露的取值/单位：revision, transaction 回调, 隔离实例, 事务提交
- 禁止的规则短语：单一事务, 同一事务, 整体回滚, 批量库存, 任一失败, 原始状态, 事务边界, 事务提交, 批量预留
- 禁止的相邻示范：其他库存写入（transfer、receive、reserve、release、consume）放进 store.transaction；用 isolated 实例执行多次库存写入
- 备注：干扰卡片可以讨论库存、预留、仓库、版本、列表、复制等，但规则不能是“多次写入放进同一事务/失败回滚”。

## R1-T02

- 约定：面向客服的审计数据递归处理敏感键名，键名比较忽略大小写，保持普通字段与存储内容。
- 参考实现：AuditService 导出时调用 safeAudit，safeAudit 调用 auditPayload，auditPayload 调用 redactSensitive；redactSensitive 递归遍历数组/对象，isSensitiveKey 用 toLowerCase 比较 SENSITIVE_KEYS。
- 禁止点名的标识符/常量：redactSensitive, isSensitiveKey, SENSITIVE_KEYS, safeAudit, auditPayload, redactText, safeJson, toLowerCase
- 禁止透露的取值/单位：[REDACTED], token, password, apikey, authorization, secret
- 禁止的规则短语：递归, 忽略大小写, 敏感键, 敏感字段, 审计导出, 客服审计, 嵌套, 键名比较, 键名大小写
- 禁止的相邻示范：其他审计/日志出口调用 safeAudit 或 redactSensitive；在相邻的导出操作上递归清理敏感键
- 备注：干扰卡片可以讨论审计查询、过滤、排序、时间、actor、payload 复制等，但不能指向 redactSensitive/isSensitiveKey/SENSITIVE_KEYS 或递归/大小写规则。

## R1-T03

- 约定：通知逻辑标识由订单、通知类型与收件人决定，请求标识变化不产生第二次业务通知。
- 参考实现：schedulePaymentNotice 把 logicalId 设为 JSON.stringify([orderId,'orderPaid',recipient])，NotificationOutbox.enqueue 用 logicalIds 去重。
- 禁止点名的标识符/常量：logicalId, NotificationOutbox.enqueue, enqueue, logicalIds, requestId, recipient, template, orderPaid, schedulePaymentNotice
- 禁止透露的取值/单位：JSON.stringify([orderId,'orderPaid',recipient]), orderPaid, logicalId 映射
- 禁止的规则短语：逻辑标识, 同一订单, 同一收件人, 只产生一次, 去重, 重复通知, 请求标识变化, 逻辑通知
- 禁止的相邻示范：其他通知（退款、邀请）也按订单/类型/收件人生成 logicalId；在相邻通知入口示范请求重试不产生第二条通知
- 备注：干扰卡片可以讨论模板、收件人格式、发送重试、投递状态、outbox 队列等，但不能给出 logicalId 的构成或“同订单/同收件人只一次”的规则。

## R1-T04

- 约定：操作身份来自 serverMember，客户端提供的标识只作为不可信输入。
- 参考实现：appendOrderNote 调用 resolveIdentity({serverMember:context.serverMember,clientMemberId:input.actorId})，事件和返回值使用 identity.id。
- 禁止点名的标识符/常量：resolveIdentity, serverMember, clientMemberId, clientDisplayName, IdentityInput, identity.id
- 禁止透露的取值/单位：context.serverMember, input.actorId, identity.id
- 禁止的规则短语：服务端成员, 客户端标识, 不可信, 伪造, 操作身份, 认证上下文, actorId 不可信, 身份来源
- 禁止的相邻示范：其他写操作（订单备注、事件、审计）用 resolveIdentity 取身份；在相邻入口示范忽略客户端 actorId
- 备注：干扰卡片可以讨论显示名称、长度、大小写、成员角色、身份键等，但不能给出“操作身份取 serverMember、客户端标识不可信”的规则。

## R1-T05

- 约定：订单归档月份采用 UTC，createdAt 为秒。
- 参考实现：summarizeOrderMonths 用 new Date(order.createdAt*1000).toISOString().slice(0,7) 计算月份。
- 禁止点名的标识符/常量：nowSeconds, createdAt, toISOString, summarizeOrderMonths, sameDay
- 禁止透露的取值/单位：UTC, 1000, 秒, 毫秒, YYYY-MM, slice(0,7)
- 禁止的规则短语：UTC, 秒级, 时间戳, 归档月份, 月份统计, 时区, 自然月, createdAt 单位
- 禁止的相邻示范：其他按时间分组的统计（结算、退款、通知）也按 UTC 月份；在相邻操作上示范秒级时间戳转月份
- 备注：干扰卡片可以讨论时间范围、过期、重试延迟、分页等，但不能透露 createdAt 的单位或月份按 UTC 计算。

## R2-T01

- 约定：导出当前及历史 trace 时递归处理凭据文本，历史记录不能依赖写入时的配置。
- 参考实现：exportTraceWindow 读取 readTrace 后再次调用 redactSensitive(event)；writeTraceExport 写 JSON。
- 禁止点名的标识符/常量：redactSensitive, readTrace, exportTraceWindow, writeTraceExport, createTraceStore, traceStore
- 禁止透露的取值/单位：[REDACTED], Bearer, Authorization, afterSequence, sequence
- 禁止的规则短语：递归脱敏, 历史 trace, 导出时, 再次脱敏, 嵌套凭据, 分页导出, 写入时配置
- 禁止的相邻示范：其他 trace 读取/分页出口也再次脱敏；在相邻的 trace 导出上示范递归清理凭据
- 备注：干扰卡片可以讨论 trace 追加、sequence、分页、文件路径、队列等，但不能指向“导出时再次递归脱敏”。

## R2-T02

- 约定：历史聊天按项目文件保存，roomId 是临时协作房间；读取历史记录时关联当前 roomId。
- 参考实现：exportChatHistory 校验 query.roomId，读取 loadMessages 后返回 {...message,roomId:query.roomId}。
- 禁止点名的标识符/常量：exportChatHistory, loadMessages, createChatStore, listMessages, ChatMessage, roomId
- 禁止透露的取值/单位：query.roomId, roomId:query.roomId
- 禁止的规则短语：历史聊天, 下载历史, 当前房间, 临时房间, 关联 roomId, 项目文件, 房间标识
- 禁止的相邻示范：其他聊天读取接口也把历史消息关联当前 roomId；在相邻的聊天导出上示范 roomId 覆盖
- 备注：干扰卡片可以讨论消息 sequence、作者、mentions、文件格式、分页等，但不能给出“读取历史时关联当前 roomId”的规则。

## R2-T03

- 约定：成员导出文件采用 0600，已有文件权限宽于 0600 时也必须收紧。
- 参考实现：writeMemberExportCsv 用 mode:0o600 写临时文件，再 fs.chmod(temporary,0o600)，最后 rename。
- 禁止点名的标识符/常量：0o600, 0600, chmod, writeMemberExportCsv, collectMemberExport, writeJsonFileAtomically, mode
- 禁止透露的取值/单位：0o600, 0600, mode:0o600, fs.chmod, 属主可读写
- 禁止的规则短语：权限位, 属主可读写, 成员导出, CSV 导出, 收紧权限, 私有权限, 文件权限
- 禁止的相邻示范：其他成员/项目数据导出也使用 0600；在相邻的文件写入上示范 chmod/权限收紧
- 备注：干扰卡片可以讨论成员字段、CSV 格式、临时文件命名、原子替换、导出路径等，但不能出现 0600/0o600/chmod 或“权限收紧”的规则。

## R2-T04

- 约定：过程活动导出只包括 durableEventTypes，光标与连接状态不构成开发过程记录。
- 参考实现：exportActivityHistory 用 durableEventTypes.has(event.type) 过滤，排除短暂事件。
- 禁止点名的标识符/常量：durableEventTypes, exportActivityHistory, writeActivityHistoryExport, createEventLog, loadEvents
- 禁止透露的取值/单位：durableEventTypes.has, event.type, 白名单
- 禁止的规则短语：持久事件, 白名单, 短暂事件, 连接状态, 光标, 活动历史导出, 过程记录, 非持久
- 禁止的相邻示范：其他活动/事件导出也按 durableEventTypes 过滤；在相邻的事件查询上示范排除短暂事件
- 备注：干扰卡片可以讨论事件追加、payload、时间戳、分页、文件格式等，但不能指出 durableEventTypes 或“只导出持久事件”。

## R2-T05

- 约定：同一协作项目的成员可以读取项目 run；成员展示角色不决定读取权限。
- 参考实现：getRunForViewer 校验 identity.projectId===run.projectId 且 can(identity,'agent:read',{projectId:run.projectId})。
- 禁止点名的标识符/常量：getRunForViewer, can, agent:read, identity.projectId, run.projectId, projectId, ownerMemberId
- 禁止透露的取值/单位：identity.projectId!==run.projectId, can(identity,'agent:read',{projectId:run.projectId})
- 禁止的规则短语：同项目成员, 项目成员, 读取 run, 展示角色, 项目成员关系, 权限判断, 项目范围
- 禁止的相邻示范：其他 run 读取/列表接口也按项目成员判断；在相邻的 run 权限入口示范展示角色不决定读取
- 备注：干扰卡片可以讨论 run 状态、存储、分页、成员名称、路由顺序等，但不能给出“同项目成员可读、角色不决定权限”的规则。
