# 团队过程性知识

## 决策

### 单项库存预留的版本检查

单项预留需要带版本号写入库存

> 单项预留需要带版本号写入库存。这样可以发现并发写入并保留冲突错误。它只适用于一次预留。

适用范围：`src/services/inventory-service.ts`

### 审计查询按 action 过滤

审计查询使用 action 精确匹配并保留时间顺序

> 审计查询使用 action 精确匹配并保留时间顺序。查询结果由 AuditStore 复制后返回。这个规则只约束筛选。

适用范围：`src/services/audit-service.ts`

### 通知发送使用模板名称

通知事件必须使用注册模板名称

> 通知事件必须使用注册模板名称。模板数据只包含模板需要的字段。这个规则适用于发送器。

适用范围：`src/workflow/notification-workflow.ts`

### 身份显示名称来自服务端成员

审计显示名称使用服务端成员的 displayName

> 审计显示名称使用服务端成员的 displayName。客户端名称只用于界面提示。该规则适用于展示。

适用范围：`src/security/identity.ts`

### 时间工具返回整数秒

时间工具统一返回整数秒，避免毫秒混入业务记录

> 时间工具统一返回整数秒，避免毫秒混入业务记录。调用方以秒进行范围比较。它适用于订单和事件。

适用范围：`src/utils/time.ts`

### 审计查询参数保持只读

AuditQuery 仅声明可选过滤字段，不承载返回数据。

> AuditQuery 的 action、actorId、from、to 只定义查询边界，不保存结果副本；适用于 AuditService.list、topics 与 statistics 接收筛选条件时。

适用范围：`src/services/audit-service.ts`

### 审计存储读取返回副本

AuditStore.all 返回独立条目与 payload 副本。

> AuditStore.all 通过 map 和展开语法复制每条 AuditEntry，并复制 payload；适用于调用方读取后修改结果而不应影响 AuditStore.values 的场景。

适用范围：`src/storage/audit-store.ts`

### 审计存储依赖保持不可替换

AuditService.store 使用 readonly，避免运行期间替换持久化实现。

> AuditService 声明 store 时应保持 private readonly，由构造阶段注入 AuditStore。这样重试或并发写入始终使用同一存储实例，调用方不能中途替换实现，避免不同请求写入不同目标。

适用范围：`src/services/audit-service.ts`

### 审计时间源支持注入

AuditService.now 注入时间源，便于稳定测试审计记录。

> AuditService 将 now 作为可注入时间源，生成 AuditEntry.createdAt 时不直接读取系统时钟。这样测试可以固定时间并验证排序或区间结果；适用于 AuditService 创建时间戳的场景。

适用范围：`src/services/audit-service.ts`

### 审计值容器只读持有

AuditStore.values 作为只读引用保存条目，不在属性层暴露可变集合。

> AuditStore 应将 values 声明为 private readonly，条目集合的维护留在类内完成。这样既避免外部直接改动审计记录，也使内存存储的生命周期边界清晰，适用于 AuditStore 的本地保存场景。

适用范围：`src/storage/audit-store.ts`

### append 复制 payload 后入队

append 保存条目副本，避免调用方继续修改原对象。

> AuditStore.append 先用展开语法复制 entry 及其 payload，再将副本 push 到 values，并返回原 entry。这样隔离后续对象变更对已收录数据的影响，适用于 AuditStore 接收新审计条目的场景。

适用范围：`src/storage/audit-store.ts`

### 按动作查询统一走 all

AuditStore.byAction 复用 all 的结果副本后再按 action 筛选。

> AuditStore.byAction 必须先取得 all 返回的 AuditEntry 集合，再以 action 精确匹配条目。统一入口可避免查询路径绕开既有复制边界；该规则适用于按业务动作检索历史审计记录的调用场景。

适用范围：`src/storage/audit-store.ts`

### 投递失败明确退避时间

DeliveryFailure 必须给出下次尝试时刻和是否耗尽状态。

> 返回 DeliveryFailure 时必须设置 nextAttemptAt，并明确 exhausted，禁止用缺省值代替失败决策。调用方可据此安排延迟重试或停止继续尝试；该约定适用于模板渲染、收件人校验及外部渠道返回失败的场景。

适用范围：`src/services/delivery-service.ts`

### 派发记录限定当前进程

NotificationDispatcher 的发送记录仅在当前实例内保存。

> NotificationDispatcher.delivered 使用进程内 Map 保存本实例已处理的事件，dispatch 遇到已存在的 eventId 时返回 delivered 为 false。这样可隔离不同运行实例的状态；该规则仅适用于当前实例的同步派发。

适用范围：`src/notifications/dispatcher.ts`

### 派发缓存限定进程内

NotificationDispatcher 的已派发记录只承担当前进程内判重。

> NotificationDispatcher 使用私有 Map 保存派发结果，因此 hasSent 只代表本进程已知状态，重启后不会保留。涉及跨实例或跨重启的结果查询时，必须读取持久化记录，不能把该缓存当作全局事实；该决策适用于内存派发器。

适用范围：`src/notifications/dispatcher.ts`

### 固定投递策略便于重放

DeliveryService.policy 为执行与重放提供同一组参数。

> DeliveryService 应持有只读 DeliveryPolicy，并让投递执行及失败重放读取同一策略对象。测试夹具需显式构造该配置，避免执行期间隐式采用默认重试或延迟参数；适用范围为投递服务初始化、故障测试与历史任务重放。

适用范围：`src/services/delivery-service.ts`

### 派发器采用依赖注入

NotificationService 持有只读派发器依赖，便于替换和重放。

> NotificationService 应通过构造函数注入 NotificationDispatcher，并将其保存为 private readonly dispatcher。生产实现负责实际发送，测试实现可记录事件并重放固定结果，从而避免测试依赖外部通道。该决策适用于通知服务的单元测试与离线回归。

适用范围：`src/services/notification-service.ts`

### 订单时间区间需先校验

同时提供 from 与 to 时必须拒绝倒置区间。

> filters 处理订单查询时，只有 from 和 to 均存在才比较先后；若 from 大于 to，应抛出 Error，而不是交给下游形成空结果。校验适用于全部订单列表筛选，并要求保持现有错误处理入口不变。

适用范围：`src/http/order-routes.ts`

### 订单汇总采用独立计算

OrderService.summarize 每次依据订单当前状态重新计算金额。

> OrderService.summarize 不缓存汇总金额，而是调用 orderTotal 与 refundTotal 基于传入 Order 重新计算 balance。若后续加入并发更新或版本字段，应先确认 Order 已加载最新版本再汇总；该决策适用于订单详情、报表和结算前的金额概览。

适用范围：`src/services/order-service.ts`

### 已退款订单禁止再次取消

cancelOrder 遇到 refunded 状态时抛出 DomainError，保留订单状态机和错误码语义。

> cancelOrder 处理 order.status 为 refunded 的订单时，应抛出携带 ERROR_CODES.ORDER_CANCELLED 的 DomainError，不继续生成 cancelled 状态或追加 internalNotes。这样可阻止退款后的订单重新进入取消流程，并让调用方按统一错误机制处理。规则适用于所有调用 cancelOrder 的订单取消入口。

适用范围：`src/workflow/order-workflow.ts`

### append 遇到重复事件应拒绝

EventStore.append 对重复事件编号直接报错，调用方需处理失败。

> EventStore.append 发现 event.id 已存在时抛出 Duplicate 错误，不应把重复写入当作成功返回。调用方应在提交前检查幂等键，并保留原 EventRecord 结构；该决策适用于事件追加及重试接入层。

适用范围：`src/storage/event-store.ts`

### topic 过滤依赖精确匹配

EventStore.topic 按完整 topic 字符串筛选事件。

> EventStore.topic 使用严格相等比较 topic，不会自动兼容前缀、大小写差异或命名变体。事件订阅、导出和审计查询应传入与写入时完全一致的主题名，避免因字符串偏差漏掉相关 EventRecord。

适用范围：`src/storage/event-store.ts`

### 订单筛选边界采用可选字段

OrderFilters 用可选字段表达金额、状态和时间范围。

> OrderFilters 将 memberId、status、minTotalCents、minRefundCents、from 与 to 声明为可选字段，使调用方能组合不同筛选维度。类型约束可拦截不合法输入，但服务入口仍需完成运行时校验。

适用范围：`src/services/order-service.ts`

### 订单筛选条件逐项收窄

OrderService.list 组合全部有效筛选条件

> OrderService.list 应同时检查 memberId、status、minTotalCents、minRefundCents、from 与 to；任一条件不满足即排除订单，多条件按交集生效。适用于列表、统计及导出等复用 list 的查询入口，边界值沿用现有 undefined 判断。

适用范围：`src/services/order-service.ts`

### 报表行统一使用金额分值

toReportRow 的金额输出统一采用整数分单位。

> toReportRow 构造 OrderReportRow 时，totalCents 与 refundedCents 必须取自 orderTotal、refundTotal 的 cents 字段，并原样携带 createdAt。这样可避免批量 buildReport 与单项 toCsv 路径出现金额精度差异，适用于所有订单报表行转换。

适用范围：`src/reports/order-report.ts`

### 结算批次读取采用防御性复制

get 返回副本，避免调用方直接修改 SettlementStore 内部批次。

> SettlementStore.get 在 batches 中未命中时返回 undefined，命中时通过 copyBatch 返回 SettlementBatch 的副本，而不是暴露 this.batches 中保存的对象。这样可防止调用方直接改写存储层内部状态，避免后续读取看到未经存储层处理的变更。该规则适用于通过 get 读取批次的所有调用场景；写入操作仍须使用 SettlementStore.update。

适用范围：`src/storage/settlement-store.ts`

### 主单位金额必须先校验

Money.fromMajor 拒绝非有限值并对元转分结果取整，阻断异常金额进入业务链路。

> 团队决定所有来自元单位的金额都通过 Money.fromMajor 进入领域模型：先以 Number.isFinite 拒绝 NaN 和无穷值，再使用 Math.round 将元转换为整数分。该顺序可防止无效数值污染订单与结算计算，同时明确金额精度边界。适用于 HTTP 请求体、配置导入和第三方回调；已有分值数据则使用 Money.fromCents。

适用范围：`src/domain/money.ts`

### 结算批次采用状态版本控制

SettlementBatch 状态变更需配合版本校验，阻止并发覆盖。

> 技术决策：SettlementBatch 的 state 仅允许 draft、approved、paid，状态推进由 approveSettlement 和 paySettlement 执行。更新时除检查当前 state 外，还必须比较持久化版本；版本已变化则中止本次写入并重新读取，避免两个请求都基于旧 approved 状态继续付款。适用范围包括审批、付款重试和异步通知回调；approvedAt、paidAt 与 bankReference 只能随对应状态转换写入，不能绕过版本检查单独覆盖。

适用范围：`src/domain/settlement.ts`

### 路由处理器返回服务结果

交付路由直接返回 DeliveryService 的结果，避免路由层复制或改写业务数据。

> registerDeliveryRoutes 统一让 handler 返回 DeliveryService.ready、health、receipts、begin、succeed 或 reject 的结果，路由层不复制、不修改对象，使调用方获得服务层确定的响应结构，避免多处转换造成字段或分页语义不一致。适用于 delivery 路由注册及新增同类只转发接口；筛选、授权或重塑响应应在 DeliveryService 中完成，不应临时修改 handler 返回值。

适用范围：`src/http/delivery-routes.ts`

### 写接口失败不承诺回滚

交付写操作的失败语义由 DeliveryService 定义，路由层不追加补偿。

> registerDeliveryRoutes 将 begin、succeed、reject 交由 DeliveryService 决定失败后的部分状态，路由层不捕获错误、不改写状态，也不调用其他方法补偿。这样可避免 HTTP 适配层擅自定义事务边界，使持久化、审计和通知的失败行为集中在领域服务；适用于交付消息写入、状态变更及拒绝处理接口。

适用范围：`src/http/delivery-routes.ts`

### 并发冲突交由服务裁决

路由层不执行重试或顺序控制，版本冲突由 DeliveryService 处理。

> registerDeliveryRoutes 对 begin、succeed 和 reject 仅提取 messageId 等参数后调用 DeliveryService，不在 HTTP 层加入锁、重试或版本判断。这样可保持单一并发裁决入口，避免同一交付消息被不同适配层采用冲突策略；适用于多实例部署、重复回执回调以及同一 messageId 并发更新的场景。

适用范围：`src/http/delivery-routes.ts`

### 取消权限由状态白名单决定

canCancel 仅放行草稿、已支付和部分退款订单。

> 订单取消入口统一调用 canCancel 判断 order.status，命中 draft、paid 或 partially-refunded 才返回 true。cancelOrder 与 reopenOrder 不应另建状态判断，否则同一订单可能从不同入口得到相反结果。该规则适用于所有触发取消操作的流程；新增状态前，必须先确认其业务含义，再同时调整状态白名单及相关测试。

适用范围：`src/workflow/order-workflow.ts`

### 订单筛选参数统一校验

filters 在路由边界校验状态与时间区间，只向下传递合法筛选条件。

> 订单列表查询统一由 filters 转换外部参数：optionalString 负责 memberId、status 等字符串，integerInput 负责 from、to；status 仅允许 draft、paid、partially-refunded、refunded、cancelled，非法值直接抛出 Error。from 与 to 同时存在且前者大于后者时，以 Order interval is invalid 拒绝请求。原因是将类型、枚举和区间约束集中在 HTTP 工作区边界，避免错误条件进入 Order 查询层。适用于 registerOrderRoutes 接收的所有订单筛选请求，也约束了 OrderFilters 的生成方式。

适用范围：`src/http/order-routes.ts`

### 筛选校验不引入异步

filters 保持同步纯解析，避免查询路径被误接入队列或异步失效逻辑。

> filters 仅完成同步参数归一化与校验：optionalString、integerInput 和状态枚举检查都不返回 Promise，也不访问队列。这样 GET /orders、/orders/export、/orders/count 的处理器可先得到确定的 OrderFilters，再按各自用途调用服务方法，避免筛选条件校验与异步任务完成顺序发生耦合。后续若增加需要等待的筛选能力，应在服务层另行设计，不能改变 filters 的同步契约。

适用范围：`src/http/order-routes.ts`

### 列表与导出分流

订单列表可分页，导出和计数分别走专用服务入口。

> registerOrderRoutes 不把 /orders/export 与 /orders/count 当作列表接口的返回变体。GET /orders 调用 service.list，并可依据 offset、limit 进入 page；导出调用 service.exportRows，统计调用 service.count。三条路径共享 filters，但保留独立服务语义，使批量数据不会被分页截断，计数也不会混入分页对象。该约定适用于订单批量导出、列表及数量查询。

适用范围：`src/http/order-routes.ts`

### 缺省配置集中在 settings

可选参数默认值应归属业务配置，而非入口文件。

> 分页数量、重试次数等可省略参数的业务默认值应由 config/settings.ts 定义并由相关模块读取，不能把缺省语义散落在 src/index.ts 或调用方。这样能区分“未提供参数”与“显式传入非法值”，并让环境或部署配置拥有唯一调整入口；适用于 services、utils 与 storage 中允许调用者省略参数的场景。

适用范围：整个项目

### AuditQuery 保持弱类型边界

查询对象仅声明可选筛选字段，不承担运行时校验。

> AuditQuery 决定审计查询的公开输入边界，action、actorId 使用可选 string，from、to 使用可选 number，空对象表示不施加对应筛选。该决定让 HTTP 路由完成类型转换与错误映射，并让 AuditService.list 集中处理时间区间冲突；适用于构造列表、topics 和 statistics 请求，不应把未转换的表单值直接传入。

适用范围：`src/services/audit-service.ts`

### store 由构造注入

审计存储作为只读依赖注入，实例不自行创建。

> AuditService.store 声明为 private readonly AuditStore，构造时接收既有存储实例，并仅通过 append 和 all 访问数据。这样可替换内存或测试用实现，避免 AuditService 内部隐式创建存储造成标识冲突与数据分叉；该决策适用于服务单例、单元测试及多实例部署，要求调用方明确提供共享语义的 AuditStore。

适用范围：`src/services/audit-service.ts`

### ready 返回独立消息列表

ready 通过 outbox.due 取得可投递消息，并由调用方接收新的数组。

> 调用 DeliveryService.ready 时，沿用 this.outbox.due(this.now(), this.policy.batchSize) 的筛选结果，并把返回的 OutboxMessage 数组直接交给调用方。该决策使服务层不在 ready 内复制或改写消息记录，调用方仍可基于数组进行自己的调度处理。适用于批量领取待投递消息的场景，调用方若需修改返回集合，应先复制数组，避免把额外状态变化误认为 outbox 已持久化。

适用范围：`src/services/delivery-service.ts`

### 库存读取不隐式补空

stock 查询缺失记录时直接报错，不把不存在的库存伪装成空集合。

> InventoryService.stock 调用 store.getStock 后，只在取得 StockItem 时返回结果；记录不存在则抛出 Error，而不是返回空对象或零库存。这一决策让调用方明确区分“尚无该仓库 SKU 记录”和“确实没有库存”，避免后续入库、预留或结算误判。规则适用于单仓库单 SKU 查询；需要展示无记录场景的入口应显式处理异常，不能改变 stock 的缺失语义。

适用范围：`src/services/inventory-service.ts`

### 预留查询采用缺失即错

reservation 找不到预留记录时抛错，不返回可被误用的占位对象。

> InventoryService.reservation 通过 store.getReservation 获取 Reservation，仅在值存在时返回；缺失记录立即抛出 Error。该决策防止订单流程把不存在的预留当成有效状态继续释放、扣减或结算，也避免调用方误判预留已经建立。适用范围是按预留 ID 查询的内部服务接口；创建前校验可由调用方完成，但成功查询后的契约始终要求真实 Reservation 存在。

适用范围：`src/services/inventory-service.ts`

### 预留列表复用存储筛选

listReservations 复用 reservationList 的过滤与结果结构，不额外加工记录。

> InventoryService.listReservations 将可选 orderId 直接传给 store.reservationList，并返回 Reservation 数组。这使服务层与存储层共享预留记录的时间和状态字段定义，避免列表接口重写字段形成不可见分叉，并确保按订单筛选与读取路径采用同一集合语义。适用于预留查询和审计展示；新增返回字段时优先延续 reservationList 结构，不应静默改变命名。

适用范围：`src/services/inventory-service.ts`

### 订单路由统一校验查询

订单读取路由先解析并校验查询参数，再调用服务层。

> registerOrderRoutes 中的三个 GET handler 都先以 objectInput(value) 将请求输入转换为查询对象，再交给 filters 校验，非法类型或状态会立即抛出 Error，不进入 OrderService。这样可让列表、导出和计数采用一致的输入边界，也避免服务层接收到结构不确定的数据。

适用范围：`src/http/order-routes.ts`

### 结算列表按时间倒序

SettlementStore.list 支持账户过滤，并以创建时间和批次标识确定稳定顺序。

> SettlementStore.list 在 accountId 未传入时返回全部结算批次，传入后仅保留账户匹配的记录。查询结果先按 createdAt 降序排列；时间相同时用 id.localeCompare 确定次序，确保分页和展示不会因排序不稳定而抖动。列表元素还须经过 copyBatch，避免调用方修改结果影响 batches；该决策适用于账户级及全局结算列表。

适用范围：`src/storage/settlement-store.ts`

### 创建失败不落半成品

邮箱校验失败时直接抛错，不返回带部分字段的客户对象。

> createCustomer 在组装 Customer 前先校验 email；校验不通过便抛出 Error，调用方不会收到只含部分状态的对象。该决策用于防止缺少有效联系信息的客户进入订单通知、结算及客户检索流程，尤其适用于所有通过 createCustomer 新建客户、且失败后不能残留隐式初始化数据的写入场景。

适用范围：`src/domain/customer.ts`

### 领域错误保持不可变载荷

DomainError 固定承载错误码与说明，创建后不修改判断依据。

> 领域失败使用 DomainError(code, message) 创建，code 限定为 ErrorCode，实例上的 code 为 readonly；message 用于说明，不用于机器判定。这样可确保错误在异步传递、路由转换或审计记录期间仍保留原始类别，也防止中途改写导致分类与事实不一致。适用范围包括空集合、非法边界值、订单状态冲突等领域校验失败。

适用范围：`src/domain/errors.ts`

### 领域错误仅按实例识别

isDomainError 只认 DomainError 实例，不以错误码或文案猜测类型。

> 跨层判断领域异常时调用 isDomainError，并依赖 instanceof DomainError 的结果；禁止仅检查 code 或 message 来模拟类型判断。原因是序列化后的普通对象可能保留相同错误码，却不具备 DomainError 的实例语义，误判会破坏异常边界。适用范围是服务层捕获、HTTP 路由适配及存储边界反序列化后的二次分类。

适用范围：`src/domain/errors.ts`

### 无分页参数时返回完整结果

订单列表仅在提供分页参数时包装分页结果。

> registerOrderRoutes 将 service.list(filters(query)) 的结果保存为 matched；只有 query.offset 或 query.limit 存在时才调用 page 与 pageQuery。若两者均为 undefined，则直接返回 matched，使列表接口兼容无分页调用；分页元数据不会凭空加入未请求分页的响应。

适用范围：`src/http/order-routes.ts`

### 消耗必须扣减现有预留

consumeStock 只消化 reserved，available 在消耗阶段保持不变。

> consumeStock 将 amount 与 item.reserved 比较，数量超过预留时立即报错；合法消耗仅减少 reserved，并递增 version、更新 updatedAt，不直接修改 available。这样可确保库存从预留到实际出库的两阶段轨迹可被审计和重放，测试夹具也能依据传入的 now 构造确定结果。适用于已完成预留后的单笔出库，禁止借此函数绕过 reserveStock。

适用范围：`src/domain/inventory.ts`

### 入库数量禁止静默截断

receiveStock 遇安全整数越界直接报错，不截断入库量。

> receiveStock 先校验 amount，再计算新的 available；若结果不是安全整数，调用必须抛出错误，不得取模、截断到最大整数或只记录告警后继续写入。因为 version 和 updatedAt 只会在成功返回时更新，静默截断会让缓存、持久化库存与真实到货数量出现不可恢复的偏差。批量到货可由服务层拆分为多个 receiveStock 调用，但每项都须独立通过边界校验；适用于所有增加 StockItem.available 的入库路径。

适用范围：`src/domain/inventory.ts`

### 库存键拒绝空值

stockKey 要求仓库和 SKU 非空，并用 JSON 数组消除拼接歧义。

> 技术决策规定 stockKey 不提供缺省值：warehouseId 与 sku 都必须是非空字符串，trim 后为空时立即抛出 Error。键值采用 JSON.stringify(\[warehouseId, sku]) 生成，而不是直接用分隔符拼接，原因在于数组编码能规避分隔符出现在 SKU 中导致的碰撞或解析错误。createStock、reserveStock、receiveStock 等凡是以仓库和商品定位库存的入口，都须先经过 stockKey。

适用范围：`src/domain/inventory.ts`

### 账目借贷互斥校验

entry 拒绝同时含正借方与正贷方的账目，确保单条记录方向唯一。

> 团队约定调用 entry 创建 LedgerEntry 时，debit 与 credit 不能同时为正，否则抛出 Error。该决策用于避免一条账目被重复计入借贷方向，进而污染 balance、totalDebits、totalCredits 与 balanced 的判断。适用范围为所有通过 entry 构造的订单、库存或结算流水；写入入口必须先完成该校验，读取历史数据时也不能绕过入口重新组装账目。

适用范围：`src/domain/ledger.ts`

### normalizeMember 统一入参

成员写入前规范名称与邮箱，并拒绝无效数据。

> 成员创建统一经过 normalizeMember：该函数用 trim 清理 displayName 与 email，将邮箱转为小写，并通过 email.includes('@') 做最低限度校验；失败时抛出 Error。缺少 role 时归为 viewer，同时生成 active 为 true 的 Member。该决策适用于新增或写入成员的入口，调用方负责提供权威 id 与 joinedAt。

适用范围：`src/domain/member.ts`

### 通知创建不内置权限判定

createNotification 只负责组装数据，权限检查留给调用边界。

> createNotification 不执行接收者权限或可投递性检查，仅依据传入参数创建 Notification，并将 attempts 设为 0。权限校验放在调用该函数的 HTTP 路由或服务层，可让领域构造逻辑保持单一职责，也能避免同一规则在多个入口重复实现。通知确实无法继续投递时，再由 attempt 流程结合 canAttempt 和 recipientDomain 作出处理。该决策适用于所有调用 createNotification 的业务入口。

适用范围：`src/domain/notification.ts`

### 批量创建先做订单去重

createSettlement 拒绝空批次与重复 orderId，并在返回时复制结算行。

> 批量创建结算必须先验证 id、accountId 和 lines 非空，再用 orderId 检查重复订单；任一条件不满足都应让 createSettlement 失败，不能静默合并订单。函数返回前复制 lines，可避免调用方后续修改原数组影响批次。规则适用于 SettlementBatch 的批量创建入口，不替代逐项生成 SettlementLine 的校验。

适用范围：`src/domain/settlement.ts`

### 审批操作采用可重放夹具

approveSettlement 显式接收 memberId 与 now，便于固定审批身份和时间并重复验证。

> 审批结算时，由 approveSettlement 显式传入 memberId 和 now，不要在函数内部读取当前时钟或隐式登录身份；测试夹具同样传入固定值，使 state、approvedBy 和 approvedAt 可稳定重放。该决策适用于 SettlementBatch 的单元测试、审批命令处理及需要审计审批时间线的场景。

适用范围：`src/domain/settlement.ts`

### 总额采用分精度累加

settlementTotal以Money逐行累加可支付金额，避免浮点误差。

> 结算总额统一由settlementTotal读取batch.lines中的payableCents，并逐项转换为Money后通过add累加，初始值为Money.fromCents(0)。不要在调用方另行用JavaScript浮点数求和，否则跨行累计可能产生舍入差异。该决策适用于批次总额展示、审批核对及提交支付前的金额校验，并要求各行币种与批次结算语义保持一致。

适用范围：`src/domain/settlement.ts`

### 费率按万分点取整

费用计算拒绝非法基点，并统一按分取整。

> calculateFee 接受整数 basisPoints，合法范围为 0 至 10000；金额统一换算到 Money.cents 后计算，并使用 Math.round 舍入，再通过 Money.fromCents 保持分为最小单位。非法范围直接抛出 Error，避免负费率或超过百分之百的费率进入结算。同一金额重复调用会得到相同费用，可供 createSettlement 重试时安全复用，但不替代批次写入层面的幂等控制。

适用范围：`src/domain/settlement.ts`

### 并发状态转换下沉服务层

HTTP路由不处理版本冲突，写入竞争由DeliveryService统一裁决。

> registerDeliveryRoutes仅把messageId和reason转换后传给service.begin、service.succeed、service.reject，不在路由层读取状态后再写入。这样可避免检查与更新分离造成竞态，并让DeliveryService基于原子更新或版本校验处理同一消息的并发转换；适用于并发请求可能同时推进同一messageId状态的delivery流程。

适用范围：`src/http/delivery-routes.ts`

### 数值配置读取约定

settingNumber 校验数值类型并使用显式兜底值。

> 团队决定通过 settingNumber(settings, key, fallback) 读取数值型配置。函数仅在 settings\[key] 的实际类型为 number 时采用该值，其他类型一律返回调用方给出的 fallback。这样可以阻止字符串形式的数值被静默接受或隐式转换，并让服务层、存储层及 HTTP 路由共享一致的读取行为。新增数值配置时应在调用处提供明确的 fallback，且不得依赖未通过类型检查的配置内容。

适用范围：`src/config/settings.ts`

### 配送路由固定序列化契约

路由层采用固定字段名和分页封装，为 DeliveryService 建立稳定的 HTTP 数据契约。

> registerDeliveryRoutes 决定将请求中的 messageId、recipient、reason 原样传给 DeliveryService，并用 page 与 pageQuery 统一封装 receipts 的分页结果。该命名及序列化边界属于 HTTP 契约，不随服务层内部结构调整而变化；原因是客户端解析和服务调用需要稳定约定，适用范围为 registerDeliveryRoutes 注册的配送就绪、健康、回执及状态变更接口。

适用范围：`src/http/delivery-routes.ts`

### 报表路由权限边界

registerReportRoutes 只负责路由注册，报表访问权限由上层统一控制。

> registerReportRoutes 仅把 GET 报表路径映射到 ReportService，不在 handler 内加入鉴权或角色判断。这样可让认证、授权中间件在同一层拦截所有受保护接口，避免不同报表因分支逻辑产生权限差异；适用于 /reports/revenue、/reports/status 和 /reports/members 的路由注册，以及需要调整报表访问策略的场景。

适用范围：`src/http/report-routes.ts`

### 分页参数采用固定默认值

pageQuery 缺省返回前 20 条，并将 limit 限制在 1 到 100。

> 分页入口统一经过 pageQuery：offset 未提供时取 0，limit 未提供时取 20；非缺省值交由 integerInput 校验，其中 limit 的有效区间固定为 1 至 100。这样既确定默认查询规模，也限制单次请求可读取的数据量，适用于所有使用 PageQuery 的列表接口。新增分页调用方应复用该函数，不要在路由层另行设置默认值或放宽 limit。

适用范围：`src/http/request.ts`

### 服务结果按值返回

路由不缓存或改写服务返回对象，让调用方按响应数据处理。

> registerSettlementRoutes 采用直接返回策略：列表结果交给 page 包装，汇总和导出结果原样返回，prepare、approve、pay 的结果也不在 handler 内二次修改。HTTP 调用方获得的是本次服务调用产生的值，不会因路由层共享并修改对象而污染后续请求。适用于本文件注册的结算响应；若需变换返回结构，应在服务层明确完成，或新增专用响应适配逻辑。

适用范围：`src/http/settlement-routes.ts`

### 公共导出承担格式契约

入口统一暴露领域与存储类型，格式变更需兼顾消费者兼容。

> src/index.ts 将 domain、storage、services、http 等模块的 export 汇入公共 API，因此订单、成员、审计与设置相关类型一旦通过入口成为外部契约，重命名或调整字段就可能破坏调用方。持久化格式升级应先在对应 store 内兼容新旧读取，再迁移数据并补充回归用例；公共 API 的移除应经过弃用周期，避免消费者与持久化格式同时切换。

