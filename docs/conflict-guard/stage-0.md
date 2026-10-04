# 阶段 0：Agent 并发运行

更新时间：2026-10-04

## 改动内容

- 增加项目级 `SIMPLERCP_AGENT_MAX_CONCURRENT_RUNS` 配置，默认值为 3；调度器按项目限制活动 run，并按 session 保持互斥。
- 增加活动 run 的独立失败、取消、关闭等待和团队工作区初始化独占处理。
- 增加 OpenCode 写文件工具台账、SHA-256 内容哈希、文件归属标记、Agent 间重叠记录和启动时并发 run 记录。
- 运行期间允许保存新模型，模型进程在活动数归零后切换，客户端显示待生效提示。
- 假 runtime 发出与 OpenCode 工具 part 相同形状的写入完成事件。
- 增加 OpenCode 并发 diff 核实脚本和并发运行说明文档，更新并发共享目录已知问题。

## 测试结果

服务端和客户端 TypeScript 检查通过，项目构建通过。排除真实 Provider 集成测试后，服务端 Vitest 的 26 个测试文件、93 个测试全部通过；新增假 runtime 并发测试通过。真实 Provider 集成测试在当前环境的 120 秒测试限制内未完成，无法作为本阶段的通过依据。

假 runtime 的并发场景覆盖在运行管理器中使用 `fake-delay`、`fake-write` 和工具完成事件，可用于验证并发启动、会话互斥、取消、独立失败、文件台账和重叠记录。

## 真实冒烟观察

真实核实脚本完成了两个 session 修改不同文件和两个 session 修改同一文件的运行。原始输出为 `{"differentFiles":[[],[]],"sameFile":[[],[]]}`；工作区快照确认文件确实发生修改，`session.diff` 没有返回文件集合，因此没有把它当作按 session 隔离的来源。没有记录任何 API key。

## 遗留问题

共享目录仍然允许 Agent、成员和 bash 互相覆盖。bash 写入没有工具台账，只能标记为 `exclusive` 或 `ambiguous`。OpenCode `session.diff` 是否按 session 隔离需要在 Provider 可用时运行 `scripts/verify-opencode-concurrent-diff.mjs` 并把原始结果补入本文档和并发说明。
