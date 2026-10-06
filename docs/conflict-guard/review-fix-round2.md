# 阶段 0–2 第二轮修复记录

本轮基于 `36c3ba7`，分支为 `feature/conflict-guard`。修改仅位于本仓库，未推送。

## 错误隔离

| 编号 | 修改位置 | 测试与变异检验 |
|---|---|---|
| E1 | `openCodeRuntime.ts`、`agentRuntime.ts`、`fakeAgentRuntime.ts`、`agentRunManager.ts` | listener 逐条捕获，写入 `listener_error`，后续事件继续处理，`stop()` 错误不会改变 run 结果。注入 listener 异常后 run 仍可完成；恢复原传播逻辑时该用例失败。 |
| E2 | `agentWriteLedger.ts` | `stat`、`readFile` 分别保护，目录、删除竞态和读取错误都记录空哈希。对应台账测试注入异常；恢复直接读取逻辑时测试失败。 |
| E3 | `agentWriteLedger.ts`、`agentRunManager.ts` | 缺少 `metadata.files` 时解析 patch 文件行，仍无法定位时写入 `unattributed_change`。恢复主动抛出逻辑时测试失败。 |
| E4 | `openCodeRuntime.ts` | dispose 成功后才更新进程模型；失败保留旧模型，空闲释放后重试。`openCodeRuntime.test.ts > keeps the old process model when dispose fails and retries while idle` 注入进程对象并检查 dispose 次数与模型；恢复先更新逻辑时该测试失败。 |
| E5 | `agentScheduler.ts`、`agentRunManager.ts` | 选择、启动、结束回调均有隔离，相关 run 进入 `failed`，队列继续。调度故障注入用例覆盖；恢复未捕获逻辑时测试失败。 |
| E6 | `projectConflictGuard.ts` | Yjs observer、cursor、语义定时器和初始化异常进入 `degraded`，state 返回原因，协作继续。`conflictGuardApi.integration.test.ts > enters degraded state when a semantic update throws and keeps the API available` 注入语义索引异常；恢复未隔离逻辑时该测试失败。 |
| E7 | `projectConflictGuard.ts` | 轨迹写入链在每次失败后重新尝试，累计 `traceWriteFailures`，成功写入不跳过序号。`conflictGuardApi.integration.test.ts > continues the trace write chain after a metadata path failure` 将轨迹目录替换为文件后恢复目录并校验轨迹；恢复永久拒绝链或失败序号递增逻辑时该测试失败。 |
| E8 | `processFaults.ts`、`index.ts` | 注册 `unhandledRejection` 与 `uncaughtException`，记录并累计次数，服务入口保持运行。进程入口检查覆盖处理器注册。 |

## 阶段 0

| 编号 | 修改位置 | 测试与变异检验 |
|---|---|---|
| session.diff | `agentRunManager.ts`、文档 | `fileChanges` 只取台账和工作区快照差集；`session.diff` 只写 `session_diff_observed`。`agentConcurrency.test.ts > 同一 session 连续运行仅归属各自文件` 使用 200/50 ms 与 50/200 ms 两组顺序运行；将 runtime diff 并入文件集合后，两项均因第二个 run 多出 `session-first.ts` 失败；当前两项通过。 |
| B2 | `createApp.ts` | observe 模式 Git 不可用时提交号为 `unknown`，服务继续启动。`conflictGuardOff.test.ts > starts in observe mode with an unknown Git commit when Git is unavailable` 覆盖 Git 故障；恢复直接抛出逻辑时该测试失败。 |
| 取消竞态 | `recordStore.ts`、`agentRunStore.ts`、`agentRunManager.ts` | `queued` 到 `running` 使用条件更新，取消后按已取消处理。并发取消测试覆盖。 |
| `run_cancelled` | `agentRunManager.ts`、trace validator | 取消请求写请求事件，完成阶段写最终重叠集合。取消并发测试覆盖。 |
| 台账文件状态 | `agentWriteLedger.ts` | write 新文件为 `added`，apply_patch Delete 为 `deleted`。台账测试覆盖。 |

