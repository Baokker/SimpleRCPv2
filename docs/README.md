# 项目文档

## 当前文档

1. [当前实现盘点](./01-current-state.md)：现有协作架构、功能和已知限制。
2. [开源 Agent 与 trace 调研](./04-agent-runtime-research.md)：面向服务端 CLI 接入的 Agent 候选、trace 能力和推荐结果。
3. [OpenCode 与 DeepSeek Harness 比较](./06-opencode-deepseek-harness-comparison.md)：多人 Agent、Session、并发写入和 runtime 选择。
4. [运行系统基线需求](./05-baseline-product-requirements.md)：项目入口、同步协作、成员 Agent、服务端 API Key、trace、开发范围和测试方案。
5. [文档同步设计](./07-document-sync-design.md)：磁盘与 Yjs 的双向同步、现有缺陷分析、业界方案对照和最小实现。
6. [基线实施计划](./08-implementation-plan.md)：可交接的分阶段执行计划、删除清单和需求修订记录。

## 背景材料

- [ACP Agent 接入方案](./02-acp-agent-proposal.md)
- [ACP Agent 选型调研](./03-acp-agent-options-research.md)

开发范围以运行系统基线需求为准，同步部分以文档同步设计为准，执行顺序以基线实施计划为准。文档状态为讨论稿时只调整方案，确认后进入代码开发。

需求文档与实施计划存在差异时以需求文档为准，并把差异登记到实施计划第 9 节。
