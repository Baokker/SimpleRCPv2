# RQ3 补充实验 · 阶段 1（v2 真实扩充知识库）

状态：阶段 1 完成，等待确认后进入阶段 2。旧模板方案已作废：`knowledge-bench-r4` 分支 `r4-scaled-kb`（提交 `451fa73`）的 `library-200.json` / `library-500.json` 由两种固定模板生成，920 张卡片只差编号，不再用于任何实验；该 worktree 保留作记录，不删除、不引用。

## 分支、提交与 manifest

| 项目 | 分支 | 起点 | 阶段 1 提交 |
| --- | --- | --- | --- |
| 平台 SimpleRCPv2 | `experiment/r4-context` | `7f91f7cc` | 本文件所在提交（`git log -1`） |
| 数据 knowledge-bench | `r4-scaled-kb-v2` | `ea11a85` | `a55f36b841d33b5a336c9372541562ca03ff3364` |

数据工作区为 `/Users/baokker/Work/Master/CSCW/过程性知识管理/code/knowledge-bench-r4b`。最终 `manifest.json` 共 2,219 个文件，SHA-256 为 `cd6d00426615b6d4bab1052c856710225629802af34c46cf275a8bb5dca36134`。数据仓库没有远端，未创建远端。

## 生成方法

1. 用 TypeScript AST 为 R1（60 个源文件）和 R2（30 个源文件）建立可锚定符号索引：顶层类/函数/接口/类型/常量、类方法、嵌套命名函数；超长声明拆成块锚点。每张新卡片从索引中选择一个真实符号，输入该符号的源码片段、文件内符号表和 `allowedIdentifiers`。
2. 每个项目新增 160 张（200 规模）或 460 张（500 规模）；新增部分 25% 为干扰卡片，75% 为无关卡片。干扰卡片按 10 条目标约定分配到同模块/同术语文件，规则必须与目标约定不同；无关卡片按源文件行数比例分配，覆盖其他模块。200 规模单文件新增不超过 8 张（5% × 160），500 规模不超过 23 张（5% × 460）。
3. 用 MiniMax-M3 生成（`thinking: disabled`，温度 0.9），每批 5 个 slot；要求标题、摘要、正文、至少两个真实标识符，正文说明规则/原因/适用范围。生成后逐卡校验：标识符必须存在于对应源文件、至少一个标识符锚定在该 slot 的代码片段、正文提到至少两个标识符、长度在范围内；不合格的卡片带错误反馈重写。长卡片再做一次压缩调用（目标 150–190 字），压缩不改变规则和标识符。
4. 去重与泄露检查在组装阶段执行：先做正文/骨架/标题相似度去重，再做三层泄露检查（见下）。命中卡片删除并用同一 slot 重写；如果同一 slot 反复泄露，则改换同文件的另一个符号与角度后重写。
5. 用平台 `exportAgentsMarkdown` 生成 200/500 规模的 C1 AGENTS.md，并用真实 MiniMax-M3 请求记录 `promptTokens`；没有用字符数估算 token。

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
| 200 R1 | 154 / 185 / 212 | 145 / 174 / 198 | 116.5 / 145 / 154.25 |
| 200 R2 | 176 / 203 / 235 | 158 / 191 / 215 | 114.25 / 146 / 154.25 |
| 500 R1 | 156 / 186 / 211 | 149 / 183 / 208 | 116.5 / 145 / 154.25 |
| 500 R2 | 175 / 198 / 237 | 169 / 194 / 230 | 114.25 / 146 / 154.25 |

新卡片比原有 40 张长约 30–50 字。原因是每张新卡片需要点名真实标识符并说明原因与适用范围；没有用截断强凑分布，以免破坏语义。这是本阶段需要向审稿人说明的偏差。

## 锚点分布

- 200：R1 覆盖 60 个文件、R2 覆盖 30 个文件，单文件新增最多 8 张（5% × 160）。
- 500：单文件新增最多 23 张（5% × 460）；R1 前几位为 `src/services/inventory-service.ts` 23、`src/domain/inventory.ts` 23、`src/notifications/outbox.ts` 23、`src/services/delivery-service.ts` 23、`src/domain/settlement.ts` 23；R2 前几位为 `src/extracted/chat.ts` 23、`rooms.ts` 23、`projects.ts` 23、`workspace.ts` 23、`agent/agentRunManager.ts` 23。
- 没有单个文件超过 5% 上限；没有把上百张卡片挂到同一个活动文件。

