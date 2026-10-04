# 阶段 0：Agent 并发运行

更新时间：2026-10-05

阶段 0的调度器按项目限制活动 run，并按 session 保持互斥。OpenCode 运行时使用全局 `acquireRun()` 引用计数，跨项目的活动 run 归零后才执行模型进程切换。团队 Agent 初始化工作区时暂时占用初始化资格；初始化返回后立即释放该资格并重新扫描队列。

每个 run 维护完整的重叠集合。工具完成事件进入写入台账，台账记录相对路径、完成时间和 SHA-256 内容哈希。`apply_patch` 从 `patchText` 中提取 Update、Add、Delete 和 Move 目标文件。结束时只保留本 run 台账文件及无重叠台账的快照文件；其他重叠 run 已记录的文件从本 run 的 `fileChanges` 中移除。无法归属的同期修改标记为 `ambiguous` 并写入 `unattributed_change`。历史 run 不参与 `agent_overlap` 判断，重叠集合全部结束后清理台账。

取消、失败、超时和完成路径都执行结束时归属。取消发生在 runtime 启动前时也会记录当时可见的文件变化。调度器处理取消竞态、队列重新扫描、项目关闭和服务关闭，并在事件监听器异常时继续读取 OpenCode 事件流。

## 测试结果

`apps/server/src/__tests__/agentConcurrency.test.ts` 包含原提示词要求的 12 个场景，最近一次运行结果为 12 项通过。`@simplercp/conflict-guard` 测试为 2 个文件、16 项通过；服务端测试为 29 个文件、114 项通过；`pnpm -r build`、`pnpm test:demo`、`CONFLICT_GUARD=observe pnpm test:collab` 和 `CONFLICT_GUARD=off pnpm test:collab` 均通过。

`session.diff` 核实脚本使用工作区快照和工具台账作为主要归属来源，并且在异常退出时释放 runtime。脚本调用 `session.diff` 时不传消息编号；实际输出保存在 `evidence/stage-0-session-diff.json`，文档只依据该文件记录结论。

## 证据

- `evidence/stage-0-session-diff.json`：两个 session 修改不同文件和同一文件的核实输出，内容不含密钥。
- `evidence/stage-0-smoke/deepseek-browser.json`：两个浏览器上下文使用 DeepSeek 完成三个真实场景，包含最终文件、run 归属、`agent_overlap`、`concurrent_change` 和工具完成事件原文。
- `evidence/stage-0-smoke/fake-runtime-regression.json`：假 runtime 的 12 个并发场景与工具事件结构记录。

共享目录中的 bash 或其他外部命令仍然只能通过工作区快照和同期活动标记为 `exclusive` 或 `ambiguous`。系统记录事实，不执行锁定、合并或撤回。