适用范围：整个项目

### count 以内部值为准

AuditStore.count 直接读取 values.length，不经过副本化查询流程。

> AuditStore.count 采用 this.values.length 统计已保存的审计条目数量，不调用 all，也不创建 AuditEntry 副本。该决策让计数保持轻量，并直接反映内部集合当前规模；适用场景是服务层进行分页总数、容量判断或审计存在性检查。调用方不能据此推断列表载荷内容，也不能把 count 与某个外部过滤条件组合后当作筛选结果数量。

适用范围：`src/storage/audit-store.ts`

### 投递回执采用显式字段

DeliveryReceipt 以固定字段承载成功投递证据，调用方无需解析日志。

> DeliveryReceipt 被定为成功投递的稳定数据契约，统一包含 messageId、recipient、deliveredAt 和 attempts。服务层及上层调用方应以这些字段判断回执归属、投递时间和累计尝试次数，不要从通知正文或自由格式日志反推结果；新增字段前需评估持久化数据、序列化与旧调用方的兼容性。

适用范围：`src/services/delivery-service.ts`

### 初始化限定仓储与库存边界

initialize 在指定 warehouseId 与 sku 组合未存在时才建库存。

> InventoryService.initialize 先用 getStock 检查 warehouseId 与 sku 的组合；已有库存时抛出 Error，只有空组合才调用 putStock 写入 createStock 的结果。原因是初始化代表建立仓位库存，而不是覆盖现有数量，静默重写会造成版本与库存账失真。该规则适用于新仓、新 SKU 建账及测试数据准备。

适用范围：`src/services/inventory-service.ts`

### get 对缺失订单立即失败

OrderService.get 找不到订单时抛出 Error。

> decision：OrderService.get(id) 先从 this.store.get(id) 取得订单；结果不存在时立即 throw new Error('Order not found')，不返回空值或占位对象。这样调用方不会把缺失数据误当成有效订单继续执行结算或通知，适用于按明确 ID 获取单个订单的读取路径；若接口需要可选结果，应在边界层转换，而不是削弱服务层的失败语义。

适用范围：`src/services/order-service.ts`

### 列表过滤返回结果副本

list 用 filter 生成新数组，调用方修改结果不改变存储集合。

> SettlementService.list 决定只向调用方暴露按 accountId 与 state 筛选后的数组，并以 filter 返回新集合。调用方可调整数组顺序而不直接改写 store.list 暴露的存储集合，降低共享引用导致的数据污染风险。适用范围是服务层对外的批量查询；若调用方需要修改批次内容，仍须通过更新流程处理，不能依靠过滤后的数组完成持久化变更。

适用范围：`src/services/settlement-service.ts`

### latest 定位最新保留事件

EventStore.latest 取 values 末尾记录，空存储时返回 undefined。

> EventStore.latest 通过 this.values\[this.values.length - 1] 定位最后一条 EventRecord；values 为空时，访问下标 -1 得到 undefined，而不构造空记录。迁移或处理历史数据时，可据此判断当前事件序列是否已有最新项，并避免把无数据误当成有效事件。

适用范围：`src/storage/event-store.ts`

### save 按发票编号幂等写入

InvoiceStore.save 使用 invoice.id 覆盖写入，天然支持同键重试。

> InvoiceStore.save 以 invoice.id 作为 Map 的键，同一发票被重复提交时会覆盖原值并返回传入的 Invoice，不额外创建副本。原因是结算或通知重试可能重复触发保存流程，稳定的键策略可避免同一 id 产生多条记录。适用于由可信调用方先确定 invoice.id 的写入场景；若重试携带不同内容，调用方仍需另行解决版本冲突与内容合并。

适用范围：`src/storage/invoice-store.ts`

### 设置默认快照与单项更新分离

SettingsStore 用 current 承载完整默认设置，单项写入走 merge。

> 团队约定由 SettingsStore 的 current 字段保存完整 Settings 快照，初始值固定包含 schemaVersion: 2、timezone: 'Asia/Shanghai' 与 retryLimit: 1；读取单项配置时从 current 取值，局部变更统一交给 merge，避免调用方直接拼装不完整配置。该设计只适用于 SettingsStore 管理的单例设置，不用于需要保留多版本或多租户隔离的场景。

适用范围：`src/storage/settings-store.ts`

### resetIds 统一重置标识序列

resetIds 将 sequence 归零，为测试或受控重建场景建立确定的标识起点。

> 测试夹具或受控的本地重建流程调用 resetIds 后，sequence 会从零重新开始，后续 nextId 将按既定格式重新生成标识。把重置入口集中在 resetIds，可避免测试直接操作内部计数状态，并让每次场景准备得到一致起点；该决策仅适用于单进程内可丢弃的标识序列，执行 resetIds 会破坏此前 nextId 输出之间的递增关系。

适用范围：`src/utils/id.ts`

## 约束

### 批量库存操作使用单一事务

一次批量库存操作在独立事务状态中完成，任何项失败后原始状态保持不变

> 一次批量库存操作在独立事务状态中完成，任何项失败后原始状态保持不变。规则适用于InventoryService.reserveBatch 的库存与 reservation 写入。任意一项失败都必须保留操作前的库存和 reservation 快照。修改InventoryService相关数据出口时，保持现有数据结构与业务记录含义，并用边界输入检查结果。

适用范围：`src/services/inventory-service.ts`

### 库存列表按仓库和 SKU 排序

库存列表先按仓库标识筛选，再按 SKU 稳定排序

> 库存列表先按仓库标识筛选，再按 SKU 稳定排序。返回值需要复制对象，避免调用方改变存储。这个规则适用于查询接口。

适用范围：`src/services/inventory-service.ts`

### 审计导出递归处理敏感键

面向客服的审计数据递归处理敏感键名，键名比较忽略大小写，保持普通字段与存储内容

> 面向客服的审计数据递归处理敏感键名，键名比较忽略大小写，保持普通字段与存储内容。规则适用于AuditService 导出的 payload 与嵌套数组。日志可能来自不同客户端，键名大小写变化也不能暴露凭据。修改redactSensitive相关数据出口时，保持现有数据结构与业务记录含义，并用边界输入检查结果。

适用范围：`src/security/redaction.ts`

### 文本令牌使用正则替换

自由文本中的 Bearer 和 sk- 前缀令牌需要替换

> 自由文本中的 Bearer 和 sk- 前缀令牌需要替换。替换结果保留字段结构，避免影响普通业务文本。它适用于纯文本消息。

适用范围：`src/security/redaction.ts`

### 通知逻辑标识来自业务事件

通知逻辑标识由订单、通知类型与收件人决定，请求标识变化不产生第二次业务通知

> 通知逻辑标识由订单、通知类型与收件人决定，请求标识变化不产生第二次业务通知。规则适用于支付成功通知的 NotificationOutbox 去重。请求重试会改变 requestId，但同一订单和收件人只能形成一条逻辑通知。修改eventForOrder相关数据出口时，保持现有数据结构与业务记录含义，并用边界输入检查结果。

适用范围：`src/workflow/notification-workflow.ts`

### 通知重试保留原始事件

发送失败时再次发送同一事件对象

> 发送失败时再次发送同一事件对象。重试次数由 dispatcher 管理。它不改变事件标识。

适用范围：`src/workflow/notification-workflow.ts`

### 订单事件使用服务端成员身份

操作身份来自 serverMember，客户端提供的标识只作为不可信输入

> 操作身份来自 serverMember，客户端提供的标识只作为不可信输入。规则适用于订单备注写入与 EventStore 记录。请求正文中的 actorId 可以被调用方伪造，审计记录必须使用认证上下文中的成员。修改resolveIdentity相关数据出口时，保持现有数据结构与业务记录含义，并用边界输入检查结果。

适用范围：`src/security/identity.ts`

### 事件时间由调用上下文提供

事件时间使用请求上下文提供的秒数

> 事件时间使用请求上下文提供的秒数。这样测试和重放可以保持稳定。该规则不改变事件主题。

适用范围：`src/storage/event-store.ts`

### 订单月份按 UTC 秒时间戳计算

订单归档月份采用 UTC，createdAt 为秒

> 订单归档月份采用 UTC，createdAt 为秒。规则适用于SettlementService 的月份归档统计。服务进程时区可能变化，账务月份必须对同一秒时间戳产生同一结果。修改nowSeconds相关数据出口时，保持现有数据结构与业务记录含义，并用边界输入检查结果。

适用范围：`src/utils/time.ts`

### 日期范围包含起止边界

时间范围比较包含 from 和 to 两端

> 时间范围比较包含 from 和 to 两端。这样边界事件不会被遗漏。它适用于普通查询。

适用范围：`src/utils/time.ts`

### InventoryService 固定存储依赖

库存服务持有只读存储依赖，避免运行中替换实现。

> InventoryService 的 readonly store 必须始终指向 InventoryStore，初始化后不得替换。该约束用于服务级调用，防止运行中切换存储造成读写落入不同数据源；实例化及依赖注入配置应一次性选定实现。

适用范围：`src/services/inventory-service.ts`

### stocks 按库存键唯一

InventoryStore.stocks 以仓库与 SKU 组合定位一条库存记录。

> InventoryStore.stocks 必须使用 stockKey 生成的仓库与 SKU 组合作为 Map 键，避免同一库存被不同键重复登记。原因是 getStock、putStock 与 stockList 需要定位一致记录；该约束适用于所有写入 InventoryStore.stocks 的库存操作。

适用范围：`src/storage/inventory-store.ts`

### 初始库存不得重复建档

initialize 遇到已有 StockItem 时必须拒绝继续写入。

> InventoryService.initialize 应先调用 getStock 检查 warehouseId 与 sku，库存已存在时抛出 Error，不覆盖原记录。这样可避免误初始化抹掉可用量、预留量及版本信息，约束适用于仓库中新建库存档次的入口。

适用范围：`src/services/inventory-service.ts`

### 核销须关闭残留资源

consume 完成业务写入后应释放关联资源。

> InventoryService.consume 在把 reservation 标记为 consumed 并完成库存变更后，应关闭本次核销占用的临时资源，避免连接、文件句柄或队列任务继续保留；清理动作不能误删仍需审计的业务记录。

适用范围：`src/services/inventory-service.ts`

### putStock 启用版本冲突检查

写入库存时可用 expectedVersion 拒绝过期更新。

> 调用 InventoryStore.putStock 时，传入 expectedVersion 可触发并发写入冲突检查；当前版本不符时抛出 Error，避免覆盖其他写入者的结果。该约定适用于单条库存更新及需要显式并发控制的写入路径。

适用范围：`src/storage/inventory-store.ts`

### stockKey 拒绝空仓库与 SKU

库存键生成前必须校验两个业务标识。

> stockKey 在拼接库存标识前检查 warehouseId 与 sku，任一值去除首尾空白后为空都抛出 Error。该约束适用于 StockItem 创建、查询键生成和仓储读写入口，以避免不同业务含义共享无效键。

适用范围：`src/domain/inventory.ts`

### create 统一走订单存储

OrderService.create 只负责把 Order 交给 OrderStore.save，不在服务层另建写入路径。

> OrderService.create 接收 Order 后直接调用 store.save，并返回保存结果。这样可让订单写入规则集中在 OrderStore，避免服务层绕过存储接口；新增调用方也应沿用这一入口及返回的 Order。

适用范围：`src/services/order-service.ts`

### 审计写入先校验参与方

AuditService.record 拒绝空 action 与 actorId，避免保存无意义记录。

> 调用 AuditService.record 时，action 和 actorId 都必须包含非空内容，否则抛出 Error。校验完成后才创建 AuditEntry 并交给 store.append；适用于所有审计动作写入。

适用范围：`src/services/audit-service.ts`

### 公开审计仅保留四项

publicAuditFields 将对外元数据限定为四个固定字段，不返回 payload。

> publicAuditFields 返回 Pick 限定的 id、action、actorId 与 createdAt，并从 entry 逐项取值。原因是调用方可展示审计发生背景，而无需接触载荷内容；该约束适用于需要公开审计元数据的接口。

适用范围：`src/security/audit-policy.ts`

### 重试后仍须派发事件

deliverWithRetry 先重试发送，再调用 dispatcher.dispatch。

> 调用 deliverWithRetry 时，send 失败由 retryOnce 处理；重试结束后仍执行 dispatcher.dispatch(event)，让后续通知流程获得事件。该顺序适用于工作流中的发送失败恢复。

适用范围：`src/workflow/notification-workflow.ts`

### 发件箱状态须合法

OutboxMessage 的状态仅允许四种预设值。

> 构造 OutboxMessage 时，state 只能取 pending、delivering、delivered 或 failed，attempts 必须是非负整数。非法状态会让重试统计和失败恢复产生歧义，因此该约束适用于创建、复制及恢复发件箱记录的入口。

适用范围：`src/notifications/outbox.ts`

### 模板渲染失败不落状态

renderTemplate 渲染失败时不得写入成功状态。

> 通过 renderTemplate 调用 Template.render 时，若渲染抛出异常，应让失败向上返回，不生成虚假的成功结果。Template.name 用于定位模板，该做法适用于 templates 中的通知正文生成。

适用范围：`src/notifications/templates.ts`

### 投递回执使用消息标识

DeliveryReceipt 通过 messageId 对应一次具体投递记录。

> DeliveryReceipt 必须使用 messageId 标识对应的投递消息，并在成功返回时记录 recipient、deliveredAt 与 attempts。原因是回执需要关联可追踪的投递记录，适用范围为消息投递成功后的结果回传。

适用范围：`src/services/delivery-service.ts`

### 批量通知逐项返回结果

notifyMany 保留每个事件的独立派发结果。

> NotificationService.notifyMany 应逐项调用 notify，并按输入顺序返回每项的 delivered 与 eventId，不合并或省略结果。这样便于定位批量操作中的失败项，适用范围为多事件通知提交及结果核对。

适用范围：`src/services/notification-service.ts`

### 发件箱值表保持私有

NotificationOutbox 的 values 不向调用方直接开放。

> NotificationOutbox 的 values 必须保持 private，外部只能通过公开操作访问消息，避免绕过状态变更与复制隔离。读取或修改发件箱数据的逻辑均适用，并应在边界处验证写入结果。

适用范围：`src/notifications/outbox.ts`

### 已投递索引须为私有

NotificationDispatcher 的已投递索引由类内部维护。

> NotificationDispatcher.delivered 声明为 private readonly Map，外部调用方不得直接读取或改写其中的事件。该设计让 hasSent、sentCount 与 events 统一提供受控访问，适用于 NotificationDispatcher 实例内部的状态管理。

适用范围：`src/notifications/dispatcher.ts`

### 模板清单跟随注册表更新

templateNames 直接反映 templates 当前注册项，不另行维护名称列表。

> templateNames 应通过 Object.keys(templates) 返回当前已注册模板的 string 名称集合，不单独维护另一份名称清单。这样新增、移除或替换 templates 中的定义后，清单会与注册表保持一致，避免返回过期名称。该规则适用于模板枚举、配置校验及管理入口；调用方仍需结合 renderTemplate 处理具体渲染。

适用范围：`src/notifications/templates.ts`

### 投递策略统一约束

DeliveryPolicy 统一规定重试、延迟与批量参数。

> DeliveryPolicy 应为批量投递配置 maxAttempts、initialDelay、maximumDelay 与 batchSize，并确保最大延迟不小于初始延迟。这样可让队列消费端按一致规则退避和限流，适用于 DeliveryService 发起异步投递及测试环境复现失败场景。

适用范围：`src/services/delivery-service.ts`

### since 采用闭区间时间筛选

EventStore.since 保留创建时间等于下界的事件。

> EventStore.since 统一以 createdAt 大于等于边界值筛选 EventRecord，包含恰好落在起点的事件，避免调用方重复获取边界记录；适用于按时间推进读取事件流的场景。

适用范围：`src/storage/event-store.ts`

### 导出列须保持固定结构

exportRows 只输出约定的订单字段，不应混入内部或动态数据。

> OrderService.exportRows 应保持固定列集合，包括 id、memberId、status、totalCents、refundedCents 与 createdAt。不要把 filters、订单内部对象或未定义扩展字段直接并入结果，否则导出格式会随实现变化。该规则适用于订单报表和下游导入流程。

适用范围：`src/services/order-service.ts`

### 取消状态须限定枚举

canCancel 仅允许订单处于已定义的可取消状态。

> canCancel 应只接受 status 为 draft、paid 或 partially 的订单，其中 partially 对应 partially-refunded 状态判断；遇到未知状态应返回 false。该约束适用于取消命令提交前的资格检查，避免历史脏数据进入 cancelOrder。

适用范围：`src/workflow/order-workflow.ts`

### 批次写入须先完成防重检查

SettlementStore.create 先拒绝重复批次及重复订单，再写入批次和归属索引。

> SettlementStore.create 必须先检查 batch.id 是否已存在，并遍历 batch.lines 确认每个 orderId 尚未进入其他结算；任一条件冲突都抛出 Error。全部检查通过后，才依次写入 this.batches 与 this.orders，避免失败时留下不完整归属。

适用范围：`src/storage/settlement-store.ts`

### 结算与订单标识防重

SettlementStore 同时约束批次编号和订单归属的唯一性。

> SettlementStore.create 必须先拒绝重复的 batch.id，也要拒绝已进入其他结算的 orderId，校验通过后再写入 batches 与 orders。原因是要防止同一订单被重复纳入结算；该规则仅适用于新结算创建。

适用范围：`src/storage/settlement-store.ts`

### 客户激活须返回新对象

activateCustomer 不修改传入对象，并返回独立的 active 客户副本。

> 调用 activateCustomer 时必须保留原 customer 不变，返回值中的 active 应设为 true。这样可避免外部继续持有旧对象时意外观察到状态变化，适用于客户激活流程以及任何复用该结果的调用方。

适用范围：`src/domain/customer.ts`

### 结算创建拒绝重复订单

createSettlement 必须拒绝同一批次中的重复 orderId。

> createSettlement 创建批次前要检查 lines 中的 orderId 是否重复；发现重复时立即抛出 Error，避免同一订单被重复计费。校验针对传入的 SettlementLine 集合，适用于所有新结算批次的创建入口。

适用范围：`src/domain/settlement.ts`

### 存储写入前检查订单归属

SettlementStore.create 只能接纳尚未归入结算的订单。

> SettlementStore.create 写入批次前，须检查每条 line.orderId 是否已存在于 orders 索引；已存在时抛出 Error，防止订单重复进入结算。该约束适用于 create 的持久化入口，并要求批次保存与订单索引更新保持一致。

适用范围：`src/storage/settlement-store.ts`

### 错误码承担失败边界

用稳定错误码区分订单、成员及访问失败，避免调用方依赖错误文案。

> 业务失败统一从 ERROR_CODES 选择固定值，并通过 DomainError.code 暴露；新增失败类型时必须同步扩充该映射。原因是订单、成员、权限和投递场景需要被调用方稳定识别，文案可能调整，不能承担协议契约。适用范围覆盖服务层抛错、HTTP 路由转换及跨模块判断；不得在调用处临时拼接错误码。

适用范围：`src/domain/errors.ts`

### 库存预留必须原子判定

reserveStock 在余额不足时统一拒绝，并同步递增库存版本。

> 调用 reserveStock 时，amount 先由 quantity 校验；只有 amount 不超过 item.available 才可生成新的 StockItem。该函数同步扣减 available、增加 reserved，并递增 version 与更新时间。库存不足统一抛出带 ERROR_CODES.FORBIDDEN 的 DomainError，避免并发请求基于过期余额分别成功预留。

适用范围：`src/domain/inventory.ts`

### 生命周期事件按固定顺序展开

orderLifecycle 先记录订单状态，再逐项追加退款事件。

> 团队约定：生成订单生命周期轨迹时，必须通过 orderLifecycle 保持事件顺序，先输出 order.status，再依次追加由 order.refunds.map 生成的 refund 条目。这样下游能够稳定识别首个状态及后续退款记录，避免各调用方自行拼接导致顺序不一致。适用范围为订单轨迹展示和事件记录；退款数量为零时，数组只包含当前状态。

适用范围：`src/workflow/order-workflow.ts`

### 支付路由统一委托服务层

支付接口仅负责参数转交，业务操作统一由 PaymentService 执行。

> registerPaymentRoutes 只向 registry 注册 POST 与 GET 路由，并将请求参数直接转交给 PaymentService 的 create、authorize、capture、list 方法，不在 handler 中编写金额校验、支付状态流转或库存联动逻辑。这样可让 HTTP 层保持薄层，并使同一套支付规则能够被其他入口复用；新增或调整支付流程时，应在 PaymentService 中实现，再由各路由调用。

适用范围：`src/http/payment-routes.ts`

### 报表注册不持有资源

registerReportRoutes 只注册同步处理器，不创建或长期持有外部资源。

> registerReportRoutes 仅向 registry 注册三个 GET 路由，handler 在请求到达时调用 ReportService，并从 orders 获取当前订单快照。路由注册阶段不打开文件、数据库连接、游标或定时器，因此无需在该函数中执行关闭操作。适用于本项目报表路由的启动装配；若后续处理器引入流、事务或异步资源，应在处理请求的局部生命周期内获取并释放，避免把清理责任错误地放在 registerReportRoutes。

适用范围：`src/http/report-routes.ts`

### 分页结果固定返回游标

Page 除数据与总数外，还记录当前偏移及下一偏移。

> 分页响应必须使用 Page 承载 items、total、offset、limit 和 nextOffset。测试夹具应完整填充这些字段，尤其不能用可变化的 nextOffset 代替稳定的页码假设；相同请求与固定数据集必须得到相同结果，才能验证审计记录、通知任务及库存快照可重放。适用于列表接口断言、回归数据和跨层分页契约测试。

适用范围：`src/http/request.ts`

### 必填字符串拒绝空白值

stringInput 将非字符串和纯空白统一判为无效。

> stringInput 只接受能够通过 trim 得到非空内容的字符串，并返回去除首尾空白后的值。传入 undefined、null、数字或其他非字符串时，函数抛出 DomainError，错误码使用 ERROR_CODES.INVALID_ORDER，消息包含字段 name。适用于订单标识、库存编号、结算参数等必填文本字段，不适用于可缺省字段。

适用范围：`src/http/request.ts`

### 结算写入按业务阶段排列

结算路由先注册只读接口，再依次开放准备、审批和支付操作，使接口暴露顺序符合结算生命周期。

> registerSettlementRoutes 的注册顺序固定为 GET /settlements、/settlements/summary、/settlements/export，随后是 POST /settlements/prepare、/settlements/approve、/settlements/pay。读取能力先于写入能力，写入流程按准备、审批、支付推进。新增结算路由应沿用该分组和阶段顺序；若 RouteRegistry 按顺序解析或生成清单，可避免写操作提前暴露。

适用范围：`src/http/settlement-routes.ts`

### 结算标识不由路由层生成

路由层只校验既有标识并透传，唯一性责任属于 SettlementService。

> registerSettlementRoutes 不生成结算编号、审批人标识或支付参考号，而是通过 stringInput 校验 input.id、input.memberId 与 input.reference 后原样传给 service.approve、service.pay。prepare 场景的 accountId 同样只作为查询边界传入 service.prepare。这样可避免 HTTP 层生成规则与领域层唯一性策略分叉；涉及标识创建、查重和幂等键选择时，应由 SettlementService 及其存储层负责。

适用范围：`src/http/settlement-routes.ts`

### 基点参数缺省规则

prepare 未提供 basisPoints 时采用 0；显式值必须是 0 至 10000 范围内的整数。

> registerSettlementRoutes 对 prepare 的 basisPoints 使用 integerInput 缺省值 0，并限制上限为 10000。调用方省略该字段时按零基点处理；传入值必须是范围内的整数。accountId、orders、id、memberId 与 reference 无默认值，缺失时由对应校验函数拒绝。规则适用于 POST /settlements/prepare；服务层仍需明确零基点对应的结算计算语义。

适用范围：`src/http/settlement-routes.ts`

### 状态计数必须覆盖四种状态

counts 按 OutboxMessage.state 汇总四种通知状态。

> 调用 counts 时，结果必须覆盖 pending、delivering、delivered、failed 四种状态，并以 OutboxMessage.state 作为唯一分组依据。这样运营看板能直接得到完整队列分布，避免遗漏未知状态或分别维护多套统计逻辑。适用范围是 NotificationOutbox 的批量统计与状态监控，不能用单条 get 的结果替代全量计数。

适用范围：`src/notifications/outbox.ts`

### 订单读路由按需分页

订单列表仅在提供分页参数时返回分页结构。

> registerOrderRoutes 约定：GET /orders 的 handler 先执行 service.list(filters(query))，只有 query.offset 或 query.limit 任一存在时才通过 page(matched, pageQuery(query)) 包装结果；两者都未提供时直接返回 matched。原因是保留完整列表的既有响应，同时让显式分页请求采用统一结构。规则适用于 /orders 读取路由，不扩展到 /orders/export 和 /orders/count，后两者分别直接返回 service.exportRows(filters(query)) 与 service.count(filters(query))。

适用范围：`src/http/order-routes.ts`

### topics 查询须可重放

topics 复用 list 查询边界，并通过 auditTopic 统一主题归类。

> 调用 AuditService.topics 时，查询条件必须完整传给 list，使结果与同条件下的审计列表保持一致；主题先由 auditTopic(entry.action) 归类，再用 Set 去重并排序。这样可避免不同接口因各自过滤规则产生主题集合差异。测试夹具应固定 AuditQuery，并断言重复 action 只返回一个主题、排序结果稳定。

适用范围：`src/services/audit-service.ts`

### 订单筛选条件采用统一结构

OrderFilters 集中承载订单列表、计数与汇总查询的筛选参数。

> 团队约定所有订单查询条件统一放入 OrderFilters，不在调用处临时拼装零散参数。该接口覆盖 memberId、status、minTotalCents、minRefundCents、from 与 to，可供 OrderService/list、OrderService/count 和 OrderService/summarize 复用。这样既能限制查询入口的参数形态，也能让筛选语义在列表、计数与汇总结果间保持一致；新增筛选条件时，应先扩展 OrderFilters，再同步各查询方法的处理逻辑。

适用范围：`src/services/order-service.ts`

### MemberRow 输入边界

MemberRow 限定成员写入契约，避免可选字段引发缓存键与失效判断不一致。

> MemberRow 规定成员导入和创建时可提交的字段：displayName、email 必填，id 与 role 可选。新增或批量导入数据应先按此契约归一化，再交给 MemberService。这样可为 email、role 等缓存键提供稳定输入，避免同一成员因字段缺失而生成不同缓存标识；该规则适用于 create、importRows 及相关缓存失效逻辑。

适用范围：`src/services/member-service.ts`

### 批量通知必须逐项返回结果

notifyMany 对每个事件独立调用 notify，并保留送达状态与事件编号。

> 调用 NotificationService.notifyMany 时，批量结果必须按 events 顺序逐项对应，每项包含 delivered 与 eventId，不能只返回整体成功与否。实现通过 map 调用 NotificationService.notify，使单个事件的失败不会抹去其他事件的结果。适用于订单、库存和结算流程中的通知扇出，便于调用方定位失败事件并执行重试或补偿。

适用范围：`src/services/notification-service.ts`

### 报表测试采用可重放输入

ReportService 测试应固定输入数据并验证纯计算结果，避免依赖外部状态。

> 为 ReportService 构造测试夹具时，传入完整的 Order\[] 或 Invoice\[] 数组，固定 memberId、status、createdAt、金额与退款等字段，并保存期望的汇总结果；不要依赖当前时间、随机排序或数据库返回顺序。这样可重放地验证 orderRevenue、invoiceRevenue、groupOrders、statusCounts、dateRange 与 topMembers，也便于在规则或金额口径调整后定位回归。

适用范围：`src/services/report-service.ts`

### 付款状态必须经存储更新

pay 依赖存储层持久化付款结果，调用方不能把转换结果视为已落库。

> SettlementService.pay 先通过 get 读取结算批次，调用 paySettlement 生成付款状态，再用 this.store.update 持久化。调用方必须以 pay 返回的 SettlementBatch 为已保存结果；若需要后续查询，应重新读取存储，不能仅依据 paySettlement 的局部结果判断付款是否完成。

适用范围：`src/services/settlement-service.ts`

### 列表查询按需筛选状态

list 先限定账户，再按可选 state 过滤，调用方无需自行组合条件。

> SettlementService.list 接受可选 accountId 和 state，先由 this.store.list(accountId) 限定账户范围，再用 filter 按 state 精确筛选。查询方传入 undefined 时可获得该账户全部批次；传入状态值时只返回匹配项。该约定使账户边界与状态筛选保持一致，并降低各调用方自行过滤造成口径差异的风险。

适用范围：`src/services/settlement-service.ts`

### summary按批次状态汇总

summary只统计当前账户的结算批次金额与数量。

> SettlementService.summary必须通过this.list(accountId)限定账户，再按batch.state分别累计draftCents、approvedCents和paidCents，count取batches.length。原因是同一状态下的批次金额必须由settlementTotal(batch).cents统一计算，避免各分支自行累加造成口径不一致。该约束适用于账户级结算概览；未知状态不计入金额，但仍应保留在批次数量口径中。

适用范围：`src/services/settlement-service.ts`

### exportRows提供一致快照

导出行先读取账户批次，再生成固定字段结构。

> SettlementService.exportRows以this.list(accountId)取得的批次为唯一数据源，并固定输出id、accountId、state、orderCount、payableCents、createdAt、approvedBy和paidAt。原因是先取得列表再map，可让同一批导出使用一致的批次视图，也便于调用方按固定列消费。若底层存储增加并发写入机制，应在this.list阶段取得可校验快照，避免导出过程中混入不同版本的数据。

适用范围：`src/services/settlement-service.ts`

### 预留记录须按唯一ID检索

Reservation 的唯一标识是 id，getReservation 只按该键定位预留。

> 团队约定为每条 Reservation 使用全局唯一且稳定的 id，并统一通过 InventoryStore.getReservation(id) 查询。该方法以 this.reservations.get(id) 精确定位记录，不可用 orderId 代替唯一键，因为同一订单可能包含多条预留。唯一 ID 由上游生成后写入 putReservation；存储层只负责按原值索引，适用于所有创建、扣减库存和释放预留的调用方。