## 去重

方法：正文与标题分别做字符 n-gram Jaccard；正文用 3-gram，标题用 2-gram；另把标识符、数字、路径掩码后做骨架 3-gram Jaccard，防止“只换标识符”的模板卡片。

| 指标 | 阈值 | 实际最大值 |
| --- | ---: | ---: |
| 正文 3-gram Jaccard | 0.62 | 0.359 |
| 骨架 3-gram Jaccard | 0.80 | 0.159 |
| 标题 2-gram Jaccard | 0.85 | 0.692 |

去重删除并重写 3 张（按卡片 ID 去重）。最终库中没有超过阈值的卡片对。

## 三层泄露检查

| 层 | 方法 | 删除/重做 |
| --- | --- | ---: |
| (a) 目标卡片匹配 | 与 10 张目标卡片的标题、摘要、正文关键句、`teamConvention` 做相似度/包含检查；正文相似度阈值 0.55、标题 0.80、约定 0.60 | 0 |
| (b) requiredTokens | 用 `review-rules.json` 的 6 条 requiredTokens，另为 4 条没有 transfer 记录的约定从目标卡片补全；按“每组至少一个同义词 + 规则语气”筛查 | 27（保守删除重做；最终版本仅 3 张触发筛查，均交模型判定为不泄露） |
| (c) MiniMax-M3 逐张判定 | 每张干扰卡片逐张判定；无关卡片按 20% 抽样（每项目 69 张）；所有 (b) 命中卡片也送判定 | 18 张（22 次；同一槽位可能多轮） |

三层合计按卡片 ID 去重删除/重做 45 张。另有生成期格式/标识符/长度校验拒绝：长度 874 次、未知标识符 87 次、其他 9 次、JSON 解析失败 1 次；这些是尝试次数，不是最终卡片数。

## 完整 validate

`node tools/validate.mjs` 在 `TMPDIR=/tmp/kb-r4b-tmp` 下完整通过（exit 0，`ok:true`）：R1 59 个计入文件、1,551 行业务源码、84 项测试；R2 30 个计入文件、3,871 行、47 项测试；34 个任务（16 个陷阱、6 个对照、6 对迁移的 Ta/Tb）、6 对修订、2 段脚本全部通过。验证时的 manifest 为 `f857da65…`；之后只修改了本 README 并重新冻结 manifest，最终 manifest 为 `cd6d0042…`。

## C1 AGENTS.md 与真实 token

| 规模 | 项目 | 卡片 | 字符数 | 字节数 | 行数 | `promptTokens` | 扣基线后内容 token |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 200 | R1 | 200 | 52,771 | 106,907 | 1,614 | 20,904 | 20,727 |
| 200 | R2 | 200 | 58,451 | 113,241 | 1,614 | 22,360 | 22,183 |
| 500 | R1 | 500 | 136,118 | 269,734 | 4,014 | 52,795 | 52,618 |
| 500 | R2 | 500 | 150,453 | 284,989 | 4,014 | 56,377 | 56,200 |

基线请求（用户消息 `OK`）为 177 prompt tokens。四份 AGENTS.md 都完整发送成功，没有上下文超限或截断；500 规模约 5.3–5.6 万输入 token。文件在 `exports/AGENTS-<repo>-<scale>.md`，机器可读结果在 `exports/token-report.json`。

## 费用与时间

生成、压缩和泄露判定共 1,607 次 MiniMax-M3 调用，估算 8.32 元人民币（输入 2.1 元/M、输出 8.4 元/M、缓存读 0.42 元/M，输入+缓存超过 512k 时 ×2；按每次响应 usage 计算）。墙钟时间 2026-11-27 03:49:15–04:32:53 UTC，约 43 分 38 秒；C1 token 请求另约 20 秒。遇到 429 速率限制时按 15/30/60 秒退避重试，没有因额度停止。

## 20 张新增卡片全文抽样

10 张干扰卡片覆盖 10 条不同目标约定；10 张无关卡片为 R1/R2 各 5 张，类型与锚点不同。

