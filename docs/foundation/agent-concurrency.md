# Agent 并发运行

每个项目默认同时运行三个不同会话的任务，通过 `SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS` 配置数量。`agentScheduler.ts` 维护任务队列与活动会话集合，`agentRunSelection.ts` 按创建时间选择可以执行的任务。

同一个会话收到新要求时，会取消已有任务，等待 OpenCode 的停止请求完成后继续执行新要求。已经写入的文件继续保留，新任务会收到中断说明与已修改的文件列表。个人会话和 Chat 团队会话使用同一个机制。

工作区没有 `.git` 时，创建 Git 元数据期间暂时独占执行资格；初始化完成后，其他会话可以执行任务。项目删除与服务关闭会取消活动任务，等待清理完成后释放项目资源。

服务端从实际 OpenCode 工具完成事件登记文件路径，读取内容并记录 SHA-256。完成、取消与失败后比较工作区快照，台账中的文件标记为 `tool`；其他并发 Agent 修改的文件不计入当前任务。归属不明确的变化标记为 `ambiguous`。`session.diff` 只作为诊断记录保存。

路径使用 `workspacePath.ts` 中的 realpath 工具统一处理。编辑器中的未保存修改与外部文件变化通过 Yjs 保存快照合并。共享文件已经保存的内容仍可能被 Agent 基于旧版本的全文写入覆盖，这项限制见 [已知问题](../product/known-issues.md)。

个人任务状态与 trace 只发送给会话属主，Chat 团队任务向项目成员公开。删除个人会话后，任务列表隐藏该会话，服务端继续保存历史记录。

运行期间调整模型时，新设置在活动任务结束后生效。任务记录保存当前 OpenCode 进程使用的模型名称。

浏览器与真实模型检查命令：

```bash
pnpm --filter @simplercp/server exec tsx ../../scripts/verify-agent-acceptance.mjs
```

完整检查创建六项真实 Agent 任务，并保存浏览器检查、文件结果与完整轨迹。`--resume=<检查目录>` 可以继续已有的个人会话验收结果，运行四项聊天任务。