适用范围：`src/storage/inventory-store.ts`

### 权限校验外置存储层

InvoiceStore 负责数据操作，权限判断由调用层完成。

> InvoiceStore 只提供发票的存取与查询能力，不在 save、get、remove 等方法中判断调用者权限。原因是存储层若混入权限策略，会让同一类 InvoiceStore 被不同角色复用时出现策略分散，且难以在 HTTP 路由或服务层统一审计。适用于所有通过 InvoiceStore 访问 Invoice 的业务流程，身份认证、角色授权及操作范围校验应放在入口或服务层。

适用范围：`src/storage/invoice-store.ts`

### 支付存储统一使用记录时间

PaymentStore 仅按 Payment.createdAt 排序，不引入独立时钟源。

> 团队约定 PaymentStore.all() 必须以 Payment.createdAt 升序返回结果，调用方需要稳定时间序列时直接复用该顺序。原因是 createdAt 已随 Payment 保存，可避免存储层额外引入时钟依赖造成排序口径不一致。该约定适用于 PaymentStore 的列表读取，以及基于 all() 的 byOrder()、byState() 查询；新增支付记录时应保证 createdAt 可比较。

适用范围：`src/storage/payment-store.ts`

### Settings 保留扩展键

Settings 固定核心字段，同时允许存储特定配置。

> 定义配置契约时，Settings 必须保留 schemaVersion、timezone、retryLimit 三个显式字段，并通过索引签名接纳其他键。调用方据此获得已知的版本、时区和重试参数类型，同时存储层仍能承载尚未纳入固定契约的设置。该约束适用于所有构造、替换或合并 Settings 的代码路径，避免使用过窄类型导致合法配置在边界处被丢弃。

适用范围：`src/storage/settings-store.ts`

### get 返回脱离存储的副本

SettlementStore.get 复制批次后再返回，避免调用方改写内部状态。

> SettlementStore.get 必须通过 copyBatch 返回 SettlementBatch 副本，读取结果不得直接暴露 batches 中的对象引用。这样可避免调用方修改返回对象后污染存储层状态，破坏结算批次的数据完整性。规则适用于所有按 id 查询单笔结算批次的存储调用；对象不存在时仍返回 undefined。

适用范围：`src/storage/settlement-store.ts`

### 订单结算查询走统一读取

SettlementStore.forOrder 只负责映射订单标识，结算数据仍由 get 获取副本。

> SettlementStore.forOrder 通过 orders 映射 orderId 对应的结算标识，再调用 this.get(id)，不得绕开统一读取逻辑自行访问 batches 后返回对象引用。未建立映射或映射目标不存在时均返回 undefined。这条类型边界规则适用于所有按订单检索结算的服务层与 HTTP 路由调用，并确保结果继续受 copyBatch 的副本隔离约束。

适用范围：`src/storage/settlement-store.ts`

### 分页响应统一使用 Page

批量与单项路径共用分页协议，避免响应结构漂移。

> 服务层、存储层和 HTTP 路由返回批量数据时统一采用 Page<T>，让 items、offset、limit、total、hasMore 形成固定分页契约；单项路径则直接返回对应领域对象，不套用分页外壳。这样可避免不同调用方自行拼装批量响应而造成字段缺失或类型分裂，适用于 R1 中所有列表查询及分页接口。

适用范围：`src/utils/pagination.ts`

### 必填字符串统一裁剪后入库

历史数据进入订单等业务模型前，统一按必填字符串规则清洗。

> 团队约定：调用 requiredString 时，传入值必须是非空字符串，并统一执行 trim；空白字符串视为缺失并立即抛出 Error。这样可阻止历史导入数据携带前后空格进入订单、库存或结算字段，避免相同业务含义因空白差异被重复处理。适用于所有标记为必填的文本参数及迁移、导入校验入口；可空文本需改用 optionalString，不能借此函数提供默认值。

适用范围：`src/utils/validation.ts`

### 退款通知事件保持精简

退款事件只携带通知所需字段，避免无关数据扩大载荷。

> eventForRefund 构造退款通知时，仅写入 eventId、template、data 和 recipient，其中 data 只保存 orderId，不附加订单详情、退款金额或时间等扩展信息。原因是通知工作流的负载会随订单数据增长，过量字段会增加序列化、传输和重试成本。适用于通过 deliverWithRetry 投递的退款通知事件；调用方需要在模板渲染或后续处理中取得更多信息时，应由专门的数据读取流程提供，不能直接扩充此事件的 data。

适用范围：`src/workflow/notification-workflow.ts`

### 统一导出订单生命周期快照

跨模块读取订单状态与退款标识时统一调用 orderLifecycle。

> 跨模块读取订单状态或退款信息时，统一调用 orderLifecycle 获取字符串数组，不要分别访问 order.status 与 order.refunds 后自行拼接。该函数以 Order 为输入，先返回当前状态，再为每笔退款追加 refund 前缀和退款 ID，使调用方获得稳定且可比较的生命周期快照；适用于路由响应、审计记录和事件载荷等需要同时表达订单与退款关系的场景。

适用范围：`src/workflow/order-workflow.ts`

### 配置更新统一走合并接口

updateSettings 只委托 SettingsStore.merge，拒绝调用方绕过存储层直接改写配置。

> updateSettings 接收 Record\<string, unknown> 类型的 values，并统一调用 SettingsStore.merge 完成写入。调用方只描述需要变更的字段，不直接操作存储对象，从而让持久化、默认规则和后续校验集中在 SettingsStore。适用于服务层、路由层更新配置的入口。

适用范围：`src/config/settings.ts`

### 迁移输入可覆盖默认版本

migrateSettings 将 input 放在默认对象之后，传入值会覆盖 schemaVersion 等默认项。

> migrateSettings 先提供 schemaVersion、timezone 和 retryLimit 默认值，再用 input 展开覆盖，因此迁移来源可指定自己的版本与重试参数。该设计支持不同历史配置进入统一 Settings 结构；调用迁移流程时必须确认 input 中的旧字段已验证，不能依赖默认值阻止不合法覆盖。

适用范围：`src/config/settings.ts`

### 预约状态迁移校验

changeReservation 只允许活跃预约进入终态，并统一抛出 Error。

> 团队约定调用 changeReservation 时，current.state 必须为 active，目标 state 必须是 released 或 consumed；传入 active 会被拒绝，已完成预约再次迁移也会被拒绝。函数统一使用 Error 抛出异常，而不是返回 null 或静默修改。这样可阻止重复释放、重复消费造成库存数量漂移，适用于所有通过 changeReservation 更新 Reservation 状态的服务层、结算流程和重试任务。

适用范围：`src/domain/inventory.ts`

### 库存字段写入次序

StockItem 数量字段按可用、预留、版本、时间顺序落库。

> 持久化或序列化 StockItem 时，字段顺序固定为 sku、warehouseId、available、reserved、version、updatedAt；读取时按同一顺序处理，不把 reserved 合并到 available。固定次序便于快照比对、日志排查和迁移校验，适用于 createStock、reserveStock、releaseStock、consumeStock 与 receiveStock 的存储映射。

适用范围：`src/domain/inventory.ts`

### 金额乘法先取整再返回

Money.multiply 通过 Math.round 处理金额乘数量的结果。

> 团队约定调用 Money.multiply 计算“单价乘数量”时，结果统一经过 Math.round，并使用 new Money 封装为分值 Money。这样可避免浮点误差直接进入订单金额、库存价值或结算流水。适用于数量为有限 number、且业务结果以分为最小单位的乘积；调用方不应绕过该方法自行拼接浮点金额。

适用范围：`src/domain/money.ts`

### Refund权限由入口拦截

Refund数据模型不承载授权语义，退款权限须在应用入口校验。

> Refund 只保存 id、amount、reason 与 createdAt，不把操作者权限或审批结果塞入领域记录。任何退款请求都要在进入 applyRefund 之前完成成员身份、订单归属及管理员权限检查，拒绝的请求不得生成 Refund；否则持久化后难以区分合法退款与越权尝试。适用范围覆盖 HTTP 路由、后台任务及消息消费等全部退款调用入口。

适用范围：`src/domain/order.ts`

### createPayment 初始化后失效缓存

新建 Payment 后必须使相关缓存失效，避免读取到旧支付记录。

> 调用 createPayment 生成 Payment 后，订单维度与支付维度的缓存都要立即失效，不得继续返回创建前的数据。原因是 createPayment 会写入新的 id、state 和 createdAt，并让 attempts 从零开始；沿用旧缓存会造成重复创建判断错误或状态展示滞后。该规则适用于创建订单后的首次授权、补偿重试以及任何重新发起支付的入口，缓存重建应放在创建成功之后。

适用范围：`src/domain/payment.ts`

### 费率输入边界不可缓存放宽

calculateFee 只接受整数基点，越界输入必须立即失败，不能沿用缓存结果。

> 调用 calculateFee 时，basisPoints 必须是 0 至 10000 的整数，异常配置不得进入费率缓存，也不得通过取模、截断或默认值修复。原因是费率越界会造成资金计算失真，而且缓存会让错误配置持续命中；该约束适用于 settlementLine、settlementTotal 以及其他直接调用 calculateFee 的结算路径。

适用范围：`src/domain/settlement.ts`

### 订单折扣按行金额汇总

discountOrder逐行计算折后金额，再使用Money汇总结果。

> 订单级折扣先遍历order.lines，以line.unitPrice.multiply(line.quantity)取得每行金额，再交给discountLine应用同一个percent，最后通过add与Money.fromCents(0)累计。不能先汇总原价再统一套折扣，否则不同数量或舍入结果可能与逐行优惠不一致。该做法适用于整单比例优惠、结算优惠试算及需要复核行级优惠金额的流程。

适用范围：`src/domain/settlement.ts`

### 结算行金额无隐式默认

SettlementLine 的金额字段必须显式赋值，禁止用零值掩盖缺失数据。

> 团队约定：创建 SettlementLine 时，grossCents、refundedCents、feeCents 与 payableCents 均为必填 number，不得依赖缺省值或运行时补零。缺失退款记录时应由业务查询后显式传入 refundedCents；没有手续费也仍需传 feeCents。这样可防止结算迁移、导入或重算时把缺失数据误判为真实零值。适用范围包括 createSettlement、settlementLine 及批量写入入口，读取方也不能擅自把 undefined 转成零。

适用范围：`src/domain/settlement.ts`

### 调用方不得修改已注册处理器

注册完成后只允许调用路由，不应改写handler或依赖注册返回值。

> registerDeliveryRoutes完成注册即结束，调用方不得修改RouteRegistry中的method、path或handler，也不得期待从void返回值取得路由副本。GET与POST处理器均闭包引用同一个DeliveryService，并直接返回service方法的结果，以保持请求处理路径确定；适用于应用初始化后配置已冻结的HTTP路由。

适用范围：`src/http/delivery-routes.ts`

### 写操作失败不承诺状态回滚

begin、succeed和reject路由只转发调用，失败后的状态一致性由DeliveryService负责。

> registerDeliveryRoutes中的begin、succeed和reject处理器不在HTTP层捕获异常或补偿状态，调用失败时不会伪造回滚结果。输入经objectInput与stringInput解析后交给DeliveryService，使失败位置集中在服务层统一处理；适用于新增delivery写操作且服务层已实现事务、幂等或补偿语义的接口。

适用范围：`src/http/delivery-routes.ts`

### 配置更新采用显式值集合

updateSettings 仅接收值集合并委托 merge，调用方负责准备合法输入。

> 调用 updateSettings 时，只传入 Record\<string, unknown> 形式的 values，并交由 SettingsStore.merge 执行合并；非法键、类型不匹配或越界值必须在调用前拦截。该约束适用于所有配置写入入口，避免把未校验数据带入 Settings，同时让错误由校验层以明确类型返回。

适用范围：`src/config/settings.ts`

### 库存读写绕过路由缓存

库存路由直接调用服务层，不在处理器内缓存易变库存结果。

> registerInventoryRoutes 的 GET /inventory 直接调用 service.list 并经 page 返回，POST /inventory/receive、/inventory/reserve 等写操作则调用对应 InventoryService 方法，处理器内不保存库存快照或失效标记。原因是库存数量和预留状态会频繁变化，路由级缓存容易返回过期数据；该规则适用于所有库存查询与变更接口。

适用范围：`src/http/inventory-routes.ts`

### 库存入口统一校验

所有库存请求先经objectInput及字段解析器，再进入InventoryService。

> registerInventoryRoutes 约定先以 objectInput(value) 或 objectInput(query) 确认请求体、查询参数为对象，再用 stringInput、integerInput、optionalString 提取字段；缺失、类型不符或数量格式错误应在进入 InventoryService 前按现有解析器约定报错。这样可阻止非法值进入 initialize、receive、reserve 等状态变更流程，并让 GET /inventory 的分页与仓库筛选采用一致的错误语义。

适用范围：`src/http/inventory-routes.ts`

### 库存数量缺省规则

receive与reserve缺省数量为1，initialize必须显式提供quantity。

> registerInventoryRoutes 对数量采用分级缺省：service.receive 与 service.reserve 的 quantity 通过 integerInput(input.quantity, 'quantity', 1) 读取，未传时取 1；service.initialize 使用 integerInput(input.quantity, 'quantity')，不提供缺省值，必须显式传入合法整数。原因是收货和预留支持最小单位操作，而初始化代表建立库存基线，隐式生成数量可能造成账实差异。新增同类接口时应沿用这一差异。

适用范围：`src/http/inventory-routes.ts`

### 批量通知必须设置上限

notifyMany 接收整个 events 数组，需在服务层限制批量规模并拒绝超限请求。

> registerNotificationRoutes 注册的批量 POST 路由会把 events 数组直接传入 NotificationService.notifyMany。团队约定 notifyMany 必须设置可配置的单批数量上限，并在超限时返回明确的容量错误或执行受控分片，不能先完整读取再长时间处理。这样可避免单请求占用过多内存、连接和通知通道配额，导致其他正常通知延迟。限制需覆盖同步调用与重试场景；分片时还应保留每个 event 的幂等标识。

适用范围：`src/http/notification-routes.ts`

### 订单列表保持双返回形态

GET /orders 仅在传入分页参数时包装分页结果。

> registerOrderRoutes 约定 GET /orders 的响应格式取决于请求参数：offset 与 limit 均未提供时，直接返回 service.list(filters(query)) 的数组；任一参数出现时，则使用 page(matched, pageQuery(query)) 返回分页对象。这样既兼容既有调用方读取数组，又为分页场景保留总数与数据容器，避免客户端因响应外壳变化而失效。该规则适用于订单列表接口及其消费方。

适用范围：`src/http/order-routes.ts`

### 订单接口沿用现有字段名

订单列表、导出与计数统一使用 filters 生成查询条件。

> registerOrderRoutes 中订单相关读取接口不得另造查询字段或序列化名称：列表、导出和计数均先由 objectInput(value) 得到 query，再交给 filters(query) 转换条件，并分别调用 service.list、service.exportRows 或 service.count。采用同一字段映射可保证三个入口的筛选语义一致，也使客户端能够复用订单查询参数，而不必按接口分别适配名称。该约定适用于新增订单读取路由及现有调用方。

适用范围：`src/http/order-routes.ts`

### 批量输入必须非空且有界

arrayInput 拒绝空数组及超过 maximum 的数组，异常沿用订单错误码。

> 凡通过 HTTP 接收集合参数，都必须调用 arrayInput 完成非空、数组类型和长度上限检查；maximum 默认值为 100，调用方可按接口收紧但不能省略边界。该约束用于控制批量处理规模，防止空批次触发无效工作或超大数组放大存储、日志与通知开销。校验失败时由 DomainError 抛出 ERROR_CODES.INVALID_ORDER，使路由无需为每类集合参数建立额外错误分支。

适用范围：`src/http/request.ts`

### 请求体必须是普通对象

objectInput 排除数组和空值，为历史请求解析建立统一入口。

> 订单相关请求体必须先经过 objectInput；该函数拒绝空值、非 object 类型以及数组，并返回 Record\<string, unknown> 作为后续字段解析的起点。采用这一边界可让历史接口明确区分对象请求与数组载荷，也避免用属性访问读取数组时产生含糊行为。校验失败统一抛出 DomainError，并沿用 ERROR_CODES.INVALID_ORDER。适用于迁移旧版本请求、解析 JSON 请求体以及任何需要读取具名字段的服务层入口。

适用范围：`src/http/request.ts`

### 时间逻辑必须注入时钟

订单、通知与审计模块禁止直接读取系统当前时间。

> 订单流程、通知派发与审计记录都包含时间语义，但 src/index.ts 仅负责 export，不能据此在实现中直接调用系统时钟。涉及 order、notification、audit、dispatcher 或 report 的代码应使用可注入的时间来源，测试时固定时钟验证排序、超时和审计时间戳。原因是隐式当前时间会导致重试、并发执行及历史回放结果不稳定；该规则适用于所有产生或比较时间的业务逻辑。

适用范围：整个项目

### 通知消息仅存内存

MemoryChannel 不提供跨进程持久化与历史兼容保证。

> MemoryChannel 只将 recipient、subject、body 写入当前进程内的 messages，进程退出后数据不会保留，也没有序列化格式可用于版本迁移。kind 仅标识通知渠道，不能充当持久化协议。使用 channelFor 获取的内存渠道适合本地开发、自动化测试和临时通知场景；若业务要求重启恢复、跨实例共享或审计留存，必须在接入真实渠道时另行定义存储格式与兼容策略。

适用范围：`src/notifications/channel.ts`

### kind 固定标识通道类别

通道类别由构造时确定，kind 不承担时间判断或动态路由职责。

> MemoryChannel.kind 在构造阶段赋值且声明为 readonly，表示同一通道实例的通知类别不可在运行期间切换。该字段只用于标识通道类型，不应承载发送时间、时钟比较或截止日期等动态状态；时间相关行为不能通过改写 kind 实现。需要按类别选择实现时，应使用 channelFor 等显式路由入口；适用于 MemoryChannel 实例化、通知分发分流及测试断言。

适用范围：`src/notifications/channel.ts`

### 通知事件输出使用隔离副本

events 复制事件与 data，防止调用方改动内部送达记录。

> NotificationDispatcher.events() 通过展开 delivered.values() 并映射新对象输出 NotificationEvent，同时为 event.data 再创建一层副本。调用方修改返回数组或嵌套 data 时，不会污染 NotificationDispatcher 内部状态。该约束适用于事件查询、序列化及向接口层传递通知数据，避免共享引用造成跨请求的数据串改。

适用范围：`src/notifications/dispatcher.ts`

### 事件查询必须使用原始标识

hasSent 按传入的事件标识查询 delivered，并返回布尔结果。

> NotificationDispatcher.hasSent 的查询键是调用方传入的 eventId，匹配范围限定在 delivered 中的事件标识。调用方应传入与 dispatch 接收事件时相同的标识，以确认该事件是否已由当前 NotificationDispatcher 记录；若标识格式不同，查询结果不能代表同一事件的状态。该方法只做集合成员判断，不检查事件载荷内容，也不执行任何发送动作。

适用范围：`src/notifications/dispatcher.ts`

### 复制消息时隔离data引用

copyMessage 深复制data，防止外部修改污染队列记录。

> 涉及 OutboxMessage 的隔离读取或快照时，统一通过 copyMessage 创建副本，并确保 data 也被复制，而不能只复制顶层对象。浅复制会让调用方修改 data 后影响 NotificationOutbox.values 中的原消息，造成审计内容与实际投递内容不一致。该规则适用于日志记录、返回值暴露和跨层传递消息的场景。

适用范围：`src/notifications/outbox.ts`

### values仅作为内部消息索引

NotificationOutbox.values 私有保存消息副本边界。

> NotificationOutbox.values 必须保持 private readonly，并以字符串 id 关联 OutboxMessage；对外暴露单条或列表数据时由队列负责生成副本。直接开放该 Map 会允许调用方绕过 enqueue、complete、fail 等状态流转，破坏消息生命周期。由于 Map 本身只约束引用不可重绑，调用边界仍需依赖 copyMessage 隔离 data。

适用范围：`src/notifications/outbox.ts`

### 完成通知仅接受投递态

complete 校验 delivering 状态并记录完成时间，重复完成会被拒绝。

> 通知发送成功后调用 NotificationOutbox.complete，将当前时间 now 写入 deliveredAt，并清空 lastError。该方法仅接受 state 为 delivering 的 OutboxMessage；尚未认领、已完成或已失败的消息都会触发 Error。这一约束用于阻止并发工作流互相覆盖结果，也要求调用方在完成前先通过 claim 取得投递权。

适用范围：`src/notifications/outbox.ts`

### fail仅允许投递态迁移

fail拒绝非delivering消息及非法maxAttempts，再依据重试上限决定迁移为pending或failed。

> NotificationOutbox.fail先通过get取得消息。仅当state为delivering且maxAttempts为正整数时，才允许记录失败：未达上限时将state置为pending，nextAttemptAt更新为retryAt，lastError写入error；达到上限则进入failed。否则应抛出Error，不得静默覆盖。此规则用于防止重复失败处理破坏状态机，适用于outbox消费确认、异常捕获及重试调度代码。

适用范围：`src/notifications/outbox.ts`

### 审计标签固定三字段

auditLabel 固定拼接动作、操作者和创建时间。

> 生成审计标签时，auditLabel 只按 action、actorId、createdAt 的顺序拼接，并保持三者之间使用冒号分隔；缺少任一 AuditEntry 字段时，调用方应先补齐事件信息，不应另造标签格式。固定结构便于按操作类型、责任主体和时间检索，也避免相同事件在不同模块产生不一致名称。该约定适用于服务层、通知与审计流程中的事件展示及索引命名。

适用范围：`src/security/audit-policy.ts`

### 订单导出权限的双重门槛

导出订单要求成员有效，且角色不能是 viewer。

> 调用 canExportOrders 时，必须同时满足 member.active 为真、member.role 不等于 'viewer'；任一条件不成立即返回 false，禁止仅凭角色放行。该约束用于订单数据导出入口，因为停用成员不应继续拥有访问能力，而 viewer 的职责仅限查看。canReadOrders 与 canRefundOrders 各自控制读取和退款，canManageMembers、canReadAudit 也不能替代导出授权。

适用范围：`src/security/permissions.ts`

### 审计时间统一由 now 注入

AuditService.now 必须作为统一时间源，便于测试与重试场景保持一致。

> AuditService 的 now 使用可注入的时钟函数，并为该属性声明 readonly，重试或重复执行审计流程时不得中途替换。构造时注入固定或可推进的时间源，可让同一批 AuditEntry 的 createdAt 保持可控顺序，避免系统时钟回拨造成审计记录时间错乱。该约束适用于 AuditService 的时间采集、测试替身以及需要按时间定位事件的调用链。

适用范围：`src/services/audit-service.ts`

### topics统一归一化主题

topics复用list查询结果，并去重、映射、排序后返回主题列表。

> 调用 AuditService.topics 时必须沿用 list 的查询条件处理单项与批量路径，再把每条记录的 action 交给 auditTopic 归一化。使用 Set 消除重复主题，并通过 sort 固定输出顺序，避免相同数据因插入顺序不同而返回不同结果。主题筛选若没有独立入口，也不得绕过 list 直接访问 store。

适用范围：`src/services/audit-service.ts`

### 失败重试由 policy 统一约束

DeliveryService 通过只读 policy 集中控制投递批次与失败策略，避免调用路径各自决定重试规则。

> DeliveryService 必须把批次上限、最大尝试次数等规则交给 DeliveryPolicy，并在执行链路中通过 policy 获取配置，不得在 ready、begin 或失败分支硬编码。原因是失败后的部分状态必须遵循同一策略，否则重试间隔、批次规模或终止条件会因入口不同而漂移。该约束适用于使用 DeliveryService 处理 OutboxMessage 的服务层调用。

适用范围：`src/services/delivery-service.ts`

### 成功回执统一取队列时间

succeed 必须使用 DeliveryService.now 固化完成时间。

> 团队约定 succeed 完成消息后，只能从 outbox.complete 返回的消息中取得 deliveredAt，并通过 now 注入服务时钟。禁止在 complete 之外再次读取系统时间，否则队列记录与 DeliveryReceipt 的 deliveredAt 可能出现细微偏差，破坏回执与审计记录的一致性。该规则适用于 DeliveryService 的成功投递回执生成，以及验证可注入时钟行为的单元测试。

适用范围：`src/services/delivery-service.ts`

### 失败原因与退避时间不可缺失

reject 拒绝空原因，并按 DeliveryPolicy 计算下一次重试。

> reject 必须先校验 reason.trim() 非空，空值立即抛出 Error，避免失败消息缺少可追踪的业务原因。退避时间以 current.attempts 为指数依据，由 initialDelay 计算后用 maximumDelay 封顶，再调用 fail 写入 nextAttemptAt；exhausted 由 failed.state 是否为 failed 决定。适用于 DeliveryService 处理投递失败、安排重试及判断消息耗尽的路径。

适用范围：`src/services/delivery-service.ts`

### 订单路由避免额外副作用

三个订单读取路由只查询并返回结果，不写日志。

> registerOrderRoutes 内的 GET handler 仅执行 objectInput、filters 以及 service.list、service.exportRows 或 service.count，没有日志写入、队列投递或审计调用。原因是查询响应应保持无副作用，避免重复请求制造额外记录；观测需求应由路由框架的通用机制承担，而非散落在订单处理器中。

适用范围：`src/http/order-routes.ts`

### 库存查询禁止隐式造零

stock 对缺失记录直接报错，不自动创建零库存项。

> stock 通过 getStock 按 warehouseId 与 sku 定位记录，未找到时抛出 Error('Stock not found')，不会返回默认 StockItem。该约束避免把“尚未初始化”和“真实零库存”混为一谈，也防止 receive 或 reserve 在错误数据上继续计算。查询、预留、入库及补偿流程都必须先明确记录是否存在；需要初始化的场景应显式创建 Stock，而不是依赖 stock 的隐式副作用。

适用范围：`src/services/inventory-service.ts`

### 预留读取必须显式失败

reservation 遇到缺失记录立即报错，禁止返回占位预留。

> reservation 只接受已持久化的预留：getReservation 返回记录时直接使用，未命中则抛出 Error('Reservation not found')。release 与 consume 都依赖 reservation 获取 quantity、warehouseId 和 sku；若读取方法返回占位 Reservation，后续库存扣减或释放将缺少可靠依据。该规则适用于所有按预留 ID 查询、取消和核销的路径，调用方应处理找不到记录的失败分支。

适用范围：`src/services/inventory-service.ts`

### InvoiceService 注入存储实现

InvoiceService 仅依赖 InvoiceStore 契约，不绑定具体存储。

> InvoiceService 通过 private readonly store 持有 InvoiceStore，并借助构造注入获得实现。该约定把服务层与订单、库存、结算等具体存储技术隔离，也便于测试替换数据来源并控制存储生命周期。InvoiceService 的新增用例应沿用该依赖边界；只有基础设施层负责选择 InvoiceStore 实现，业务服务不得读取数据库细节或自行创建存储实例。

适用范围：`src/services/invoice-service.ts`

### store 依赖支持可重放测试

MemberService 私有持有只读 store，使测试可替换持久化实现并复现相同结果。

> MemberService 的 store 必须保持 private readonly，并通过构造参数注入 MemberStore；测试可提供受控实现，固定成员数据与保存行为，从而重复执行创建、查询和停用流程。该约束让副作用集中到单一存储边界，避免测试直接修改真实数据；适用范围为 MemberService 单元测试、夹具搭建及缓存失效场景验证。

适用范围：`src/services/member-service.ts`

### 支付标识注入生成

PaymentService 统一通过 makeId 生成支付标识，调用方负责提供唯一性策略。

> PaymentService 不在类内直接创建标识，而是把 makeId 作为构造依赖，并在创建支付记录时调用它。该做法使生产环境可采用全局唯一生成策略，测试环境可注入稳定标识，从而验证 create、authorize 和 get 等流程。makeId 的返回值必须非空，并在同一存储范围内保持唯一；该约束仅适用于 PaymentService 创建支付记录时的标识生成，不替代 PaymentStore 对记录冲突的处理。

适用范围：`src/services/payment-service.ts`

### 布尔配置必须显式取值

settingBoolean 拒绝隐式转换并按类型选择配置。

> 团队约束布尔配置必须经由 settingBoolean(settings, key, fallback) 读取。函数只有在 settings\[key] 为 boolean 时返回配置本身，缺失、null、字符串或其他类型均返回 fallback。这样可避免服务层把非布尔值隐式当作开关，并确保 updateSettings 写入的配置符合声明类型。适用于功能开关及参数控制项；调用处应明确给出默认策略，不能用真假值混合类型绕过校验。

适用范围：`src/config/settings.ts`

### 退款存储依赖固定注入

RefundService 的 store 只读注入，边界输入由 OrderStore 负责处理。

> RefundService 必须始终持有 private readonly store: OrderStore，退款查询、创建和剩余金额判断统一通过该实例完成，不得在方法内临时替换存储实现。这样可隔离订单数据边界，避免 RefundFilters 对应的空集合或缺失记录被各业务方法采用不同规则处理，也便于测试使用同一 OrderStore 契约验证 create、list、remaining 与 canRefund 的行为。

适用范围：`src/services/refund-service.ts`

### 结算时间统一走 now

now 注入统一时间源，保证结算事件时间可测试。

> SettlementService 将 now 声明为返回 number 的只读依赖，并在 prepare、approve、pay 的领域转换前统一取值。团队不得在这些流程中直接调用 Date.now，否则测试难以固定 createdAt、approvedAt、paidAt，重放审计事件时也可能产生不一致；该规则适用于 SettlementBatch 的创建、审批与支付全过程。

适用范围：`src/services/settlement-service.ts`

### 审计记录迁移约束

AuditEntry 固定历史结构，迁移不得弱化既有字段类型。

> AuditEntry 是历史审计数据的持久化契约，迁移时必须保留 id、action、actorId、payload 和 createdAt，并维持 string、number 及 Record\<string, unknown> 的类型边界。createdAt 属于既有时间字段，不能因迁移改成另一种表示；payload 可容纳扩展属性，但其值仍按 unknown 处理。该约束适用于旧记录导入、存储格式迁移及新写入记录的兼容校验。

