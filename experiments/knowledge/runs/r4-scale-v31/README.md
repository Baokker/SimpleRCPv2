# RQ3 补充实验 · 阶段 1–2（知识库、泄露修正、OpenCode 试跑）

状态：阶段 2 完成；原生 C1s 在 OpenCode 1.18.31 上不可行，已按确认改为 C1s-prompt 并完成试跑，准备进入阶段 3。旧模板方案已作废：`knowledge-bench-r4` 分支 `r4-scaled-kb`（提交 `451fa73`）的 `library-200.json` / `library-500.json` 由两种固定模板生成，920 张卡片只差编号，不再用于任何实验；该 worktree 保留作记录，不删除、不引用。

## 分支、提交与 manifest

| 项目 | 分支 | 起点 | 阶段 1 提交 |
| --- | --- | --- | --- |
| 平台 SimpleRCPv2 | `experiment/r4-context` | `7f91f7cc` | 本文件所在提交（`git log -1`） |
| 数据 knowledge-bench | `r4-scaled-kb-v2` | `ea11a85` | `e2900ba08c800fcdf9036486b5037d487fd84036` |

数据工作区为 `/Users/baokker/Work/Master/CSCW/过程性知识管理/code/knowledge-bench-r4b`。最终 `manifest.json` 共 2,224 个文件，SHA-256 为 `6ce9dd9434721117c67e2439a52d002c6942f0ed4112b80adcbb4a5c04d22bd1`。数据仓库没有远端，未创建远端。

## 生成方法

1. 用 TypeScript AST 为 R1（60 个源文件）和 R2（30 个源文件）建立可锚定符号索引：顶层类/函数/接口/类型/常量、类方法、嵌套命名函数；超长声明拆成块锚点。每张新卡片从索引中选择一个真实符号，输入该符号的源码片段、文件内符号表和 `allowedIdentifiers`。
2. 每个项目新增 160 张（200 规模）或 460 张（500 规模）；新增部分 25% 为干扰卡片，75% 为无关卡片。干扰卡片按 10 条目标约定分配到同模块/同术语文件，规则必须与目标约定不同；无关卡片按源文件行数比例分配。200 规模单文件新增不超过 8 张（5% × 160），500 规模不超过 23 张（5% × 460）。
3. 用 MiniMax-M3 生成（`thinking: disabled`，温度 0.9），每批 5 个 slot；要求标题、摘要、正文、至少两个真实标识符，正文说明规则/原因/适用范围。生成后逐卡校验标识符、锚点、长度；不合格带错误反馈重写。长卡片再做一次压缩调用。
4. 去重与泄露检查在组装阶段执行。泄露检查 v2 使用每条约定的禁止线索（见下），关键词扫描后对全部 920 张新卡片逐张调用 MiniMax-M3 判定；命中即删除，改换同文件安全符号/角度后重写。重写卡片再次经过关键词扫描和模型判定，直到两条目均为零。
5. 用平台 `exportAgentsMarkdown` 生成 200/500 规模 C1 AGENTS.md，并用真实 MiniMax-M3 请求记录 `promptTokens`；没有用字符数估算 token。

## 各目标约定的禁止线索

完整清单（含参考实现、禁止短语、相邻示范）见 [forbidden-clues.md](forbidden-clues.md)；机器可读文件为数据仓库 `trapbench/cards/r4-forbidden-clues.json`。核心线索如下：

