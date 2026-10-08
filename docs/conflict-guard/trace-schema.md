# 协作轨迹 Schema 3

每个启用 observe、rules 或 full 的项目使用一个 `conflict-guard/trace.jsonl` 文件。每行是一个 JSON 对象，包含 `schema: 3`、连续递增的 `seq`、毫秒时间戳 `at` 和事件 `type`。写入错误会记录并累计失败次数，后续写入继续尝试。

## 事件字段

- `session_start`：`mode`、阈值配置和服务端提交号。新服务端与合成轨迹增加 `pairRevisionMode: "judged-input"`：有效判定或分析输入首次变化时增加 revision，pending/stale 的连续输入保留 revision。服务重启后追加事件，回放保留跨会话文本、批次、变更集和脱敏状态。
- `doc_open`：普通文件记录 `file`、初始全文 `text` 和 `textHash`；敏感文件记录 `{ file, skipped: "sensitive" }`。
- `edit`：`file`、`origin`、`ops`、`revisionAfter`。每个操作包含相对于修改前文本的 `from`、`deleted` 和 `inserted`；按顺序应用时累计前序操作的长度变化。`revisionAfter` 为 collaborativeDocuments 写入后的真实 revision。服务端撤回使用 `origin.kind = "guard-revert"` 并带成员编号。
- `cursor`：`memberId`、`file`、`position`、`selection` 和时间。服务端内存保留每个成员的最新光标，轨迹每 200 毫秒窗口登记最后一个位置。
- `batch_opened`、`batch_closed`：批次编号、参与者、文件、时间和范围。关闭事件增加 `endedAt`、`closeReason`、文本哈希，`at` 使用批次结束时间。
- `change_set_opened`、`change_set_closed`：参与者与涉及文件，文件记录包含范围及触碰时间。打开事件已经包含首个文件。
- `change_set_file_closed`：`actor`、`file` 和 `reason`。
- `change_unit`：`actor`、已经关闭的 `batchId`、`commentOnly` 与 `symbols` 数组，每项包含 `key`、`file`、`status`、`beforeHash`、`afterHash`。哈希为符号 before/after 的 SHA-256，事件没有符号全文。有效符号变化的关闭批次记录一个单元；仅修改注释或空白的批次记录 `commentOnly=true`、空符号列表，不计入有效符号单元统计。每侧 before 使用其基线恢复本人修改范围，并保留范围外的当前共享代码。旧轨迹可以缺少 `commentOnly`。
- `pair_candidate_opened`、`pair_candidate_updated`、`pair_candidate_closed`：包含 `pair`，字段为稳定 `id`、`left`、`right`、`distance`、`path`、`firstSeenAt`、`updatedAt`。每侧包含 `actor`、`symbol` 和 `status`。距离 0 时两个符号相同且 `path: null`；距离 1 或 2 时路径包含相应数量的 hops，每项记录 `from`、`to`、`kind` 和 `direction`，并可带有 `typeOnly`。候选关闭后，相同参与者与符号再次关联时使用相同编号和新的首次发现时间。
- `pair_judged`：记录 `pairId`、`revision`、完整 `pair` 和 `verdict`，包括区、动作、规则编号、证据、`contractChanged` 和四状态检查的耗时、执行及跳过原因。`symbols` 保存双方的 `key`、`beforeHash` 与 `afterHash`，哈希使用 SHA-256。
- `pair_analyzing`：灰区开始异步研判，记录变更对、修订号与本地结果；相关文件暂停写入。
- `pair_analysis_progress`：超过软时间预算的分析进度，记录变更对及修订号。
- `provider_call`：`adapter`、`model`、`promptVersion`、`inputHash`、`decision`、`confidence`、`latencyMs`、`usage`、`costUsd` 与 `status`。状态为 `success/timeout/failed/invalid-format/cancelled/cache-hit`，失败可以没有 decision 与 confidence。事件不包含请求正文与原始响应。
- `provider_subscription`：每个研判请求分别记录 `role`、`adapter`、`model`、`promptVersion`、`inputHash`、`cacheKey`、`occurrence`、`status`、`latencyMs` 与 `budgetMs`，Agent 请求另带 `point`。`occurrence` 从 1 开始，在同一研判服务内按输入哈希递增。共享 HTTP 请求的各订阅者分别保存等待时长、剩余预算与完成状态；单个订阅者超时不会改写共享响应缓存。事件不包含请求正文与原始响应。
- 模型 `pair_judged.verdict.adjudication`：策略、角色来源、适配器及模型、置信度、总延迟、`success/degraded`、是否升级、中文解释、操作建议、输入哈希与提示词版本。取消及过期响应没有判定事件。
- `pair_stale`、`pair_resolved`、`pair_closed`：记录变更对修订号、状态和解决原因。
- `freeze`：当前冻结字符范围，包含变更对、成员、符号、文件与起止位置。每次相关范围移动或冻结状态变化时记录。
- `persist_gate`：文件、`allowed` 与原因 `lock/pending-judgement/analyzing`，仅在状态变化时记录。
- `persist`：文件与当前写入全文的 SHA-256，服务端成功写入后记录。
- `freeze_violation`：每次编辑事务记录一次，包含文件与涉及的 `pairIds`。
- `persist_conflict`：暂停写入期间的外部文件输入。
- `ui_action`：已经接受的卡片动作、成员与变更对；拒绝请求不记录动作。
- `t0_warning`：批次、接收成员、接口变化成员、源符号、`targetSymbol`、稳定 `pairId` 与 `revision`。卡片统计与后续同一变更对的通知按修订号去重。
- `doc_retired`：被删除或停用的文件。
- `agent_run_started`：Agent 参与者，包含 `runId`、`ownerId` 与可选 `teamAgent`。Agent 的 edit origin 使用相同参与者；活跃变更集在 T3 后关闭。
- `agent_write_attributed`：参与者、文件与匹配批准记录的 `contentHash`。
- Agent 的 `pair_candidate_*`、`pair_judged`、`pair_analyzing` 增加 `point: T2|T3`、`shadow`；pairId 使用时点前缀。`pair_judged.symbols` 包含双方 before/after 哈希。
- `t2_judged`：参与者、决定、各文件 before/after 哈希和拒绝消息；`t2_rejected` 记录文件暂停写入时的拒绝原因。
- `t2_shadow`、`t3_shadow`：observe 模式的参与者、决定与相关文件。
- `t3_revert`：参与者、每文件的撤回块哈希、跳过位置与原因、总撤回及跳过计数。
- `t3_incomplete`：Agent 参与者与无法核验的文件及原因；快照整体不可读取时只记录原因。结束检查结果为 warned，需要属主人工处理。
- `agent_guard_error`：runId、时点与原因。权限分发器的 `permission_reply`、`permission_handler_error`、`permission_reply_error` 保存在 run trace，回复包含审批等待时间；回复值只允许 once、reject。
- Agent `provider_call` 增加 `point`。原文权限事件保存在 run trace，经敏感值过滤；角色调用事件继续只保存元数据。
- `mirror_resync`：文件、修改前文本哈希、替换后的全文和新文本哈希。该事件成为该文件的回放起点。
- 脱敏按已配置的敏感值执行。写入轨迹时，已标记文件的编辑文本使用等长占位字符。导出接口会按事件顺序重放文件；一旦重建文本出现敏感值，就把该文件所有编辑、`doc_open` 与 `mirror_resync` 文本改为等长占位字符并标记 `redacted: true`。原始轨迹保留在磁盘。校验结果通过 `validateTraceDetailed` 返回 `redactedFiles` 和 `skippedFiles`，脱敏文件按跳过文本校验处理。