### 1. `R1-R4-D001`（干扰，R1-T01，risk）ReserveInput 入参防篡改

- anchor：`src/services/inventory-service.ts`
- summary：ReserveInput 仅承载标量请求字段，调用方不应依赖对象后续可变。
- content：ReserveInput 应保持标量字段结构，传入后不要由服务层修改 quantity、sku 或 orderId。外部调用方若复用并改写对象，可能让预留意图与记录不一致，因此请求边界应复制输入并校验数量。

### 2. `R1-R4-D024`（干扰，R1-T02，context）敏感键集合集中维护

- anchor：`src/security/redaction.ts`
- summary：敏感键名统一收录在 SENSITIVE_KEYS，新增项需明确凭据语义。
- content：敏感键名应登记在 SENSITIVE_KEYS，由 redactSensitive 与 isSensitiveKey 共同使用，避免多处名单漂移；适用于安全导出入口新增常见凭据字段时。

### 3. `R1-R4-D047`（干扰，R1-T03，constraint）重试后仍须派发事件

- anchor：`src/workflow/notification-workflow.ts`
- summary：deliverWithRetry 先重试发送，再调用 dispatcher.dispatch。
- content：调用 deliverWithRetry 时，send 失败由 retryOnce 处理；重试结束后仍执行 dispatcher.dispatch(event)，让后续通知流程获得事件。该顺序适用于工作流中的发送失败恢复。

### 4. `R1-R4-D070`（干扰，R1-T04，negative）身份输入须受长度约束

- anchor：`src/security/identity.ts`
- summary：IdentityInput 中的客户端字符串必须设置长度上限，避免异常输入扩大处理成本。
- content：IdentityInput 接收的 clientDisplayName 与 clientMemberId 应在入口限制长度，避免超长字符串占用过多内存并拖慢 sanitizeDisplayName 等处理。该约束适用于所有调用 IdentityInput 的身份解析场景，输入超限时直接拒绝或截断。

### 5. `R1-R4-D093`（干扰，R1-T05，constraint）nowSeconds 产出秒级整数

- anchor：`src/utils/time.ts`
- summary：nowSeconds 将当前毫秒时间转换为向下取整的秒级时间戳。
- content：nowSeconds 必须返回整数秒，避免毫秒小数进入时间计算。适用场景是调用方需要统一时间粒度时；实现时应使用 Date.now 与 Math.floor，并避免直接返回 Date.now。

### 6. `R2-R4-D001`（干扰，R2-T01，risk）追加返回值须与落盘事件一致

- anchor：`src/extracted/agent/traceStore.ts`
- summary：createTraceStore.append 返回本次实际写入的 AgentTraceEvent。
- content：createTraceStore.append 应把 operations 队列中最终赋给 result 的 event 返回给调用方，而不是回显 input；这样 sequence、timestamp 与脱敏后的内容才和落盘记录一致。该规则适用于 TraceStore 追加调用及其结果消费，不涉及历史记录的读取边界。

### 7. `R2-R4-D024`（干扰，R2-T02，context）创建消息前校验输入

- anchor：`src/extracted/chat.ts`
- summary：收紧消息创建接口的必填项与字段类型，避免无效记录进入聊天存储。
- content：调用 createChatStore 的 createMessage 前，应按 CreateChatMessageInput 校验 roomId、authorId、authorName 与 text，kind 仅接受 ChatMessage 支持的值，以防止无效输入污染持久化数据。该规则适用于成员消息、Agent 消息及 mentions、runId 等可选字段的创建入口。

### 8. `R2-R4-D047`（干扰，R2-T03，constraint）JSON 缺失读取约定

- anchor：`src/extracted/jsonFile.ts`
- summary：readJsonFile 将不存在文件视为空结果，其他解析错误继续抛出。
- content：调用 readJsonFile 读取 storagePath 时，文件不存在且错误码为 ENOENT 应返回 undefined；JSON 内容损坏等其他异常必须抛出。这样调用方能区分首次创建与真实故障，适用范围为读取 JSON 存储文件的路径。

### 9. `R2-R4-D070`（干扰，R2-T04，negative）EventInput 负载需受控

