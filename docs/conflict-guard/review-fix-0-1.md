# 阶段 0 与阶段 1审阅修复记录

更新时间：2026-10-05

| 编号 | 修改位置 | 对应验证 |
| --- | --- | --- |
| A1 | `agentRuntime.ts`、`openCodeRuntime.ts`、`agentRunManager.ts` 使用全局活动 run 引用计数 | `agentConcurrency.test.ts` 模型切换场景 |
| A2 | `agentRunManager.ts` 维护完整重叠集合并写入结束事件 | `agentConcurrency.test.ts` 并发重叠场景 |
| A3 | `agentRunManager.ts` 按重叠台账过滤 `fileChanges` | `agentConcurrency.test.ts` 不同文件归属场景 |
| A4 | 只比较真实重叠 run，结束后清理台账 | `agentConcurrency.test.ts` 历史 run 场景 |
| 1.2.1 | `openCodeRuntime.ts` 和核实脚本不传消息编号，异常时释放 runtime | `stage-0-session-diff.json` |
| 1.2.2 | 团队工作区初始化返回后立即释放调度资格 | `agentConcurrency.test.ts` 工作区初始化场景 |
| 1.2.3 | 模型切换使用共享 Promise，run 记录新模型 | `agentConcurrency.test.ts` 模型切换场景 |
| 1.2.4 | 写入台账读取失败记录 `contentHash: null`，事件监听器隔离异常 | Agent runtime 源码回归测试 |
| 1.2.5 | 队列退出前重新扫描 | Agent concurrency 测试 |
| 1.2.6 | 取消请求集合覆盖激活竞态 | Agent concurrency 取消测试 |
| 1.2.7 | 项目关闭标记阻止调度重建 | 项目关闭路径测试 |
| 1.2.8 | `apply_patch.patchText` 文件行解析 | 写入台账测试 |
| 1.2.9 | 取消、失败、超时共用结束时归属 | Agent concurrency 取消与失败测试 |
| 1.2.10 | 面板只等待更早创建的同会话 run | AgentPanel 源码回归 |
| 1.3 | 队列循环抽取到 `agentScheduler.ts`，管理器保留运行与归属挂接 | `agentConcurrency.test.ts` 全部调度场景 |
| B1 | `projectConflictGuard.ts` 和 `trace.ts` 只替换精确密钥值，敏感文件跳过 | trace 脱敏与敏感文件测试 |
| B2 | `createApp.ts` 在非 off 模式启动时读取一次提交号 | conflict guard off 测试 |
| B3 | resync 同步 tracker，回放继续校验替换后的全文 | trace 与协作文件回灌测试 |
| 2.2 | 光标、变更集文件关闭、跨会话轨迹和身份顺序校验 | conflict guard 集成与 realtime 测试 |