## 最小回放条件

`provider_call` 增加 `role` 和 `cacheKey`，缓存键包含提示词正文与请求参数。full 模式的 `replay:check` 根据 session 配置读取缓存、校验 SHA-256，重新执行灰区策略；完整初始项目文件保存为轨迹旁的 `<trace>-project.json`，包含相关测试。核验禁止联网，并比较判定、闸门、写入和冻结。

full 轨迹包含 `provider_subscription` 时，核验按输入哈希、请求次数与角色恢复各自的等待结果；相同输入的不同请求可以分别超时、取消或完成。缺少订阅事件的已有轨迹继续使用 `provider_call` 与响应缓存。

## 阶段七输入与仲裁

- `project_snapshot`：首次启动的语义源文件与相关测试内容，供 Agent 回放恢复项目视图。
- `agent_run_started`：Agent ActorRef 与开始时的 baseline 文件内容。
- `agent_proposal`：requestId、Agent ActorRef、文件级 before/after 提案。
- `agent_review`：Agent ActorRef、结束提案、实际 writes 与 forceRevert。
- `intent_created`、`intent_updated`、`intent_closed`：完整意图记录与更新原因。
- `intent_injected`：runId、条数与内容 SHA-256，不保存注入原文。
- `arbitration_action`：时点、结构化 conflict 与纯函数仲裁结果。
- `arbitration_opened`、`arbitration_updated`、`arbitration_resolved`、`arbitration_chat`：卡片状态与建议。
- `arbitration_retry`：同属主 run、关联 run 与自动检查次数。
- `arbitration_continuation`：实际追加执行完成信息，保存于 run trace。
- `ui_action` 的 arbitration_accept、arbitration_yield、arbitration_chat：成员、pairId、cardId 与双方 ActorRef。
- `agent_notice`：持久通知与 light/action 级别；`interruption`：接收人、时间、类型、pairId、revision 与级别。