| 约定 | 实现依赖（禁止点名/描述用于同类任务） | 禁止取值/单位/相邻示范 |
| --- | --- | --- |
| R1-T01 批量库存单一事务 | `InventoryService.reserveBatch`、`InventoryStore.transaction`、`isolated`、`revision`、`Inventory transaction conflict`、`transfer` | 隔离实例、事务提交、失败整体回滚；其他库存写入也放进同一事务 |
| R1-T02 审计递归忽略大小写脱敏 | `redactSensitive`、`isSensitiveKey`、`SENSITIVE_KEYS`、`safeAudit`、`auditPayload`、`redactText`、`safeJson` | `[REDACTED]`、`toLowerCase`、敏感键词表；其他审计出口也递归脱敏 |
| R1-T03 通知逻辑标识去重 | `logicalId`、`logicalIds`、`NotificationOutbox.enqueue`、`orderPaid`、`schedulePaymentNotice` | `JSON.stringify([orderId,'orderPaid',recipient])`；其他通知也按订单/类型/收件人去重 |
| R1-T04 操作身份取 serverMember | `resolveIdentity`、`serverMember`、`clientMemberId`、`IdentityInput` | `context.serverMember`、`identity.id`；其他写入口也忽略客户端 actorId |
| R1-T05 订单月份 UTC、createdAt 秒 | `nowSeconds`、`toISOString`、`sameDay`、`summarizeOrderMonths` | UTC、1000、秒/毫秒、`slice(0,7)`；其他时间统计也按 UTC 月份 |
| R2-T01 trace 导出再次递归脱敏 | `redactSensitive`、`readTrace`、`exportTraceWindow`、`writeTraceExport`、`createTraceStore` | `[REDACTED]`、Bearer、Authorization；其他 trace 出口也再次脱敏 |
| R2-T02 历史聊天关联当前 roomId | `exportChatHistory`、`loadMessages`、`roomId`、`ChatMessage` | `query.roomId`、`roomId:query.roomId`；其他聊天读取也覆盖当前 roomId |
| R2-T03 成员导出 0600 | `0o600`、`0600`、`chmod`、`writeMemberExportCsv`、`collectMemberExport`、`writeJsonFileAtomically` | `mode:0o600`、属主可读写；其他导出也收紧权限 |
| R2-T04 活动导出只含 durableEventTypes | `durableEventTypes`、`exportActivityHistory`、`writeActivityHistoryExport` | 持久事件白名单、短暂事件/连接状态/光标；其他事件导出也过滤 |
| R2-T05 同项目成员可读 run | `getRunForViewer`、`agent:read`、`can`、`identity.projectId`、`run.projectId` | 同项目成员、展示角色不决定权限；其他 run 接口也按项目成员判断 |

## 泄露检查 v2 结果

关键词扫描 + MiniMax-M3 逐张判定（全部 920 张，不再只抽查无关卡片）。判定标准：除陈述/等价改写约定外，还包括 (a) 指示或描述用禁止线索完成同类任务，(b) 在相邻操作上示范同一约定，(c) 透露约定涉及的取值或单位。仅同模块/同对象但规则无关，不算泄露。

| 约定 | 删除/重做（按卡片 ID 去重） | 删除事件 | 保留命中（按约定计，卡片可多计） |
| --- | ---: | ---: | ---: |
| R1-T01 | 18 | 19 | 3 |
| R1-T02 | 11 | 14 | 16 |
| R1-T03 | 9 | 9 | 46 |
| R1-T04 | 10 | 10 | 12 |
| R1-T05 | 15 | 16 | 50 |
| R2-T01 | 19 | 19 | 5 |
| R2-T02 | 19 | 19 | 5 |
| R2-T03 | 17 | 18 | 1 |
| R2-T04 | 3 | 6 | 24 |
| R2-T05 | 14 | 14 | 64 |
| **合计** | **135** | **144** | **226（按约定计）** |

删除后全部重写并再次判定；最终 920 张新卡片在 v2 标准下 0 泄露。关键词扫描仍会命中一些通用词（如 `createdAt`、`projectId`、`enqueue`），这些卡片由模型判定为与约定无关并保留：R1 81 张、R2 134 张。完整 ID、命中线索与理由见 [leak-v2-retained.md](leak-v2-retained.md)。

用户指出的 9 个例子（`R1-R4-D024`、`D032`、`I067`、`R2-R4-D112`、`D078`、`I079`、`I257`、`R1-R4-I084`、`D093`）均被 v2 判定命中并重写。

## 卡片数量与类型

原有 40 张/项目为 reviewed 且排除 5 张 contradict 变体；这 40 张逐项保留。200 是 500 的子集。

| 规模 | 每项目卡片 | 新增 | 干扰 | 无关 | constraint | decision | risk | context | negative | tutorial |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 原有 40 | 40 | — | 10 | 25 | 10 | 5 | 7 | 6 | 6 | 6 |
| 200 | 200 | 160 | 40 | 120 | 50 | 29 | 35 | 28 | 28 | 30 |
| 500 | 500 | 460 | 115 | 345 | 125 | 74 | 87 | 70 | 70 | 74 |

类型分布与原有 40 张接近：constraint 25%、risk 17.5%、context/negative/tutorial 各约 14–15%、decision 约 14%。

## 长度分布（中文字符数）