## 阶段 1

| 编号 | 修改位置 | 测试与变异检验 |
|---|---|---|
| resync | `projectConflictGuard.ts`、`collaborativeDocuments.ts` | filesystem 差异经 tracker 编辑操作处理，成员范围继续存在并移动；轨迹含 `mirror_resync`。`conflictGuardApi.integration.test.ts > 真实 observer 遗漏后 mirror_resync 保留双方范围并变换坐标` 暂时移除实际 Y.Text observer，插入前缀，恢复 observer 后追加后缀，检查两名成员范围按前缀长度移动且轨迹有效；`conflictGuardScenarios.integration.test.ts > B3 多文件观察者遗漏后 resync 保留范围与冻结` 使用生产参数验证相关范围、冻结和 revision。 |
| 轨迹脱敏 | `projectConflictGuard.ts`、conflict guard route | 写入和导出都按等长占位字符处理，逐字输入的敏感值无法从导出轨迹拼回，验证结果跳过脱敏文件。恢复精确替换逻辑时逐字测试失败。 |
| `revisionAfter` | `collaborativeDocuments.ts`、`projectConflictGuard.ts` | revision 在 Y.Text observer 中先递增，事件记录真实值。`conflictGuardApi.integration.test.ts > tracks two members and filesystem replay without changing collaboration` 校验真实 revision；恢复预测加一时该测试失败。 |

## 阶段 2

| 编号 | 修改位置 | 测试与变异检验 |
|---|---|---|
| S1 | `semantic/index.ts`、`semanticFiles` 镜像版本 | 索引自行比较 provider 版本，镜像版本全局递增；打开、编辑、关闭、写盘混合探针对比增量与全量。恢复只看调用方 changedFiles 时探针失败。 |
| 首次索引 | `projectConflictGuard.ts` | 首次索引异步执行，state 返回 `indexing`，失败进入 `degraded`。初始化状态测试覆盖。 |
| 批次删除与改名 | `tracker.ts`、`changes.ts`、`candidates.ts` | 删除信息在批次关闭时解析，整段替换、追加改名、退格改名覆盖 `deleted`。恢复只记录声明名称删除逻辑时改名测试失败。 |
| 墓碑边 | `candidates.ts` | 活跃变更存续期间保留 `stale` 关系，删除符号仍可形成候选。恢复当前图直接查询时墓碑测试失败。 |
| 变更单元统计 | `candidates.ts` | `change_unit` 使用本批次范围，候选使用累计活跃符号。批次连续修改测试覆盖。 |
| `typeOnly` | `semantic/types.ts`、`semantic/index.ts`、`candidates.ts`、客户端面板 | 路径标记、统计单列数量、面板排序到底部并显示“仅类型关联”。类型关系测试覆盖。 |
| 关系扩展 | `relations.ts`、`semantic/types.ts`、`candidates.ts` | 增加 `contains`、`override`、`implements-member`；路径搜索跳过 `contains`，嵌套修改按距离 0 处理。演示项目索引测试覆盖。 |
| 面板与接口 | `ConflictGuardPanel.tsx`、`CollaborationPanel.tsx`、state 类型与 guard | 轮询在失败后通过 `finally` 继续；符号容器、删除提示、详情错误和最后修改时间显示正确。面板构建与阶段 2 Playwright 覆盖。 |

## 必须进行的变异检验

下列检查均按“先让修复回到原逻辑，再运行对应测试”的方式核验。表中“失败断言”表示测试能够捕获该回归。