- anchor：`src/extracted/eventLog.ts`
- summary：避免无界 payload 拖慢事件写入与历史加载。
- content：EventInput 的 payload 不应承载无限增长的二进制或大文本，提交前应设置体积上限并优先保存摘要或引用。这样可避免 EventLog 写入放大及 loadEvents 内存占用过高；该限制适用于 createEventLog 接收的普通协作事件，超限输入应明确拒绝。

### 10. `R2-R4-D093`（干扰，R2-T05，constraint）Action 权限词表迁移边界

- anchor：`src/extracted/auth/permissions.ts`
- summary：Action 是权限判断使用的固定动作集合，迁移时不得随意扩充或改写。
- content：Action 只允许使用 permissions.ts 已列出的动作名称，新增权限需同步检查 requirePermission 与 can 的匹配关系，否则授权判断可能静默失效。迁移历史数据时应保留原有动作字符串语义，仅在明确业务需求后增删成员、Agent 或 workspace 相关项。

### 11. `R1-R4-I001`（无关，context）配置读取返回快照

- anchor：`src/config/settings.ts`
- summary：loadSettings 暴露存储读取结果，调用方不应假定获得可独立修改的配置对象。
- content：loadSettings 直接返回 SettingsStore.read() 的结果，不在服务层额外复制配置。这样可避免维护两套配置状态，并让调用方通过 updateSettings 统一提交变更。适用于读取当前配置并生成 settingsSnapshot 的场景；调用方不得把返回值当作可任意修改的本地副本。

### 12. `R1-R4-I002`（无关，tutorial）先创建客户再执行标签操作

- anchor：`src/domain/customer.ts`
- summary：统一客户写入顺序，避免更新不存在的客户。
- content：新增客户数据时，先通过 createCustomer 创建并保存 Customer，再调用 addTag 或 removeTag 调整 tags；读取列表时使用 searchCustomers，筛选可交易客户时使用 activeCustomers。该顺序让标签变更始终落在已持久化的客户上，避免检索结果与标签状态不一致，适用于服务层的新客建档流程。

### 13. `R1-R4-I003`（无关，constraint）错误码承担失败边界

- anchor：`src/domain/errors.ts`
- summary：用稳定错误码区分订单、成员及访问失败，避免调用方依赖错误文案。
- content：业务失败统一从 ERROR_CODES 选择固定值，并通过 DomainError.code 暴露；新增失败类型时必须同步扩充该映射。原因是订单、成员、权限和投递场景需要被调用方稳定识别，文案可能调整，不能承担协议契约。适用范围覆盖服务层抛错、HTTP 路由转换及跨模块判断；不得在调用处临时拼接错误码。

### 14. `R1-R4-I007`（无关，negative）入库拒绝重复重试

- anchor：`src/domain/inventory.ts`
- summary：receiveStock 每次都会增加库存，不能作为天然幂等入口。
- content：receiveStock 会把 amount 直接累加到 item.available，并未携带业务幂等键、已入库记录或重复请求标记。因此同一收货事件被重试时，每次调用都可能再次增加库存并提升 version；接入方必须在调用前完成事件去重，且只能对已确认唯一的一次收货执行入库。

### 15. `R1-R4-I009`（无关，risk）StockItem 缓存失效约束

- anchor：`src/domain/inventory.ts`
- summary：库存缓存必须按 sku 与 warehouseId 定位，并在写操作后基于 version 失效。
- content：缓存 StockItem 时以 sku 和 warehouseId 组成唯一键，读取结果需携带 version。任何 createStock、reserveStock、releaseStock、consumeStock、receiveStock 或 changeReservation 成功后，都必须使对应键下的旧版本缓存失效，并在回填时确认 version 未变化。这样可避免并发写入期间继续返回过期的 available 或 reserved；该约束适用于库存服务、HTTP 路由读取缓存以及跨实例发布失效通知的场景。

### 16. `R2-R4-I001`（无关，context）运行管理器依赖注入边界

- anchor：`src/extracted/agent/agentRunManager.ts`
- summary：创建运行管理器时显式注入存储、运行时和活动回调，避免模块内部隐式读取全局状态。
- content：通过 AgentRunManagerOptions 显式传入 members、runtime、registry、runtimeManager、getSettings 和 runTimeoutMs，apiKey、sensitiveValues 可选注入，appendActivity 承接外部事件写入。这样 createAgentRunManager 可在测试和不同宿主中替换依赖，由调用方决定返回值是否继续修改，避免共享可变状态。

