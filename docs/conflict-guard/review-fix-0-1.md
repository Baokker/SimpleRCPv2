# 阶段 0 与阶段 1 审阅修复记录

更新时间：2026-10-05。Agent 修复提交：`11d2947`；conflict-guard 修复及本次验收的产品代码提交：`0cd88f6`。

## 阶段 0

表中的测试名来自对应文件；真实 runtime 场景来自 `scripts/verify-agent-acceptance.mjs`。调度和界面相关的源码检查与运行测试分别列出。

| 编号 | 当前代码 | 对应验证 |
| --- | --- | --- |
| A1 | `openCodeRuntime.ts` 的全局 `acquireRun()` 引用计数；`agentRunManager.ts` 在调度开始和结束时维护引用 | 真实场景 `crossProjectModelChange`：其中一个项目结束时进程编号相同，双方 completed，后续 run 使用新模型 |
| A2 | `agentRunManager.ts` 的 `runOverlapIds` 保存完整重叠集合；终止事件写 `overlappingRunIds` | 真实场景 `laterStartEarlierFinish`：后启动的 run 提前完成，早启动 run 仍登记其重叠编号 |
| A3 | `agentWriteLedger.ts` 过滤其他重叠 run 的文件，每个自身文件只登记一次 | `agentWriteLedger.test.ts`：`filters a finished overlapping run's files and lists each own tool file once`；真实场景 `laterStartEarlierFinish` |
| A4 | `recordAgentOverlaps` 只查询真实重叠集合；`getCompletedOverlapGroup` 在关联的全部 run 结束后清理台账 | `agentConcurrency.test.ts`：`records overlap only for runs that actually overlap`；`agentRunSelection.test.ts`：`retains a chain of overlapping ledgers until all connected runs finish` |
| 1.2.1 | `getDiff` 省略 `messageID`；核实脚本使用仓库中已忽略的独立目录，finally 释放 runtime | `stage-0-session-diff.json` 四次返回空数组；session 隔离语义仍缺少运行证据，结果作为候选文件使用 |
| 1.2.2 | `prepareWorkspace` 完成后释放初始化资格并调度 | `agentConcurrency.test.ts`：`releases workspace preparation before the team run finishes` |
| 1.2.3 | `ensureCurrentProcess` 使用共享 Promise，创建新进程前更新 `processModel`，错误直接传播 | `agentConcurrency.test.ts`：`records the updated model on a run created after a switch`；真实场景 `crossProjectModelChange` |
| 1.2.4 | 文件已经删除或移动时记录 null hash；其他读取与 listener 错误直接传播 | `agentWriteLedger.test.ts`：`records completed apply_patch metadata for update, add, delete and Move to operations`；检查 `subscribe` 和文件读取路径 |
| 1.2.5 | `agentScheduler.ts` 的 `rescanRequested` 保留调度中的重新扫描请求 | 检查调度循环；`agentConcurrency.test.ts`：`starts two sessions and fills the next slot when one finishes` |
| 1.2.6 | `executeRun` 重读状态，`cancelRequested` 覆盖 runtime 激活前取消 | 检查激活前后状态与集合；`agentConcurrency.test.ts`：`cancels one active run while the other completes` |
| 1.2.7 | 项目与服务 `closing` 标志阻止调度继续；关闭时清理台账与重叠集合 | 检查 `disposeProject`、`dispose` 和 scheduler finally；真实验收脚本完成服务资源释放并退出 |
| 1.2.8 | `apply_patch` 读取 OpenCode `state.metadata.files` 的 `filePath` 与 `movePath` | 已安装 OpenCode 1.18.31 源码；`agentWriteLedger.test.ts` 的 metadata 测试；当前 DeepSeek 配置未提供该工具 |
| 1.2.9 | 完成、取消、失败和超时共用 `recordFinishedFileChanges` | `agentConcurrency.test.ts` 的取消与失败场景；真实场景 `timeoutAttribution` 核验 failed 的工具归属和成员修改记录 |
| 1.2.10 | AgentPanel 只检查更早创建的同会话 run | 检查 `AgentPanel.tsx` 等待原因条件 |
| 1.3 | `agentScheduler.ts` 负责调度循环，`agentRunSelection.ts` 选择任务；无效 session 进入 failed；当前会话对话与顶部活动列表独立显示 | `agentRunSelection.test.ts` 的缺少及移除 session 两项测试；12 项并发场景；检查 OpenCode 事件结构、session 过滤、runtime 引用与 AgentPanel 渲染 |
| 1.4 | 12 项并发场景及 5 项台账与队列测试存在且通过 | `self-acceptance/tests.log`；跨项目与完整重叠场景另见 `agent-real.json` |
| 1.5 | 双浏览器 DeepSeek 的不同文件、同文件和成员编辑三个场景保存最终内容与归属 | `stage-0-smoke/deepseek-browser.json`；不同文件和同文件保留双方内容，成员场景记录覆盖与 `concurrent_change` |