| 规模/项目 | 新增 Q1 / 中位数 / Q3 | 全体 Q1 / 中位数 / Q3 | 原 40 Q1 / 中位数 / Q3 |
| --- | --- | --- | --- |
| 200 R1 | 155 / 185 / 212 | 145 / 174.5 / 198 | 116.5 / 145 / 154.25 |
| 200 R2 | 173 / 199 / 236 | 154 / 189.5 / 218 | 114.25 / 146 / 154.25 |
| 500 R1 | 157 / 186 / 209 | 150 / 182 / 203 | 116.5 / 145 / 154.25 |
| 500 R2 | 171 / 196 / 230 | 166 / 191 / 224.5 | 114.25 / 146 / 154.25 |

新卡片比原有 40 张长约 30–50 字。原因是每张新卡片需要点名真实标识符并说明原因与适用范围；没有用截断强凑分布，以免破坏语义。这是本阶段需要向审稿人说明的偏差。

## 锚点分布

- 200：R1 覆盖 60 个文件、R2 覆盖 30 个文件，单文件新增最多 8 张（5% × 160）。
- 500：单文件新增最多 23 张（5% × 460）；R1 前几位为 `delivery-service.ts` 23、`domain/settlement.ts` 23、`audit-service.ts` 22、`http/order-routes.ts` 22；R2 前几位为 `agentRuntime.ts` 23、`teamAgentSupport.ts` 23、`chatAgentBridge.ts` 23、`auth/identity.ts` 23。
- 没有单个文件超过 5% 上限；没有把上百张卡片挂到同一个活动文件。

## 去重

方法：正文 3-gram Jaccard、标题 2-gram Jaccard，以及把标识符/数字/路径掩码后的骨架 3-gram Jaccard，防止“只换标识符”的模板卡片。

| 指标 | 阈值 | 实际最大值 |
| --- | ---: | ---: |
| 正文 3-gram | 0.62 | 0.376 |
| 骨架 3-gram | 0.80 | 0.235 |
| 标题 2-gram | 0.85 | 0.692 |

最终库中没有超过阈值的卡片对；v2 修正过程中另因标题重复删除/重写 5 张。

## 完整 validate

`node tools/validate.mjs` 在 `TMPDIR=/tmp/kb-r4b-tmp` 下完整通过（exit 0，`ok:true`）：R1 59 个计入文件、1,551 行业务源码、84 项测试；R2 30 个计入文件、3,871 行、47 项测试；34 个任务（16 个陷阱、6 个对照、6 对迁移的 Ta/Tb）、6 对修订、2 段脚本全部通过。

## C1 AGENTS.md 与真实 token

| 规模 | 项目 | 卡片 | 字符数 | 字节数 | 行数 | `promptTokens` | 扣基线后内容 token |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 200 | R1 | 200 | 53,107 | 107,305 | 1,614 | 20,955 | 20,778 |
| 200 | R2 | 200 | 58,054 | 112,768 | 1,614 | 22,236 | 22,059 |
| 500 | R1 | 500 | 136,205 | 270,015 | 4,014 | 52,678 | 52,501 |
| 500 | R2 | 500 | 148,575 | 282,545 | 4,014 | 55,793 | 55,616 |

基线请求（用户消息 `OK`）为 177 prompt tokens。四份 AGENTS.md 都完整发送成功，没有上下文超限或截断；500 规模约 5.3–5.6 万输入 token。文件在 `exports/AGENTS-<repo>-<scale>.md`，机器可读结果在 `exports/token-report.json`。

## 费用与时间

生成、压缩、v2 泄露判定和重写共 2,843 次 MiniMax-M3 调用，估算 14.09 元人民币（输入 2.1 元/M、输出 8.4 元/M、缓存读 0.42 元/M，输入+缓存超过 512k 时 ×2）。墙钟时间 2026-11-27 03:49:15–06:26:56 UTC，约 2 小时 38 分；C1 token 请求另约 20 秒。遇到 429 速率限制时按 15/30/60 秒退避重试，没有因额度停止。

## 20 张新增卡片全文抽样

10 张干扰卡片覆盖 10 条不同目标约定；10 张无关卡片为 R1/R2 各 5 张。其中 11 张来自用户指出的五条约定所在模块（R1-T01、R1-T02、R1-T05、R2-T03、R2-T04）。

### 1. `R1-R4-D001`（干扰，R1-T01，risk）ReserveInput 入参防篡改