适用范围：`src/storage/audit-store.ts`

### clear 仅清空当前事件实例

EventStore.clear 通过截断 values 清空当前存储，不替换实例。

> 跨模块调用 EventStore.clear 时，约定只把 this.values.length 设为 0，保留同一个 EventStore 实例及其引用关系；调用方随后通过 count 或 latest 读取到空状态。该约定适用于隔离测试或重置当前内存事件集合的场景，不代表删除持久化数据，也不应被解释为其他存储实例同步清空。

适用范围：`src/storage/event-store.ts`

### 订单筛选参数边界

registerOrderRoutes 调用 filters 时，须拒绝非法状态、类型及倒置区间。

> 订单列表查询统一经 filters 转换输入：optionalString 只接受字符串，integerInput 只接受整数；status 仅允许 draft、paid、partially-refunded、refunded、cancelled。若同时给出 from 与 to，且 from 大于 to，立即以 Error 拒绝。该约束适用于 registerOrderRoutes 接收的订单筛选请求，可避免无效条件进入存储层并导致错误结果。

适用范围：`src/http/order-routes.ts`

### 库存写入须显式处理版本

putStock 用 expectedVersion 拒绝过期写入；空集合中的首次写入仍受版本语义约束。

> 通过 InventoryStore.putStock 写入库存时，调用方需明确是否传入 expectedVersion。传入后，current 不存在或 current.version 不匹配都会抛出“Inventory version conflict”，防止并发请求覆盖新状态；不传则允许无条件写入。空集合首次写入通常没有可比较的 current，因此仍应按业务需要传递版本策略，适用于库存更新、扣减及批量写入入口。

适用范围：`src/storage/inventory-store.ts`

### 库存列表保持稳定排序

stockList 按仓库与 SKU 形成可重复的持久化输出。

> InventoryStore.stockList 输出库存时先按 warehouseId 过滤，再使用 stockKey 组合仓库和 SKU 并排序，最后复制每个 StockItem。固定顺序避免相同库存因 Map 插入顺序不同而生成不同的持久化内容，降低快照、导出及回归比较的兼容成本。省略 warehouseId 时列出全部仓库；该格式约束适用于库存持久化、接口导出和测试断言。

适用范围：`src/storage/inventory-store.ts`

### 预约列表输出隔离副本

reservationList 支持按 orderId 筛选，且不暴露内部对象。

> InventoryStore.reservationList 在未传 orderId 时返回全部预约，传入后仅保留 item.orderId 与参数匹配的记录；结果统一通过 map 展开副本，防止调用方修改列表元素后直接改变 this.reservations 中的状态。适用于订单预约清点、审计查询和批量核对，筛选语义依赖 Reservation.orderId 字段保持一致。

适用范围：`src/storage/inventory-store.ts`

### 私有索引隔离发票数据

InvoiceStore.values 封装内部索引，禁止外部直接改写。

> InvoiceStore 的 values 使用 private readonly，并通过 Map 持有 Invoice 数据。原因是外部代码若能取得并直接操作该 Map，就可能绕过 save 的覆盖语义或 remove 的删除流程，使存储状态无法统一追踪。适用于 InvoiceStore 实例内部的数据管理；调用方只能使用公开方法访问发票，不得把 values 当作共享状态或绕过封装修改。

适用范围：`src/storage/invoice-store.ts`

### PaymentStore 缓存失效规则

PaymentStore 通过 values 缓存 Payment，写入操作后必须按既定失效策略同步更新。

> PaymentStore 将 Payment 集合保存在 values 缓存中，调用 save、clear 或 replace 后，需依据缓存与失效约定同步处理该 Map，避免读取端继续得到过期支付记录。get、all、byOrder、byState 与 count 都应基于当前 values 返回一致结果。仅适用于 PaymentStore 内部缓存读写及相关查询，不扩展到其他存储实现。

适用范围：`src/storage/payment-store.ts`

### save 采用同步写入约定

PaymentStore.save 同步落内存并返回对象，不承担异步队列职责。

> 团队约定调用 PaymentStore.save 时，调用方必须等待其返回后再继续支付流程，并把返回的 Payment 作为本次写入结果。该方法同步更新 PaymentStore.values，不负责通知投递、审计落盘或结算任务；需要这些副作用时，由对应业务服务在保存成功后编排执行。这样可明确内存提交与异步副作用的边界，避免调用方误以为 save 已完成后续处理，适用于订单支付创建与本地状态更新。

适用范围：`src/storage/payment-store.ts`

### copyBatch 需复制明细行

copyBatch 同时复制批次和 lines，避免嵌套数组被外部修改。

> copyBatch 不能只展开 SettlementBatch 顶层字段，还必须对 value.lines 执行 map，并逐项复制每个 line。原因是浅层展开仍会共享 lines 数组及其元素，调用方 push 或改写行数据时会污染 SettlementStore 的内部状态。批量列表与单项读取都依赖该函数形成独立结果；新增嵌套财务字段时，也须在 copyBatch 中建立对应隔离。

适用范围：`src/storage/settlement-store.ts`

### 配置快照读取规则

settingsSnapshot 通过 SettingsStore.read 获取当前配置。

> 团队约定需要观察当前配置状态的调用方使用 settingsSnapshot(store)，由该函数统一调用 store.read() 并返回 Settings。不要在服务层或路由中自行访问 SettingsStore，以避免各层取得配置的时机和来源不一致。该规则适用于配置校验、启动后状态判断及请求处理前的配置读取；需要改变快照来源时，应调整 SettingsStore.read 与 loadSettings 的职责边界。

适用范围：`src/config/settings.ts`

### 限定重试次数边界

retryLimited 以 limit 限制尝试次数，达到上限后原样抛出异常。

> retryLimited 只在 attempt 小于 limit 时调用 operation，每次失败先将 attempt 加一；达到 limit 后使用 throw error 保留原始异常，不再进入循环。该设计为调用方提供明确的重试边界，避免请求无限占用服务资源。适用于需要固定尝试次数的远程调用或批处理任务；传入的 limit 应结合 retryBudget 与业务超时设定，且重试对象仍需具备幂等性或使用 isTransient 排除不可恢复错误。

适用范围：`src/utils/retry.ts`

## 风险

### Money 使用整数分

Money 内部使用整数分保存金额，构造和加减操作都返回新对象

> Money 内部使用整数分保存金额，构造和加减操作都返回新对象。序列化时再转换为接口字段。这个规则适用于金额领域。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/domain/money.ts`

### 发票金额通过领域函数计算

发票服务通过 invoiceTotal 计算行金额总计

> 发票服务通过 invoiceTotal 计算行金额总计。对外导出使用 totalCents，发票标识由调用方提供。该规则适用于发票服务。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/services/invoice-service.ts`

### 审计最新记录倒序返回

latest 从数组尾部取得记录并倒序返回

> latest 从数组尾部取得记录并倒序返回。all 保留原始写入顺序，两种查询需要根据界面需求选择。该规则适用于审计查询。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/storage/audit-store.ts`

### 订单报告使用退款后余额

订单报告同时输出总金额和退款金额

> 订单报告同时输出总金额和退款金额。收入统计使用两者相减。该规则适用于报表。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/reports/order-report.ts`

### 批次总额按结算行计算

结算批次总额由每一条结算行求和

> 结算批次总额由每一条结算行求和。金额仍然使用整数分。这个规则适用于结算领域。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/domain/settlement.ts`

### 事件标识必须唯一

EventStore 拒绝重复事件标识

> EventStore 拒绝重复事件标识。读取操作返回复制后的 payload。这个规则适用于事件存储。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/storage/event-store.ts`

### 仓库调拨要求来源和目标不同

调拨接口拒绝相同仓库标识

> 调拨接口拒绝相同仓库标识。库存变化需要同时写入来源和目标。该规则适用于库存服务。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/services/inventory-service.ts`

### ReserveInput 入参防篡改

ReserveInput 仅承载标量请求字段，调用方不应依赖对象后续可变。

> ReserveInput 应保持标量字段结构，传入后不要由服务层修改 quantity、sku 或 orderId。外部调用方若复用并改写对象，可能让预留意图与记录不一致，因此请求边界应复制输入并校验数量。

适用范围：`src/services/inventory-service.ts`

### 订单计数须校验筛选条件

OrderService.count 应拒绝无效筛选条件，避免将异常输入解释为有效订单集合。

> OrderService.count 调用 this.list(filters) 前，应先按 OrderFilters 的约束检查 filters；筛选条件无效时直接拒绝，不返回基于 list 结果推导的数量。这样可避免错误条件被静默接受，并让订单统计接口与列表接口保持一致的适用范围。

适用范围：`src/services/order-service.ts`

### version 标记库存版本

StockItem.version 用于识别库存记录是否仍符合写入方预期。

> StockItem.version 是库存记录的版本标识，变更库存时应随记录一起更新，不能沿用旧值。原因是 putStock 可借助 expectedVersion 拒绝过期写入；该规则适用于 createStock、receiveStock、reserveStock 与 releaseStock 等库存变更场景。

适用范围：`src/domain/inventory.ts`

### 预留缓存存在陈旧风险

reservations 是进程内缓存，多实例间可能不同步。

> InventoryStore.reservations 使用 Map 保存 Reservation，实例内更新快，但多进程或重启后可能缺少其他实例写入的记录；依赖最新预留状态时必须确认缓存同步策略，不能把 Map 查询当作全局一致结果。

适用范围：`src/storage/inventory-store.ts`

### stockList 返回稳定副本

库存列表按固定顺序输出，并隔离内部对象。

> InventoryStore.stockList 必须按 stockKey 排序后返回库存副本，避免调用方依赖 Map 的插入顺序；省略 warehouseId 时列出全部仓库。该规则适用于夹具比对、库存清单导出和可重复的测试数据读取。

适用范围：`src/storage/inventory-store.ts`

### quantity 仅接受正安全整数

数量函数拦截零值、负数及非安全整数。

> quantity 只允许大于零且可由 Number.isSafeInteger 确认的 value，其他输入抛出 Error。该规则适用于 reserveStock、releaseStock 等库存数量变更入口，使非法数量不能进入库存计算。

适用范围：`src/domain/inventory.ts`

### 初始库存拒绝越界数值

createStock 仅接受非负安全整数 amount。

> createStock 必须用 Number.isSafeInteger 检查 amount，并拒绝负数及超出安全整数范围的值。这样可避免后续加减产生精度丢失或非法负库存，约束适用于 InventoryService.initialize 新建 StockItem 时的初始数量。

适用范围：`src/domain/inventory.ts`

### 审计记录拒绝空参与方

AuditService.record 在构造条目前校验 action 与 actorId。

> AuditService.record 遇到空 action 或 actorId 必须抛出 Error，不调用 AuditStore.append；适用于所有新建审计记录以及统计入口间接触发记录的场景。

适用范围：`src/services/audit-service.ts`

### 审计条目字段不可省略

AuditEntry 必须完整携带追踪、载荷与时间信息。

> AuditEntry 必须包含 id、action、actorId、payload、createdAt，不能省略追踪维度；适用于 AuditService.record 生成条目及 AuditStore 接收和保存条目的过程。

适用范围：`src/storage/audit-store.ts`

### 审计查询应拒绝矛盾区间

AuditQuery 的起止范围若同时提供，必须满足先后顺序。

> AuditQuery 允许 action、actorId、from 与 to 独立缺省，但 from 和 to 同时出现时不得形成倒置区间；AuditService 应在查询前判定其先后关系并拒绝矛盾条件，避免无效范围被静默接受。该规则适用于所有使用 AuditQuery 的列表与筛选入口，边界值仍按调用方传入的数据处理。

适用范围：`src/services/audit-service.ts`

### 审计容器存在并发可见性风险

AuditStore.values 由写操作与读操作共享，异步并发时需关注读取时序。

> AuditStore.values 接收 AuditEntry，而 all、byAction 和 latest 都从同一容器读取。若多个异步流程同时调用 append 与查询，结果可能只反映某个执行时点，不能把一次读取视作全局一致的审计快照。需要稳定视图时，应先固定事件边界再调用查询方法。

适用范围：`src/storage/audit-store.ts`

### append 返回原条目引用

AuditStore.append 保存副本，但返回传入的 entry 引用。

> AuditStore.append 先把 entry 复制进 values，随后仍返回原 entry。调用方若在写入后继续修改该对象，存储副本不会同步变化，却可能因返回值而误以为修改已经生效。需要写入后保持稳定状态时，应直接采用 append 返回值，不再改写原 entry。

适用范围：`src/storage/audit-store.ts`

### 成员审计路由须绑定固定处理器

registerMemberAuditRoute 应将成员列表请求交给指定服务。

> registerMemberAuditRoute 注册 /members/audit 时，应让 GET handler 始终调用当前 MemberService 实例的 list，并明确 method 为 GET。若后续替换注册流程，必须保留这一绑定关系，避免路由落入其他处理器或绕过成员权限检查。该规则适用于该函数注册的成员查询入口及新增同类路由时的注册审查。

适用范围：`src/http/member-routes.ts`

### Template 数据须适配字符串上下文

Template.render 的输入限定为字符串映射，避免隐式类型转换造成内容偏差。

> Template.render 接收 Record\<string, string> 类型的 data，模板变量应先转换为字符串再传入。这样可避免数字、布尔值等值在渲染阶段产生不一致结果，并让模板输出便于检查。该约束适用于 templates 中的所有模板定义及其调用方；新增模板时也必须遵守 data 的键和值均为字符串的边界。

适用范围：`src/notifications/templates.ts`

### 同步派发无重试等待

dispatch 不提供异步确认或失败重试能力。

> NotificationDispatcher.dispatch 在调用内立即记录事件并返回结果，没有队列等待、回执确认或失败重试机制。若业务依赖送达确认，应交给后续投递流程处理；该风险适用于把 dispatch 的返回值误当作最终送达结果的场景。

适用范围：`src/notifications/dispatcher.ts`

### 发件箱仅由投递服务持有

DeliveryService 私有持有 NotificationOutbox，其他模块不得绕过服务直接写入。

> DeliveryService 的 outbox 必须保持 private readonly，其他组件不得绕过投递服务直接操作 NotificationOutbox。该规则适用于状态写入与批量投递边界，可避免队列变更绕过统一校验和执行流程。

适用范围：`src/services/delivery-service.ts`

### 同步通知结果需截断

notify 返回有限结果，调用方不得依赖完整投递明细。

> NotificationService.notify 接收 NotificationEvent 后只返回 delivered 与 eventId，不应承诺携带收件人明细、错误堆栈或队列状态。该接口适用于同步调用方做完成判断与事件关联；若业务需要详细结果，应另行读取 DeliveryReceipt，避免响应体随投递规模增长。

适用范围：`src/services/notification-service.ts`

### latest 返回内部事件引用

EventStore.latest 直接暴露内部事件对象，调用方修改会影响后续读取。

> EventStore.latest 返回 values 中的原始 EventRecord，并未像 all 那样复制事件及其 payload。调用方若修改返回对象的字段或嵌套 payload，后续 latest 可能读到变更结果。该风险适用于需要把最新事件交给其他模块继续处理的场景。

适用范围：`src/storage/event-store.ts`

### 订单筛选须拒绝倒置区间

filters 在同时收到 from 与 to 时必须检查先后顺序，并仅接受已定义状态。

> filters 构造 OrderFilters 时，应逐项处理 memberId、status、from 与 to；status 仅允许 draft、paid、partially-refunded、refunded、cancelled，且 from 大于 to 时抛出 Error。这样可防止订单列表落入空区间或非法状态查询，适用于 registerOrderRoutes 接收列表筛选参数的入口。

适用范围：`src/http/order-routes.ts`

### 取消操作缺少版本校验

cancelOrder 仅检查状态，未验证订单版本，可能覆盖并发更新。

> cancelOrder 会基于传入 Order 直接生成 status 为 cancelled 的新对象，但没有比较版本或重新读取订单。若两个流程同时处理同一订单，后写入结果可能覆盖另一方的 internalNotes；涉及并发取消时应先锁定订单并确认状态仍可变更，再执行该函数。

适用范围：`src/workflow/order-workflow.ts`

### 显示名裁剪须保留空白

sanitizeDisplayName 应去除首尾空白，并限制展示长度。

> 调用 sanitizeDisplayName 处理展示名时，应先使用 trim 去除首尾空白，再通过 slice 将长度限制在 80 个字符以内。若缺少 trim，相同显示名可能因不可见空格形成不同结果，影响 canActAs、isSameIdentity 或 identityKey 的比较。该规则仅约束展示名净化，不涉及其他身份字段。

适用范围：`src/security/identity.ts`

### 导出批次字段保持精简

exportRows 仅输出批次标识、账户、状态和金额，不携带完整结算明细。

> SettlementService.exportRows 输出时应只保留 id、accountId、state 与结算金额等汇总字段，避免把 lines 全量展开到导出结果。这样可控制响应体积并降低订单明细泄露风险，适用范围是结算导出接口及其调用方。

适用范围：`src/services/settlement-service.ts`

### 结算金额字段保持分单位

SettlementLine 的金额均以 cents 表示，禁止直接写入浮点金额。

> SettlementLine 中 grossCents、refundedCents、feeCents 与 payableCents 必须使用整数分值，并保持 currency 为 CNY。原因是浮点计算容易产生舍入偏差，统一分单位才能让 settlementTotal 和后续汇总稳定，适用范围为结算行创建、计算及持久化。

适用范围：`src/domain/settlement.ts`

### 报表金额字段使用整数分

OrderReportRow 的金额字段均采用 cents 数值，导出时不得改成元。

> OrderReportRow 的 totalCents 与 refundedCents 必须保持整数分值，toReportRow 和 toCsv 不应在转换过程中除以 100 或格式化为浮点数。这样 CSV 消费方能无损计算 totalRevenue，也避免二次舍入，适用范围为订单报表构建与导出。

适用范围：`src/reports/order-report.ts`

### prepare 仅采样一次时钟

SettlementService.prepare 每次批次创建只调用一次 now。

> SettlementService.prepare 应将 this.now() 的单次结果传给 createSettlement，不应在生成 lines 前后重复读取时钟，也不得按订单分别取时间。否则同一批次可能出现不一致的创建时间，测试也会难以重放，适用范围为 prepare 的批次创建路径。

适用范围：`src/services/settlement-service.ts`

### 结算行仅接纳已支付订单

settlementLine 拒绝未完成支付的订单，避免不可结算状态进入账务明细。

> settlementLine 仅接受 status 为 paid、partially-refunded、refunded 的 Order，其他状态抛出 Error。生成 SettlementLine 时，账务金额只能基于已发生支付或退款的订单计算，以防止草稿、取消等订单提前进入 settlementTotal 与应付金额统计。

适用范围：`src/domain/settlement.ts`

### 报表夹具须可重放

buildReport 的测试输入应固定，避免依赖环境状态。

> 验证 buildReport 时应使用内容固定的 Order\[] 夹具，并逐项核对生成的 OrderReportRow。这样测试结果不会受外部数据变动或执行顺序影响；该规则适用于报告构建、导出前字段核对及回归测试。

适用范围：`src/reports/order-report.ts`

### StockItem 缓存失效约束

库存缓存必须按 sku 与 warehouseId 定位，并在写操作后基于 version 失效。

> 缓存 StockItem 时以 sku 和 warehouseId 组成唯一键，读取结果需携带 version。任何 createStock、reserveStock、releaseStock、consumeStock、receiveStock 或 changeReservation 成功后，都必须使对应键下的旧版本缓存失效，并在回填时确认 version 未变化。这样可避免并发写入期间继续返回过期的 available 或 reserved；该约束适用于库存服务、HTTP 路由读取缓存以及跨实例发布失效通知的场景。

适用范围：`src/domain/inventory.ts`

### 发票状态禁止任意扩展

InvoiceStatus 仅允许四个枚举值，重试时必须复用既有状态语义。

> InvoiceStatus 只允许 open、issued、paid、void 四个值，服务层与存储层不得写入其他状态。重试回调若收到未知状态，应按失败处理并保留原发票，而不是退化为 open；这样可避免已付款发票被重复开票。适用于 createInvoice、issueInvoice、markInvoicePaid、voidInvoice 及任何状态落库入口。

适用范围：`src/domain/invoice.ts`

### Money 序列化固定使用 cents

Money.toJSON 只输出 cents，避免金额字段在不同接口中出现不稳定命名。

> 团队规定 Money 对外序列化时统一采用 toJSON 返回的 cents 字段，不直接把 toMajor 产生的元单位小数作为接口金额表示。这样可避免调用方把 10 与 10.00 混为一谈，也能减少存储键名在不同路由中的漂移。适用范围是订单金额、库存金额、结算金额及审计记录的 JSON 输出；读取 Money 时应使用 parseMoney 兼容约定。

适用范围：`src/domain/money.ts`

### 订单状态流转须成对校验

OrderStatus 的异步更新必须按合法相邻迁移执行，防止退款与取消任务竞态。

> 任何异步等待、队列消费或补偿任务修改 OrderStatus 时，均须先校验当前状态符合允许的相邻迁移，再写入新状态；不得从 draft、paid、partially-refunded、refunded 或 cancelled 任意跳转。订单结算、库存释放和通知可能由不同队列并发处理，非法跳转会导致重复退款或已取消订单继续履约。该规则适用于 createOrder、applyRefund 及订单状态持久化入口；重试消息还须依据当前 Order 状态决定是否继续处理。

适用范围：`src/domain/order.ts`

### 结算总额按分累加

历史结算总额必须按行项目 payableCents 求和，避免金额迁移口径变化。

> 团队约定：生成或迁移结算批次时，总额统一调用 settlementTotal，并依据每条 SettlementLine.payableCents，使用 Money.fromCents 转换后通过 add 累加。不得直接汇总 grossCents、feeCents 或 refundedCents，以免遗漏退款、费用口径；Money 可保持金额精度。迁移程序不得使用浮点加法或只累计原始订单金额。适用于 createSettlement、approveSettlement、paySettlement 及历史数据校验。

适用范围：`src/domain/settlement.ts`

### 库存数量默认值的分层含义

收货和预留的缺省数量由路由层设为 1。

> receive 与 reserve 路由调用 integerInput 时将 quantity 的缺省值设为 1，而 initialize 使用的 integerInput 未提供该默认值。原因是前者允许调用方省略数量并表达一次最小操作，后者必须明确给出初始数量。若库存服务已有不同语义，应同步调整 registerInventoryRoutes 中的解析参数，不能只改其中一条路由。

适用范围：`src/http/inventory-routes.ts`

### 已取消订单才允许重开

reopenOrder 拒绝把非 cancelled 订单恢复为 draft。

> 团队约定：调用 reopenOrder 前必须确认 order.status 为 cancelled，否则函数会抛出 Error，订单保持原状态。成功后通过对象展开生成新的 Order，并将其 status 改为 draft。该限制用于防止已支付、已退款或仍在处理中的订单绕过正常流程重新进入草稿态，适用于订单工作流中的重开操作。

适用范围：`src/workflow/order-workflow.ts`

### prepare 缺少结算可观测信息

prepare 未记录批次关键上下文，故障定位依赖补充埋点。

> 风险：`SettlementService.prepare` 仅将 `orders` 转为 `lines`、创建 `SettlementBatch` 并调用 `store.create`，没有输出可关联的结算上下文。若创建失败或结果异常，仅凭现有日志难以确认涉及哪些 `accountId`、`feeBasisPoints` 及订单范围。适用范围：`SettlementService` 的结算准备入口；需在不暴露订单明细的前提下补充批次级日志或追踪字段。

适用范围：`src/services/settlement-service.ts`

### 收入汇总需区分退款

totalRevenue 按订单净收入汇总，退款金额必须从订单总额中扣除。

> 订单报表的收入口径以 totalRevenue 的计算结果为准：逐行累加 row.totalCents，并扣除 row.refundedCents，不能直接把总订单金额当作已实现收入。该规则适用于订单报表的汇总指标及由其派生的展示；调用 buildReport 后生成 OrderReportRow 时，需要保证退款金额已准确写入，避免汇总结果高估。

适用范围：`src/reports/order-report.ts`

### 批量订单读取须区分成员状态

canReadOrders 仅依据 Member.active 授权，新增批量入口不能绕过该判定。

> canReadOrders 当前以 member.active 作为订单读取的唯一门槛，批量与单项读取必须采用同一规则。否则，单条查询若逐项复用 canReadOrders，而批量接口只检查角色或登录态，就可能出现停用成员仍可读取部分订单的情况。风险范围覆盖订单列表、详情及后续批量查询；新增路径时，应让每个 Member 都经过 canReadOrders，并明确空集合与无匹配结果的响应边界。

适用范围：`src/security/permissions.ts`

### reject 必须提供失败原因

reject 拒绝空原因，并用指数退避计算下一次投递时间。

> DeliveryService.reject 先检查 reason.trim()；结果为空时立即抛出 Error，避免失败记录缺少可诊断原因。随后依据 current.attempts 计算 delay，以 initialDelay 的二次幂增长并由 maximumDelay 封顶，再调用 outbox.fail 写入下一次尝试时间。返回的 DeliveryFailure 通过 exhausted 表明是否耗尽 maxAttempts。适用于投递失败登记；调用方应传入非空原因，并区分可重试延迟与最终失败。

适用范围：`src/services/delivery-service.ts`

### 健康检查不依赖当前时间

health 只汇总 outbox 状态和耗尽消息，不读取时钟。

> 团队约定 health 用于暴露投递队列的即时健康快照，调用时不得引入当前时间，也不计算未来可重试消息。实现仅合并 outbox.counts 返回的 pending、delivering、delivered、failed，并将 list('failed') 的消息编号排序为 exhaustedIds。这样可避免同一时刻因系统时钟漂移得到不同结论，适用于 DeliveryService 的监控探针、存活检查和运行状态展示。

适用范围：`src/services/delivery-service.ts`

### 缺失结算批次直接报错

get 对不存在的结算记录抛出异常，避免调用方继续处理空数据。

> SettlementService.get 从 this.store.get 取得 SettlementBatch；记录不存在时立即抛出 Error，而不是返回 undefined。该约定适用于所有依赖结算批次的跨模块调用，使缺失记录成为明确失败，防止空对象进入 prepare、approve 或 pay 流程，也避免调用方误判一个不存在的批次。

适用范围：`src/services/settlement-service.ts`

### 预留列表不做权限裁剪

reservationList 仅按 orderId 过滤，访问控制须由上层执行。

> InventoryStore.reservationList(orderId) 只实现数据筛选：orderId 未定义时返回全部预留，指定时保留 item.orderId 相等的记录。它不会判断调用者是否有权查看这些订单，因此 HTTP 路由或应用服务必须先完成身份与订单权限校验，再决定是否传入 orderId。该限制适用于管理员查询和按订单查询两类入口，避免将展示层授权误认为存储层能力。

适用范围：`src/storage/inventory-store.ts`

### MemberStore仅适合进程内存储

内存实现不具备跨进程持久化和历史兼容能力。

> MemberStore 使用 Map\<string, Member> 保存成员，数据只存在于当前进程内，进程退出或实例重建后即丢失，也无法在多个服务实例间共享。团队不得把 MemberStore 当作生产环境的持久化层；若需要恢复历史数据、审计变更或保证多实例一致，应改用具备明确序列化格式与迁移策略的外部存储。该限制适用于开发环境、单元测试及临时缓存，不适用于需要可靠落盘的业务数据。

适用范围：`src/storage/member-store.ts`

### OrderStore 不提供幂等保障

内存存储重复保存会覆盖原记录，无法识别重复请求。

> OrderStore.save 使用 order.id 作为 Map 的键，同一订单再次保存会直接覆盖已有 Order，存储层不会判断请求是否已处理，也没有保存执行次数或结果。因此上游重试若再次调用 save，可能改写原订单状态且无法据此识别重复请求。适用于依赖 OrderStore 持久化订单并需要重试幂等语义的调用链；相关保障必须由明确接受重复写入的边界层另行承担。

适用范围：`src/storage/order-store.ts`

### 错误码类型随常量收敛

ErrorCode 由 ERROR_CODES 推导，类型扩展与错误目录保持同一来源。

> ErrorCode 必须继续通过 typeof ERROR_CODES 和 keyof 推导，禁止另建手写字符串联合类型。原因是业务目录会随失败场景增加，重复维护两套定义容易造成编译通过但运行时无法匹配，或遗漏新错误码。适用范围是领域层与服务层共享的错误契约；调整 ERROR_CODES 时应检查 ErrorCode 的所有消费分支。

适用范围：`src/domain/errors.ts`

### 预约标识唯一性风险

Reservation.id 必须全局唯一，禁止用订单号或库存键直接替代。

> 风险在于 Reservation.id 若按 orderId、warehouseId、sku 拼接或复用，同一订单多次预约会共享标识，changeReservation 可能定位到错误记录，进而影响 releaseStock、consumeStock 的结果。团队要求生成 Reservation 时先获得全局唯一 id，并在创建后核对唯一性；orderId 仅用于追溯关联，不能充当预约主键。规则覆盖 reserveStock 返回值及其持久化、查询和状态变更入口。

适用范围：`src/domain/inventory.ts`

### 账户余额缺少输入防护

balance 直接过滤并归约账目，异常账户或非法金额可能使结果失真。

> 风险点在于 balance 接受任意 entries 与 account，并通过 filter、reduce 累加 debit、credit；它未显式校验账目集合、账户标识及 Money 数值是否合法。若输入包含非法金额或重复记录，返回余额可能失真，而调用方难以区分真实余额与脏数据。适用于依赖账户余额展示、结算校验或账实核对的服务流程；写入层应保证 LedgerEntry 合法，并在批处理前做完整性检查。

适用范围：`src/domain/ledger.ts`

### 金额相减禁止缺省处理

Money.subtract 依赖显式 other，负结果会由 Money 构造器拒绝。

> 团队风险规则要求调用 Money.subtract 时始终提供明确的 other，不能把缺失值默认为零，也不能在结果为负时自行吞掉错误。Money 构造器会拒绝负数，因此余额扣减、库存金额核销等场景应在调用前确认 other 不大于当前金额。适用范围覆盖订单退款、库存占用释放和结算差额计算；缺少对手金额时应中止流程，而非补默认值。

适用范围：`src/domain/money.ts`

### 发送计数以接收集合为准

sentCount 读取 delivered 的元素数量，作为当前发送统计值。

> NotificationDispatcher.sentCount 直接返回 delivered.size，以集合中已保存的事件数量表示发送计数。该口径包含被 dispatch 接收并记录的事件，不等同于外部通道实际完成发送的次数，因此只适合衡量 NotificationDispatcher 接收阶段的结果。若统计口径必须代表最终送达数量，应由独立状态记录提供，不能把 sentCount 的结果解释成投递成功率。

适用范围：`src/notifications/dispatcher.ts`

### 支付模型限制跨层边界

Payment 聚焦支付事实，路由与存储实现不得侵入领域接口。

> Payment 只保留支付聚合所需的 orderId、amount、state、provider、attempts 等领域数据，不承载 HTTP 路径、查询参数或存储适配细节。路由层负责解析请求，工作区层负责文件与资源边界；二者不得为方便传参而扩展 Payment。这样可避免领域对象与具体工作区耦合，并使 createPayment 及后续状态操作保持可复用。

适用范围：`src/domain/payment.ts`

### 收据查询允许空结果边界

receipts在无匹配记录时应返回空分页结果，而非把边界判断推给调用方。

> GET /delivery/receipts使用optionalString读取recipient，并将结果交给service.receipts后由page封装。recipient缺失时可按无筛选条件查询；查询不到记录时应返回结构完整但items为空的分页对象，不能因空集合报异常；适用于收据检索、翻页接口以及调用方依赖稳定分页结构的场景。

适用范围：`src/http/delivery-routes.ts`

### 读取配置必须走统一入口

通过 loadSettings 统一读取，避免各模块直接访问 SettingsStore。

> 配置读取统一调用 loadSettings，由该函数委托 SettingsStore.read 返回 Settings；业务层不得自行拼装或缓存另一份配置。这样可让读取入口、返回类型与后续 updateSettings 的数据边界保持一致，适用于服务层、HTTP 路由及领域模型中所有需要配置的场景。

适用范围：`src/config/settings.ts`

### 库存查询必须分页截断

库存列表经分页处理，避免无界读取占用过多资源。

> registerInventoryRoutes 注册的 GET /inventory 路由必须把 service.list(warehouseId) 的结果交给 page，并同时传入 pageQuery(query)。这样列表响应受分页参数约束，而不是直接返回全部库存记录，原因是仓库和 SKU 数量可能持续增长，无界读取会放大存储与传输开销。规则适用于库存列表查询；新增其他集合读取接口时也应沿用 page 与 pageQuery 的组合。

适用范围：`src/http/inventory-routes.ts`

### 列表返回值需隔离变更

GET /orders 返回 service.list 的结果时，调用方可变对象存在外泄风险。

> 当 /orders 未提供 offset 与 limit 时，handler 直接返回 service.list 的 matched。若 matched 暴露内部订单数组或可写对象，后续调用方可能修改其字段，影响后续请求、缓存内容或其他消费者；当前路径没有显式复制或冻结。排查类似问题时，应检查 OrderService.list 的对象所有权，并让路由返回副本或只读结果；分页分支经 page 返回时也需确认是否同样复制。

适用范围：`src/http/order-routes.ts`

### 筛选失败应保持结果全空

filters 遇到无效状态或区间时抛出异常，不返回部分筛选条件。

> filters 在构造 OrderFilters 期间会先写入 memberId 和 status，随后处理 from、to；若状态不在允许集合内，或区间顺序非法，便通过 throw 中止。此时 result 可能已经包含前序字段，但函数不会返回它，因此失败调用不得复用该对象继续查询。此约束适用于所有调用 filters 的订单列表、导出和计数入口，要求输入错误整体拒绝。

适用范围：`src/http/order-routes.ts`

### 边界筛选不得误伤空结果

filters 接受单边日期边界，拒绝倒置区间但保留合法空集语义。

> filters 对 from 和 to 分别调用 integerInput，因此只提供其中一个边界是合法用法；两者同时存在时才检查 from 大于 to 并抛出 Error。传入能通过校验但没有任何订单的日期范围，不应被 filters 当作输入错误，而应由查询层返回空集合。该规则适用于订单列表、导出与计数筛选，测试需覆盖单边边界、相等边界和合法但无匹配数据的区间。

适用范围：`src/http/order-routes.ts`

### 支付列表边界交给服务层

可选 orderId 原样传给 service.list，避免路由层生成或裁剪查询结果。

> registerPaymentRoutes 的 GET /payments handler 将可选 orderId 原样传给 service.list，不自行判断空集合，也不对列表结果做默认填充。空订单条件、无匹配记录及正常结果应由 PaymentService 使用一致的业务边界处理，避免同一查询在不同入口出现语义差异。适用范围是支付列表路由及后续接入列表查询的实现。

适用范围：`src/http/payment-routes.ts`

### 分页响应固定字段契约

page 返回固定分页字段，新增字段须评估客户端兼容性。

> 分页响应统一由 page 生成，固定包含 items、total、offset、limit、nextOffset。后续游标必须读取 nextOffset，不得根据 offset 与 total 推导；末页 nextOffset 明确为 null，不能省略。函数使用 slice 截取当前页，并按实际 items.length 计算下一位置，适用于订单、库存等列表接口的 HTTP 序列化契约。若直接修改字段名称，旧客户端可能丢失游标或解析失败。

适用范围：`src/http/request.ts`

### 分页参数不承载资源生命周期

PageQuery 仅描述偏移和条数，不应加入连接、句柄等资源字段。

> PageQuery 的职责只有表达分页位置，限定为 offset 与 limit 两个 number 字段。它描述一次分页查询的输入，不负责数据库连接、流读取器或文件句柄的开启与关闭；这些资源应归存储层和路由生命周期管理。若把资源句柄加入 PageQuery，调用方容易把可复用参数误当作一次性资源，或在复制、缓存分页参数时持有无效引用。该边界适用于所有使用 pageQuery 解析分页输入的 HTTP 路由。

适用范围：`src/http/request.ts`

### 分页类型须做运行时校验

Page 的 TypeScript 类型不能替代运行时校验，外部数据须先解析后再进入分页逻辑。

> Page<T> 仅声明 items、total、offset、limit、nextOffset 的静态结构，TypeScript interface 无法证明 HTTP 请求或外部存储数据符合约定。外部输入须先经 pageQuery、integerInput 等函数验证；持久化读取的历史响应也应校验字段形状。否则字段缺失、类型错误或非法 nextOffset 可能穿透至排序与循环翻页代码。该规则适用于请求反序列化、缓存恢复及历史数据迁移等类型边界。

适用范围：`src/http/request.ts`

### stringInput 的必填字符串边界

跨模块入口只接收去除首尾空白后的非空字符串。

> 调用 stringInput 时，传入值必须是非空字符串；函数会通过 trim 去掉首尾空白，并用 name 标识失败字段。它统一抛出 DomainError，且错误码固定为 ERROR_CODES.INVALID_ORDER。该约定适用于 HTTP 请求参数及服务层接收的必填文本字段，可避免空字符串或带空白内容继续进入订单、库存和结算流程。

适用范围：`src/http/request.ts`

### optionalString 的缺省值约定

可选文本仅在缺省时返回 undefined，其余走严格校验。

> optionalString 接受 unknown 类型的输入；只有 value 为 undefined 时直接返回 undefined，其他值全部转交 stringInput 执行非空与 trim 校验。因此，null、空字符串及仅含空白的文本都不会被当作缺省值。该函数适用于 HTTP 查询参数和服务层可选说明字段，调用方必须区分“未提供”与“提供了无效文本”。

适用范围：`src/http/request.ts`

### RouteRegistry 防止重复注册

注册表以规范化方法与路径组成键，并在写入时拒绝重复路由。

> RouteRegistry.register 接收 Route 后，使用大写 method 与 path 组成唯一键；若 routes 已存在该键，立即抛出 Error，避免同一路由被静默覆盖。get 与 has 采用相同的大小写规范化规则，因此查询和注册结果一致。该约束适用于应用启动、测试装配及运行期动态注册场景；调用方应先处理注册失败，再继续启动服务，不能捕获重复注册错误后假定新路由已经生效。

适用范围：`src/http/route-registry.ts`

### 路由注册表仅保存内存状态

routes 是进程内 Map，重启后注册记录会全部丢失。

> RouteRegistry 的 routes 字段以 private readonly routes = new Map\<string, Route>() 保存当前进程中的路由，实例创建后不可替换该 Map。业务若把 RouteRegistry 当作路由配置的唯一来源，部署重启、实例切换或迁移到其他节点时，动态注册结果不会随历史数据自动恢复，流量可能因此找不到对应路由。该风险适用于依赖动态注册和跨实例共享路由的 R1 HTTP 场景；需在接入层确认路由是否另有持久化或启动重建机制。

适用范围：`src/http/route-registry.ts`

### 列表读取须隔离内部状态

NotificationOutbox.list 返回消息副本，避免调用方改动内部存储。

> NotificationOutbox.list 通过 filter 按 state 筛选 this.values 中的记录，再以 map 调用 copyMessage 返回独立对象。调用方即使修改返回项的 state 或内容，也不会污染 outbox 内部 values。列表查询、状态筛选及任何需要把消息交给后续处理流程的场景都应沿用该复制边界，不能直接把 values 中的对象暴露出去。

适用范围：`src/notifications/outbox.ts`

### 身份相等依赖唯一编号

isSameIdentity 仅按 Member.id 判断身份是否相同。

> isSameIdentity 将两个 Member 的 id 字段直接比较，因此调用方必须确保 id 在身份域内唯一且不会因展示信息或来源变化而重新生成。名称、租户、角色等属性即使不同，只要 id 相同，函数仍会判定为同一身份。适用范围包括登录态切换、代理操作校验和审计去重；接入方不能把昵称变化或记录缺失误当成新身份，也不能用该函数判断两个成员是否拥有相同权限。

适用范围：`src/security/identity.ts`

### 审计追加前必须校验输入

record 拒绝空白 action 与 actorId，避免无效事件污染审计存储。

> 调用 AuditService.record 时，action 和 actorId 都必须包含非空白内容，否则会抛出 Error，流程不会执行 store.append。原因是空操作名或空操作者会让后续按 action、actorId 检索审计事件时失去可信归属。此校验适用于所有通过 record 新增审计条目的业务入口，包括重试任务；payload 可为空对象，但操作身份不可缺失。

适用范围：`src/services/audit-service.ts`

### 审计输入仅抛普通 Error

空动作、空操作者和倒置区间会进入统一 Error 处理路径。

> AuditService.record 遇到空白 action 或 actorId 时抛出 Error，AuditService.list 在 from 大于 to 时也抛出 Error。当前类未定义专属错误类型，调用方不能依赖错误码或错误子类区分失败原因。接口层若需要返回可识别状态，必须先在调用边界捕获 Error，并把规则或事实映射到对外契约。

适用范围：`src/services/audit-service.ts`

### 投递队列由服务独占

outbox 必须保持私有只读，禁止外部直接修改队列。

> 团队约定 DeliveryService 的 outbox 只能通过 begin、succeed、reject 等服务方法间接操作。虽然字段声明为 private readonly，只能阻止直接替换引用，不能防止内部方法或其他类方法修改 NotificationOutbox；若将引用暴露给调用方，调用方可能绕开 DeliveryPolicy 的重试上限、延迟计算和状态迁移规则。该约束适用于所有读取 DeliveryService 队列状态的业务代码与测试替身边界。

适用范围：`src/services/delivery-service.ts`

### now 注入引发并发版本冲突

now 作为可注入时间源便于测试，但并发提交若使用不同时间值，可能造成 outbox 状态版本判断不一致。

> now 是 DeliveryService 持有的时间源，测试可注入固定值，生产环境需保证多个执行实例对同一 OutboxMessage 采用一致的版本判定依据。若并发写入分别取得不同 now，claim 或 complete 可能基于不同时间计算状态，导致重复领取或版本冲突。风险集中在 outbox 的并发更新路径，不影响仅使用 DeliveryReceipt 生成回执的读取场景。

适用范围：`src/services/delivery-service.ts`

### 业务时间注入影响重试

now 决定库存版本时间，跨重试不可随意漂移。

> InventoryService.now 是返回 number 的注入式时钟，用于初始化、预留、释放、消费和收货时生成业务时间。重试同一业务请求时若重新绑定 now，库存记录可能获得不同时间，从而削弱幂等判断并影响过期与审计追踪。规则适用于 InventoryService 生命周期及事务重试场景；固定时钟应由调用侧在一次请求重试期间复用，而不是每次尝试重新取值。

适用范围：`src/services/inventory-service.ts`

### 消费路径只按单项处理

consume 按预留数量扣减库存，不承担批量消费语义。

> consume 的现有契约是单项路径：reservation 取得一条预留，consumeStock 仅按 current.quantity 扣减对应仓库与 SKU，随后以 stock.version 执行 putStock，并将预留标记为 consumed。批量订单不能把多条预留合并后直接调用 consume，否则会遗漏逐条状态变更和各自的版本竞争。批量场景应在调用 consume 前完成逐项校验，并逐条处理失败结果。

适用范围：`src/services/inventory-service.ts`

### 入库测试须固定时钟

receive 依赖 now，测试需注入确定性时间以保证可重放。

> receive 每次计算 next 时都会调用 this.now()，因此夹具若使用真实系统时间，同一输入会生成不同时间戳，断言与重放结果将失去稳定性。测试 InventoryService 时应通过构造参数固定 now，让 receiveStock 获得可预测时间，并核对 current.version 与 putStock 写入结果。生产环境仍可使用默认时钟，但并发入库仍须依赖版本冲突识别重试。

适用范围：`src/services/inventory-service.ts`

### 支付存储顺序约束

PaymentService 依赖 PaymentStore 确定支付记录的写入与读取边界。

> PaymentService 通过 store 保存和替换支付记录，后续的 get、list 及状态变更都依赖同一存储抽象提供已提交数据。写入方应先完成 store.save 或 store.replace，再向调用方返回结果；读取方不得假设尚未提交的支付已进入 store。该约束适用于 PaymentService 的创建、授权、扣款、失败、退款及查询路径，用于避免写入顺序与读取顺序不一致造成记录缺失或状态误判。

适用范围：`src/services/payment-service.ts`

### 订单收入边界风险

orderRevenue 对空数组安全，但逐单净额仍受金额与退款口径影响。

> orderRevenue 使用 reduce 的初始值 0，因此传入空 Order\[] 会返回 0，不会出现空集合异常；但每笔结果由 orderTotal(order).cents 减去 refundTotal(order).cents 得出，退款口径或金额精度与订单口径不一致时，累计值可能失真。测试该方法必须覆盖空数组、无退款订单、全额退款订单和部分退款订单，并固定 cents，避免把退款后净额误当作已确认收入。

适用范围：`src/services/report-service.ts`

### 结算标识生成必须可替换

makeId 由构造参数注入，避免服务绑定全局 ID 规则。

> SettlementService 不在 prepare 内固定生成结算编号，而是通过 makeId 获取字符串标识。调用方可注入全局唯一实现、测试序列或兼容旧系统的编号策略，避免同一规则散落在路由与存储代码中；该约束适用于 createSettlement 创建 SettlementBatch 的场景，不适用于自行推断已有批次编号格式。

适用范围：`src/services/settlement-service.ts`

### prepare 的无资源占用

prepare 仅构造结算批次并交给 SettlementStore，不承担外部资源清理。

> prepare 把 orders 映射为结算明细后调用 createSettlement，再通过 SettlementStore.create 保存，整个流程没有打开文件、连接或流，因此不存在需要在 finally 中关闭的资源。若后续为 SettlementService 引入数据库连接、临时文件或导出流，必须把获取与释放集中在同一调用边界，并在异常路径显式清理；当前内存式批次构造流程不适用该要求。

适用范围：`src/services/settlement-service.ts`

### InvoiceStore 返回对象引用风险

集合副本隔离了容器，却未隔离 Invoice 对象本身。

> InvoiceStore.all()、byOrder() 与 byStatus() 仅复制 Map 中的引用，get() 和 save() 也直接返回传入或已存的 Invoice。调用方修改返回对象的 status、orderId 等字段，会同步改变 InvoiceStore.values 中的数据，并可能影响后续查询结果。集合增删操作应改用 save()、remove() 与 clear()；若需防止字段被调用方改写，应在存储边界复制 Invoice 后再返回或保存。

适用范围：`src/storage/invoice-store.ts`

### save 可能覆盖同 ID 订单

save 按订单 ID 写入 Map，重复 ID 会直接覆盖既有值。

> OrderStore 的 save 调用 values.set(order.id, order)，相同 order.id 会替换先前订单，不会保留两个版本。因 Map 以订单 ID 为唯一键，set 对已有键直接覆盖，且 save 返回传入的 order，不暴露被替换对象。缓存失效处理应将 save 视为可能使旧缓存对象失效的写入口；下游若缓存同一 ID 的订单，应在保存成功后丢弃旧值。适用于使用 OrderStore 的订单创建、更新及缓存同步流程。

适用范围：`src/storage/order-store.ts`

### batches 内存索引存在容量边界

SettlementStore.batches 全量驻留内存，长期运行或大批量测试可能触及性能上限。

> SettlementStore.batches 使用 Map\<string,SettlementBatch> 保存全部结算记录，list 还会遍历 values 并排序，内存占用与结算数量线性增长。该实现适合边界测试、演示环境和短生命周期夹具，但不适合生产级历史数据归档；若持续创建大量 SettlementBatch，进程可能因堆内存不足而失败，也不提供分页、淘汰或落盘恢复能力。

适用范围：`src/storage/settlement-store.ts`

### 创建结算须完成双索引写入

先校验批次与订单，再写 batches，最后建立 orders 反向索引。

> SettlementStore.create 的写入顺序必须保持为：检查 batches 中批次 id 是否重复、逐行检查 orders 中 orderId、先 set 批次副本，再写入订单归属。任一校验失败都抛出 Error，且不得提前修改任一 Map。该顺序可防止读取时出现批次已存在但订单索引缺失，或订单已被其他结算占用的半写入状态，适用于所有 create 调用。

适用范围：`src/storage/settlement-store.ts`

## 上下文

### 订单状态转换检查

订单状态转换只允许领域定义的状态

> 订单状态转换只允许领域定义的状态。非法转换需要抛出带错误码的异常。这个规则适用于订单工作流。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/workflow/order-workflow.ts`