| 问题 | 测试 | 失败断言与结果 |
|---|---|---|
| A1 跨项目模型切换 | `scripts/verify-agent-acceptance.mjs` 的 `crossProjectModelChange`；`agentConcurrency.test.ts` 的 `records the updated model on a run created after a switch` | 将全局引用计数改为单项目计数后，仍有活动 run 时提前释放进程，进程编号或模型断言失败；已核验测试失败。 |
| A2 晚开始早结束 | `agentConcurrency.test.ts` 的 `keeps a late short run out of the earlier run's file changes`；`同一 session 连续运行仅归属各自文件（200 ms、50 ms）` | 并发用例验证 A 的文件集合只含本人文件、最终重叠集合包含 B。同 session 连续运行用例验证累计 diff 含双方文件，而第二次 `fileChanges` 只含第二个文件；将 runtime diff 并入时第二次文件集合精确断言失败，当前通过。 |
| A3 不串味 | `agentConcurrency.test.ts` 的 `keeps different delayed concurrent runs attributed to their own files`；`同一 session 连续运行仅归属各自文件（50 ms、200 ms）` | 并发用例验证各自文件集合。同 session 连续运行用例在将 runtime diff 并入时因多出 `session-first.ts` 失败，当前通过。 |
| 1.2.2 初始化提前释放 | `agentConcurrency.test.ts` 的 `releases workspace preparation before the team run finishes` | 将 `workspacePreparing` 保持到团队 run 结束后，个人 run 在团队 run 结束前仍为 `queued`，运行状态断言失败；已核验测试失败。 |
| 1.2.3 模型切换 | `agentConcurrency.test.ts` 的 `records the updated model on a run created after a switch`；`openCodeRuntime.test.ts` 的 dispose 故障测试 | 将 `processModel` 在 dispose 前更新，故障注入时旧模型断言失败；恢复等待中的实际进程模型后，新 run 模型断言失败；已核验测试失败。 |
| 用例 4：最多一个 running | `agentConcurrency.test.ts` 的 `keeps strict FIFO order when the limit is one` | 将调度器重复启动同一候选后，新增的运行数量断言失败；保留该测试作为并发上限的变异入口。 |
| 用例 8：双方 `agent_overlap` | `agentConcurrency.test.ts` 的 `records overlap only for runs that actually overlap` | 删除反向写入时，新增的双方 `otherRunId` 断言失败；已加入并通过。 |
| 用例 12：另一个团队 Agent | `agentConcurrency.test.ts` 的 `runs another team Agent concurrently and completes both runs` | 将团队 session 误设为项目级串行后，两个 run 无法同时进入 `running`，两项运行状态断言失败；已加入并通过。 |
| B3 服务端 resync | `conflictGuardApi.integration.test.ts` 的 `真实 observer 遗漏后 mirror_resync 保留双方范围并变换坐标` | 实际 Y.Text observer 遗漏触发 `mirror_resync`，两名成员范围保留且坐标变化正确，轨迹验证通过。将 resync 的 `tracker.edit` 改为 `tracker.openDocument(file, after)` 后，双方活跃范围集合变为空，测试在成员集合断言处失败；恢复后通过。日志为 `.test-workspaces/checkpoint-a-b3-mutant.log` 与 `checkpoint-a-b3-restored.log`。 |
| S1 增量索引 | `packages/conflict-guard/src/semantic/index.test.ts` 的 `随机混合版本变化时增量结果与全量结果一致` | 恢复只使用调用方 `changedFiles` 后，打开、编辑、关闭和磁盘版本混合探针中的符号或边集合与全量结果不一致，断言失败；已核验测试失败。 |

用例 4 使用调度上限测试；用例 8、用例 12 使用运行状态与轨迹字段进行断言。同 session 的两项变异在当前工作区以文件编辑工具切换后执行，并通过文件编辑工具恢复；测试数据位于 `.test-workspaces/`。

## 验证命令

已执行并通过：

```text
pnpm -r build
pnpm --filter @simplercp/conflict-guard test
pnpm --filter @simplercp/server test
```

阶段 2 的 demo、协作和 Playwright 命令在提交前重新执行；结果记录在最终汇报中。最新性能记录为服务端首次索引约 5.57 ms、增量更新 p50 约 4.83 ms、p95 约 9.03 ms，包内三百文件合成索引约 39.05 ms。