- anchor：`src/services/inventory-service.ts`
- summary：ReserveInput 仅承载标量请求字段，调用方不应依赖对象后续可变。
- content：ReserveInput 应保持标量字段结构，传入后不要由服务层修改 quantity、sku 或 orderId。外部调用方若复用并改写对象，可能让预留意图与记录不一致，因此请求边界应复制输入并校验数量。

### 2. `R1-R4-D024`（干扰，R1-T02，context）审计存储限定在进程内

- anchor：`src/storage/audit-store.ts`
- summary：AuditStore 仅维护当前进程中的审计记录，不承担持久化职责。
- content：AuditStore 将 AuditEntry 保存在实例字段 values 中，因此记录仅在当前进程和该实例生命周期内可用。若业务要求跨重启保留历史，应由外部存储承担持久化，AuditStore 继续负责收集与查询，避免调用方误以为 count 或 latest 已覆盖持久化数据。

### 3. `R1-R4-D047`（干扰，R1-T03，constraint）重试后仍须派发事件

- anchor：`src/workflow/notification-workflow.ts`
- summary：deliverWithRetry 先重试发送，再调用 dispatcher.dispatch。
- content：调用 deliverWithRetry 时，send 失败由 retryOnce 处理；重试结束后仍执行 dispatcher.dispatch(event)，让后续通知流程获得事件。该顺序适用于工作流中的发送失败恢复。

### 4. `R1-R4-D070`（干扰，R1-T04，negative）取消原因须从专用备注提取

- anchor：`src/workflow/order-workflow.ts`
- summary：cancelReason 只解析 cancelled: 前缀的内部备注，避免把普通备注误判为取消原因。
- content：cancelReason 应仅从 order.internalNotes 中查找以 cancelled: 开头的条目，并使用 slice 去掉该前缀后返回；未命中时返回 undefined。原因是 internalNotes 还可能承载其他订单流转信息，宽松匹配会污染取消原因。适用范围为订单取消流程及读取取消原因的调用方。

### 5. `R1-R4-D093`（干扰，R1-T05，constraint）批次写入须先完成防重检查

- anchor：`src/storage/settlement-store.ts`
- summary：SettlementStore.create 先拒绝重复批次及重复订单，再写入批次和归属索引。
- content：SettlementStore.create 必须先检查 batch.id 是否已存在，并遍历 batch.lines 确认每个 orderId 尚未进入其他结算；任一条件冲突都抛出 Error。全部检查通过后，才依次写入 this.batches 与 this.orders，避免失败时留下不完整归属。

### 6. `R2-R4-D001`（干扰，R2-T01，risk）工作区快照缺失文件按删除统计

- anchor：`src/extracted/agent/agentWorkspaceSnapshot.ts`
- summary：快照比较应区分新增、删除与内容变更。
- content：createAgentWorkspaceSnapshot 读取工作区时，目录不存在或没有可读文件应得到空 Map，而不是让比较流程失败。原因是快照用于前后差异检测，缺少文件必须能与 before 中的条目对应并被识别为删除；该规则适用于工作区采集及 compareAgentWorkspaceSnapshots 的空目录输入。

### 7. `R2-R4-D024`（干扰，R2-T02，context）迁移结果按会话复用

- anchor：`src/extracted/agent/agentSessionAccess.ts`
- summary：migrateLegacyAgentSessions 复用同一成员的迁移会话对象。
- content：migrateLegacyAgentSessions 以 memberId 与 legacyRuntimeSessionId 组成 migrationKey，并通过 migrated 保存 create 返回值。相同键的运行记录复用该对象，同时逐条 update runStore；适合迁移多个运行条目时避免重复创建会话。

### 8. `R2-R4-D047`（干扰，R2-T03，constraint）JSON 缺失读取约定

- anchor：`src/extracted/jsonFile.ts`
- summary：readJsonFile 将不存在文件视为空结果，其他解析错误继续抛出。
- content：调用 readJsonFile 读取 storagePath 时，文件不存在且错误码为 ENOENT 应返回 undefined；JSON 内容损坏等其他异常必须抛出。这样调用方能区分首次创建与真实故障，适用范围为读取 JSON 存储文件的路径。

### 9. `R2-R4-D070`（干扰，R2-T04，negative）EventInput 负载需受控