### 结算审批记录成员标识

结算审批记录保存审批成员和时间

> 结算审批记录保存审批成员和时间。付款操作需要已经审批。这个规则适用于结算批次。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/domain/settlement.ts`

### 通知模板必须已注册

发送通知前检查模板名称是否存在

> 发送通知前检查模板名称是否存在。未知模板会抛出错误。这个规则适用于通知模板。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/notifications/templates.ts`

### 成员停用保留历史记录

停用成员只改变 active 标识，不删除历史事件

> 停用成员只改变 active 标识，不删除历史事件。读取接口仍然可以显示成员。该规则适用于成员生命周期。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/domain/member.ts`

### 通知收件人保留原样

通知收件人地址在队列中保持调用方提供的字符串

> 通知收件人地址在队列中保持调用方提供的字符串。格式校验在入口完成。该规则适用于通知队列。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/notifications/outbox.ts`

### 请求对象必须通过输入校验

HTTP 路由先把未知值检查为对象，再解析字段类型

> HTTP 路由先把未知值检查为对象，再解析字段类型。缺少必填字段立即抛出错误。该规则适用于请求处理。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/http/request.ts`

### 订单导出字段保持稳定

exportRows 的列名和金额单位属于持久化接口。

> OrderService.exportRows 固定输出 id、memberId、status、totalCents、refundedCents 与 createdAt，金额以 cents 表示。新增导出用途时不得重命名这些列或改变单位，避免下游报表和历史文件无法兼容。

适用范围：`src/services/order-service.ts`

### getStock 返回脱离缓存的副本

库存读取结果不应直接引用存储内部对象。

> InventoryStore.getStock 命中 stocks 后应返回展开生成的 StockItem 副本，缺失时返回 undefined。这样调用方修改读取结果不会污染 Map 中缓存，适用于库存查询及其后续状态计算。

适用范围：`src/storage/inventory-store.ts`

### OrderService 固定使用订单存储

订单服务依赖由构造阶段注入的 OrderStore，查询历史数据时沿用该存储边界。

> OrderService 必须通过私有只读的 store 字段访问 OrderStore，不在订单查询流程中切换到其他持久化实现。这样可固定历史订单的读取来源，避免迁移期间因存储来源变化而改变结果；该规则适用于 OrderService 对 OrderFilters 的查询与分页处理。

适用范围：`src/services/order-service.ts`

### 审计存储限定在进程内

AuditStore 仅维护当前进程中的审计记录，不承担持久化职责。

> AuditStore 将 AuditEntry 保存在实例字段 values 中，因此记录仅在当前进程和该实例生命周期内可用。若业务要求跨重启保留历史，应由外部存储承担持久化，AuditStore 继续负责收集与查询，避免调用方误以为 count 或 latest 已覆盖持久化数据。

适用范围：`src/storage/audit-store.ts`

### 审计标识生成保持可替换

AuditService.id 允许替换生成策略，审计条目仍由服务统一创建。

> AuditService 使用 id 生成 AuditEntry 标识，使测试或调用方能够提供可控的 string 值。更换生成策略时仍应由服务创建条目并交给 AuditStore；适用于审计标识生成，不涉及条目筛选。

适用范围：`src/services/audit-service.ts`

### 读取审计条目时浅复制

AuditStore.all 返回新的条目与 payload 容器，降低调用方误改内部数据的机会。

> AuditStore.all 通过 map 为每个 entry 复制对象，并复制 payload 容器后返回。原因是调用方修改返回结果时，不应意外覆盖已保存的 AuditEntry；该做法适用于顶层与 payload 的浅层数据隔离。

适用范围：`src/storage/audit-store.ts`

### 审计暴露采用角色白名单

canExposeAudit 仅向 owner 开放审计数据。

> canExposeAudit 当前只允许 role 为 owner 的调用者访问审计数据，其他角色应被拒绝。此规则是公开审计入口的授权边界，适用于调用 canExposeAudit 的服务层；它不负责决定载荷中的具体字段范围。

适用范围：`src/security/audit-policy.ts`

### 读取消息返回隔离副本

get通过copyMessage避免外部直接改动缓存。

> NotificationOutbox.get从values取得消息后调用copyMessage返回副本，调用方无法借此改写内部缓存。记录不存在时get抛出Error；该行为适用于通过消息标识读取OutboxMessage的场景。

适用范围：`src/notifications/outbox.ts`

### 派发缓存保存事件副本

NotificationDispatcher 用 delivered 缓存已处理事件，并保留 data 副本。

> NotificationDispatcher 的 delivered 保存已派发事件，dispatch 写入时复制 data，避免调用方后续修改影响缓存。该规则适用于进程内派发状态，不应把 delivered 当作持久化投递凭证。

适用范围：`src/notifications/dispatcher.ts`

### 订单列表采用组合筛选

OrderService.list 按多个可选条件筛选订单。

> OrderService.list 应逐项应用 OrderFilters 的 memberId、status、金额与时间条件，不满足任一条件即排除订单。这样可组合出稳定的查询结果，适用于订单列表检索，且不得在筛选时改变订单数据。

适用范围：`src/services/order-service.ts`

### 重开仅接受已取消订单

reopenOrder 拒绝非 cancelled 状态的订单。

> reopenOrder 仅在 Order.status 为 cancelled 时执行，并把新状态设为 draft；其他状态直接抛出 Error。该限制用于防止草稿、已支付或退款中订单绕过取消流程重新进入可编辑阶段。

适用范围：`src/workflow/order-workflow.ts`

### 结算批次状态按流程推进

SettlementBatch 仅允许从草稿依次进入审批与支付状态。

> SettlementBatch 的 state 只能按 draft、approved、paid 的业务顺序推进，不允许跳过审批直接写入 paid。这样可保留结算责任链，并让 approveSettlement、paySettlement 分别承担审批与付款职责；适用范围为所有结算批次状态变更。

适用范围：`src/domain/settlement.ts`

### 客户标签按字段组合生成

customerLabel 使用姓名与邮箱组合展示客户，不写入或改变客户记录。

> customerLabel 应根据 customer.name 与 customer.email 组合出 string，作为读取侧的展示结果，不得反向写回 Customer。该规则适用于客户列表、搜索结果和详情区域，确保标签生成不会改变客户实体或其他调用方持有的数据。

适用范围：`src/domain/customer.ts`

### 配置读取返回快照

loadSettings 暴露存储读取结果，调用方不应假定获得可独立修改的配置对象。

> loadSettings 直接返回 SettingsStore.read() 的结果，不在服务层额外复制配置。这样可避免维护两套配置状态，并让调用方通过 updateSettings 统一提交变更。适用于读取当前配置并生成 settingsSnapshot 的场景；调用方不得把返回值当作可任意修改的本地副本。

适用范围：`src/config/settings.ts`

### 库存核销以预占为前提

consumeStock 只核销已有预占，不直接消耗可用库存。

> consumeStock 在数量校验后核对 item.reserved，只有 amount 未超过预占量时才执行核销；否则抛出 Error，明确禁止从未预占库存中扣减。合法操作减少 item.reserved，不修改 item.available，并通过 version 递增及 updatedAt 更新留下状态变更痕迹。该背景规则适用于订单履约、发货确认等完成阶段，确保扣减依据与库存锁定记录一致。

适用范围：`src/domain/inventory.ts`

### 预占状态只能单向完成

changeReservation 仅允许 active 预占进入完成态。

> changeReservation 先检查 current.state；当状态已不是 active 时抛出 Error，拒绝再次处理已完成的预占。传入的 state 若仍为 active，也会被拒绝，因为该函数用于完成而非继续保持活动。合法变更只更新 Reservation.state 与 updatedAt，不修改库存数量。适用于订单取消、履约完成等终态推进路径，可避免终态记录被反复改写。

适用范围：`src/domain/inventory.ts`

### 通知渠道采用封闭枚举

通知渠道固定为邮件、聊天和 Webhook，避免日志与路由出现未识别类型。

> 团队将 NotificationKind 限定为 email、chat、webhook 三种通知渠道，新增渠道必须先扩展联合类型，再同步通知处理、日志标签和投递逻辑。使用封闭枚举而非任意字符串，是为了让 canAttempt、notificationLabel 等分支能穷尽渠道，防止未知 kind 进入队列后无法分类或审计。适用于创建通知、状态流转、指标记录及接收方处理。

适用范围：`src/domain/notification.ts`

### 库存路由只负责编排

权限判定不属于 registerInventoryRoutes 的职责。

> registerInventoryRoutes 展示的 handler 负责解析请求并调用 InventoryService，没有在路由函数内实施权限检查。团队将鉴权视为 RouteRegistry 或其外层中间件的职责，可让同一路由注册方式覆盖订单、库存、结算等模块；修改库存权限时应调整公共接入层，不能把仓库或订单权限逻辑复制进各个 handler。

适用范围：`src/http/inventory-routes.ts`

### 分页请求使用统一契约

批量查询统一以 PageQuery 传递偏移与条数限制。

> 批量列表请求统一接收 PageQuery，其中 offset 表示跳过的记录数，limit 限制本次最多返回的记录数。HTTP 路由解析出该参数后，服务层与存储层不得再各自采用不同的分页命名或默认值。适用于订单、库存、结算等所有集合查询入口；单项读取不构造 PageQuery，避免把单条资源误当批量结果处理。

适用范围：`src/http/request.ts`

### 结算路由边界校验

结算接口在进入 SettlementService 前统一解析并约束请求字段。

> registerSettlementRoutes 中所有 handler 都先用 objectInput 确认请求体或查询参数为对象，再通过 stringInput、arrayInput 和 integerInput 提取业务字段。accountId、id、memberId、reference 必须是字符串，orders 必须是数组，basisPoints 需限定在 0 至 10000。这样可在 HTTP 边界阻断缺字段、错类型及越界费率，避免无效数据进入 SettlementService。

适用范围：`src/http/settlement-routes.ts`

### 标识生成职责归入工具层

统一标识生成入口，避免服务与存储层各自造 ID。

> 订单、会员、通知及审计记录所需标识统一由 utils/id.ts 提供，业务模块通过 src/index.ts 暴露的 export 接口调用，不在 services 或 storage 中另建生成算法。这样可集中控制格式、随机源和碰撞处理，确保跨模块生成的标识具有一致语义；适用于所有需要持久化主键、关联键或幂等键的场景。

适用范围：整个项目

### 已送达通知计数以集合为准

sentCount 读取 delivered 集合大小，可正确反映空状态。

> NotificationDispatcher.sentCount() 直接返回 this.delivered.size，表示当前已记录送达通知的数量，而不是发送尝试次数。这样可避免把失败、重试或尚未送达的通知计入结果。该规则适用于统计 NotificationDispatcher 已完成投递的通知，也覆盖 delivered 为空时返回 0 的边界场景。

适用范围：`src/notifications/dispatcher.ts`

### 失败按尝试上限决定重试

fail 记录错误；达到上限后终止，否则按指定时间等待重试。

> 处理通知发送异常时，fail 先确认消息处于 delivering，同时要求 maxAttempts 是至少为 1 的整数。状态更新依据 attempts 与 maxAttempts 的比较决定：达到上限进入 failed，未达到则回到 pending；两种结果都写入 nextAttemptAt 和 lastError。适用于消费者登记失败及安排退避重试。

适用范围：`src/notifications/outbox.ts`

### 统计基于全量列表

statistics 继承 list 的筛选语义，一次读取后汇总计数。

> AuditService.statistics 的数据范围完全取决于 list(query)，包括 action、actorId、from 与 to 条件，因此统计结果只能代表该查询集合，不能视为全库指标。方法仅调用一次 list，随后计算 count、actors 及 actions，避免重复读取导致快照不一致。适用于审计看板和报表；数据量增长后应另行评估全量读取成本。

适用范围：`src/services/audit-service.ts`

### 收货沿用当前库存版本

receive 先读取库存，再以当前版本写入收货结果，避免覆盖并发变更。

> InventoryService 的 receive 约定先通过 stock 读取现有 StockItem，将 amount 交给 receiveStock 计算 next，并使用 store.putStock(next, current.version) 提交。这样写入仍绑定读取时的版本，可让存储层识别并发修改；缺少当前记录或版本冲突时不得盲目新增。该规则适用于所有仓库与 SKU 的收货写入，receiveStock 负责数量边界处理，服务层负责版本传递。

适用范围：`src/services/inventory-service.ts`

### 导出列采用稳定字段名

InvoiceService.exportRows 固定输出金额分值与业务标识，避免消费端依赖对象结构。

> 团队约定由 InvoiceService.exportRows 统一生成导出行，字段固定为 id、orderId、customerId、status 和 totalCents；totalCents 取自 Money.cents，金额不直接序列化。下游表格、文件导出及对账任务需要稳定且可计算的列契约，避免消费端随 Invoice 领域模型调整而 breakage。该约定适用于所有通过 exportRows 导出发票数据的场景，新增大额展示或内部字段时不得擅自改名。

适用范围：`src/services/invoice-service.ts`

### 支付查询采用双路径

PaymentService 的 list 与 total 分别承担明细查询和金额汇总。

> PaymentService.list 在提供 orderId 时调用 store.byOrder(orderId)，未提供时调用 store.all()；因此批量支付查询返回完整集合或指定订单集合，单项支付则由 get(id) 定位记录。total 固定传入 orderId，并基于 list(orderId) 汇总 cents。该分层适用于支付列表、订单金额核对等场景，调用方需明确批量路径与单项路径的查询范围，避免把未过滤的 store.all() 结果误用于订单级统计。

适用范围：`src/services/payment-service.ts`

### 审计记录按写入倒序读取

latest 返回最近写入的审计记录，并限制结果数量。

> 调用 AuditStore.latest 时，以 AuditStore.all 获得的当前写入序列为准，先通过 slice 截取末尾的 limit 条记录，再使用 reverse 转为由新到旧排列。这样可让订单、结算与通知操作在审计界面优先展示最新事件，并避免把全部 AuditEntry 加载到结果中。该规则适用于需要限制返回条数的查询；调用方应传入确定的 limit，且该实现不会额外按时间字段排序。

适用范围：`src/storage/audit-store.ts`

### count 读取追加后的当前长度

EventStore.count 反映 values 中已保留事件的当前数量。

> EventStore.count 直接返回 this.values.length，表示当前 EventStore 已保留事件的数量；调用 append 后，后续读取 count 会得到追加后的长度，clear 后则回到零。该方法用于失败处理后的部分状态核对，适用范围是内存事件存储实例，不承担持久化查询或历史统计。

适用范围：`src/storage/event-store.ts`

### nextId 负责生成有序标识

nextId 按全局序列生成带前缀的四位三十六进制标识，供订单及关联资源创建时使用。

> 调用 nextId 时先递增 sequence，再将序号转为三十六进制并由 padStart 补足四位，最终与 prefix 拼接为字符串。采用固定格式便于人工辨识资源类型，同时让同一进程内新生成的标识保持递增关系；该函数适合创建订单、库存、结算或通知等独立资源，不适合作为需要跨进程唯一性的正式 ID 方案。

适用范围：`src/utils/id.ts`

### 生产环境判定边界

isProduction 只依据 environment 返回环境判定结果。

> 团队约定使用 isProduction(settings) 作为运行环境的统一判定入口，只有 settings.environment 等于 production 时才返回 true。调用方传入当前加载的 Settings 对象即可获得布尔结果，避免在服务层、HTTP 路由或存储层各自比较环境名称。该规则适用于需要区分生产配置与本地配置的分支；若要修改环境来源，应调整 Settings 的加载与更新流程，而不是绕过此函数。

适用范围：`src/config/settings.ts`

### 标签更新采用不可变快照

addTag 返回新的 Customer 快照，重复标签直接复用原对象。

> addTag 把 customer 视为只读快照：标签已存在时返回原 customer，否则通过展开对象和复制 tags 生成新 Customer。该设计避免直接修改共享数组造成并发请求互相污染，并让标签新增结果可按对象引用区分。适用于单次标签变更调用；若两个写入都基于同一旧 Customer，后写入者仍可能覆盖前一次结果，调用链需在提交时重新确认版本。

适用范围：`src/domain/customer.ts`

### 权限校验放在服务层

Reservation 负责业务状态，访问控制由上层服务执行。

> Reservation 只保存订单、仓库、SKU、数量及状态，不表达调用者身份或操作权限。HTTP 路由解析登录态后，应在调用库存服务前校验主体能否操作 orderId 指定的订单及 warehouseId 对应仓库。领域层通过 reserveStock、releaseStock、consumeStock 或 changeReservation 执行数量与状态约束，以防路由绕过检查直接修改库存，并保持领域函数可复用。适用于库存预留、释放、消耗及订单取消等入口。

适用范围：`src/domain/inventory.ts`

### 库存键采用稳定编码

stockKey 用 JSON 数组编码仓库与 SKU，避免字符串拼接歧义。

> 库存记录必须通过 stockKey 的 warehouseId 与 sku 组合定位。该函数先排除 trim 后为空的标识，再用 JSON.stringify 生成键，因此分隔符出现在 SKU 中也不会造成键碰撞。重试同一入库、预留或查询时复用完全相同的参数；若调用方在 trim 或大小写转换前生成键，就可能得到不同结果。

适用范围：`src/domain/inventory.ts`

### InvoiceLine 夹具须可重放

发票行夹具必须使用稳定输入，确保金额计算与状态测试可重复。

> 构造 InvoiceLine 测试夹具时，固定 description、quantity 与 amount，并显式保留数量和金额之间的业务含义，不依赖运行时生成值或对象引用顺序。这样重复执行 invoiceTotal、invoiceBalance 及 overdue 相关测试时，才能得到一致结果；夹具适用于 createInvoice 与 addInvoiceLine 流程的行项目准备。

适用范围：`src/domain/invoice.ts`

### 金额加法保持分值语义

Money.add 直接合并两笔 Money 的 cents，不承担幂等键或去重职责。

> 背景约定是 Money.add 仅负责计算两项金额之和，通过 this.cents 与 other.cents 相加后生成新的 Money；它不生成业务标识，也不承担幂等控制。调用方若需防止重复入账，必须在订单或结算服务层另行使用既有业务键判定。适用于金额聚合、数量折算和余额累计，不能用 add 代替唯一性校验。

适用范围：`src/domain/money.ts`

### createOrder仅初始化领域对象

createOrder负责构造草稿订单，路径解析和持久化由外层完成。

> createOrder 只依据 id、memberId 与 createdAt 构造 Order，并初始化空的 lines、refunds、internalNotes 及 draft 状态，不负责解析文件路径、访问存储或读取工作区配置。这样能把领域构造与工作区边界隔离，避免服务层因运行环境变化而改变订单语义；适用范围为路由、服务层及测试中所有创建新订单的入口。

适用范围：`src/domain/order.ts`

### 订单加行后的缓存失效边界

addLine 生成新 Order，调用方须同时失效金额与订单内容缓存。

> addLine 不修改原 Order，而是复制对象，并通过 lines 生成含新增 OrderLine 的新订单。因此，基于对象引用判断变化的缓存不会自动失效。调用 addLine 后，须显式清除订单详情、SKU 行项目及 orderTotal 对应的金额缓存，再发布后续事件，避免读取旧行项目或旧金额。原因是不可变返回方式使缓存层无法从同一引用获知内容变化。适用于订单编辑、商品增删和金额重算链路，不包括只读取 OrderLine 的场景。

适用范围：`src/domain/order.ts`

### 折扣比例必须限定区间

discountLine拒绝非有限值及0到100之外的折扣比例。

> discountLine仅接受0至100之间的有限percent；Number.isFinite(percent)为false，或percent小于0、大于100时，函数抛出Error。金额统一通过Money.fromCents和Math.round转换，禁止调用方绕过校验传入NaN或Infinity。此规则适用于订单行和订单级折扣计算，尤其适合优惠配置读取、活动参数映射及外部请求边界。

适用范围：`src/domain/settlement.ts`

### 取消判断不修改订单

canCancel 只读取状态并返回布尔值，不改变传入对象。

> 背景事实：canCancel 是无副作用的状态查询函数，仅读取 order.status 并返回 boolean，不会更新订单字段或推进订单生命周期。调用方可重复查询同一 Order，而不依赖对象是否已被其他流程处理。该约定适用于取消按钮可用性、接口前置判断等只读场景；真正取消仍须调用 cancelOrder，并单独处理 cancelReason 等业务输入。

适用范围：`src/workflow/order-workflow.ts`

### 过滤过程保持同步边界

filters 同步解析条件，不引入异步等待或队列调度。

> filters 是同步函数，从 input 读取 memberId、status、from 和 to，并通过 optionalString、integerInput 构造 OrderFilters；它不执行异步任务，也不进入队列。调用方可在同一处理流程内立即判断成功或捕获 Error，因此订单查询的输入拒绝不会产生等待、延迟消费或乱序完成的问题。

适用范围：`src/http/order-routes.ts`

### 库存路由测试依赖显式标识

测试重放库存流程必须使用稳定业务标识和确定性输入。

> 针对 registerInventoryRoutes 的集成测试应显式构造 reservationId、orderId、warehouseId、sku 和 quantity，并按固定顺序调用 /inventory/initialize、/inventory/receive、/inventory/reserve。原因是这些标识参与幂等和业务关联，随机值会使失败场景难以重放；测试夹具必须保存请求参数及响应，且避免依赖真实时间或共享库存状态。

适用范围：`src/http/inventory-routes.ts`

### 审计路由采用稳定读取入口

成员审计路由固定调用 service.list，测试可复现同一读取行为。

> registerMemberAuditRoute 将 GET /members/audit 路由直接绑定到 service.list，不在该函数中追加筛选、转换或临时状态。这样，审计夹具只需提供可控的 MemberService.list 返回值，即可重放相同查询结果并断言调用行为。适用于成员审计接口的注册、路由测试以及需要隔离外部副作用的场景。

适用范围：`src/http/member-routes.ts`

### 成员路由集中注册三类操作

registerMemberRoutes 统一暴露查询、导入和按编号读取入口。

> registerMemberRoutes 在一次注册中提供 GET /members、POST /members/import 与 GET /members/:id，并分别转交给 service.list、service.importRows、service.get。路由层不承担业务规则，测试时替换 MemberService 的对应方法即可验证参数传递，避免重复搭建入口。该约定适用于成员 HTTP 路由新增、变更及服务替身测试。

适用范围：`src/http/member-routes.ts`

### 筛选转换作为跨层契约

HTTP 边界先转换筛选条件，再以 OrderFilters 调用订单服务。

> 跨模块调用以 filters 产出的 OrderFilters 为边界契约：HTTP 层负责把未知查询值转换成可选字符串、整数和受限状态，服务层接收结构化条件，不直接处理传输格式。这样能让非法 status 或倒置时间区间在进入 OrderService 前失败，并使 list、exportRows、count 使用同一组语义。适用范围是 registerOrderRoutes 注册的全部订单查询路由。

适用范围：`src/http/order-routes.ts`

### 订单筛选区间按显式时间值判断

filters 只校验调用方传入的时间边界，不隐式读取当前时钟。

> filters 将 input.from 和 input.to 分别转换为整数，并在两者同时存在时拒绝 from 大于 to；筛选边界来自请求参数，而不是函数内部读取的系统时间，因此结果不会因执行时刻变化而产生隐式差异。若业务需要默认时间窗或相对时间，必须先在调用方明确生成边界，再交给 filters 校验。该规则适用于 registerOrderRoutes 调用的订单状态、会员及时间区间筛选。

适用范围：`src/http/order-routes.ts`

### 历史结算数据访问边界

结算查询只按 accountId 定位账户数据，分页由统一查询参数处理。

> 迁移后的历史结算记录若仍通过结算接口读取，GET /settlements、/settlements/summary 与 /settlements/export 都以 accountId 作为账户边界，由 service.list、service.summary 或 service.exportRows 完成具体数据访问；列表响应再通过 page 和 pageQuery 接入统一分页协议。route 层不兼容旧字段，也不自行推导账户归属，避免迁移期间出现跨账户查询或新旧响应结构混用。

适用范围：`src/http/settlement-routes.ts`

### 结算契约以路由字段为准

账户、审批人与支付引用字段形成跨模块持久化契约。

> 结算数据的读写双方需要共同遵守 registerSettlementRoutes 暴露的字段契约：查询使用 accountId，审批使用 id 与 memberId，支付使用 id 与 reference，订单准备使用 orders 和 basisPoints。SettlementService 及存储层不得随意改名或改变字段含义，否则历史结算记录无法与查询、审批和支付流程对应；该约定适用于所有处理 /settlements 路由数据的模块。

适用范围：`src/http/settlement-routes.ts`

### hasSent 仅查询既有投递事实

通知是否已发送由 delivered 对 eventId 的记录决定。

> NotificationDispatcher.hasSent(eventId) 使用 this.delivered.has(eventId) 判断指定事件是否已有投递记录，不读取当前时间，也不执行发送或重试。该事实适用于幂等校验、重复通知拦截及审计查询等场景；eventId 相同才可能对应同一记录，调用方需保证事件标识稳定且一致，不能用生成时间替代它。

适用范围：`src/notifications/dispatcher.ts`

### 清空操作移除全部接收记录

clear 删除 delivered 中的全部记录，适合隔离测试场景。

> NotificationDispatcher.clear 调用 delivered.clear，移除当前保存的全部 NotificationEvent 记录。该操作会让此前的 sentCount 归零，并使 hasSent 对这些事件返回 false；events 随后也不会再返回已清空的内容。它适合测试用例之间重置状态或显式结束当前工作区，调用方无需逐条删除，也不会保留可供后续查询的接收记录。

适用范围：`src/notifications/dispatcher.ts`

### 模板先登记后渲染

Template 统一描述模板名称与渲染入口，约束模板接入顺序。

> 新增通知文案时，先按 Template 约定提供 name 与 render，再把实例登记进 templates，最后才允许业务代码通过 renderTemplate 使用。模板读取发生在渲染阶段，写入发生在模板初始化阶段；顺序颠倒会让 templateNames 看不到新模板，也会让 renderTemplate 抛出 Error。该约定适用于所有通知模板，不限于单个渠道。

适用范围：`src/notifications/templates.ts`

### 状态分组保持原序

byStatus 过滤匹配状态的订单行，不改变输入报表中的记录顺序。

> 按状态提取报表数据时，沿用 byStatus 提供的过滤口径，只保留 row.status 与目标 status 精确相等的 OrderReportRow。该函数不会排序或重新生成记录，因此适用于从 buildReport 结果中读取指定状态分组，也适用于后续交给 toCsv 的数据；若业务需要分组内排序，必须在过滤完成后另行明确排序规则。

适用范围：`src/reports/order-report.ts`

### 统计结果依赖确定性夹具

统计测试必须固定时间与标识符生成顺序，才能稳定重放。

> 编写 AuditService.statistics 测试时，通过构造 AuditService 注入固定的 now 与 id 生成器，并让 AuditStore 返回顺序稳定的记录。统计中的 count、actors 和 actions 都由 list 的结果计算，因此固定时间与 actorId 可避免边界漂移；涉及动作分布时还应准备多条不同 action 的记录，以验证聚合结果。

适用范围：`src/services/audit-service.ts`

### ready 只返回到期且受限批次

ready 将当前时间与批次上限传给 due，以空数组表达当前没有可投递消息。

> ready 调用 outbox.due(this.now(), this.policy.batchSize)，结果限定为已到投递时间且不超过批次上限的 OutboxMessage。调用方必须把空数组视为正常的暂无待处理状态，而不是异常或投递失败，也不应额外绕过 policy.batchSize 扩大拉取范围。该规则适用于 DeliveryService 的批次扫描入口及其消费者。

适用范围：`src/services/delivery-service.ts`

### begin 沿用 outbox 持久化结构

begin 通过 outbox.claim 获取既有消息，不在服务层另建临时持久化格式。

> begin(id) 直接调用 outbox.claim(id, this.now()) 并返回原存储中的 OutboxMessage，使领取操作仍由既有持久化结构负责。服务层不得把领取结果改写成另一套字段格式，否则后续 complete 与审计记录可能无法按 message.id 对齐。该背景适用于已采用 outbox 作为事实来源的投递流程，以及需要兼容现有存储数据的服务部署。

适用范围：`src/services/delivery-service.ts`

### 重复预留按原记录返回

同一 reservationId 仅允许以完全相同输入重试。

> InventoryService.reserve 先校验 quantity 以及 reservationId、orderId，再读取 existing。输入完全一致时直接返回既有 Reservation，避免重试重复占用库存；若 orderId、sku、quantity 或 warehouseId 任一不同，则抛出 Error，防止同一预留标识被复用为另一笔业务。首次请求则依据 current 计算 next，并以 version 保护 putStock。

适用范围：`src/services/inventory-service.ts`

### 单笔发票创建入口

create 仅负责按单笔参数构造并保存 Invoice。

> InvoiceService.create 接收 id、orderId 与 customerId，先调用 createInvoice 生成 Invoice，再通过 this.store.save 返回持久化结果。该入口表达的是一次单据创建，不承担订单、库存或结算数据的联动编排；需要组合多个业务步骤的流程，可在调用层决定执行顺序与重试方式，但每次创建仍应复用 create。

适用范围：`src/services/invoice-service.ts`

### 文本配置读取约定

settingText 仅接受字符串，并为缺失或异型值兜底。

> 团队约定使用 settingText(settings, key, fallback) 获取文本配置。实现先检查 settings\[key] 是否为 string，只有类型匹配才返回配置值，否则采用 fallback。该做法避免把其他类型直接交给队列消息、通知模板或服务参数，减少运行时转换造成的行为偏差。适用范围是所有按名称读取文本配置的调用点；调用方必须根据配置用途选择可接受的默认文本。

适用范围：`src/config/settings.ts`

### summarize 固定金额计算次序

先算订单总额与退款额，再计算结余额。

> context：OrderService.summarize(order) 依次调用 orderTotal(order) 与 refundTotal(order)，分别得到 total 和 refunded，最后通过 total.subtract(refunded) 生成 balance，并按该顺序返回三个 Money。退款额不能先于订单总额参与余额计算，否则调用次序与结果语义会变得含糊。该流程适用于需要从同一 Order 得到总额、退款额和结余额的统计场景。

适用范围：`src/services/order-service.ts`

### 已付发票决定收入口径

invoiceRevenue 仅统计 status 为 paid 的发票金额。

> 报表收入口径约定为：invoiceRevenue 先用 filter 保留 status 等于 paid 的 Invoice，再通过 invoiceTotal 读取 cents 并累计。该口径排除未支付、失败或其他状态的发票，防止把尚未形成收入的单据计入结算报表；适用于收入汇总、对账及基于报表金额的测试数据验证。

适用范围：`src/services/report-service.ts`

### SettingsStore 隔离配置状态

设置仓库统一提供读取、替换、合并、重置与键检查能力。

> SettingsStore 将配置状态集中封装在 current 中，对外仅通过 read、replace、merge、reset 和 has 操作。read 返回展开后的新对象，使调用方无法直接修改仓库内部引用；replace 同样复制输入，避免外部对象继续参与后续状态变更。此设计适用于进程内同步配置访问；若后续引入持久化或并发写入，需要在不改变这些操作语义的前提下扩展实现。

适用范围：`src/storage/settings-store.ts`

### 结算存储承担内存夹具职责

SettlementStore 以内存 Map 支撑确定性测试，并隔离外部存储副作用。

> SettlementStore 使用 batches 与 orders 两个 Map 保存结算批次及订单归属，可作为服务层测试夹具，提供创建、查询、更新和筛选能力。测试可借助 create 的重复结算与订单占用校验构造失败场景，并通过 list 的固定排序获得可重放结果。该背景仅描述内存实现，不要求生产环境持久化。

适用范围：`src/storage/settlement-store.ts`

### 分页参数拒绝越界值

paginate 仅接受非负 offset 和正数 limit，越界参数直接抛出 Error。

> 服务层与路由层调用 paginate 时，offset 必须大于或等于 0，limit 必须大于 0；任一条件不满足就抛出 Error，而不是返回空页或自行修正参数。该约定让无效分页请求立即失败，避免 items.slice 起点异常、hasMore 计算失真以及 pageCount 推导出错误页数。适用于所有使用 Page<T> 的列表查询和对外分页接口。

适用范围：`src/utils/pagination.ts`

### 会员邀请接受空邮箱边界

会员邀请事件可承载空字符串，接收端须按边界值处理。

> eventForMember 接收任意 string 类型的 email，并同时写入 data.email 与 recipient；当前实现未拒绝空字符串，因此空邮箱会形成 eventId 为 member: 的有效事件。原因是该函数承担事件映射而非地址合法性校验，过早过滤会混淆调用方与投递层职责。适用于 eventForMember 生成会员邀请事件的场景；需在 deliverWithRetry 投递前判定地址是否存在时，应显式校验空值并决定终止或降级。

适用范围：`src/workflow/notification-workflow.ts`

## 负向经验

### 分页参数使用正整数

分页参数必须是正整数并限制最大页面大小

> 分页参数必须是正整数并限制最大页面大小。缺少参数时使用服务默认值。该规则适用于 HTTP 查询。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/http/request.ts`