## 阶段 1

| 编号 | 当前代码 | 对应验证 |
| --- | --- | --- |
| B1 | 精确敏感值脱敏；敏感文件跳过；首次 edit 脱敏登记文件，后续事件与重启持续带有标记 | `trace.test.ts`：`keeps ordinary code intact and reports redacted files separately`、`reports a file first redacted during an edit`、`reports sensitive documents as skipped`；集成测试 `marks character-by-character configured value edits as redacted` |
| B2 | `createApp` 只在启用观察时读取 Git 提交；off 或缺少 conflictGuard 配置时跳过 | `conflictGuardOff.test.ts`：`does not create trace state or require a new feature when disabled`，通过 `loadConfig` 与实际不可用的 Git 环境启动 |
| B3 | resync 更新 tracker 与镜像，关闭已有批次和活跃范围，轨迹登记全文；observer 与写入错误直接传播 | `tracker.test.ts`：`closes existing batches when a document receives a new replay baseline`；`trace.test.ts`：`replays a mirror resynchronization`；集成测试 `tracks two members and filesystem replay without changing collaboration` |
| 2.2.1 | `session_start` 保留跨会话状态 | `trace.test.ts`：`keeps document, batch and redaction state across session boundaries`；集成测试 `continues validating the trace after a service restart` |
| 2.2.2 | 首个文件加入后发出 `change_set_opened`；空闲或停用时发出 `change_set_file_closed` | `tracker.test.ts`：`aggregates one actor across files and closes each file after active idle` |
| 2.2.3 | tracker 保存每名成员最新光标，state 返回 cursors | 集成测试 `saves the latest cursor window through ws and broadcasts messages with missing fields`；双浏览器 `browser-state.json` |
| 2.2.4 | `/ws` 广播完成后登记有效光标，缺字段继续广播 | 同上 WebSocket 集成测试；检查 realtime 回调顺序 |
| 2.2.5 | `revisionAfter` 使用 collaborativeDocuments revision | 集成测试 `attributes a Yjs edit to the authenticated member and exposes state` 和 filesystem 回灌测试 |
| 2.2.6 | 核验具体范围、次数、顺序、哈希和最终文本 | 包内 20 项、observe 集成 7 项；双浏览器范围及回放记录 |
| 2.3 | settled 的新编辑恢复 editing；cursor 每窗口登记最后位置；批次结束时间作为 at；timer 使用 `!== undefined`；查询状态包含基线；路由身份与项目检查；构建排除测试；范围语义写入包 README | `returns to editing when a settled actor starts editing another file`；WebSocket 光标窗口测试；检查 timer、schema、路由和 README；构建目录包含 5 个产品 `.js` 文件 |
| 2.4 | 删除边界、内部删除、替换、多操作、切换文件、双方具体范围、乱序与篡改；真实服务端路径全部核验 | `tracker.test.ts`、`trace.test.ts`、`conflictGuardApi.integration.test.ts`、`conflictGuardOff.test.ts`，原始输出 `self-acceptance/tests.log` |
| 2.5 | 两名成员通过独立浏览器会话持续编辑 170929 毫秒，每人 3 个批次，回放通过且与最终文件一致 | `self-acceptance/browser-observation.json`、`browser-state.json`、`browser-trace.jsonl` |

## 验收命令与证据

`pnpm -r build`、`pnpm test`、`CONFLICT_GUARD=off pnpm test:collab` 和 `CONFLICT_GUARD=observe pnpm test:collab` 全部通过。包内测试 20 项、服务端 31 个文件 120 项、演示 2 项、每种协作模式 2 项。真实 DeepSeek 的三个归属与模型场景通过，双浏览器轨迹回放通过。

完整命令、配置、原始输出及敏感值检查位于 [self-acceptance/README.md](evidence/self-acceptance/README.md)。行为说明分别见 [stage-0.md](stage-0.md)、[stage-1.md](stage-1.md)、[trace-schema.md](trace-schema.md) 和 [agent-concurrency.md](../foundation/agent-concurrency.md)。