- anchor：`src/extracted/eventLog.ts`
- summary：避免无界 payload 拖慢事件写入与历史加载。
- content：EventInput 的 payload 不应承载无限增长的二进制或大文本，提交前应设置体积上限并优先保存摘要或引用。这样可避免 EventLog 写入放大及 loadEvents 内存占用过高；该限制适用于 createEventLog 接收的普通协作事件，超限输入应明确拒绝。

### 10. `R2-R4-D093`（干扰，R2-T05，constraint）提及解析须过滤无效候选

- anchor：`src/extracted/agent/teamAgentSupport.ts`
- summary：parseMentions 只返回候选集合中有效且不重复的句柄。
- content：parseMentions 解析文本后，应先核对 candidates，并用 seen 排除重复句柄；无效或不存在的句柄不得进入 mentions。该约束适用于团队 Agent 的提及提取，目的是避免无效通知和重复通知。

### 11. `R1-R4-I001`（无关，context）配置读取返回快照

- anchor：`src/config/settings.ts`
- summary：loadSettings 暴露存储读取结果，调用方不应假定获得可独立修改的配置对象。
- content：loadSettings 直接返回 SettingsStore.read() 的结果，不在服务层额外复制配置。这样可避免维护两套配置状态，并让调用方通过 updateSettings 统一提交变更。适用于读取当前配置并生成 settingsSnapshot 的场景；调用方不得把返回值当作可任意修改的本地副本。

### 12. `R1-R4-I007`（无关，negative）入库拒绝重复重试

- anchor：`src/domain/inventory.ts`
- summary：receiveStock 每次都会增加库存，不能作为天然幂等入口。
- content：receiveStock 会把 amount 直接累加到 item.available，并未携带业务幂等键、已入库记录或重复请求标记。因此同一收货事件被重试时，每次调用都可能再次增加库存并提升 version；接入方必须在调用前完成事件去重，且只能对已确认唯一的一次收货执行入库。

### 13. `R1-R4-I009`（无关，risk）StockItem 缓存失效约束

- anchor：`src/domain/inventory.ts`
- summary：库存缓存必须按 sku 与 warehouseId 定位，并在写操作后基于 version 失效。
- content：缓存 StockItem 时以 sku 和 warehouseId 组成唯一键，读取结果需携带 version。任何 createStock、reserveStock、releaseStock、consumeStock、receiveStock 或 changeReservation 成功后，都必须使对应键下的旧版本缓存失效，并在回填时确认 version 未变化。这样可避免并发写入期间继续返回过期的 available 或 reserved；该约束适用于库存服务、HTTP 路由读取缓存以及跨实例发布失效通知的场景。

### 14. `R1-R4-I067`（无关，negative）all 返回隔离副本

- anchor：`src/storage/audit-store.ts`
- summary：AuditStore.all 复制条目与载荷，阻断调用方直接改动内部记录。
- content：AuditStore.all 通过 map 复制每个 AuditEntry，并重新创建 payload 对象，避免调用方获得 this.values 中的同一引用。团队读取审计列表时应只依赖返回副本进行展示或后续处理，不要把结果当作内部存储进行原地修改；否则一次字段赋值可能意外影响后续 all 查询。该规则适用于 AuditStore 的列表读取及其调用方对返回对象的处理。

### 15. `R1-R4-I011`（无关，decision）结算批次读取采用防御性复制

- anchor：`src/storage/settlement-store.ts`
- summary：get 返回副本，避免调用方直接修改 SettlementStore 内部批次。
- content：SettlementStore.get 在 batches 中未命中时返回 undefined，命中时通过 copyBatch 返回 SettlementBatch 的副本，而不是暴露 this.batches 中保存的对象。这样可防止调用方直接改写存储层内部状态，避免后续读取看到未经存储层处理的变更。该规则适用于通过 get 读取批次的所有调用场景；写入操作仍须使用 SettlementStore.update。

### 16. `R2-R4-I001`（无关，context）运行管理器依赖注入边界

- anchor：`src/extracted/agent/agentRunManager.ts`
- summary：创建运行管理器时显式注入存储、运行时和活动回调，避免模块内部隐式读取全局状态。
- content：通过 AgentRunManagerOptions 显式传入 members、runtime、registry、runtimeManager、getSettings 和 runTimeoutMs，apiKey、sensitiveValues 可选注入，appendActivity 承接外部事件写入。这样 createAgentRunManager 可在测试和不同宿主中替换依赖，由调用方决定返回值是否继续修改，避免共享可变状态。

### 17. `R2-R4-I002`（无关，tutorial）项目队列失败后保留任务