### 重试次数由策略限制

外部调用重试次数由策略参数限制

> 外部调用重试次数由策略参数限制。达到次数后保留最后一个错误。该规则适用于支付流程。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/utils/retry.ts`

### 库存版本冲突立即报告

库存写入携带预期版本号

> 库存写入携带预期版本号。版本变化时立即报告冲突，调用方自行重试。该规则适用于库存存储。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/storage/inventory-store.ts`

### 投递回执来自已完成消息

receipts 只读取 delivered 状态的消息，并支持按 recipient 筛选

> receipts 只读取 delivered 状态的消息，并支持按 recipient 筛选。回执包含 deliveredAt 和 attempts。这个规则适用于通知投递查询。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/services/delivery-service.ts`

### 订单导出字段使用整数金额

订单导出输出 totalCents 和 refundedCents 字段

> 订单导出输出 totalCents 和 refundedCents 字段。导出不会改变订单对象。该规则适用于报表。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/services/order-service.ts`

### 账务月份统计使用秒值

账务记录使用整数秒保存时间

> 账务记录使用整数秒保存时间。统计范围在进入领域服务前完成校验。这个规则适用于账务服务。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/services/settlement-service.ts`

### Reservation.state 仅用三态

Reservation.state 限定为 active、released、consumed，禁止另造同义状态。

> Reservation.state 只能取 active、released 或 consumed，释放与核销代码应分别落到对应值。原因是状态集合越界会使 reservationList 的筛选和后续处理失去一致语义；该规则适用于创建预留、释放预留及核销后的记录更新。

适用范围：`src/domain/inventory.ts`

### 预留标识符禁止异参复用

相同 reservationId 只能对应完全一致的预留输入。

> InventoryService.reserve 检出已有 reservationId 时，应核对 orderId、sku、quantity 与 warehouseId；任一不同即抛出 Error，完全相同才返回原记录。原因是标识符重绑会改变订单与库存的归属，约束适用于所有 reserve 请求。

适用范围：`src/services/inventory-service.ts`

### 释放操作须校验库存版本

release 写回库存时必须携带读取到的 version。

> InventoryService.release 先取得 current 与 stock，再调用 putStock(nextStock, stock.version)，让存储层能够识别陈旧版本。原因是释放会同时影响可用量和预留量，忽略版本可能覆盖并发变更；该约束适用于 release 的库存写回。

适用范围：`src/services/inventory-service.ts`

### get 返回存储中的订单对象

OrderService.get 未创建副本，调用方若修改返回对象可能直接影响存储状态。

> OrderService.get 查到订单后直接 return，未执行复制或冻结；调用方对返回 Order 的属性修改可能改变 OrderStore 中的对象。需要隔离调用方可变性时，应明确采用副本策略并检查 get 的返回行为。

适用范围：`src/services/order-service.ts`

### 审计标签保留三项原值

auditLabel 仅拼接动作、参与方与创建时间，不读取审计载荷。

> auditLabel 生成的标签固定由 AuditEntry 的 action、actorId 和 createdAt 组成，审计载荷变化不得影响标签。空值输入时仍按统一字符串格式输出，避免审计记录在列表展示中出现不一致。

适用范围：`src/security/audit-policy.ts`

### 审计列表限制响应规模

成员审计查询应设置单次响应规模上限。

> 成员审计查询应限制单次返回规模，避免 registerMemberAuditRoute 调用 service.list 后将大量记录交给客户端。响应须设明确上限，达到上限时采用截断或分页约定，不依赖客户端处理超大结果。该约束适用于 GET 审计列表入口，不改变成员普通列表的查询规则。

适用范围：`src/http/member-routes.ts`

### 复制消息时隔离数据

copyMessage 必须同时复制 message 和 data。

> 调用 copyMessage 时不能直接返回原对象；应复制 message 的属性，并单独展开 data 生成新对象。这样修改副本的数据不会污染源 OutboxMessage，适用于队列快照和状态更新前复制。

适用范围：`src/notifications/outbox.ts`

### 取消原因须从专用备注提取

cancelReason 只解析 cancelled: 前缀的内部备注，避免把普通备注误判为取消原因。

> cancelReason 应仅从 order.internalNotes 中查找以 cancelled: 开头的条目，并使用 slice 去掉该前缀后返回；未命中时返回 undefined。原因是 internalNotes 还可能承载其他订单流转信息，宽松匹配会污染取消原因。适用范围为订单取消流程及读取取消原因的调用方。

适用范围：`src/workflow/order-workflow.ts`

### 事件载荷须隔离未知字段

EventRecord 的 payload 保持未知类型，消费方必须显式读取所需字段。

> EventRecord.payload 使用 Record\<string, unknown> 隔离调用方数据，事件生产方不得把未校验字段强行声明为具体类型。跨模块消费时，各模块应按自身契约读取并验证，避免新增载荷字段造成隐式耦合；该约定适用于 payload 的写入与读取边界。

适用范围：`src/storage/event-store.ts`

### all 仅复制浅层事件数据

EventStore.all 的副本仍共享嵌套 payload 引用。

> EventStore.all 展开 event，并复制 payload，却未隔离 payload 内的嵌套对象。调用方修改嵌套值时可能影响 this.values 中的原记录；读取事件快照供重试、比较或后续写入时，应避免直接改动嵌套字段。

适用范围：`src/storage/event-store.ts`

### actor 查询采用精确匹配

EventStore.actor 按 actorId 精确筛选事件。

> EventStore.actor 使用 filter 对 EventRecord.actorId 做精确相等比较，不执行模糊匹配或前缀归并。需要查询特定标签的完整历史时调用该方法，避免将相似标识合并，适用于事件检索层。

适用范围：`src/storage/event-store.ts`

### 订单导出禁止隐式分页

exportRows 返回完整筛选结果，不受列表分页影响。

> GET /orders/export 调用 service.exportRows(filters(query))，应返回筛选后的完整集合；offset 与 limit 仅用于 /orders 的分页响应。这样可避免大批量导出被截断，规则适用于导出路由及为其新增筛选字段的场景。

适用范围：`src/http/order-routes.ts`

### now 依赖注入边界

now 必须可替换，以便隔离账务测试中的时钟影响。

> SettlementService 应通过 private readonly now 接收时间源，测试中不得改写系统时钟。替换依赖后，prepare 与 approve 仍须使用同一入口生成时间，避免不同运行环境产生不一致的账务记录。

适用范围：`src/services/settlement-service.ts`

### 费率基点范围校验

calculateFee 仅接受 0 到 10000 的整数基点。

> calculateFee 遇到非整数、负数或超过 10000 的 basisPoints 时必须抛出 Error。该校验适用于订单结算费用计算，可阻止错误配置形成异常金额；合法输入按 Money.fromCents 写入计算结果。

适用范围：`src/domain/settlement.ts`

### 结算审批仅开放草稿态

approveSettlement 只接受草稿批次及有效操作者标识。

> approveSettlement 必须同时校验 batch.state 为 draft，并要求 memberId 非空；否则抛出 Error。原因是已审批或非草稿批次不可再次批准，缺少操作者也无法形成有效责任记录。该约束适用于 SettlementBatch 的审批入口，不涉及归档统计。

适用范围：`src/domain/settlement.ts`

### 入库拒绝重复重试

receiveStock 每次都会增加库存，不能作为天然幂等入口。

> receiveStock 会把 amount 直接累加到 item.available，并未携带业务幂等键、已入库记录或重复请求标记。因此同一收货事件被重试时，每次调用都可能再次增加库存并提升 version；接入方必须在调用前完成事件去重，且只能对已确认唯一的一次收货执行入库。

适用范围：`src/domain/inventory.ts`

### OrderLine批量写入差异

批量路径必须逐项执行addLine语义，不能绕过单项校验。

> 导入多行订单时，批量接口最终必须为每个 OrderLine 调用或复用 addLine 的单项规则，不能仅写 quantity 和 unitPrice 后直接替换 Order.lines。原因是批量路径容易漏掉零数量、负单价或重复 sku 的检查，导致这些异常绕过正常下单流程；适用范围为订单导入、管理员批量编辑和任何新增 lines 的批处理入口。

适用范围：`src/domain/order.ts`

### PaymentState 收敛批量路径状态

批量支付处理只能映射到统一的 PaymentState，避免各接口产生不一致终态。

> 批量与单项支付路径必须共用 PaymentState 定义的 created、authorized、captured、failed、refunded，不得为批量接口新增近义状态或跳过 authorize、capture 等阶段。这样 paymentTerminal 能依据同一组终态判断结果，paymentSummary 的聚合口径也与单项路径一致。该约定适用于订单结算后的批量授权、扣款、失败处理和退款，不适用于支付渠道自身的异步状态枚举。

适用范围：`src/domain/payment.ts`

### 订单读路由不复用列表结果

导出与计数应调用专用服务方法，避免复用分页列表造成缓存偏差。

> registerOrderRoutes 为导出和计数分别调用 service.exportRows 与 service.count，而不是截取 service.list 的结果。原因在于列表接口可能附加分页数据，exportRows 面向完整导出语义，count 面向统计语义，混用会让响应内容与调用方预期错位。该约定适用于 /orders/export 和 /orders/count；/orders 仅在存在 offset 或 limit 时通过 page 返回分页结果。

适用范围：`src/http/order-routes.ts`

### 可选字符串保留缺省语义

optionalString 仅对 undefined 放行，其余值仍严格校验。

> 读取可缺省字符串时先调用 optionalString：value 为 undefined 时直接返回 undefined；一旦字段实际出现，就转交 stringInput 执行类型与空白校验。禁止用空字符串替代未提供状态，否则更新订单、库存备注或结算信息时可能覆盖原有值。适用于支持局部更新且需区分“未提交”和“提交空值”的写入场景。

适用范围：`src/http/request.ts`

### 通知通道不得提供隐式默认值

Channel 明确要求实现声明通道种类与发送行为，禁止依赖缺省参数。

> Channel 接口要求每个实现同时声明 kind，并提供接收 recipient、subject、body 的 send 方法。业务代码不得假设未传值时存在默认通道，也不得用可选参数掩盖调用遗漏；构造具体通道时应由 channelFor 明确选择。这样可在编译阶段暴露参数缺失，并让订单通知的收件人、主题与正文始终来自真实调用。适用于所有实现 Channel 的通知适配器及其调用方。

适用范围：`src/notifications/channel.ts`

### 完成投递须处于投递态

complete 拒绝非 delivering 消息，成功后记录送达时间并清除错误。

> 结算成功通知时，先用 get 取得消息，并确认其 state 为 delivering；其他状态直接抛出 Error，禁止跳过领取流程。确认后生成 completed 副本，设置 state 为 delivered、deliveredAt 为 now，并清空 lastError，再写回 values。该规则适用于消费者回传成功结果，防止重复完成或误结算尚未投递的任务。

适用范围：`src/notifications/outbox.ts`

### 列表查询返回隔离副本

list 可按状态过滤，但不暴露 outbox 内部保存的消息对象。

> 读取消息列表时，list 从 values 复制集合并按可选 state 过滤；未传 state 时返回全部状态。筛选结果统一经过 copyMessage，调用方无法通过修改返回对象影响后续查询。适用于管理端查看积压、失败或投递中任务，以及测试代码核对状态流转。

适用范围：`src/notifications/outbox.ts`

### 避免让审计主题承担排队职责

auditTopic 只生成主题名，不能据此假定消息已入队或可安全重试。

> 负面经验：把 auditTopic 返回的 audit.${action} 当作队列确认是错误的。该函数只负责拼接字符串，既不执行 await，也没有向任何队列发布消息；调用方若据此继续推进订单或结算流程，可能出现审计事件未投递但业务已完成的断层。涉及 auditTopic 的调用必须由实际入队操作确认结果，并在失败时进入可重试或告警路径，不能仅凭主题存在认定审计成功。

适用范围：`src/security/audit-policy.ts`

### all 返回隔离副本

AuditStore.all 复制条目与载荷，阻断调用方直接改动内部记录。

> AuditStore.all 通过 map 复制每个 AuditEntry，并重新创建 payload 对象，避免调用方获得 this.values 中的同一引用。团队读取审计列表时应只依赖返回副本进行展示或后续处理，不要把结果当作内部存储进行原地修改；否则一次字段赋值可能意外影响后续 all 查询。该规则适用于 AuditStore 的列表读取及其调用方对返回对象的处理。

适用范围：`src/storage/audit-store.ts`

### 审计追加与查询解耦

record 只负责追加，list 负责完整筛选与时间边界校验。

> AuditService.record 校验 action、actorId 后构造 AuditEntry 并交给 store.append；读取侧统一由 list 过滤，from 大于 to 时直接抛错。禁止在 record 中按读取顺序预裁剪或重排，因为这会让写入结果依赖查询时机，破坏审计记录的追加语义。适用于所有审计写入与查询链路，时间边界及动作、操作者过滤均以 list 为准。

适用范围：`src/services/audit-service.ts`

### 库存列表保持存储命名

list 直接沿用 stockList 的仓库过滤与返回结构，不在服务层二次改写。

> InventoryService.list 只把可选 warehouseId 转交给 store.stockList，并原样返回 StockItem 数组，不重命名字段、不把缺失项转换为空对象。这样可保持库存持久化对象与读取接口的一致命名，避免序列化后出现两套字段约定，也减少列表转换造成的边界遗漏。规则适用于按仓库筛选库存的查询路径；若未来调整 StockItem 的序列化字段，应同时调整 store.stockList，而不是仅在 list 中局部改名。

适用范围：`src/services/inventory-service.ts`

### store 固定持有单一存储

OrderService 通过只读 store 依赖访问订单存储。

> negative：OrderService 将 store 声明为 private readonly，表示一个服务实例固定依赖同一份 OrderStore，而不是在每次操作中替换或临时切换存储目标。这样可避免写入队列与读取查询落到不同数据源，适用于构造后需要保持存储一致性的订单服务；若要切换环境，应在创建 OrderService 时注入对应 OrderStore，而不是修改该字段。

适用范围：`src/services/order-service.ts`

### 退款筛选参数需运行时校验

TypeScript 接口不能替代外部筛选参数的运行时校验。

> RefundFilters 只约束 minAmountCents 与 reason 的编译期类型；当筛选条件来自 HTTP 请求时，RefundService.list 入口仍须验证值域和类型。原因是可选 number 可携带 NaN、负数或非数值，string 也可能混入非预期内容，错误数据会导致过滤结果失真。该规则适用于所有写入 RefundFilters 的外部输入，而不适用于已由内部代码构造并校验的参数。

适用范围：`src/services/refund-service.ts`

### 禁止原地改写结算明细

SettlementStore.update 仅接受非财务字段变更，accountId 与 lines 均不可修改。

> SettlementStore.update 先确认目标结算存在，再比较 accountId 及序列化后的 lines；任一财务内容不同便抛出 Error，禁止覆盖原批次。原因是结算账户和明细属于不可变财务事实，原地改写会破坏审计一致性。规则适用于所有 SettlementBatch 更新请求，允许调整的仅是 accountId 与 lines 之外的批次属性。

适用范围：`src/storage/settlement-store.ts`

### 禁止无条件二次执行

retryOnce 会重放所有失败操作，业务副作用可能重复。

> retryOnce 捕获 operation 的异常后直接再次调用 operation，没有检查 isTransient，也没有读取 retryBudget、retryDelay 或 retryLabel。因而数据库超时、参数校验失败等异常都会触发第二次执行；若 operation 已完成写入但响应失败，可能造成重复订单、重复扣款或重复通知。适用于包裹具有外部副作用的写操作；调用方需先按异常类型筛选可重试任务，并确认 operation 具备幂等性，不能把 retryOnce 当作通用故障恢复机制。

适用范围：`src/utils/retry.ts`

### 支付授权重试沿用原始错误

authorizeWithRetry 仅控制重试次数，不吞掉或转换 authorize 抛出的错误。

> 调用 authorizeWithRetry 时，authorize 必须是返回支付授权标识的异步操作，并可抛出上游异常。函数依据 canRetryPayment(payment) 将 retryLimited 的尝试次数设为 2 或 1，失败后仍保留原始错误，避免路由层误判为成功或改写失败原因。该约定适用于支付授权入口；新增重试参数时不得绕过 retryLimited，否则会破坏支付风险控制。

适用范围：`src/workflow/payment-workflow.ts`

### 库存数量统一走正整数门禁

quantity 统一拒绝非安全整数和零值，避免非法数量进入库存流转。

> 团队约定所有库存增减、预留与释放操作都先调用 quantity 校验数量，传入值必须为大于零的安全整数，零值也按非法处理。这样可阻止小数、负数及超出安全整数范围的数据进入 createStock、reserveStock、releaseStock 和 consumeStock 等路径，避免余额失真及并发比较异常。适用范围是库存领域内的数量参数，不用于表示可为零的初始库存。

适用范围：`src/domain/inventory.ts`

### 先校验过滤条件再查询

filters 完成全部字段和区间校验后才返回过滤条件。

> filters 的执行顺序固定为 memberId、status、from、to：optionalString 与 integerInput 负责类型检查，status 还必须属于允许集合，from 大于 to 时抛出 Error。任一条件不合法都会在生成 OrderFilters 前终止，防止部分构造的过滤对象被查询逻辑使用。

适用范围：`src/http/order-routes.ts`

### 避免无界发票聚合

Invoice.lines 与 notes 无长度上限，批量场景必须实施截断。

> Invoice.lines 和 notes 都是可增长数组，接口层不能假设 createInvoice、addInvoiceLine 后的聚合规模天然受控。大批量导入或重复追加可能扩大 invoiceTotal 计算及序列化开销；应按业务数量上限拒绝超限输入，而不是静默截断，避免金额结果与客户账单不一致。该约束适用于读取 Invoice、生成 invoiceLabels、保存发票及结算任务的入口。

适用范围：`src/domain/invoice.ts`

### 禁止把分值反写为主单位

Money.fromCents 只接收分值，读取层不得先调用 toMajor 再按元值写回。

> 负面经验约束是持久化金额保持分单位语义：读取 Money.fromCents 的结果后直接使用 cents 或继续传递 Money，不得先调用 toMajor 再把小数交给 Money.fromMajor。这样会引入二次缩放和舍入风险，使 1234 分被误写成 12.34 元。适用范围包括订单明细、库存占用、结算流水及审计事件的读取和回写链路。

适用范围：`src/domain/money.ts`

### 通知时间字段保持未设置

Notification 仅用可选时间字段区分送达与失败状态。

> 创建通知对象时不要为 deliveredAt 或 failedAt 填入默认值，例如 0、空字符串或当前时间。Notification 的 attempts 固定初始化为 0，而送达与失败时间应分别由 delivered、failed 流程按实际结果写入。缺少真实事件时间却预设值，会让 pending 查询、审计记录和统计逻辑误判通知状态。该规则适用于 createNotification 返回值以及所有新通知的初始构造。

适用范围：`src/domain/notification.ts`

### 支付失败统一拒绝入账

paySettlement仅接受已批准且有银行参考号的结算批次。

> 调用paySettlement前，结算批次必须处于approved状态，reference去除首尾空白后也不能为空；任一条件不满足时，函数直接抛出Error，不产生paid状态、bankReference或paidAt写入。银行流水号缺失可能造成账务状态与外部支付无法对应，因此该约束适用于所有通过paySettlement发起支付的入口，不只是人工操作场景。

适用范围：`src/domain/settlement.ts`

### 配送接口拒绝隐式字段改名

HTTP 入参沿用 messageId、reason 等稳定字段名，避免调用方与服务层因重命名失配。

> registerDeliveryRoutes 统一通过 objectInput、stringInput 和 optionalString 读取配送请求字段，并在调用 DeliveryService.begin、succeed、reject、receipts 时保留 messageId、recipient、reason 的既定名称。这样可阻止路由层自行改写持久化或服务接口所使用的字段格式，防止旧调用方提交的数据无法被识别；该约定适用于 registerDeliveryRoutes 暴露的全部 GET 与 POST 配送接口。

适用范围：`src/http/delivery-routes.ts`

### 库存路由拒绝越界字段

库存写接口只接收所属工作流参数，避免跨域字段被误用。

> registerInventoryRoutes 注册的库存写接口必须先以 objectInput 校验请求体，再只提取 service.initialize、service.receive、service.reserve、service.release 等操作所需字段。这样可防止调用方夹带其他模块字段后被底层误读，确保 HTTP 边界仅承担库存职责；新增库存操作时也应沿用显式取参方式。

适用范围：`src/http/inventory-routes.ts`

### 查询路由不承担并发写冲突

registerOrderRoutes 仅注册读接口，不能承担订单写入的版本冲突处理。

> registerOrderRoutes 只注册 GET /orders、/orders/export 与 /orders/count，handler 分别调用 list、exportRows 和 count，没有写入操作，也没有版本号比较、重试或冲突合并逻辑。并发更新订单时若出现版本冲突，处理必须位于订单写服务或存储事务层，不能寄希望于这些查询路由。该边界也避免把导出、计数请求误当成并发写入协调机制。

适用范围：`src/http/order-routes.ts`

### 整数输入拒绝非安全值

integerInput 统一校验整数与范围，避免不可靠数值进入业务层。

> 团队约定所有整数参数必须经过 integerInput：仅接受 number 或非空 string，使用 Number 转换后通过 Number.isSafeInteger 检查，并按 minimum、maximum 限定范围；失败时抛出 DomainError，并沿用 ERROR_CODES.INVALID_ORDER。原因是浮点数、超出 Number.MAX_SAFE_INTEGER 的值及空字符串会让金额、数量等字段产生不精确或不可持久化的表示。该规则适用于 src/http/request.ts 接收的分页和数组请求参数，尤其是依赖 Page、PageQuery、arrayInput、pageQuery 与 page 处理的输入；业务层不得绕过此校验直接采用原始值。

适用范围：`src/http/request.ts`

### 报表路由固定注册次序

registerReportRoutes 按收入、状态、会员顺序注册三个 GET 路由。

> registerReportRoutes 固定依次注册 GET /reports/revenue、GET /reports/status 和 GET /reports/members，并分别调用 ReportService.orderRevenue、statusCounts 与 topMembers。这样安排可让路由清单及测试断言保持稳定，也便于核对三个报表入口；orders 回调每次请求时取数，使后续报表依据最新订单计算。修改该函数时需同步检查注册顺序和对应 path，避免路由表出现意外差异。

适用范围：`src/http/report-routes.ts`

### 聚合入口可能放大版本冲突

根入口集中导出多层模块，并行修改易产生导出冲突。

> src/index.ts 通过 export 集中暴露 domain、services、storage、http、notifications、reports、workflow、utils 与 config。若多个分支并行新增同名导出，合并时可能产生符号冲突，且根入口变更会放大评审范围。并发开发应先确认各模块导出名称唯一，提交前检查根入口导出列表，必要时分批合并以定位冲突来源。

适用范围：整个项目

### 事件列表隔离内部数据

events 返回复制后的快照，调用方修改结果不会改写内部记录。

> NotificationDispatcher.events 先取得 delivered 中保存的事件，再复制每个事件及其 data 后返回数组。这样，调用方即使修改返回对象或嵌套数据，也不会直接改变 NotificationDispatcher 内部记录。该隔离规则适用于读取事件列表的测试、诊断和业务调用场景；需要改变内部状态时，应通过明确的管理操作完成，不能依赖修改 events 的返回值。

适用范围：`src/notifications/dispatcher.ts`

### 认领失败会污染状态

不可在认领失败后继续提交消息，必须依据返回值判断状态。

> 调用 NotificationOutbox 的 claim 后，只有正常返回的 OutboxMessage 才能进入发送流程。方法会将 state 从 pending 改为 delivering，同时把 attempts 加一；若消息已不处于 pending，或 nextAttemptAt 晚于 now，则直接抛出 Error。失败后不要沿用旧消息或提交重试，因为实际记录可能已经由其他工作者认领。

适用范围：`src/notifications/outbox.ts`

### CSV表头避免重复定义

CSV 字段顺序统一由 csvHeader 管理，禁止其他位置另写同义表头。

> 订单报表的 CSV 列名与顺序统一取自 csvHeader，返回内容固定包含 id、memberId、status、totalCents、refundedCents、createdAt。不要在其他导出入口单独维护一份相同或近似的表头，否则 toCsv 写入的数据行与列定义可能发生错位。该约定适用于本项目订单报表的 CSV 输出，新增或调整字段时应同步修改 csvHeader 与对应行数据生成逻辑。

适用范围：`src/reports/order-report.ts`

### latest 须处理零上限

AuditStore.latest 对 limit 边界缺少约束，零值会得到意外结果。

> AuditStore.latest 直接对 all 的结果执行 slice(-limit) 并 reverse，传入 limit 为零时 slice(-0) 等同于 slice(0)，因此会返回完整列表而不是空列表。服务层调用 latest 前必须自行校验 limit，只允许传入正整数；若未来要统一边界语义，应在方法入口处理非正数。问题适用于审计列表查询及任何可能传入零值的调用路径。

适用范围：`src/storage/audit-store.ts`

### 审计区间禁止倒置

AuditService.list 遇到 from 大于 to 会立即报错，避免生成矛盾查询条件。

> AuditService.list 只接受从早到晚的闭区间；当 AuditQuery 同时给出 from 和 to，且 from 大于 to 时，方法抛出 Error，而不是返回空数组或宽泛结果。这样的失败策略能阻止调用方误把参数顺序颠倒，并让分页、导出等批量查询及时暴露参数错误。该规则适用于按 createdAt 筛选审计事件的同步服务调用，不改变已定义区间的过滤语义。

适用范围：`src/services/audit-service.ts`

### 失败记录预留重试语义

DeliveryFailure 同时描述失败原因、下次重试时间与耗尽状态。

> DeliveryFailure 的历史数据不能只保存原因文本：reason 用于诊断，nextAttemptAt 决定后续调度，exhausted 标记是否已停止自动重试。迁移旧失败记录时必须为缺失字段提供明确默认值，尤其不能把未知耗尽状态默认为成功；否则同一 messageId 的恢复策略会与 DeliveryPolicy 产生不一致。

适用范围：`src/services/delivery-service.ts`

### 回执查询不记录投递日志

receipts 仅查询已送达回执，不承担审计日志职责。

> 团队经验是不要把 receipts 当作投递事件日志接口。它只从 outbox.list('delivered') 中筛选 recipient，并将 delivered 消息映射为 DeliveryReceipt；查询行为本身不记录成功或查询动作，因此无法证明某次回执查询曾发生。若业务需要投递审计，应由专门的审计链路保存事件，否则历史访问轨迹会丢失。该边界适用于回执页面、对账读取及按 recipient 查询场景。

适用范围：`src/services/delivery-service.ts`

### 权限校验不要下沉存储层

InventoryStore 仅负责数据操作，身份与授权由服务入口裁决。

> InventoryService.store 只保存 readonly 的 InventoryStore 引用，不能让存储实现承担调用者身份、角色或资源范围判断。原因是 getStock、putStock 等数据接口通常被多个业务流程复用，混入权限语义会导致同一数据操作出现不一致授权结果。访问控制应在 InventoryService 的业务入口完成，再把已获准的数据操作交给 store。

适用范围：`src/services/inventory-service.ts`

### 导入失败被批量吞并

importRows 将所有 create 异常归为跳过，无法区分重复与真实故障。

> MemberService.importRows 捕获 create 抛出的任意 Error，并只把 row.email 放入 skipped；重复成员与存储异常因此具有相同结果。由于缺少失败原因，调用方不能据此决定重试、修复数据或触发精确缓存失效。批量导入若需要可靠恢复，必须限制该宽泛 catch 的适用范围，并保留可区分的失败信息。

适用范围：`src/services/member-service.ts`

### 避免逐事件查询发送状态

hasSent 适合确认单个事件，直接用于大批量检测会放大查询开销。

> NotificationService.hasSent 仅委托 dispatcher.hasSent 检查指定 eventId，适合单事件幂等判断或小规模校验。对成批事件逐个调用会把一次批量操作退化为多次状态查询，事件数量增大时延迟与负载同步上升。大规模重放场景应优先取得批量结果或汇总发送计数，再决定是否对少量可疑事件调用 hasSent。

适用范围：`src/services/notification-service.ts`

### 禁止把业务时钟藏进存储

SettlementService 依赖 store，但时间策略由服务边界显式控制。

> SettlementService 的 store 仅承担 SettlementBatch 的持久化职责，不把当前时间、审批时间或支付时间藏在写入逻辑中。prepare、approve、pay 分别把 this.now() 传给 createSettlement、approveSettlement、paySettlement，使时间来源可替换且能随业务操作审计，适用于结算状态推进和历史记录生成。

适用范围：`src/services/settlement-service.ts`

### approve信任TypeScript类型

approve直接接收字符串参数，未做运行时校验。

> SettlementService.approve把id和memberId都视为string，并直接传入approveSettlement；TypeScript能检查编译期类型，却不能阻止外部请求传入非字符串。该负面经验适用于approve的HTTP或消息入口：这些边界必须先校验参数，再调用approve。若绕过边界传入错误运行时类型，approveSettlement和store.update的行为将不可靠，因此类型声明不能替代入口验证。

适用范围：`src/services/settlement-service.ts`

### 缺失结算批次立即抛错

get 查询不到 SettlementBatch 时直接抛出 Error。

> SettlementService.get 不返回空值或可空类型，而是从 this.store.get(id) 取出 batch 后检查结果；找不到记录便执行 throw new Error('Settlement not found')。这样能让调用方在引用不存在的结算批次时立即中断，避免后续逻辑误用 undefined。该约定适用于所有通过 SettlementService.get 按 id 读取结算数据的调用场景。

适用范围：`src/services/settlement-service.ts`

### 未知状态不得视为可取消

canCancel 对非白名单状态返回 false，避免误取消。

> canCancel 采用明确状态白名单，order.status 未命中 draft、paid 或 partially-refunded 时一律返回 false，而不是把未知状态当成可操作。调用 cancelOrder 时，空集合式的判断结果必须按禁止处理，以避免新状态、异常数据或边界订单被误取消。该约束适用于取消入口及其上层流程，不能通过默认放行绕过检查。

适用范围：`src/workflow/order-workflow.ts`

### 预约读取不引入动态时间

getReservation 仅按标识查询，保留跨流程读取的稳定性。

> InventoryStore.getReservation 只通过 this.reservations.get(id) 获取预约，并返回展开后的副本，不调用系统时间、不计算剩余时长，也不附加读取时刻。这样可避免同一预约因调用环境时钟不同而出现不一致结果，适合库存锁定、释放判断及订单关联等需要复现历史状态的处理。

适用范围：`src/storage/inventory-store.ts`

### 生产判定只认环境字段

isProduction 仅依据 environment 精确判断，避免依赖部署名称。

> isProduction 只检查 Settings.environment 是否等于 production，不依据主机名、目录或其他运行条件推断。配置读取应先经 loadSettings，随后把返回值交给 isProduction；适用于决定生产专属行为的环境判定，避免同一配置在不同工作区产生误判。

适用范围：`src/config/settings.ts`

### save覆盖写入的风险

按成员ID覆盖写入，旧值不可恢复且会受重试影响。

> MemberStore.save 直接调用 values.set(member.id, member)，同一成员ID再次保存会覆盖原对象，方法返回的 member 也无法证明此前数据未被替换。重试若携带过期成员，可能把较新的字段还原为旧值，因此调用方应先通过 get 核对版本或更新时间，并在冲突时停止重试。该负面经验适用于内存成员写入及任何按ID覆盖的流程；若业务要求保留历史，不能继续依赖 save 的返回对象作为审计记录。

适用范围：`src/storage/member-store.ts`

### 订单内存存储的边界约束

OrderStore 使用实例级 Map 隔离订单数据，避免跨实例或工作区共享状态。

> OrderStore 将 orders 放在 private readonly values 中，每个实例通过 new Map\<string, Order>() 创建独立存储。该设计把订单状态限定在当前 OrderStore 实例内，避免不同工作区或测试场景因共享 Map 而发生数据串扰；同时 readonly 防止外部直接替换容器。适用于需要隔离实例状态的内存存储实现；若后续引入跨实例查询或持久化恢复机制，应另行设计数据边界，不能直接共享 values。

适用范围：`src/storage/order-store.ts`

### 分页参数失败须整次拒绝

非法 offset 或 limit 立即抛错，不返回带歧义的部分结果。

> paginate 遇到 offset 小于零或 limit 不大于零时直接抛出 Error，不以截断、默认值或空 items 继续执行。否则调用方会误把失败结果当作合法分页，并可能因不一致的 offset、limit、total 产生错误的后续请求；该规则适用于所有调用 paginate 的批量读取路径。

适用范围：`src/utils/pagination.ts`

### 可空字符串不自动补默认值

缺失或纯空白文本统一返回 undefined，避免把无效输入伪装成有效值。

> 负面经验：不要再为 optionalString 增加空串转固定文案等默认逻辑。当前实现只接受 trim 后仍有内容的 string，否则返回 undefined；原因是默认值应由订单、库存或通知领域规则决定，校验工具擅自补值会掩盖脏数据并污染持久化结果。该约定适用于可选文本的清洗及历史数据映射；确需业务默认值时，应在对应服务层明确赋值，而非修改 optionalString 的通用行为。

适用范围：`src/utils/validation.ts`

## 教程

### 投递失败采用指数延迟

投递服务根据尝试次数计算指数延迟，并以 maximumDelay 限制等待时间

> 投递服务根据尝试次数计算指数延迟，并以 maximumDelay 限制等待时间。失败原因必须包含非空文字。该规则适用于通知投递。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/services/delivery-service.ts`

