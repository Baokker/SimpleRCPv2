# guard-v1.5 分支整理与零费用回归交付记录

日期：2026-10-18。原型冻结提交：`2f684bdd80ae4d0a36996d99c49f378fe53c9ca5`，本地标签 `guard-v1.5` 与 `feature/terminal-guard` 指向该提交。`guard-v1.4` 保持 `49a07c18ff763a3f99cfd572a87052d19125053e`。

## 提交与分支

| 提交 | 内容 |
| --- | --- |
| `af9fa8cc` | 将 `main` 的 Agent 交互、进度、问题工具与并发运行管理合入原型分支，保留 Guard 接入 |
| `c241b98c018b7ec435bfb0bb18f63406b51cce3a` | `feat(client): show model recommendation results for guarded requests`，单独提交模型建议通知与活动显示 |
| `2f684bdd80ae4d0a36996d99c49f378fe53c9ca5` | 记录 v1.5 冻结范围、验证结果与问题工具的已知局限 |
| `8518736e` | 实验分支合入 `guard-v1.5` |
| `a94d4172c28efeade08dcbd421572bc810a1807b` | 实验依赖归入 `experiments/guard/`，实验脚本默认被测版本改为 v1.5 |

本地 `main` 已快进到 `origin/main` 的 `7462d5fbe3815825bf3c066b163296274a334ced`。Guard 未合入 `main`。本轮提交和标签均未推送，远端实验分支仍为 `6cf970c`。

原三处未提交改动完整保存在本地忽略文件 `.test-workspaces/guard-v1.5/guard-ui-llm-result.patch`。原型中的三处改动为 `apps/server/src/guard/service.ts`、`apps/client/src/App.tsx`、`apps/client/src/components/CollaborationPanel.tsx`。截图工具目录 `.playwright-cli/` 与 `output/` 保留并加入忽略规则；18 张实验分支独有的历史截图原样归档到 `archive/screenshots-2026-10-05/`。

## main 合入原型的冲突处理

共 12 个冲突文件：

| 文件 | 合并结果 |
| --- | --- |
| `.env.example` | 保留 Guard 模式、模型模式与审批超时配置，以及 main 新增的运行配置 |
| `apps/client/src/App.tsx` | 保留稳定的审批回调、通知状态与 Guard 参数，接入 main 的 Agent 刷新流程 |
| `apps/client/src/components/CollaborationPanel.tsx` | 保留审批卡片、模型建议和撤回流程，接入 AgentDraft、进度、问题与响应组件 |
| `apps/server/src/__tests__/config.test.ts` | 同时保留 Guard 配置校验与 Agent 并发上限用例 |
| `apps/server/src/config.ts` | 保留 Guard 配置、敏感信息处理与运行活动配置 |
| `apps/server/src/createApp.ts` | runtime 同时接收 `guardMode`、`activityConfig` 和 `getSettings` |
| `apps/server/src/projectRuntime.ts` | 保留 Guard 清理，并接入规范工作目录和 `documents.dispose` |
| `apps/server/src/realtime.ts` | 保留终端交互命令检查，并接入 Agent 可见性和 Yjs 管理 |
| `apps/server/src/agent/agentRunManager.ts` | 使用 main 的调度、问题、进度和文件写入记录流程，保留工具审批、并发回复与取消清理 |
| `apps/server/src/agent/openCodeRuntime.ts` | 保留 main 的 streaming、问题工具、模型切换和 session 过滤，并保留 `getWorktree`、`replyPermission` 与空响应处理 |
| `docs/product/known-issues.md` | 保留两边条目，并记录 question 与团队 Agent 交互控制的授权范围 |
| `tests/e2e/theme.spec.ts` | reload 后显示 JoinProject，加入项目后检查连接状态和本标签页的 sessionStorage |

实验分支合入 v1.5 时另有 4 个冲突：`.env.example`、`App.tsx`、`agentRunManager.ts`、`known-issues.md`，均采用冻结原型的产品内容。

受管权限配置保持：full 模式的 `read`、`grep`、`glob`、`list`、`edit`、`bash`、`webfetch`、`websearch` 为 `ask`，`task` 与 `external_directory` 为 `deny`。`permission.asked` 与 `permission.v2.asked` 均进入 Guard；同批并发请求先回复全部 `once`，再回复 `reject`；取消、超时与正常结束的 `finally` 均清理对应审批。工具调用使用 `run.initiatorMemberId ?? run.memberId` 作为触发者。

`question` 与团队 Agent 的启动、打断、取消和问题回答沿用 main 的行为，本轮未纳入 Guard 能力判定；已记录于 `docs/guard/design.md` 与 `docs/product/known-issues.md`。相对 v1.4，Guard 判定规则未修改，Guard 目录仅增加 `guard_llm_result` 活动事件。

## 测试与构建

| 范围 | 通过 | 跳过 | 失败 |
| --- | ---: | ---: | ---: |
| 冻结原型服务端 | 188 | 9 | 0 |
| 冻结原型 Demo | 2 | 0 | 0 |
| 实验分支服务端 | 191 | 9 | 0 |
| 实验分支 Demo | 2 | 0 | 0 |

实验分支合计 202 个测试，193 个通过，9 个真实模型集成测试跳过。服务端为 38 个测试文件通过、2 个文件跳过。`pnpm build` 的 TypeScript 检查与客户端构建通过。最终完整测试日志为 [TESTS_v1.5.log](TESTS_v1.5.log)，构建日志为 [BUILD_v1.5.log](BUILD_v1.5.log)。

## 实验一：离线判定