- anchor：`src/extracted/agent/agentRunManager.ts`
- summary：项目级队列记录待运行项与处理状态，失败后仍保留未完成任务。
- content：使用 ProjectQueue 时，runIds 保存项目内待处理运行，processing 标识当前是否由队列协程占用，completion 可让调用方等待本轮结束。执行某项失败时不能清空其余 runIds，否则会丢失排队请求；应保留可重试状态并释放 processing。适用于 createAgentRunManager 管理的同一项目串行调度场景。

### 18. `R2-R4-I081`（无关，decision）JSON 读取缺失文件返回空值

- anchor：`src/extracted/jsonFile.ts`
- summary：读取不存在的数据文件视为空数据，其余读取错误继续抛出。
- content：readJsonFile 对 storagePath 执行 JSON 读取与解析，系统返回 ENOENT 时将结果定义为 undefined，让上层按“尚无持久化数据”处理首次启动或文件被移除的场景。JSON 损坏、权限不足等其他异常不在降级范围内，函数会原样 throw error，避免将数据问题误判为文件不存在。该约定适用于 R2 中通过 jsonFile 读取项目、成员、聊天、房间、事件日志、trace、工作区及权限数据的流程。

### 19. `R2-R4-I078`（无关，risk）事件文件不承担权限判定

- anchor：`src/extracted/eventLog.ts`
- summary：EventFile 仅定义持久化结构，访问授权须在写入前处理。
- content：EventFile 只含 version 与 events: EventRecord[]，不含操作者、成员角色或工作区权限信息，不能据此判断 append 是否获准。权限检查须在事件进入 createEventLog 返回的 append 前，使用当前请求上下文完成；文件可读也不等于调用者拥有业务权限。loadEvents 仅负责恢复数据。

### 20. `R2-R4-I009`（无关，risk）旧版运行记录兼容性风险

- anchor：`src/extracted/agent/agentRunStore.ts`
- summary：AgentRun 校验过宽，磁盘旧数据可能缺少新增必填字段。
- content：createAgentRunStore 委托 createRecordStore 持久化 AgentRun，但 validateRecord 仅校验对象及字符串类型的 id、projectId，缺失状态、输入、输出等新增字段仍可写入。读取方按完整 AgentRun 使用时可能得到 undefined，因此新增字段或改变字段含义时，须同步制定 run.json 迁移或更严格校验策略，适用于已有 agent-runs 数据及跨版本升级。

## 阶段 2：OpenCode 读取规则、500 规模试跑与 C1s 结论

### OpenCode 1.18.31 如何读取 AGENTS.md

**源码证据（1.18.31 二进制内的 `InstructionContext.observe`）**：加载指令时调用 `up({targets:["AGENTS.md"], start: currentDirectory, stop: projectRoot})`，再并入全局配置目录的 `AGENTS.md`；`up` 从会话当前目录向项目根目录逐级向上查找。没有向下扫描子目录的逻辑，也没有在读取文件时触发 AGENTS.md 加载的钩子。系统提示只说明“如果 AGENTS.md 为空或不足，可以检查子目录中的 README/AGENTS.md”，即由 Agent 主动用工具读取，不是自动注入。

**实际运行验证**：在临时项目放三份带标记的 AGENTS.md（根 `ROOT_MARKER_12345`、`src/SUBDIR_MARKER_67890`、`src/deep/DEEP_MARKER_24680`），用本地 mock OpenAI provider 捕获 OpenCode 实际发送的请求体。

- 从项目根运行：请求体只含 `ROOT_MARKER_12345`；
- 从 `src/` 运行（git 根仍在项目根）：含 `ROOT_MARKER_12345` 和 `SUBDIR_MARKER_67890`，不含 `DEEP_MARKER_24680`。

结论：1.18.31 **只在会话开始时加载当前工作目录到项目根路径上的 AGENTS.md**；不会自动加载子目录 AGENTS.md，也不会在访问该目录文件时加载。

### C1s 结论

按原计划把规则写入各目录 AGENTS.md、依赖 OpenCode 自动按路径读取的原生 C1s 在 1.18.31 上**不可行**。已确认采用 **C1s-prompt**：只用 C2 同源的 `activeFiles`，把匹配卡片写入项目根 AGENTS.md。其余备选方案保留供参考：

