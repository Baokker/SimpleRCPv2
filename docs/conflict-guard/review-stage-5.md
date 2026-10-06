# 阶段 5 复核

复核范围为 `b1ddb7d..559b71d` 的阶段五修改及本轮修复，分支为 `feature/conflict-guard`。检查包括研判请求、共享上下文、模型录放命令、成员通知、变更对状态机及真实浏览器流程。

## 已验证行为

| 编号 | 行为 | 修改位置 | 常驻回归测试 |
|---|---|---|---|
| R1 | 每名订阅者保留自己的级联截止时间；一名订阅者超时后，其他订阅者可以继续等待共享深判请求 | `src/adjudication/service.ts` | `shared deep requests preserve each subscriber's cascade deadline` |
| R2 | 调用点及测试证据使用 TypeChecker 查询目标声明；同名方法、import 别名、匿名 default 函数分别获得对应证据；索引包含 `.mjs` 与 `.cjs` | `src/adjudication/invariants.ts`、`src/semantic/` | `caller and test evidence resolves the modified method across namesakes`；`anonymous default functions retain their caller and test evidence` |
| R3 | 离线校验恢复完整录制配置和适配器模型版本，只运行报告中已有的策略；HTTP 次数与调用事件分别记录；离线运行允许缺少 `.env` | `scripts/adjudication-run.ts`、`adjudication-verify.ts`、`model-runtime.ts` | `verifies a G3-only recording with its original configuration and model version offline` |
| R4 | 黑区重新判定为 warn 并自动解除冻结后，双方接收当前修订的解释与建议；通知按 `pairId:revision` 去重 | 客户端 `App.tsx`、`conflictGuardPresentation.ts` | `participants receive the model warning after a lock is automatically cleared` |
| R5 | 有效判定或分析输入首次失效时推进 revision；pending/stale 连续输入及临时关闭保留计数；新服务端与合成轨迹使用相同模式 | `src/coordination/`、`src/replay/`、`src/bench/generator.ts`、服务端 `projectConflictGuard.ts` | `pending and stale inputs retain their revision across refreshes and temporary removal`；`historical refresh coalescing is verified by identical semantic input hashes` |
| R6 | 修订改变时清除双方确认；关闭后恢复原文仍按当前修订重新判定。同一修订关闭后重新出现时保留确认 | `src/coordination/pairState.ts` | `a previous confirmation does not apply after closed revisions return to their original content`；`双方确认的修订在变更对关闭后重新出现时继续有效` |

状态机测试通过公开 `update`、`confirm` 和记录查询验证转换。录放命令测试使用已提交的真实 G3 录制，在独立子进程中运行三轮校验，并改变环境中的模型版本及报告配置。共享上下文测试使用真实 SemanticIndex 和 TypeChecker。

R1、R2、R3、R4 的提交分别为 `a0628fd`、`8c16071`、`4dbdfcb`、`5c91ae9`；R5/R6 为 `94815ef`，浏览器时序测试为 `047e04e`。

浏览器并发提示用例等待服务端运行状态为 Running 后输入。阶段二面板的文件数量包含演示项目的 `.mjs` 测试文件。

## 轨迹兼容

新轨迹在 `session_start` 写入 `pairRevisionMode: "judged-input"`，一致性检查严格比较 revision。已有未标记轨迹使用 legacy 计数；仅当有效 SHA-256 `revisionKey` 相同且规则、动作、成员和时间检查通过时，接受历史数值计数差异，并列入 `legacyRevisionMatches`。输入哈希缺失或不同均不能通过。闸门、文件写入和冻结继续独立核验。

历史连续输入录制保存在 `evidence/stage-5-review/continuous-input.jsonl`。常驻测试同时验证输入哈希改变和新模式严格检查的拒绝结果。

## 验证记录

| 命令 | 结果 |
|---|---|
| `pnpm -r build` | 全部包通过 |
| `pnpm --filter @simplercp/conflict-guard test` | 18 个文件、169 项通过 |
| `pnpm --filter @simplercp/server test` | 41 个文件、185 项通过，包含 1500 ms 批次空闲和 300 ms 写入等待的研判集成测试 |
| `pnpm test:demo` | 两项通过 |
| `CONFLICT_GUARD=rules SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS=1 SIMPLERCP_STAGE5_LIVE=0 pnpm test:e2e` | 36 项通过、5 项按条件跳过，阶段二、阶段三及检查点浏览器流程通过 |
| `CONFLICT_GUARD=off pnpm test:collab` | 两项通过 |
| `CONFLICT_GUARD=observe pnpm test:collab` | 两项通过 |
| `CONFLICT_GUARD=rules pnpm test:collab` | 两项通过 |
| `pnpm --filter @simplercp/conflict-guard replay:check ../../docs/conflict-guard/evidence/stage-4-ui/trace.jsonl` | 判定、写入闸门、文件写入、冻结均无差异；新模式 revision 严格一致 |
| `pnpm --filter @simplercp/conflict-guard adjudication:verify` | 三个独立进程与 record 一致，压缩 JSON 逐字节相同，HTTP 调用为零 |
| `git diff --check` | 通过 |
| `node scripts/verify-evidence-secrets.mjs` | 配置凭据精确值匹配数量为零 |

浏览器和回放检查结果保存在 `evidence/stage-5-review/verification.json`。本轮界面回放重新生成 `evidence/stage-4-ui/trace.jsonl`，检查点截图由浏览器用例更新。浏览器回归的条件跳过包含三个灰区真实模型场景、演示录制和终端关闭场景；灰区真实模型冒烟与人工验收结果见 `stage-5.md`。普通 Agent 浏览器用例可能调用 OpenCode；本轮模型评价使用离线录制重放。

三轮离线模型结果的共同 SHA-256 为 `2d15c5f6fd78db3c9f06086a4676ba18e2dd53cbe37677bfa720e3108d5aad61`，比较范围包括判定、结果、区间、指标、输入哈希、完成率、录制延迟和 T03。

## 评价范围

本轮保留已有开发集配置与真实模型记录，通过离线重放检查可重复性。G3 开发集三分类一致率为 50%，漏阻断率为 50%，误阻断率为 0%；完成率为 100%，p50/p95 为 353/3419 ms。质量指标未达到 T03 门槛，阶段六应继续分别记录调用完成与判断质量。保留集未参与本轮检查。