### 17. `R2-R4-I002`（无关，tutorial）项目队列失败后保留任务

- anchor：`src/extracted/agent/agentRunManager.ts`
- summary：项目级队列记录待运行项与处理状态，失败后仍保留未完成任务。
- content：使用 ProjectQueue 时，runIds 保存项目内待处理运行，processing 标识当前是否由队列协程占用，completion 可让调用方等待本轮结束。执行某项失败时不能清空其余 runIds，否则会丢失排队请求；应保留可重试状态并释放 processing。适用于 createAgentRunManager 管理的同一项目串行调度场景。

### 18. `R2-R4-I003`（无关，constraint）活动运行禁止并发覆盖

- anchor：`src/extracted/agent/agentRunManager.ts`
- summary：同一项目的活动运行必须串行更新，防止会话和文件状态发生版本冲突。
- content：ActiveRun 中的 workspacePath 与 runtimeSessionId 共同绑定一次运行所占用的工作区和运行时会话。团队禁止两个运行同时写入同一项目活动状态；新运行需等待旧运行完成或明确中断后再登记，避免后写入者覆盖前者的会话信息。该约束适用于 createAgentRunManager 触发 AgentRuntime 的并发执行路径。

### 19. `R2-R4-I007`（无关，negative）运行存储按项目惰性创建

- anchor：`src/extracted/agent/agentRunManager.ts`
- summary：getStore 只缓存可验证项目的存储实例，缺失项目立即失败。
- content：getStore 的缓存键是 projectId，但只有 options.registry.getProject(projectId) 成功后才调用 createAgentRunStore，并写入 stores。原因是运行数据必须绑定真实项目的 metadata 路径，避免为不存在的 projectId 生成孤立目录或无效 AgentRunStore。调用方应在创建运行、读取运行或处理项目队列前使用 getStore；项目不存在时允许抛出 Error，而不要继续写入。

### 20. `R2-R4-I009`（无关，risk）旧版运行记录兼容性风险

- anchor：`src/extracted/agent/agentRunStore.ts`
- summary：AgentRun 校验过宽，磁盘旧数据可能缺少新增必填字段。
- content：createAgentRunStore 委托 createRecordStore 持久化 AgentRun，但 validateRecord 仅校验对象及字符串类型的 id、projectId，缺失状态、输入、输出等新增字段仍可写入。读取方按完整 AgentRun 使用时可能得到 undefined，因此新增字段或改变字段含义时，须同步制定 run.json 迁移或更严格校验策略，适用于已有 agent-runs 数据及跨版本升级。

## 原始记录

生成期的完整请求/响应、逐卡生成日志、泄露判定缓存、压缩记录、plan/index/assembly 在数据工作区 `.judge-work/r4b/`（被 gitignore，不提交）：

- `raw/`：每批请求与模型原始响应；
- `generation-log.jsonl`：逐批 usage、接受/拒绝、错误原因；
- `leak/`：每张卡片的泄露判定与理由；
- `compress-log.jsonl`：压缩前后长度；
- `plan-*.json`、`index-*.json`、`assembly-*.json`：分配、符号索引与组装结果。

提交的 `llm-calls.jsonl` 记录每次调用的 provider、model、usage、promptHash 与时间，不含凭据。

## 效度与限制

- 新卡片由模型生成，标识符与锚点可机械校验，但“这条规则是否真的属于该团队”无法完全自动验证；报告与抽样供人工复核。
- 干扰卡片与目标约定共享模块和术语，模型判定存在边界案例；本阶段对 18 张（22 次）判定为泄露的卡片做了删除重写，仍建议审稿人抽查最终库。
- 新卡片比原 40 张长 30–50 字，长度分布没有完全对齐；这是为了保留真实标识符、原因与适用范围而做的取舍。
- 本阶段没有 Agent 运行，因此没有 phase 3 意义上的 `raw/<组合>/`；C1 token 请求只用于测量上下文规模，不作为实验条件。

## 下一步

阶段 2 将检查 OpenCode 1.18.31 读取 AGENTS.md 的规则，决定 C1s 是否可行，并做 C1@500、C2@500、C1s@40 的试跑；阶段 3 按 22 任务 × 3 次重复运行矩阵。等待确认。