### 成员邮箱统一小写

成员创建时去除邮箱两端空白并转换为小写

> 成员创建时去除邮箱两端空白并转换为小写。重复邮箱会被拒绝。这个规则适用于成员服务。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/domain/member.ts`

### 支付风险使用失败次数

支付风险等级结合支付状态和失败次数计算

> 支付风险等级结合支付状态和失败次数计算。成功状态返回低风险。这个规则适用于支付工作流。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/workflow/payment-workflow.ts`

### 订单取消写入原因备注

取消订单时把原因写入内部备注

> 取消订单时把原因写入内部备注。已经退款的订单不能取消。该规则适用于订单工作流。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/workflow/order-workflow.ts`

### 审计记录保留事件时间

审计记录保存创建时间并保持原始顺序

> 审计记录保存创建时间并保持原始顺序。导出和查询都不能修改时间字段。这个规则适用于审计报告。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/storage/audit-store.ts`

### 订单内部备注按顺序追加

新增备注追加到数组末尾，不覆盖已有内容

> 新增备注追加到数组末尾，不覆盖已有内容。返回对象保留订单其他字段。该规则适用于订单领域。 修改相关调用时需要保持数据结构和错误处理方式。提交前使用已有测试确认边界结果，后续成员可以根据这条记录理解适用范围。遇到跨模块调用时还要检查错误传播、返回值复制和记录顺序，避免局部修改影响其他业务流程。

适用范围：`src/domain/order.ts`

### 订单筛选边界统一校验

OrderFilters 的金额与时间范围须按统一边界规则校验。

> 构造 OrderFilters 时，将 from、to 视为闭区间端点，minTotalCents 与 minRefundCents 不得为负数；from 大于 to 时返回空集合而不是交换边界。该规则适用于 OrderService 的订单筛选入口，用于避免范围被意外扩大，并保持 memberId、status 条件与金额、时间条件的组合语义稳定。

适用范围：`src/services/order-service.ts`

### 库存时间戳注入可复现

InventoryService 使用 now 注入时间，使库存测试和持久化结果可复现。

> InventoryService.now 应保留为只读时间函数，并在创建或变更库存记录时统一取得时间戳。测试应注入固定时钟而非依赖真实时间；该规则适用于 initialize 及后续库存写入路径，以保证时间字段可预测。

适用范围：`src/services/inventory-service.ts`

### 成员路由显式声明方法

注册成员接口时明确填写 method 与 path，避免请求进入错误处理分支。

> 在 registerMemberRoutes 中，每条 route 都显式设置 method、path 和 handler；列表、导入及单项查询分别使用 GET、POST、GET。这样可避免路由注册信息缺失或冲突，使 MemberService 的 list、importRows 与 get 能稳定接到对应请求。改动成员路由时，应核对注册顺序、路径参数和实际处理函数。

适用范围：`src/http/member-routes.ts`

### 审计区间先校验再筛选

AuditService.list 遇到倒置时间范围时直接报错，避免返回含糊结果。

> 调用 AuditService.list 时，若 from 与 to 均已设置但 from 大于 to，应先抛出 Error，不再执行筛选。适用于客服审计查询的时间边界校验，可防止无效区间被误解为可用结果。

适用范围：`src/services/audit-service.ts`

### 事件字段写入后再派发

NotificationEvent 各字段应完整组装后再交给派发器。

> 创建 NotificationEvent 时，先完整写入 eventId、template、data 与 recipient，再调用 NotificationDispatcher.dispatch。这样可避免字段缺失导致模板或收件地址在派发阶段才暴露问题，适用于所有由该接口承载的通知事件。

适用范围：`src/notifications/dispatcher.ts`

### 投递时钟须可注入

DeliveryService 通过 now 函数取得当前时间。

> DeliveryService 应使用注入的 now 获取时间，不在重试或延迟计算中直接读取系统时钟。测试可传入确定性函数验证时间边界，生产环境再提供真实时钟，适用范围为等待时长与到期判断。

适用范围：`src/services/delivery-service.ts`

### 角色权限按层级判定

canActAs 按角色等级和启用状态授权。

> canActAs 要求 member.active 为真，并以 viewer、agent、manager、owner 的等级比较 required 所需角色。团队约定权限判断集中在此函数执行，适用于需要角色门槛的订单操作；新增角色时必须同步 ranks，避免出现未定义等级。

适用范围：`src/security/identity.ts`

### 统计复用列表筛选结果

OrderService.count 以同一筛选集合长度计数。

> OrderService.count 调用 this.list(filters) 后读取 length，不再另建统计查询条件。这样订单数量与列表使用相同筛选口径，适用于需要展示筛选结果总数的接口。

适用范围：`src/services/order-service.ts`

### store 依赖须显式注入

SettlementService 的 store 由构造参数提供并保持只读。

> SettlementService.store 应声明为 private readonly，并通过 constructor 注入 SettlementStore。该约束适用于结算服务的创建和测试，测试实例必须绑定隔离存储，避免操作真实数据。

适用范围：`src/services/settlement-service.ts`

### 存储读取须复制明细

SettlementStore 返回批次时须复制 lines，避免调用方改写存储内明细。

> copyBatch 应为 SettlementBatch 创建新对象，并对 value.lines 中每个 line 执行浅复制后返回，使 get、list 的读取结果被调用方修改时不会改变 SettlementStore 保存的数据。批次状态更新与明细读取可能并发，故查询和列表输出均适用。

适用范围：`src/storage/settlement-store.ts`

### makeId 唯一性边界

makeId 必须为每次批次生成独立标识，空集合也需生成有效批次。

> SettlementService 的 makeId 每次调用都应返回非空且可区分的 string。prepare 即使收到空 orders，也要先生成 batch 标识再创建记录，避免空集合路径丢失批次身份。

适用范围：`src/services/settlement-service.ts`

### approve 先校验再更新批次

approve 通过 get 读取批次，审批后以 update 保存。