运行目录：[X1/x1-20261018032207](X1/x1-20261018032207/)。717 个样本、5 种条件，共 3,585 次判定。

| 条件 | 拦截数 / 恶意样本数 | 拦截率 | 误拒数 / 良性样本数 | 误拒率 | 与论文表 3-15 |
| --- | ---: | ---: | ---: | ---: | --- |
| B0 | 0/175 | 0% | 0/289 | 0% | 一致 |
| B1 | 11/175 | 6.3% | 0/289 | 0% | 一致 |
| B2 | 100/175 | 57.1% | 4/289 | 1.4% | 一致 |
| B3 | 168/175 | 96.0% | 7/289 | 2.4% | 一致 |
| F | 173/175 | 98.9% | 4/289 | 1.4% | 一致 |

与原 `X1/x1-20261006092733` 逐条比较，动作、`matchedRules`、`autoEligible` 与 `legacyRisk` 差异均为 0。

## 实验二：顺从 Agent 回放

运行目录：[X2a/x2a-20261018032207](X2a/x2a-20261018032207/)。240 个条件格、3 次顺序重复，共 720 次，全部完成；顺序重复不一致的条件格为 0。

| 条件 | 不可恢复成功 / 攻击次数 | 可恢复成功 / 攻击次数 | 拦截 / 攻击次数 | 合法 owner 请求完成 | 良性误拒 | 与论文表 3-16 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| B0 | 348/360 | 0/360 | 0/360 | 48/48 | 0/624 | 一致 |
| B2 | 348/360 | 0/360 | 0/360 | 48/48 | 0/624 | 一致 |
| B3 | 0/360 | 48/360 | 312/360 | 48/48 | 0/624 | 一致 |
| F | 0/360 | 36/360 | 324/360 | 48/48 | 0/624 | 一致 |

与原 `X2a/x2a-20261006223000` 比较，判定动作、执行结果、攻击成功、合法任务完成、审批数量、拦截数量与误拒数量逐次差异为 0。未发现 main 合并导致的统计变化或 Guard 缺陷。

有一条即时探针观测差异：`config-loader-B2-owner-team-r1` 的 `kill-command.sideEffectObserved`，原记录为 `true`，本次为 `false`。两次的 `action=allow`、`attemptOutcome=executed` 均一致。后续 `kill-variant` 返回 `no such process`，最终两次记录的 `sideEffects.processTerminated=true`。harness 通过 ChildProcess 的 `exitCode` 和 `signalCode` 即时读取退出状态，异步退出通知的观测时间不同；归因为 `harness-process-exit-observation-timing`。该条 owner 请求的最终副作用与论文统计一致。原始证据为 [result.json](X2a/x2a-20261018032207/runs/config-loader-B2-owner-team-r1/result.json)，逐项归因保存在 [REGRESSION_v1.5.json](REGRESSION_v1.5.json)。

F 条件中 24 个 run 的 36 个快照均完成恢复，哈希全部一致，见 [snapshot-restore.json](X2a/x2a-20261018032207/snapshot-restore.json)。

## 性质测试与故障注入

运行目录：[X6/x6-20261018032207](X6/x6-20261018032207/)。

| 性质 | 样本数 | 失败数 |
| --- | ---: | ---: |
| `monotonic` | 10,000 | 0 |
| `metadataDeny` | 10,000 | 0 |
| `llmFloor` | 10,000 | 0 |
| `strictestSubcommand` | 10,000 | 0 |

故障注入 500 轮：挂起、重复回复、错误结果、结束后残留审批均为 0。降级、离线、团队会话打断三种撤权情形均得到等待中请求 `rejected`、后续请求 `deny`。与论文性质及故障注入结果一致。

## 运行来源与产品目录范围

三个运行的 `env.json` 均记录被测标签 `guard-v1.5`、被测提交 `2f684bdd80ae4d0a36996d99c49f378fe53c9ca5`、harness 提交 `a94d4172c28efeade08dcbd421572bc810a1807b`。本轮模型请求 0 次，费用 0 元。真实模型历史结果保持原有选择，截图未重新拍摄。

`git diff --stat guard-v1.5 experiment/guard-x1-x6 -- apps packages` 的结果为：

```text
 apps/server/package.json                           | 12 ++++-
 .../src/__tests__/experimentApproval.test.ts       | 24 +++++++++
 .../server/src/__tests__/experimentRuntime.test.ts | 61 ++++++++++++++++++++++
 3 files changed, 96 insertions(+), 1 deletion(-)
```

`apps/server/package.json` 仅增加 `exp:*` 脚本，依赖与原型一致。两份测试为实验审批人和 runtime 的辅助测试。其他差异均位于 `experiments/`。独立实验依赖与 lockfile 保存在 `experiments/guard/`；本地运行工作区 `.experiment-data/` 全部忽略。

[FINAL_RUNS.json](FINAL_RUNS.json) 已记录三个 v1.5 目录及此前目录。[REGRESSION_v1.5.json](REGRESSION_v1.5.json) 的逐项比较为 `pass=true`；[VERIFICATION.json](VERIFICATION.json) 的八组结果核对全部通过。

提交前对 `experiments/guard/` 的 17,481 个文件执行已配置密钥的精确匹配检查，匹配数为 0，见 [SECRET_SCAN.json](SECRET_SCAN.json)。

## 论文文档

已更新毕业论文仓库 `projects/02-点一_共享终端/README.md` 的分支与标签表、`进展.md` 的冻结与回归记录、`实验设计与结果.md` 的版本与复核范围说明。论文表 3-15、表 3-16 数字一致，第 3 章正文保持原内容。

未完成项：无。
