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

### 投递失败明确退避时间

DeliveryFailure 必须给出下次尝试时刻和是否耗尽状态。

> 返回 DeliveryFailure 时必须设置 nextAttemptAt，并明确 exhausted，禁止用缺省值代替失败决策。调用方可据此安排延迟重试或停止继续尝试；该约定适用于模板渲染、收件人校验及外部渠道返回失败的场景。

适用范围：`src/services/delivery-service.ts`

### 订单时间区间需先校验

同时提供 from 与 to 时必须拒绝倒置区间。

> filters 处理订单查询时，只有 from 和 to 均存在才比较先后；若 from 大于 to，应抛出 Error，而不是交给下游形成空结果。校验适用于全部订单列表筛选，并要求保持现有错误处理入口不变。

适用范围：`src/http/order-routes.ts`

### 订单汇总采用独立计算

OrderService.summarize 每次依据订单当前状态重新计算金额。

> OrderService.summarize 不缓存汇总金额，而是调用 orderTotal 与 refundTotal 基于传入 Order 重新计算 balance。若后续加入并发更新或版本字段，应先确认 Order 已加载最新版本再汇总；该决策适用于订单详情、报表和结算前的金额概览。

适用范围：`src/services/order-service.ts`

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

### 批次写入须先完成防重检查

SettlementStore.create 先拒绝重复批次及重复订单，再写入批次和归属索引。

> SettlementStore.create 必须先检查 batch.id 是否已存在，并遍历 batch.lines 确认每个 orderId 尚未进入其他结算；任一条件冲突都抛出 Error。全部检查通过后，才依次写入 this.batches 与 this.orders，避免失败时留下不完整归属。

适用范围：`src/storage/settlement-store.ts`

### 结算与订单标识防重

SettlementStore 同时约束批次编号和订单归属的唯一性。

> SettlementStore.create 必须先拒绝重复的 batch.id，也要拒绝已进入其他结算的 orderId，校验通过后再写入 batches 与 orders。原因是要防止同一订单被重复纳入结算；该规则仅适用于新结算创建。

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

### 审计存储限定在进程内

AuditStore 仅维护当前进程中的审计记录，不承担持久化职责。

> AuditStore 将 AuditEntry 保存在实例字段 values 中，因此记录仅在当前进程和该实例生命周期内可用。若业务要求跨重启保留历史，应由外部存储承担持久化，AuditStore 继续负责收集与查询，避免调用方误以为 count 或 latest 已覆盖持久化数据。

适用范围：`src/storage/audit-store.ts`

### 订单列表采用组合筛选

OrderService.list 按多个可选条件筛选订单。

> OrderService.list 应逐项应用 OrderFilters 的 memberId、status、金额与时间条件，不满足任一条件即排除订单。这样可组合出稳定的查询结果，适用于订单列表检索，且不得在筛选时改变订单数据。

适用范围：`src/services/order-service.ts`

### 结算批次状态按流程推进

SettlementBatch 仅允许从草稿依次进入审批与支付状态。

> SettlementBatch 的 state 只能按 draft、approved、paid 的业务顺序推进，不允许跳过审批直接写入 paid。这样可保留结算责任链，并让 approveSettlement、paySettlement 分别承担审批与付款职责；适用范围为所有结算批次状态变更。

适用范围：`src/domain/settlement.ts`

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

### 审计标签保留三项原值

auditLabel 仅拼接动作、参与方与创建时间，不读取审计载荷。

> auditLabel 生成的标签固定由 AuditEntry 的 action、actorId 和 createdAt 组成，审计载荷变化不得影响标签。空值输入时仍按统一字符串格式输出，避免审计记录在列表展示中出现不一致。

适用范围：`src/security/audit-policy.ts`

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

### 成员路由显式声明方法

注册成员接口时明确填写 method 与 path，避免请求进入错误处理分支。

> 在 registerMemberRoutes 中，每条 route 都显式设置 method、path 和 handler；列表、导入及单项查询分别使用 GET、POST、GET。这样可避免路由注册信息缺失或冲突，使 MemberService 的 list、importRows 与 get 能稳定接到对应请求。改动成员路由时，应核对注册顺序、路径参数和实际处理函数。

适用范围：`src/http/member-routes.ts`

### 事件字段写入后再派发

NotificationEvent 各字段应完整组装后再交给派发器。

> 创建 NotificationEvent 时，先完整写入 eventId、template、data 与 recipient，再调用 NotificationDispatcher.dispatch。这样可避免字段缺失导致模板或收件地址在派发阶段才暴露问题，适用于所有由该接口承载的通知事件。

适用范围：`src/notifications/dispatcher.ts`

### store 依赖须显式注入

SettlementService 的 store 由构造参数提供并保持只读。

> SettlementService.store 应声明为 private readonly，并通过 constructor 注入 SettlementStore。该约束适用于结算服务的创建和测试，测试实例必须绑定隔离存储，避免操作真实数据。

适用范围：`src/services/settlement-service.ts`

### 存储读取须复制明细

SettlementStore 返回批次时须复制 lines，避免调用方改写存储内明细。

> copyBatch 应为 SettlementBatch 创建新对象，并对 value.lines 中每个 line 执行浅复制后返回，使 get、list 的读取结果被调用方修改时不会改变 SettlementStore 保存的数据。批次状态更新与明细读取可能并发，故查询和列表输出均适用。

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