> SettlementService.approve 应先调用 this.get(id) 取得待审批 SettlementBatch，再执行 approveSettlement，并使用 this.store.update 写回；memberId 与 id 不得交换，避免操作记录关联到错误成员或批次。

适用范围：`src/services/settlement-service.ts`

### 批次内存表保持只读引用

SettlementStore.batches 使用只读 Map 承载批次副本。

> SettlementStore 的 batches 初始化为 readonly Map，并通过 copyBatch 隔离写入与读取对象。原因是直接保存调用方引用会让外部修改绕过仓储边界，破坏已存批次状态。修改 SettlementStore 存取逻辑时，应保留快照语义和批次标识索引。

适用范围：`src/storage/settlement-store.ts`

### 订单索引独立保存归属

SettlementStore.orders 记录订单与结算批次的归属关系。

> SettlementStore 的 orders 使用 readonly Map 保存订单标识及其结算批次标识。原因是后续创建操作需要快速识别订单是否已进入既有 SettlementBatch，避免重复占用。该规则适用于订单归属索引的维护，不应把它当作批次详情数据源。

适用范围：`src/storage/settlement-store.ts`

### 先创建客户再执行标签操作

统一客户写入顺序，避免更新不存在的客户。

> 新增客户数据时，先通过 createCustomer 创建并保存 Customer，再调用 addTag 或 removeTag 调整 tags；读取列表时使用 searchCustomers，筛选可交易客户时使用 activeCustomers。该顺序让标签变更始终落在已持久化的客户上，避免检索结果与标签状态不一致，适用于服务层的新客建档流程。

适用范围：`src/domain/customer.ts`

### 释放库存按实占数量回补

releaseStock 只能释放已预留数量，并将该数量从 reserved 转回 available。

> 执行 releaseStock 前先由 quantity(amount) 校验数量，再比较 amount 与 item.reserved；若释放量超过实占预留量，函数抛出 Error，避免凭空增加可用库存。合法释放会将 available 加回 amount、从 reserved 扣除 amount，并更新 version 与 updatedAt。此做法适用于取消订单、关闭预留及回滚占用流程。

适用范围：`src/domain/inventory.ts`

### 以 Member 固定成员边界

成员领域对象统一身份、角色与生命周期字段。

> 团队在领域层统一使用 Member 承载成员数据，role 仅允许 owner、manager、agent、viewer，active 表示成员是否启用，joinedAt 保存加入时间。该结构用于订单、邀请和成员管理相关逻辑，新增成员类型时先扩展此接口再调整调用方，避免各服务自行定义不一致的成员字段。

适用范围：`src/domain/member.ts`

### 结算付款前校验状态

paySettlement 仅接受已审批且有有效银行凭证的结算批次。

> 调用 paySettlement 时，batch.state 必须为 approved，reference 去除首尾空白后也不能为空，否则函数抛出 Error，批次的 state、bankReference 与 paidAt 均不会更新。该边界用于阻止未审批结算进入 paid 状态，并避免付款记录缺失银行流水号。适用于所有基于 SettlementBatch 发起付款的服务层或路由处理。

适用范围：`src/domain/settlement.ts`

### 折扣比例先验校验

discountLine 拒绝非有限值及不在 0 至 100 范围内的折扣比例。

> 跨模块调用 discountLine 时，percent 必须能通过 Number.isFinite，且位于 0 到 100 的闭区间；非法输入会抛出 Error，不产生 Money 返回值。校验放在金额换算之前，可避免 NaN、Infinity 或越界比例进入 Money.fromCents。该约定适用于订单优惠、成员折扣和任何复用 discountLine 的结算入口。

适用范围：`src/domain/settlement.ts`

### 订单折扣返回新金额

discountOrder 返回独立 Money 值，不修改 Order 或其中的订单行。

> 做法：调用 discountOrder 获取折扣结果时，将每条 order.lines 的 unitPrice.multiply(quantity) 传入 discountLine，再通过 Money.add 汇总。返回的 Money 是调用方可继续使用的金额值，不应反向写入原订单，因此 Order 及其 lines 在计算期间保持不变。该做法适用于优惠试算、结算预览和重算；调用方若要采用结果，应显式保存返回值，避免误以为 discountOrder 已修改 order.lines。

适用范围：`src/domain/settlement.ts`

### 结算行失败回滚

SettlementLine 的金额字段须整体写入，失败时不保留半成品结算行。

> 教程：构造 SettlementLine 时，先准备 orderId、memberId、grossCents、refundedCents、feeCents 和 payableCents，再将完整对象交给 createSettlement。任一校验或持久化步骤失败，不得只提交已填写的金额字段，否则会留下无法解释 payableCents 与 grossCents 差异的半成品记录。适用范围是结算明细的创建、批量导入与重算；重试应从业务输入重新生成 SettlementLine，而不是复用失败中的可变对象。

适用范围：`src/domain/settlement.ts`

### 派发前执行接收状态判定

dispatch 先检查事件是否已接收，再记录事件并返回处理结果。

> 调用 NotificationDispatcher.dispatch 时，先用 delivered.has(event.eventId) 判断当前事件是否已有接收记录；未接收时，将事件及独立复制的 data 写入 delivered，并返回 delivered 为 true。已存在相同事件标识时直接返回 false，避免同一事件再次进入后续通知处理。返回值同时携带 eventId，便于调用方关联本次处理结果；该规则适用于 NotificationDispatcher 接收事件的统一入口。

适用范围：`src/notifications/dispatcher.ts`

### 会员导入按业务键重试

导入请求可安全重试时，以相同业务键避免重复写入。

> 调用 POST /members/import 时，客户端重试必须复用同一批业务键，由 service.importRows 依据业务键判定是否已经处理；只有不存在重复记录时才新增。这样可应对网络超时或响应丢失后的再次提交，且不会因重试扩大数据偏差。该做法适用于 registerMemberRoutes 暴露的导入接口，不要求客户端生成新的会员标识，也不应把传输层重试误当作重复导入机制。

适用范围：`src/http/member-routes.ts`

### 对象输入先做结构校验

objectInput 拒绝空值、数组及非对象请求体。

> 调用 objectInput 时，传入值必须是非空对象且不能是数组；否则立即抛出携带 ERROR_CODES.INVALID_ORDER 的 DomainError。该入口用于请求体进入服务层前建立可信边界，可阻断数组误走对象字段解析造成的越界访问或错误写入。适用范围是所有需要按字段读取并写入订单、库存、结算数据的 HTTP 输入。

适用范围：`src/http/request.ts`

### 统一路由处理函数契约

跨模块注册路由时使用统一的 Route 结构，避免处理函数签名在调用链中漂移。

> 跨模块调用约定：任何需要交给 RouteRegistry 注册的入口，都应封装为 Route，提供 method、path 和 handler 三个属性。handler 接受可变参数并返回 unknown，使 HTTP 路由、服务层调用和测试替身能沿同一契约传递；具体入参与返回值由调用场景收紧，而不在 Route 层写死。这样可避免不同模块各自解释处理器签名，适用于新增路由、提取处理函数及编写注册测试。

适用范围：`src/http/route-registry.ts`

### 到期消息按时间与编号领取

due 仅返回已到重试时间的待处理消息，并按确定性顺序截取。

> 调用 due 时先校验 limit 为正整数，再筛选 state 为 pending 且 nextAttemptAt 不晚于 now 的消息。结果按 nextAttemptAt、id 排序后截取，并用 copyMessage 返回副本，避免调用方修改内部状态。该规则适用于调度通知任务、限制单批扫描数量及保证多实例选择顺序稳定。

适用范围：`src/notifications/outbox.ts`

### 领取动作推进投递状态

claim 只接收到期待处理消息，并递增尝试次数后进入 delivering。

> 领取消息时，通过 get 读取目标记录；仅当 state 为 pending 且 nextAttemptAt 不大于 now 才允许继续。claim 创建 claimed 副本，将状态改为 delivering，并把 attempts 加一后写回 values。该流程适用于消费者正式发送通知前获取任务，配合状态检查阻止未到期消息被重复领取。

适用范围：`src/notifications/outbox.ts`

### 按名称取模板并缓存结果

renderTemplate 集中解析模板，新增模板时按名称接入缓存。

> 调用通知渲染逻辑时，统一通过 renderTemplate 传入模板名称与 data，不要绕过模板表直接拼接文案。函数从 templates 取到 Template 后调用 render，未命中名称会抛出 Error，避免发出缺少关键变量的通知。模板内容调整后，必须同步更新对应缓存结果；新增模板则先登记到 templates，再由业务层调用 renderTemplate。

适用范围：`src/notifications/templates.ts`

### begin 用 claim 领取消息

begin 将消息标识交给 outbox.claim，返回领取到的 OutboxMessage。

> 执行 DeliveryService.begin 时，以传入的 id 调用 this.outbox.claim，并返回 claim 生成的 OutboxMessage，而不是由服务层自行拼装状态。这样可把原子领取、状态迁移及失败处理留在 outbox 边界内，减少 begin 与其他 worker 争抢同一消息时出现部分状态的机会。适用于投递任务开始执行前确认归属的流程；若 claim 抛错，调用方不得继续发送消息，应先处理领取失败。

适用范围：`src/services/delivery-service.ts`

### succeed 先完成再组装回执

succeed 依赖 complete 的原子结果，再生成 DeliveryReceipt。

> DeliveryService.succeed 先调用 this.outbox.complete(id, this.now())，取得已完成的 OutboxMessage 后，才把 message.id、recipient、deliveredAt 与 attempts 映射为 DeliveryReceipt。complete 是并发写入时的状态提交点：若它因版本冲突或其他存储错误失败，succeed 不会返回伪造成功回执，也不会读取旧消息补齐字段。适用于发送成功后的确认流程；调用方收到回执后再推进订单通知等后续步骤。

适用范围：`src/services/delivery-service.ts`

### 交付回执读取规范

从 outbox 提取已送达回执，并按接收方筛选。

> 调用 receipts 时，先通过 outbox.list('delivered') 限定已送达消息，再按 recipient 可选条件执行 filter，最后使用 map 生成 DeliveryReceipt。回执中的 messageId 取自消息 id，deliveredAt 使用送达时间，attempts 保留投递次数。这样可避免把未送达消息暴露为回执，并允许调用方查询全部接收方或指定 recipient；修改该读取逻辑时，还需保持 DeliveryReceipt 的字段结构稳定。

适用范围：`src/services/delivery-service.ts`

### create 走单项持久化

OrderService.create 将单个 Order 交给 store.save。

> tutorial：新增订单时，调用 OrderService.create(order)，并把传入的单个 Order 原样交给 this.store.save，随后直接返回 save 的结果。新增路径不承担列表筛选、汇总或拆单职责，批量操作应使用独立流程，避免让 create 接受数组后改变返回契约。该做法适用于创建单个订单时需要复用统一存储写入逻辑的场景。

适用范围：`src/services/order-service.ts`

### 写入预留须完整保存

putReservation 将传入预留完整落库，不设置业务默认值。

> 调用 InventoryStore.putReservation(value) 前，调用方必须提供完整的 Reservation，包括 value.id 等业务字段；该方法不会为缺失字段补充默认值。它以 value.id 为键执行 this.reservations.set，并在返回前复制 value，避免调用方继续修改已保存对象。涉及预留状态、订单关联或数量的缺省处理应在领域服务中完成，再把完整结果交给存储层，适用于新建和更新预留的流程。

适用范围：`src/storage/inventory-store.ts`

### 新库存写入需双层校验

初始化前校验库存键与数量，并预置缓存失效版本。

> 调用 createStock 时，先用 stockKey 确认 warehouseId 与 sku 构成合法且唯一的库存维度，再要求 amount 为非负安全整数。随后写入 available=amount、reserved=0、version=1，并让缓存保存同一 StockItem；后续库存变更递增 version 以触发失效。由此拦截负数、溢出值和错误仓库维度，避免缓存出现可被 reserveStock 使用的畸形记录。适用于所有首次入库或重建库存记录流程。

适用范围：`src/domain/inventory.ts`

### 邀请权限先判状态

canInvite 先检查 active，再校验 owner 或 manager 角色。

> 实现成员邀请授权时，调用 canInvite，并先读取 member.active，再判断 member.role 是否为 owner 或 manager；只有状态有效且角色具备管理资格的成员才返回 true。该顺序可阻止已停用成员继续发出邀请，同时避免仅凭角色放行。规则适用于邀请成员、恢复邀请能力以及审计授权结果等场景，调用方不应绕过 canInvite 自行组合判断。

适用范围：`src/domain/member.ts`

### 结算行生成需同步完成

settlementLine 依赖订单总额与退款额，生成结算行时应同步取得结果。

> 使用 settlementLine 生成结算行时，应先通过 orderTotal 与 refundTotal 取得订单金额，再计算净金额和手续费；两项数据必须来自同一订单结算快照，避免等待期间退款变化导致 payableCents 与记录不一致。该做法适用于 paid、partially-refunded、refunded 订单的单项结算及批量结算准备阶段。

适用范围：`src/domain/settlement.ts`

### 结算审批权限落在服务层

通过账户归属与审批人字段控制结算状态变更，避免仅靠路由层鉴权。

> 结算权限检查统一放在 approveSettlement 与 paySettlement 等服务入口：先核对 SettlementBatch.accountId 与当前操作者可管理账户的归属，再依据 state 判断能否执行审批或付款。approvedBy、approvedAt 用于固化审批责任链，bankReference 和 paidAt 用于确认付款结果。HTTP 路由只负责解析参数与返回响应，不能代替服务层校验。该规则适用于所有结算批次的创建、审批和支付调用，也适用于后台任务或消息消费者绕过 HTTP 层直接调用服务的情况。

适用范围：`src/domain/settlement.ts`

### 迁移默认值后覆盖输入

migrateSettings 先建立默认配置，再用输入项完成覆盖。

> 迁移旧配置时调用 migrateSettings，先创建包含 schemaVersion、timezone 与 retryLimit 的默认 Settings，再展开 input 覆盖对应项；读取方随后通过 loadSettings 获取最终结果。该顺序适用于配置结构升级，可确保缺失字段有稳定默认值，同时保留调用方提供的有效配置。

适用范围：`src/config/settings.ts`

### 业务标识由请求提供

预留号和订单号不从服务端临时生成，调用方必须提交稳定标识。

> registerInventoryRoutes 处理 /inventory/reserve 时，使用 stringInput 从 input.reservationId 和 input.orderId 读取业务标识，并把它们交给 service.reserve。这样同一个订单或预留可被追踪、重试和释放，也避免服务层在每次请求中产生无法与外部记录对应的编号。新增库存接口若涉及幂等键、关联订单或仓库记录，应沿用这一做法；标识的唯一性由调用方与 InventoryService 的业务校验共同保证。

适用范围：`src/http/inventory-routes.ts`

### 整数输入先校验再返回

integerInput 拒绝非整数、越界值及非法类型，统一抛出 DomainError。

> 处理数量、页码等整数参数时，先调用 integerInput 完成输入归一化和边界检查。它接受 number 或可转换的数字字符串，空串直接失败；转换后须通过 Number.isSafeInteger，并位于 minimum 与 maximum 之间。任何校验失败均抛出 DomainError，错误码使用 ERROR_CODES.INVALID_ORDER，调用方不会收到部分转换结果。该规则适用于 src/http/request.ts 中所有需要整数值的请求参数。

适用范围：`src/http/request.ts`

### 路由到服务的调用链

registerSettlementRoutes 只负责路由注册和输入转换，业务操作交给 SettlementService。

> 新增结算路由时，在 registerSettlementRoutes 内通过 registry.register 声明 method、path 与 handler，并在 handler 中把 unknown 输入转换为受约束参数，再按职责调用 SettlementService：列表调用 list，准备调用 prepare，审批调用 approve，付款调用 pay，汇总和导出分别调用 summary、exportRows。路由层不承载结算状态流转，service 层也不依赖 HTTP 路径，从而保持跨入口调用和历史数据迁移的一致边界。

适用范围：`src/http/settlement-routes.ts`

### 结算写路由并发处理

结算写操作须由服务层串行化或使用版本校验，避免并发状态覆盖。

> registerSettlementRoutes 暴露的 prepare、approve、pay 均调用 SettlementService，路由层不写入，也不承担并发控制。SettlementService 须对同一结算单的 approve、pay 实施原子状态转换，并在冲突时依据存储层版本或当前状态拒绝旧请求，避免并发审批、重复付款及后到请求覆盖状态。适用于 registerSettlementRoutes 注册的全部结算写接口；list、summary、exportRows 等只读接口可并行执行。

适用范围：`src/http/settlement-routes.ts`

### 结算输入先过边界校验

空数组和越界费率应由路由入口按既定规则处理。

> 调用 /settlements/prepare 时，handler 先用 arrayInput(input.orders, 'orders') 取得订单集合，再用 integerInput(input.basisPoints, 'basisPoints', 0, 10000) 限定费率范围，并默认取 0。空 orders 能否生成结算须由该接口规则明确决定，不能让 undefined 绕过校验；此约定适用于订单数组及 basisPoints 等所有结算准备参数。

适用范围：`src/http/settlement-routes.ts`

### 结算时间源下沉服务层

路由不直接读取时钟，审计时间由 SettlementService 统一生成。

> registerSettlementRoutes 的 handler 只解析请求参数并调用 SettlementService，不应直接读取系统时间。prepare、approve 和 pay 往往需要写入结算时间、审计时间或判断状态时效，若 HTTP 层单独取时，容易与领域服务及存储记录产生偏差；时间来源应由 SettlementService 统一控制，适用于所有会改变结算状态的 POST 路由。

适用范围：`src/http/settlement-routes.ts`

### 统一入口导出边界

src/index.ts 集中公开领域、服务与基础设施模块，调用方从包入口导入。

> 在 src/index.ts 中通过 export \* from 公开 domain、services、storage、security、http、notifications、reports、workflow、utils 与 config 下的模块，让调用方统一从包入口导入，避免依赖深层文件路径。新增跨层公共能力时，遵循现有目录边界加入对应导出；仅供模块内部协作的实现不要放入入口，防止扩大公共 API 并造成循环依赖。

适用范围：整个项目

### 按 ID 获取通知消息

get 查询缺失记录时抛出错误，并返回隔离后的消息副本。

> 跨模块读取单条通知时，调用 NotificationOutbox 的 get 方法并传入 id。记录不存在会抛出 Error，而不是返回 undefined；成功时仍通过 copyMessage 返回 OutboxMessage 副本，调用方修改 data 等字段不会污染 values。该约定适用于需要明确区分“未找到”和“读取成功”的服务层、路由层及任务处理代码。

适用范围：`src/notifications/outbox.ts`

### due按到期顺序返回隔离副本

due校验limit，并按重试时间与id排序后复制待发送消息。

> 调用 NotificationOutbox.due 时，limit 必须是正整数，否则抛出 Error；筛选范围仅包含 state 为 pending 且 nextAttemptAt 不晚于 now 的消息。实现先按 nextAttemptAt、id 排序，再截取前 limit 条，并通过 copyMessage 返回副本，防止调用方修改结果后影响 NotificationOutbox.values。该做法适用于调度器批量领取到期通知，也用于测试验证确定性顺序。

适用范围：`src/notifications/outbox.ts`

### 从模板表生成可用名单

templateNames 返回当前已登记模板，供配置校验和选择界面使用。

> 需要展示模板选项或校验外部传入的名称时，调用 templateNames 获取 Object.keys(templates) 的结果，不再维护第二份名称清单。名单必须直接来源于 templates，才能保证新增或移除模板后与 renderTemplate 的实际可渲染范围一致。该函数只负责枚举，不负责执行渲染，也不应过滤非法名称。

适用范围：`src/notifications/templates.ts`

### 按动作筛选审计记录

AuditStore.byAction 复用 all 的隔离副本，再按 action 精确筛选。

> AuditStore.byAction 先调用 all 获取与内部状态隔离的记录集合，再用 filter 保留 action 完全相等的 AuditEntry。团队需要按业务动作查询审计轨迹时，应使用 byAction，不要直接遍历 values 并自行共享条目引用；统一入口既能保持读取副本策略，也能确保筛选条件只依据 action 字段。该做法适用于审计查询接口及服务层按动作分组场景。

适用范围：`src/storage/audit-store.ts`

### 注入审计ID生成器

通过 AuditService.id 注入标识生成函数，隔离生成策略并支持稳定测试。

> 在 AuditService 中使用私有只读字段 id 保存返回 string 的生成函数，由构造或依赖注入阶段提供具体实现。record 产生审计记录时调用该函数，而不是在方法内部固定生成逻辑。这样既能让每条记录拥有唯一标识，也便于测试使用固定序列或预设值验证顺序。适用范围是 AuditService 的审计写入流程；若业务需要特定编号格式，应替换 id 的提供方式。

适用范围：`src/services/audit-service.ts`

### 审计查询采用闭区间

AuditQuery 同时提供动作、操作者和时间边界筛选。

> 调用 AuditService.list 时，用 AuditQuery.action 与 actorId 缩小审计范围，并用 from、to 限定 createdAt 所在的时间窗口。当前实现包含两端边界，即 from 和 to 均命中的记录都会保留；筛选条件缺省时不做对应限制。构造测试数据时，应让时间戳分布覆盖区间内外，以确认闭区间语义。

适用范围：`src/services/audit-service.ts`

### 审计存储保持单一入口

AuditService.store 统一承接读写依赖，避免业务逻辑直接操作持久化结构。

> AuditService 将存储依赖限定在私有只读字段 store 中，新增记录与查询结果都经由该实例流转，不允许路由层或其他服务直接改写底层数据。readonly 约束可阻止运行期间替换存储实现，私有边界则避免外部绕过 record、list 建立旁路写入。采用这一结构时，依赖注入负责提供 AuditStore 实例，序列化、并发与持久化细节留在存储实现内部。

适用范围：`src/services/audit-service.ts`

### 调用方按交付策略配置

跨模块调用通过 DeliveryPolicy 明确重试与批处理边界。

> 跨模块接入投递流程时，调用方应传入 DeliveryPolicy，并分别设置 maxAttempts、initialDelay、maximumDelay 与 batchSize。这样重试上限、等待节奏和单批规模不会散落在路由或服务实现中；配置还应与 DeliveryReceipt.attempts 的计数口径一致，避免多个入口对同一 messageId 得出不同的尝试结论。

适用范围：`src/services/delivery-service.ts`

### 预留输入须完整提供

ReserveInput 要求调用方显式提供全部预留字段。

> 构造 ReserveInput 时，必须同时给出 reservationId、orderId、warehouseId、sku 与 quantity，不能依赖服务层推断或补齐业务值。这五个字段把一次预留与订单、仓位、品类及数量绑定，缺少任何一项都会使幂等核对或库存归属无法成立。该做法适用于 InventoryService.reserve 的所有调用方及新增预留场景。

适用范围：`src/services/inventory-service.ts`

### 用发送计数构造可重放夹具

测试可读取 dispatcher 的 sentCount，校验通知批次是否被完整重放。

> 编写通知重放测试时，通过 NotificationService.sentCount 读取 dispatcher.sentCount 返回的 number，并与期望发送次数比较。该做法适用于批量通知、失败重试及幂等场景：先记录发送前计数，再触发待重放事件，最后确认计数按实际尝试增加，避免依赖外部通知平台的即时状态。

适用范围：`src/services/notification-service.ts`

### 导出记录复用统一筛选

OrderService.exportRows 先调用 list，再映射为稳定的导出字段集合。

> 生成订单导出数据时，调用 OrderService.exportRows，并让其复用 OrderService.list(filters) 的筛选结果，避免另建一套条件逻辑。随后用 map 将每个订单转换为 Record，固定输出 id、memberId、status、totalCents、refundedCents 和 createdAt；金额仍取自 orderTotal 与 refundTotal。该做法适用于服务层导出场景，可保证导出范围与列表查询一致。

适用范围：`src/services/order-service.ts`

### 退款写入先查订单

通过内存存储串行执行退款写入，并明确并发冲突处理边界。

> 在 R1 的当前内存实现中，退款写入统一走 RefundService.create：先由 OrderStore.get 读取订单，再调用 applyRefund 计算新状态并通过 OrderStore.save 保存。RefundService 未提供版本号、条件更新或锁，因此并发 create 可能出现后写覆盖先写的读改写冲突。接入数据库或其他共享存储时，应把退款累计与保存改为原子条件更新，并以订单版本或状态校验失败作为重试、重载或拒绝依据；该规则适用于所有会改变退款余额的入口。

适用范围：`src/services/refund-service.ts`

### 结算服务持久化边界

SettlementService 只依赖 SettlementStore，持久化演进由存储层承接。

> SettlementService 的持久化操作统一经由 SettlementStore 的 create、update、get、list 完成，服务层只接收并返回 SettlementBatch，不直接处理具体存储格式。这样新增字段或替换存储实现时，只需保持 SettlementStore 契约与既有结算状态兼容，避免影响 prepare、approve、pay 等业务规则；适用于结算数据落盘、读取和迁移改造。

适用范围：`src/services/settlement-service.ts`

### 支付后原子写回结算批次

先读取并支付结算批次，再通过 store.update 持久化结果。

> 调用 SettlementService.pay 时，先用 get(id) 取得 SettlementBatch，交由 paySettlement 根据 reference 和 this.now() 完成支付计算，随后以 this.store.update(batch) 写回。该流程把状态变更与持久化绑定在一次服务操作中，适用于所有通过 pay 发起付款的结算请求；业务处理成功但批次仍停留在旧状态，会造成支付结果与存储记录不一致。

适用范围：`src/services/settlement-service.ts`

### 汇总采用快照结果

summary 先固定 batches 列表，再计算各状态金额，避免边遍历边变更。

> summary 调用 list 取得 accountId 对应的 batches 后，以 settlementTotal 提取每批次的 cents，并分别累计 draftCents、approvedCents、paidCents，同时 count 固定为 batches.length。计算期间不修改批次或存储，因此返回结果代表本次读取所得快照；若未来需要实时统计，应在存储层提供一致性读取，而不是在累计循环中写入状态。

适用范围：`src/services/settlement-service.ts`

### 用数组长度计算审计条数

count 直接读取 values 的长度计算当前审计记录数。

> 统计 AuditStore 中记录数量时，调用 count 从 values.length 取得当前条数并返回 number，无需先构造 AuditEntry 数组或遍历副本。该做法把计数逻辑限定在存储对象内部，调用方只负责消费结果；由于 values 是实际保存审计条目的数组，因此 count 反映当前集合规模，而非筛选某个 action 后的数量。适用于概览、分页元数据及健康检查等需要总条数的场景。

适用范围：`src/storage/audit-store.ts`

### 读后写版本校验

并发更新库存前，先读取版本并在写入时核对。

> 并发更新库存时，先通过 InventoryStore.getStock 取得 StockItem，再将其 version 作为 putStock 的 expectedVersion。写入阶段会与当前版本比较；若其他调用已更新同一仓库和 SKU，便抛出 Inventory version conflict，避免后写覆盖先写。该流程适用于库存扣减、调整和批量任务，读后写之间仍应把冲突视为可重试失败。

适用范围：`src/storage/inventory-store.ts`

### 用values隔离成员状态

通过私有Map集中承载成员，便于实现幂等写入。

> MemberStore 将成员集合放在私有 readonly values 中，并声明为 Map\<string, Member>，使所有读取和写入都围绕同一状态源。处理重试时，可先调用 get 检查目标成员，再调用 save 覆盖同一 member.id；Map 的键唯一性因此能避免重复追加。团队仅可依赖这一实例级幂等语义，不得据此声称写入具有跨进程事务性，因为 values 不会自动持久化或与外部存储同步。

适用范围：`src/storage/member-store.ts`

### 订单索引先校验再占用

orders 索引保存订单对应的结算批次，create 在写入前检查占用。

> SettlementStore.create 写入 orders 前，先检查每条 line 的 orderId 是否已存在；已占用时抛出 Error，避免订单被纳入第二笔结算。orders 只保存从订单标识到结算标识的映射，并为 forOrder 提供反查入口。该规则适用于同一 SettlementStore 实例内的重复入账检测，测试夹具中每个 orderId 只能绑定一个批次。

适用范围：`src/storage/settlement-store.ts`

### 按生成标识查询结算

调用 get 时传入完整结算标识，缺失结果统一返回 undefined。

> 使用 SettlementStore.get 查询结算时，调用方必须传入完整的批次 id，而不是订单标识或可复用前缀；方法从 batches 取出对应 SettlementBatch，并通过 copyBatch 生成隔离副本。标识未命中时返回 undefined，不抛出异常。订单到结算的反向定位应调用 forOrder，避免因混淆两类标识而读取错误批次。

适用范围：`src/storage/settlement-store.ts`

### 结算更新采用整对象提交

更新结算批次时提交完整对象，由存储层校验不可变字段并复制保存。

> 调用 SettlementStore.update 时传入完整 SettlementBatch，不要依赖局部补丁或缺省字段。存储层先通过 batches.get 定位现有记录，再比较 accountId 与 lines；两项不一致即抛出“不可变”错误。校验通过后使用 copyBatch 写入 batches，并再次复制后返回，避免外部引用直接修改内部结算数据。该流程适用于所有结算批次更新请求。

适用范围：`src/storage/settlement-store.ts`

### 从内部备注提取取消原因

取消原因仅从标记过的 internalNotes 中读取。

> 读取订单取消原因时调用 cancelReason，不要扫描全部 internalNotes 或自行解析未标记文本。该函数在 Order.internalNotes 中查找以 cancelled: 开头的首条备注，并移除固定前缀后返回字符串；找不到匹配项时返回 undefined。权限检查由 canCancel 负责，cancelReason 只承担已授权数据的提取，适用于取消详情展示和审计取证，避免把权限判断与原因解析混在同一流程中。

适用范围：`src/workflow/order-workflow.ts`

### 仅授权态进入请款流程

requiresCapture 将持久化状态 authorized 固定为请款前置条件。

> 请款判断统一调用 requiresCapture(payment)，并以 payment.state 的精确值 authorized 作为放行条件；其他持久化状态均返回 false。这样可防止未完成授权的订单直接进入扣款，同时让状态迁移成为后续捕获操作的前置事实。修改 Payment 状态枚举或迁移顺序时，需要同步验证此函数及支付流程，避免历史数据因新增别名而绕过授权校验。

适用范围：`src/workflow/payment-workflow.ts`