1. **C1s-prompt（推荐）**：任务开始时按卡片的 `appliesTo`/锚点路径与任务提示中出现的文件匹配，只把匹配规则拼接到根 AGENTS.md 或任务前缀；保留路径范围，且利用 OpenCode 原生根文件加载。属于实验入口改动，不改产品。
2. **C1s-cwd**：把会话工作目录设到任务主要子目录，OpenCode 会加载该目录及祖先的 AGENTS.md；但任务跨多个目录，工作区根会改变，不适合当前任务。
3. **C1s-instructions**：在 `opencode.json` 的 `instructions` 中列出所有子目录 AGENTS.md；OpenCode 会在启动时全部加载，效果接近 C1（全量），不构成路径范围。
4. **C1s-plugin**：写 OpenCode 插件，在读取文件时注入对应目录的 AGENTS.md；最接近按访问加载，但需要改运行时/插件，不是 1.18.31 原生行为。

### 500 张 AGENTS.md 的上下文与截断

C1@500 R1 的 AGENTS.md 为 136,205 字符、52,678 真实 token；C1 首请求实际输入 74,769 token（含系统提示与工具定义），运行完成，无截断/压缩事件。R2 为 148,575 字符、55,793 token，也远低于 MiniMax-M3 的 1M 上下文。500 规模不会因上下文上限被截断。

### C1@500 / C2@500 试跑

任务 `R1-T01`，各 1 次；成功目录 `phase2-trials/c1c2-500d`。

| 条件 | functional | trapAvoided | 首请求输入 token | 累计输入 / 输出 / 缓存读 | 费用（CNY） | Agent 墙钟 / 流水线墙钟 |
| --- | --- | --- | ---: | --- | ---: | --- |
| C1@500 | true | true | 74,769 | 104,844 / 4,039 / 1,608,192 | 1.0169 | 315s / 402s |
| C2@500 | true | true | 22,771 | 72,060 / 6,852 / 962,816 | 0.8201（含重排 0.0290） | 203s / 277s |

C2 注入 5 张卡片、2,230 字符、558 token；目标卡 `R1-T01-target` 由 BM25 词法路径送达，重排来源为 `m3`。C1 的 AGENTS.md 已写入项目根并由 OpenCode 自动加载。

失败运行保留不覆盖：`phase2-trials/c1c2-500` 与 `c1c2-500b` 因数据目录不在 `SIMPLERCP_IMPORT_ROOTS` 失败；`c1c2-500c` 因卡片导入上限 100 失败。对应 `failure.json` 与 `raw/` 保留在各自目录。修复为实验入口允许数据 worktree 作为导入根、把导入上限提高到 1,000 后，`c1c2-500d` 成功。

### C1s-prompt 试跑与选择结果

按确认的规则实现 C1s：路径信号只用 C2 同一来源的 `activeFiles`（`knowledgeActiveFiles`：explicit-context、成员当前文件、任务提示中出现的现有工作区路径；k3 任务没有前两者，因此实际是提示中出现的现有路径）。项目级卡片全部写入；文件/目录级卡片在 `appliesTo` 或锚点路径与 activeFile 相同或为祖先目录时写入；不排序、不重排、不设数量上限；写入项目根 AGENTS.md。

任务 `R1-T01`，各 1 次：

| 条件 | 选中卡片 | 目标卡在内 | 字符数 | 估算 token（chars/4） | functional | trapAvoided | 费用 CNY | Agent 墙钟 |
| --- | ---: | --- | ---: | ---: | --- | --- | ---: | ---: |
| C1s@40 | 40 | true | 8,337 | 2,085 | true | true | 0.7401 | 150s |
| C1s@500 | 46 | true | 9,818 | 2,455 | true | true | 0.8283 | 131s |

`R1-T01` 的 activeFiles 为空（提示中的 `src/services/reservation-batch.ts` 是待新增文件），所以 C1s@500 只写入 40 张原有项目级卡片 + 6 张新项目级卡片 = 46 张；C1s@40 的 40 张原有卡片全部没有 `appliesTo`，按规则都是项目级，因此 **C1s@40 与 C1@40 在内容上等价**。这不是实现错误，而是原有 40 张卡片的 `appliesTo` 属性决定的；C1s@40 因此主要作为通道对照。

全任务选择扫描（不运行 Agent）：R1 的 11 个任务 activeFiles 均为 0，C1s@500 选 46 张；R2 任务 activeFiles 为 1–2 个，C1s@500 选 44–67 张，目标卡均在内。C1s@40 对所有任务都是 40 张（全部项目级）。R2 的路径匹配确实收窄/扩展了写入集合，说明规则生效。

