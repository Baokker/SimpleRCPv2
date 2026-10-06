# Agent 冲突预防

## 权限分发

OpenCode 固定使用 1.18.31。`rules`、`full` 将 `edit` 权限配置为 `ask`；`off`、`observe` 保持 `allow`。`bash`、`webfetch` 保持原有配置。真实 runtime 的 `edit`、`write`、`apply_patch` 都产生 `permission.asked`，证据见 `evidence/stage-6-smoke/permission-events.json`。

`permissionDispatcher.ts` 按注册顺序执行处理函数，任何处理函数拒绝即结束检查。全部通过后回复 `once`；异常、取消、超过时间预算回复 `reject`。处理函数异常及回复错误写入 run trace，run 的状态继续由实际任务结果决定。同一请求编号在全部处理函数、权限回复和清理完成期间共享处理过程。最终拒绝、取消或回复失败会清除对应的批准预约。审批等待期间暂停 run 的执行超时计时，累计等待时间单独保存；暂停与恢复函数的异常均记录 trace。

回复仅允许 `once`、`reject`。收到事件中的 `always` 字段只作为原始事件保存。

## T2 修改检查

`conflictGuardEditHandler.ts` 使用 `diff` 库解析 unified diff，以磁盘当前内容还原 before/after，支持单文件与多文件元数据。文件路径必须属于项目工作区，基线不匹配或元数据无法还原时拒绝并提示重新读取文件。

Agent 参与者包含 `kind: agent`、`runId`、`ownerId`，团队 Agent 另含 `teamAgent`。`ownerId` 使用本次 run 的触发成员编号。

提案与共享文本中其他区域的修改合并后，复用 `SemanticChangeTracker`、`classify`、`PairCoordinator`。重叠的共享修改要求 Agent 重新读取。删除符号保留相关依赖边。白区与本地黑区直接决定；`full` 的灰区使用 G4 中的 T2 策略，默认 G1。单次权限检查总时间预算为 30 秒，包括排队及所有候选对检查。

模型返回后核验当前输入。检查期间其他参与者改变相关文件或活跃范围时，在同一时间预算内重新检查；回复之前再次检查文件写入许可。

| 结果 | 回复及提示 |
|---|---|
| allow | `once` |
| warn | `once`，属主收到提示，run 保存近期警告 |
| lock | `reject`，附冲突参与者、符号、规则、证据与修改建议 |
| 失败、超时、无效格式 | `reject`，提示稍后重试 |
| 文件暂停写入 | 直接 `reject`，提示等待相关冲突处理完成 |

拒绝消息包含 `Edit rejected`、另一方参与者与符号、规则及证据、重新读取与兼容修改建议，末尾可以附近期警告。人与 Agent 的冲突只拒绝 Agent，双方均不产生人类冻结或冲突卡片；通知仅发给 Agent 属主。两个 Agent 的审批检查按进入顺序执行，已批准但尚未写入的修改也参与下一次检查。

放行记录保存路径与目标全文 SHA-256。chokidar 或工具完成事件回灌时，匹配该记录的修改使用 Agent origin，进入该 run 的活跃变更集。无法匹配的修改保留 `filesystem` origin。

## T3 结束检查与撤回

完成、失败、取消、超时共用结束检查。run 开始快照包含当前共享文档内容；结束快照来自工作区。检查只选择 run 开始之后被其他参与者修改过的相关符号，包含已经结束批次的记录。检查视图保留当前共享文本中其他符号的修改。T3 总时间预算为 60 秒，默认 G1。

已经归属的 edit 保存每次 before/after。无法经过 T2 的 bash 修改由快照差异补充，同文件中 edit 之后的独立修改也进入检查。存在并发修改且无法确定归属的快照差异交由人工处理；结束快照无法读取时同样记录 `t3_incomplete`，检查结果为 `warned`，并通知属主。

T3 使用每次归属修改的符号键限定 Agent 的净变化，保留 run 期间其他参与者各轮修改的符号范围。模型返回后重新核验当前输入，依据变化时继续检查。已经打开的删除文件恢复时直接恢复磁盘文件，同时更新 Yjs 文档的保存记录。`guard-revert` 写入会保存文件，成员修改计数保持独立。

lock 后按完整行形成修改块，比较原文、Agent 写入版本与当前文本。完整块保持 Agent 内容时恢复原文；其他成员已经修改过的块保持当前内容，并记录需要人工处理。新增文件可以删除，已删除文件可以恢复。打开的文件使用新的 Yjs 事务，origin 为 `guard-revert`；未打开的文件核验当前内容后写入，由文件监听传播。撤回失败或检查异常记录原因并通知属主。

`AgentRun.conflictGuard.t3` 为 `passed`、`warned`、`reverted` 或 `partially-reverted`。原有 run 完成状态保持实际任务结果；T3 等待期间取消任务，最终状态保持 `cancelled`。`t3_revert` 保存每个文件撤回块的哈希、跳过块及原因和计数。

## 配置与界面

`CONFLICT_GUARD_T2_STRATEGY`、`CONFLICT_GUARD_T3_STRATEGY` 接受 G1、G2、G3，默认 G1。`CONFLICT_GUARD_T2_REASONING`、`CONFLICT_GUARD_T3_REASONING` 接受 true、false，默认 false。角色接口与提示词沿用阶段 5，时点与 reasoning 进入输入哈希。

Agent 面板显示拒绝次数、最近拒绝原因、审批等待时间及 T3 结果。“冲突预防”页签显示 Agent 活跃符号、关系与 T2/T3 判定来源。属主使用现有工作区通知查看警告及撤回结果。

observe 在工具完成后执行 T2 shadow，记录 Agent 归属与 `t2_shadow`，保持实际写入和 run 行为。T3 只记录 `t3_shadow`。off 不创建 Agent 冲突上下文。

## 使用限制

- bash 文件写入仅受 T3 检查。
- 修改块以完整行为单位，同一行被其他成员修改时整行交由人工处理。
- 快照差异存在并发归属不明时，不能据此自动撤回。
- 审批通过与实际工具写入之间仍受外部程序写入影响；内容哈希不匹配时保留 filesystem 来源。
- 依赖 OpenCode 1.18.31 的权限事件元数据及 SDK 回复接口。
- 活跃变更集与审批记录保存在服务端内存中，服务重启后需重新建立 run 上下文。

复现命令：`pnpm --filter @simplercp/server exec tsx scripts/probe-agent-permission.ts` 与 `pnpm --filter @simplercp/server exec tsx scripts/stage6-smoke.ts`。运行目录位于被忽略的 `.test-workspaces/`，原始证据经过敏感值过滤。
