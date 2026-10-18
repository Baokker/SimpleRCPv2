# guard-v1.5 复查与修复验证

日期：2026-10-18。被测冻结提交：`76ac373f8ed30cce5aa21a0b8e68a3e5664c6ad5`。

## 功能与规范检查

检查范围包括 `guard-v1.4` 至当前原型的集成代码、本轮实验辅助代码、回归记录和论文版本说明。功能检查与代码规范检查分别进行，确认两项需要修复的问题，修复提交已经复查。

| 项目 | 提交 | 最终行为 |
| --- | --- | --- |
| Agent 发起者本人审批 | `abcee42f0aa19e132b8b9c1d9083946f453de7ac` | `self` 与 `initiator` 请求的发起者均显示 `Run anyway / Cancel`，调用审批接口；等待 owner 审批时显示 `Withdraw request` |
| 回归记录完整性 | `314fe1ac21c94fa07c636808b83722dd754f1c4d` | 参考与当前数据分别检查重复 ID，比较完整 ID 集合，每个 X2a run 的工具调用同样检查；X2a summary 从 raw 重算核对 |

完整性用例使用已保存的真实实验记录，在内存中构造重复、缺失或额外记录，原始文件保持原内容。当前选定的真实数据通过完整性检查。组件用例使用真实 `decide`、审批队列和 React renderer，不调用模型。

Guard 判定规则、受管工具配置、并发审批回复顺序与取消清理经检查保持一致。OpenCode question 和团队 Agent 交互的授权范围见设计与已知局限文档。

## 回归测试

客户端组件测试位于 `apps/client/tests/guardApproval.test.ts`，已纳入 `pnpm test`：

| 测试名 | 结果 |
| --- | --- |
| `renders confirmation controls for an Agent request assigned to its initiator` | 通过 |
| `renders confirmation controls for an owner self-approval` | 通过 |
| `only lets a student withdraw a request assigned to owners` | 通过 |
| `renders owner approval controls for another member's request` | 通过 |

记录完整性测试位于 `experiments/guard/lib/regressionCoverage.test.ts`，命令为 `pnpm --filter @simplercp/server exp:test:regression`：

| 测试名 | 结果 |
| --- | --- |
| `accepts the complete saved X1 and X2a records and tool calls` | 通过 |
| `rejects duplicate X1 records even when the row count and statistics are unchanged` | 通过 |
| `rejects a missing X1 record` | 通过 |
| `rejects duplicate records in the reference run` | 通过 |
| `rejects a missing tool call within an otherwise complete X2a run` | 通过 |
| `rejects duplicate tool calls with the original call count` | 通过 |
| `rejects an extra current record absent from the reference set` | 通过 |

两项修复均在相关断言失败后完成。原型完整测试为服务端 188 个、客户端组件 4 个、Demo 2 个通过，9 个真实模型集成测试跳过；实验分支为服务端 191 个、客户端组件 4 个、Demo 2 个通过，另有完整性 7 个通过，共 204 个通过、9 个跳过、0 个失败。TypeScript 检查和客户端构建通过。

## 冻结与实验记录

`guard-v1.5` 与 `feature/terminal-guard` 指向 `76ac373f8ed30cce5aa21a0b8e68a3e5664c6ad5`。实验分支合入该提交，回归的 harness 为 `5e0e5a0dd4cf5c124f4315d1194212a5f7ea2673`。

| 回归 | 运行目录 | 核对结果 |
| --- | --- | --- |
| X1 | `X1/x1-20261018035422` | 3,585 次判定，表 3-15 全部一致 |
| X2a | `X2a/x2a-20261018035422` | 720 次回放，表 3-16 全部一致 |
| X6 | `X6/x6-20261018035422` | 四项性质各 10,000 例、故障注入 500 轮，失败均为 0 |

完整数字、观测差异与证据索引见 [DELIVERY_v1.5.md](DELIVERY_v1.5.md)、[REGRESSION_v1.5.json](REGRESSION_v1.5.json)、[FINAL_RUNS.json](FINAL_RUNS.json)。此前运行目录以 `reviewPrevious` 保留。

本轮模型请求 0 次、费用 0 元，未重新拍摄截图。没有 push，Guard 未合入 `main`，本地 `main` 保持 `7462d5f`。未完成项：无。
