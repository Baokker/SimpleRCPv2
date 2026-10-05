# 阶段 0：Agent 并发运行

更新时间：2026-10-05。修复基线：`36c3ba7`。本轮修改尚未推送。

## 调度与归属

每个项目限制活动 run 数量，同一 session 的 run 按顺序执行。OpenCode 使用全局 `acquireRun()` 引用计数，跨项目的活动 run 全部结束后执行模型进程切换。等待切换的 `getClient` 和 `createSession` 共用一个 Promise。团队 Agent 的工作区初始化资格在 `prepareWorkspace` 完成后释放，队列随即重新扫描。

每个 run 保存启动时的 `concurrentRunIds` 和整个运行期间的 `overlappingRunIds`。写入台账记录工具完成事件的相对路径、时间和 SHA-256。`apply_patch` 使用 OpenCode 提供的 `state.metadata.files`，缺少元数据时解析 patch 文本中的文件行。文件已经删除、路径为目录或读取失败时记录 `contentHash: null` 与原因；后续协作继续运行。

完成、取消、失败和超时共用 `recordFinishedFileChanges`。`fileChanges` 只使用台账与工作区快照差集，`session.diff` 只写入 `session_diff_observed`，避免同一 session 的历史文件进入后续 run。本 run 台账中的文件使用 `tool`；仅在其他重叠 run 台账中的文件从本 run 的 `fileChanges` 中移除。其余快照差异在没有重叠 run 且没有成员修改同一文件时使用 `exclusive`，存在同期活动时使用 `ambiguous` 并记录 `unattributed_change`。同一文件多次写入只产生一个文件结果。成员 revision 增加时记录 `concurrent_change`；真实重叠 run 写入同一路径时，双方记录 `agent_overlap`。

重叠关系关联的全部 run 结束后清理台账。项目关闭阻止继续调度，服务关闭清理全部调度状态。无效 session 的等待任务进入 failed。OpenCode 事件监听、模型切换和调度选择错误会记录并进入对应失败或重试状态，协作主路径继续运行。Git 不可用时 observe 模式的 `session_start.gitCommit` 为 `unknown`。AgentPanel 顶部显示运行中任务，当前会话的对话仅包含该会话的 run；等待原因只检查更早创建的同会话任务。

## 自动测试

阶段 0 的真实 OpenCode 记录保留在 [self-acceptance](evidence/self-acceptance/README.md)；第二轮修复的测试结果与变异检验记录在 [review-fix-round2.md](review-fix-round2.md)。

| 命令 | 结果 | 原始输出 |
| --- | --- | --- |
| `pnpm -r build` | 全部构建通过 | `self-acceptance/build.log` |
| 阶段 0 基线验收 | conflict-guard 20 项；服务端 31 个文件、120 项；演示 2 项通过 | `self-acceptance/tests.log` |
| `CONFLICT_GUARD=off pnpm test:collab` | 2 项通过 | `self-acceptance/collab-off.log` |
| `CONFLICT_GUARD=observe pnpm test:collab` | 2 项通过 | `self-acceptance/collab-observe.log` |

`agentConcurrency.test.ts` 的 15 项测试覆盖并发上限 3、上限 2 后补充运行任务、同会话顺序、上限 1 的 FIFO、取消、失败、不同延迟下的文件归属、同文件重叠与历史 run、双方重叠指向、成员编辑、模型记录、工作区初始化、两个团队 Agent 并行运行和团队 Agent 再次被提及。`openCodeRuntime.test.ts` 注入进程对象核验模型切换失败后的实际模型与空闲重试。`agentRunSelection.test.ts` 的 3 项测试覆盖缺少 session、已移除 session 和关联 run 的台账清理；`agentWriteLedger.test.ts` 的 6 项测试覆盖 OpenCode metadata、删除与移动路径、重叠文件过滤、文件去重、目录读取失败和 patch 文本解析。

## 真实 OpenCode 与 DeepSeek 验收

命令：`pnpm --filter @simplercp/server exec tsx ../../scripts/verify-agent-acceptance.mjs`。配置通过 dotenv 从本地 `.env` 读取，OpenCode 为 1.18.31，`SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS=3`，`CONFLICT_GUARD=off`，关闭 terminal，使用独立 `.test-workspaces/agent-real-acceptance-*` 数据目录。原始 run、trace 和进程编号位于 `self-acceptance/agent-real.json`，命令输出位于 `self-acceptance/agent-real.log`。

| 场景 | 实际结果 |
| --- | --- |
| `laterStartEarlierFinish` | 后启动的 run 提前完成；双方结果各自只有 `a.ts` 或 `b.ts`，均为 `tool`；早启动 run 的完成记录包含另一个 run 的完整重叠编号 |
| `crossProjectModelChange` | 两个项目有活动 run 时保存新模型；其中一个项目结束后 OpenCode 进程编号保持相同，另一个项目正常完成；活动数量归零后的新 run 使用 `deepseek-v4-pro` 并完成 |
| `timeoutAttribution` | Agent 写入 `timeout.ts` 后成员修改该 Yjs 文件；9000 毫秒超时产生 failed，文件仍为 `tool`，trace 包含 `concurrent_change` |

当前 DeepSeek 配置提供 `edit`、`write` 和 `bash`，本次请求 `apply_patch` 得到工具不可用的回复，记录在 `observations.applyPatchAvailability`。`apply_patch` 的 Update、Add、Delete 和 `*** Move to:` 字段依据已安装 OpenCode 1.18.31 源码及 metadata 单元测试核验。

## 浏览器与 session.diff 证据

`stage-0-smoke/deepseek-browser.json` 保存两个独立浏览器会话在 DeepSeek `deepseek-flash`、OpenCode 1.18.31 下的三个场景。不同文件场景保留双方文件，同一文件场景保留双方函数，两者均记录工具归属；同文件双方的 `agent_overlap` 指向对方。成员并发编辑场景记录 `concurrent_change`，最终内容为 Agent 写入的 `agent replaced this file`，成员内容被覆盖。该阶段负责记录修改与归属，文件内容仍由共享工作区的写入顺序决定。

核实命令：`pnpm --filter @simplercp/server exec tsx ../../scripts/verify-opencode-concurrent-diff.mjs`。脚本使用 dotenv 配置、独立 `.scratch/verify-opencode-concurrent-diff/` 工作区，并在结束时释放 runtime。调用 `session.diff` 时省略 `messageID`；[stage-0-session-diff.json](evidence/stage-0-session-diff.json) 中不同文件和同文件的四次调用均返回空数组。该记录未包含运行时提交编号，能够证明这次调用的返回值，session 隔离语义仍未获得运行证据。文件归属只依照工具台账和工作区快照差集判定，`session.diff` 结果只写入 `session_diff_observed` 轨迹事件。
