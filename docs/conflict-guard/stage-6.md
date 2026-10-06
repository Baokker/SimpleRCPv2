# 阶段 6：Agent 冲突预防

## 权限、归属与检查

| 位置 | 行为 |
|---|---|
| `apps/server/src/agent/permissionDispatcher.ts` | 按注册顺序执行审批处理函数，支持 defer，回复 once 或 reject；各处理函数独立预算，记录审批等待，重复请求共享处理过程，处理异常拒绝修改。 |
| `apps/server/src/agent/conflictGuardEditHandler.ts` | 优先使用 tool.callID 对应的 edit/write 输入，后备使用 diff 库，还原 trimDiff、多文件、新增、删除和移动提案，核验 realpath 与 before。 |
| `apps/server/src/agent/agentRunManager.ts` | 连接审批事件、暂停执行超时计时、更新拒绝与警告记录，在全部结束路径执行 T3，保留取消状态。 |
| `apps/server/src/conflictGuard/projectAgentGuard.ts` | 维护 run 快照、批准预约、归属哈希与关联修改历史，按文件串行执行 T2，不同文件并行，执行 T3 与持久属主通知。 |
| `packages/conflict-guard/src/coordination/agentGuard.ts` | 复用语义索引、候选对、classify 与 PairCoordinator，合并共享文本，选择可以撤回的完整行。 |
| `apps/server/src/collaborativeDocuments.ts` | 回灌使用 Agent origin；打开文件以 guard-revert 事务撤回，未打开文件核验当前内容后写入，支持新增文件删除与删除文件恢复。 |
| `apps/client/src/components/AgentPanel.tsx`、`ConflictGuardPanel.tsx`、`App.tsx` | 显示审批拒绝、原因、等待时间、T3、Agent 参与者及 T2/T3 来源，通知属主。 |

rules、full 的 edit 使用 ask，off、observe 使用 allow。bash 与 webfetch 保持配置。权限回复类型只接受 once、reject。

T2 总时间预算为 30 秒。灰区使用 G4 的 T2 策略，默认 G1；白区和本地黑区直接采用规则结果。失败、超时、格式无效均拒绝本次修改，run 继续由实际任务结果决定。已有批准预约参与下一次检查，后到的不兼容 Agent 修改被拒绝。人与 Agent 的冲突只通知 Agent 属主，人的编辑区域保持可用。

T3 总时间预算为 60 秒，默认 G1。范围限定为 run 期间被其他参与者改变、且与 Agent 修改有关的符号。按完整行比较原文、Agent 版本与当前文本；保持 Agent 内容的行可以撤回，其他参与者继续修改的行需要人工处理。归属无法核验或快照无法读取时记录 t3_incomplete，返回 warned。完成、失败、取消、超时均执行检查；T3 等待期间取消任务，最终状态保持 cancelled。

## 真实 OpenCode 验证

OpenCode 版本为 1.18.31。原始权限证据位于 `evidence/stage-6-smoke/permission-events.json`，三个 permission.asked 事件来自 edit 与 write，permission 均为 edit。元数据包含 filepath 与 unified diff。apply_patch 的 files 元数据通过 SDK 类型及夹具测试核验，字段为 filePath、relativePath、type、patch、movePath。事件中的 always 是请求字段；回复仅使用 once。

真实任务的 run 事件、协作轨迹和最终源码保存在 `evidence/stage-6-smoke/`。运行命令：

```bash
pnpm --filter @simplercp/server exec tsx scripts/probe-agent-permission.ts
pnpm --filter @simplercp/server exec tsx scripts/stage6-smoke.ts
pnpm --filter @simplercp/server exec tsx scripts/verify-stage6-smoke.ts
```

| 场景 | 真实行为 | T3 | 项目测试 |
|---|---|---|---|
| 人与个人 Agent | 一次签名拒绝后，Agent 重新读取 pricing.ts，使用兼容的三参数调用；run completed。 | passed | 3/3 通过 |
| 两个 Agent | formatMoney 的格式修改先完成；checkout 的首次提案和读取格式的重试均被深判拒绝，Agent 暂缓修改；两个 run completed。 | 生产者 passed，消费者 warned | 2/3 通过 |

两个 Agent 场景的保留格式为 `18.00 USD`，既有测试期望 `USD 18.00`。生产者在审批时没有其他活跃修改，消费者的提案被拒绝后没有写入，生产者的依据也没有被推进，因此 T3 未撤回该单方修改。消费者结束快照包含并发文件变化，记录检查不完整并通知属主。验证命令如实返回非零状态；原始测试输出和失败计数均保存在证据中。两个协作轨迹均通过 schema 校验。

此场景验证了 T2 拒绝和 Agent 暂缓行为。单方业务修改与已有测试的兼容性需要 Agent 任务自行保证。T3 撤回及保护其他成员修改的行为由生产参数集成测试和浏览器用例验证。

## 测试与浏览器验收

Agent 集成测试使用真实 createApp、WebsocketProvider、Yjs、文件监听和磁盘文件。Agent runtime 与模型角色采用本阶段指定的注入实现。批次空闲时间为 1500 ms，文件写入延迟为 300 ms。