### NT 导出与检索库

已生成到 `exports/`：

| 组 | 文件 | 卡片数 | 说明 |
| --- | --- | ---: | --- |
| C1-NT@40 | `AGENTS-R1-40-NT.md` / `AGENTS-R2-40-NT.md` | 35/项目 | 原有 40 张去掉 5 张目标卡 |
| C1-NT@500 | `AGENTS-R1-500-NT.md` / `AGENTS-R2-500-NT.md` | 495/项目 | 500 张去掉 5 张目标卡 |
| C2-NT@40 | `library-40-no-targets.json` | 70 | 40 规模检索库去掉 10 张目标卡 |
| C2-NT@500 | `library-500-no-targets.json` | 990 | 500 规模检索库去掉 10 张目标卡 |

删除的卡片 ID：`R1-T01-target`、`R1-T02-target`、`R1-T03-target`、`R1-T04-target`、`R1-T05-target`、`R2-T01-target`、`R2-T02-target`、`R2-T03-target`、`R2-T04-target`、`R2-T05-target`。机器可读记录在 `exports/nt-report.json`。

### 费用与时间预估

以单任务试跑为锚点：C1@500 约 1.02 元/5.3 分钟，C2@500 约 0.82 元/3.4 分钟。阶段 3 矩阵（C1 3 规模、C2 3 规模、C1s 2 规模、C1-NT@40、C1-NT@500、C2-NT@500）共 726 次运行；若 C1s 不可行则为 594 次。按 C1@40/200 和 NT 条件略低于 500 规模估算，总费用约 **450–550 元**，串行墙钟约 **40–45 小时**；配置 `concurrency: 2` 时约 **20–25 小时**。这是单任务单规模的粗略外推，正式运行前应以试跑更新。

## 阶段 3 矩阵（更新）

在原有 7 组之外增加 **C1-NT@500** 与 **C2-NT@500**：各项目从 500 张卡片中删除 5 张目标卡片后，分别导出全量 AGENTS.md 和做 BM25 + 重排检索注入；在 16 个陷阱任务上各跑 3 次。若新卡片无泄露，联合成功应接近 C0 的 2/16；明显更高则说明仍有泄露。C2-NT 用于区分检索路径带来的泄露。

| 条件 | 40 | 200 | 500 |
| --- | --- | --- | --- |
| C1 全量 AGENTS.md | 运行 | 运行 | 运行 |
| C2 检索注入 | 运行 | 运行 | 运行 |
| C1s 按路径规则文件 | 运行 | — | 运行 |
| C1-NT 去目标卡全量 | 运行 | — | 运行 |
| C2-NT 去目标卡检索 | — | — | 运行 |

## 原始记录

生成期完整请求/响应、逐卡生成日志、v2 泄露判定缓存、压缩记录、plan/index/assembly 在数据工作区 `.judge-work/r4b/`（被 gitignore，不提交）：`raw/`、`generation-log.jsonl`、`leak-v2/`、`core-v2/`、`compress-log.jsonl`、`plan-*.json`、`index-*.json`、`assembly-*.json`。提交的 `llm-calls.jsonl` 记录每次调用的 provider、model、usage、promptHash 与时间，不含凭据。

## 效度与限制

- 新卡片由模型生成，标识符与锚点可机械校验，但“这条规则是否真的属于该团队”无法完全自动验证；报告与抽样供人工复核。
- 干扰卡片与目标约定共享模块和术语，v2 判定仍有边界案例；本阶段对 135 张（144 次）判定为泄露的卡片做了删除重写，保留的 215 张关键词命中卡片逐条列出理由，建议审稿人抽查。
- 新卡片比原 40 张长 30–50 字，长度分布没有完全对齐；这是为了保留真实标识符、原因与适用范围而做的取舍。
- 本阶段没有 Agent 运行，因此没有 phase 3 意义上的 `raw/<组合>/`；C1 token 请求只用于测量上下文规模，不作为实验条件。

## 下一步

阶段 2 已完成 OpenCode 读取规则验证和 C1@500/C2@500 试跑；C1s 在 1.18.31 上不可行，等待确认替代方案。阶段 3 按 22 任务 × 3 次重复运行矩阵，并加入 C1-NT@40、C1-NT@500、C2-NT@500。
