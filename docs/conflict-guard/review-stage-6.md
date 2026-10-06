# 阶段 6 复核验证

复核范围为 `f925263..1d6cf71` 的阶段 6 提交。服务端时序测试使用 `idleMs=1500`、文件写入延迟 300 ms，通过真实 createApp、Yjs、WebsocketProvider 与磁盘文件验证；Agent runtime 与模型接口使用阶段 6 要求的注入实现。

## 行为与回归测试

| 编号 | 当前行为 | 修改位置 | 对应测试 |
|---|---|---|---|
| R1 | T2、T3 在模型返回后核验当前输入，相关内容变化时在原有时间预算内重新检查；T2 回复前再次核验文件写入许可。 | `projectAgentGuard.ts` | `rechecks a dependency changed while T2 is awaiting a model verdict`、`rechecks a dependency changed while T3 is awaiting a model verdict` |
| R2 | 同一权限请求在回复与清理完成期间共享处理过程，完成后允许再次处理同一编号。 | `permissionDispatcher.ts` | `shares a repeated request while its permission reply is pending`、`processes another empty-handler request after the earlier reply completes` |
| R3 | 后续处理函数拒绝、取消或 SDK 回复失败时清除该提案的预约；取消等待中的批准回调后回复 reject。 | `permissionDispatcher.ts`、`conflictGuardEditHandler.ts`、`projectAgentGuard.ts` | `clears an unwritten approval reservation after handler-reject`、`clears an unwritten approval reservation after reply-failure`、`rejects after cancellation during approval and releases the proposal` |
| R4 | T3 保留 run 期间同一成员各轮修改的相关范围，使用 run 开始文本进行比较。 | `projectAgentGuard.ts` | `retains dependency changes from an earlier completed human change set during T3` |
| R5 | 已经打开的文件在 T3 撤回后保存磁盘内容；删除文件恢复时更新文件与 Yjs 保存记录；guard-revert 使用独立的修改计数。 | `collaborativeDocuments.ts` | `restores an Agent-deleted file whose Yjs document remained open`、`persists a T3 revert through an already open document`、`does not count a guard revert as a member revision` |
| R6 | T3 仅将每次归属修改涉及的符号计入 Agent 的净变化，新增与删除的 class 保留声明自身。 | `projectAgentGuard.ts`、包内 `coordination/agentGuard.ts` | `keeps another member's symbol out of an Agent's repeated-edit T3 change set`、`keeps container declarations in added and deleted Agent symbol sets` |
| R7 | 审批暂停与恢复函数异常记录 trace，权限分发继续完成回复。 | `permissionDispatcher.ts` | `rejects and replies when pausing approval throws`、`keeps the permission reply when resuming approval throws` |
| R8 | 服务端 Vitest 使用 forks，让包含 node-pty 的测试在独立进程中执行。 | `apps/server/vitest.config.ts` | 服务端完整测试 |

R1 到 R6 的新增测试均完成修复前失败、修复后通过的验证。R7 的异常路径由独立测试验证。所有测试通过公共接口检查实际文本、权限回复或 run 结果。

## 执行记录

| 命令 | 结果 |
|---|---|
| `pnpm -r build` | 通过 |
| `pnpm --filter @simplercp/conflict-guard test` | 19 个文件、180 项通过 |
| `pnpm --filter @simplercp/server test` | 44 个文件、237 项通过；Agent 生产参数集成 37 项 |
| `pnpm test:demo` | 2 项通过 |
| `CONFLICT_GUARD=full SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS=3 SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e tests/e2e/conflict-guard-agent.spec.ts` | 3 项通过 |
| `CONFLICT_GUARD=rules SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e tests/e2e/conflict-guard-intervention.spec.ts` | 6 项通过 |
| `CONFLICT_GUARD=rules SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e tests/e2e/conflict-guard-panel.spec.ts` | 1 项通过 |
| `CONFLICT_GUARD=observe SIMPLERCP_SKIP_MODEL_REQUESTS=true pnpm test:e2e tests/e2e/conflict-guard-agent.spec.ts` | 1 项通过，2 项按模式跳过 |
| `CONFLICT_GUARD=off pnpm test:collab` | 2 项通过 |
| `CONFLICT_GUARD=observe pnpm test:collab` | 2 项通过 |
| `CONFLICT_GUARD=rules pnpm test:collab` | 2 项通过 |
| `CONFLICT_GUARD=full pnpm test:collab` | 2 项通过 |
| `node scripts/verify-evidence-secrets.mjs` | 配置凭据精确值匹配计数 0 |

已有的真实 OpenCode 权限与任务证据继续保存在 `evidence/stage-6-smoke/`。本轮模型等待场景使用可控的注入结果检查时序。