测试覆盖：签名拒绝与兼容重试、无关修改放行、灰区 lock/warn、超时拒绝、人类编辑保持可用、两个 Agent 的审批顺序、Agent origin、同文件的共享修改、暂停文件拒绝、全部结束路径、完整与部分撤回、删除恢复、observe shadow、审批暂停超时、T3 等待期间取消、检查不完整与目录事件。

浏览器用例 `tests/e2e/conflict-guard-agent.spec.ts` 使用两个独立上下文，检查个人 Agent 拒绝与重试、两个 Agent 的依赖冲突、属主收到 T3 撤回通知，以及 observe 的直接写入与 shadow 展示。页面行为通过 DOM、Monaco、文件 API 和 guard 状态验证，状态证据位于 `evidence/stage-6-manual/`。

| 命令 | 结果 |
|---|---|
| `pnpm -r build` | 全部项目通过 |
| `pnpm --filter @simplercp/conflict-guard test` | 22 个文件、195 项通过 |
| `pnpm --filter @simplercp/server test` | 45 个文件、260 项通过，其中 Agent 集成 47 项 |
| `pnpm test:demo` | 2 项通过 |
| `CONFLICT_GUARD=rules SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS=1 SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e` | 36 项通过、8 项按条件跳过；包含阶段 2、3、4 的浏览器回归 |
| `CONFLICT_GUARD=rules SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS=3 SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e` | 37 项通过、7 项按条件跳过；包含阶段 2、3、4 与阶段 6 的浏览器回归 |
| `SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e` | 21 项通过、23 项按条件跳过；默认并发容量为 3 |
| `CONFLICT_GUARD=full SIMPLERCP_STAGE6_EVIDENCE=true pnpm test:e2e tests/e2e/conflict-guard-agent.spec.ts` | 3 项通过 |
| `CONFLICT_GUARD=observe SIMPLERCP_STAGE6_EVIDENCE=true pnpm test:e2e tests/e2e/conflict-guard-agent.spec.ts` | 1 项通过、2 项按模式跳过 |
| `CONFLICT_GUARD=off pnpm test:collab` | 2 项通过 |
| `CONFLICT_GUARD=observe pnpm test:collab` | 2 项通过 |
| `CONFLICT_GUARD=rules pnpm test:collab` | 2 项通过 |
| `CONFLICT_GUARD=full pnpm test:collab` | 2 项通过 |
| `CONFLICT_GUARD=off pnpm test:e2e:terminal-disabled` | 1 项通过 |
| `node scripts/verify-evidence-secrets.mjs` | 配置凭据的精确值匹配计数为 0 |

容量为 1 的回归运行跳过两个 Agent 并发用例，该用例在 full、容量为 3 的阶段 6 验收中执行。需要实际模型请求的浏览器用例保留各自的执行条件；阶段 6 的实际调用由上述 OpenCode 验证命令执行。机器可读记录见 `evidence/stage-6-manual/verification.json`。

Agent trace 将事件转换为界面条目后保留最后 200 条可见记录。队列用例按照配置的并发容量创建运行任务，在团队任务进入 queued 后取消占位任务。检查点测试没有执行验收场景时保留已有 acceptance.json。

## 使用限制

阶段 6 的权限生命周期、检查期间输入变化、T3 修改范围和文件恢复验证见 [复核记录](review-stage-6.md)。

- bash 文件写入只在 T3 检查。
- 同一行被其他参与者继续修改时，该行交由人工处理。
- 并发归属无法确定的快照变化保持当前内容，并通知属主人工检查。
- 批准审批与工具写入之间的外部变化可能导致哈希无法匹配，此时保留 filesystem 来源。
- 服务重启会清除内存中的活跃 run 与审批预约。
- 依赖 OpenCode 1.18.31 的权限事件元数据和 SDK 接口。
- 未形成候选对的单方行为修改可能改变既有测试结果，T2/T3 的关联检查不会运行整个项目测试。

## 检查点 B 真实浏览器

两个独立浏览器使用 full/G3、真实 OpenCode 和 DeepSeek，工作区通过 macOS 符号链接访问。三次真实 Agent run 均 completed。签名变化与 checkout 前缀场景获得 once 和模型警告，人类没有冻结；同文件灰区修改曾因语义冲突拒绝一次。兼容的空购物车检查场景在分析期间遇到 Cart.add 更新，首次提案因 before 已变化拒绝，Agent 重新读取后获得 once，双方修改均保留，T3 passed。

预约使用精确修改范围与提案自己的 after；批准后暂停该文件的 Yjs 写入，两秒期限后核验实际内容并记录 reservation_mismatch。子 Agent 的 session.created 后代进入同一事件集合，回复使用请求的 sessionID。T3 的无法核验文件限定于本次台账或按 user messageID 查询的会话 diff。

GuardConflict 统一传递显示名、双方 ActorRef、符号、修改前后签名、规则、中文说明与建议。defer 权限处理和带 read/handled 的持久通知提供阶段 7 接口，团队 Agent 通知对象为本次触发者。生产参数集成复查、blocker 变异、完整测试与截图见 review-fix-checkpoint-b.md。

## 阶段 7 建议

属主协调复用 ownerId、teamAgent、T2/T3 记录及通知通道。属主选择通过权限处理函数与状态机执行，保持人类编辑优先。打扰数量可以根据 run、pairId、revision 与通知编号统计；归属无法核验的修改继续交由人工处理。