session_start 记录 arbitration 与 intentInjection。Agent 回放从输入事件重新计算 T1/T2/T3 判定与仲裁。provider 缓存经 SHA-256 检查后使用录制延迟；建议内容与成员操作作为输入保留。不同仲裁配置使用同一录制行为，意图注入效果另由真实 Agent 执行评价。旧轨迹缺少 intentInjection 时，由 intent_injected 事件的存在恢复开关。

`reservation_mismatch` 保存 Agent ActorRef、文件、预计内容哈希与磁盘实际内容哈希，表示批准后的两秒确认期限内出现格式变化。`permission_deferred` 保存请求和子会话 ID；后续回复使用 `permission_reply`。内部检查异常保存原因，重复同文件异常会产生属主通知。

T2/T3 的结构化 `conflict` 包含 pairId、revision、self、other、otherDisplayName、symbols、beforeSignature、afterSignature、ruleId、zone、decision、summaryZh 及可选解释和建议。持久通知包含 id、memberId、runId、at、summary、read、handled，保存到项目的 `conflict-guard/notifications.json`。

回放从每个 `doc_open.text` 或 `mirror_resync.text` 建立文件状态，按 `seq` 顺序校验 edit 并应用操作。`batch_closed.textAfterHash` 必须等于回放后的文件文本 SHA-256。脱敏保留文本长度并替换内容，这些文件跳过 edit 操作和哈希核验，并列入 `redactedFiles`。敏感文件列入 `skippedFiles`。校验拒绝空轨迹、缺少 session 起点、缺失或乱序事件、错误删除文本和未关闭批次。

`mirror_resync` 使用 filesystem 差异作为 tracker 编辑操作，已有批次和活跃范围继续保留并按差异移动。`session_start` 保持已有文件状态，序列继续递增。

## 版本兼容与语义回放

`readTrace`、`validateTrace` 与 `validateTraceDetailed` 接受版本 1、版本 2、版本 3 及顺序混合的轨迹。版本 1、2 的旧事件保留原有字段与验证方式；缺少分区事件时，回放可以只重建符号与候选关系。服务升级后继续追加版本 3 事件，原有序列保持连续。

版本 2 校验 `change_unit` 的批次引用、状态与哈希格式，以及候选打开、更新、关闭的顺序和距离。`session_start` 开始新的候选生命周期；服务端候选状态属于当前运行会话，文件文本、批次与脱敏状态仍按连续轨迹保存。语义事件没有 before/after 全文，语义回放结合初始项目文件和 edit 序列复原符号。当前验证器执行文本 edit 与批次全文哈希核验；一致性检查比较判定序列，尚未单独比较 `change_unit` 的符号哈希。

阶段 4 的 replayTrace 处理输入事件，复用产品逻辑产生候选与判定；replay:check 比较判定、闸门、文件写入、冻结四类事件。没有 pair_judged 的轨迹返回 checked=false、valid=false。找不到变更对的 ui_action 计入 errors。冻结后相交编辑与含有该编辑的模拟持久记录使用结果字段 shouldHaveBeenBlocked、counterfactual 标记；输入轨迹保持 schema 3。

缺少 `pairRevisionMode` 的已有轨迹使用 legacy 修订方式。定时回调合并次数可以影响历史数值 revision；`replay:check` 只在双方有效的 SHA-256 `revisionKey` 完全相同，且成员、规则、动作和时间检查通过时接受这类计数差异，差异单列在 `legacyRevisionMatches`。缺少输入哈希时严格比较 revision。`judged-input` 轨迹始终严格比较 revision。
