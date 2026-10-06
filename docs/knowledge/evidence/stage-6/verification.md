# 阶段 6 验证记录

日期：2026-10-06 至 2026-10-07。分支：feature/process-knowledge。环境：Node 22.19.0、pnpm 9。

| 命令 | 结果 |
| --- | --- |
| pnpm build | 通过，shared、knowledge、server、client 完成编译 |
| pnpm test | server 128 项、knowledge 152 项、demo 2 项通过 |
| pnpm test:e2e | 21 项通过，15 项因测试启用条件跳过 |
| pnpm test:e2e:knowledge | 13 项通过 |
| AGENT_LLM_PROVIDER=minimax 的完整回归中的 Agent 测试 | 17 个文件、38 项通过 |
| AGENT_LLM_PROVIDER=deepseek 的同组测试 | 17 个文件、38 项通过 |
| pnpm --filter @simplercp/knowledge bench:retrieval-stress | Lexical Recall@1 24.2%，Type-only 60.8%，Wrong-file+Type @1/@3 为 0%/63.3% |
| knowledge-stage6-audit.ts | 扫描版本控制文件与待提交文件，两个已配置模型 Key 的匹配数为零 |
| git diff --check | 通过 |

本地完整命令输出位于忽略目录 artifacts/stage6-*.log。真实模型记录独立保存在同一目录的 JSON 文件：16 次多文件任务均完成且通过原始功能测试；两次真实 OpenCode MCP 任务均取得约束卡片；六次 MiniMax 服务端复盘均通过结构与引用校验且未使用兜底。

构建包含既有 client bundle 大小提示，编译成功。端到端测试沿用项目现有测试运行时，真实模型观察来自真实 OpenCode 和 MiniMax/DeepSeek 请求。
