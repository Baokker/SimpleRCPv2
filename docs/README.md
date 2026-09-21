# SimpleRCPv2 文档

当前有效的产品与开发文件集中在 `product` 目录。调研材料按照调研日期归档，开发时以产品文件为准。

当前代码已经完成多项目、文件协作、聊天持久化、共享终端、主题、OpenCode、DeepSeek、Agent run、session 和 trace。

OpenCode 与 DeepSeek 的配置方式见[项目 README](../README.md#配置)。

## 当前产品文件

- [Agent Session 设计与开发范围](./product/2026-09-19-agent-sessions.md)：成员私有会话、会话内 run、接口和页面行为。
- [IDE Agent 界面与 Monaco 语言支持调研](./research/2026-09-19/ide-agent-ui-and-monaco.md)：Cursor、VS Code、Zed 的 Agent 交互设计，以及 Monaco 的内置语言支持。
- [基线需求](./product/2026-09-17-baseline.md)：产品范围、用户流程、系统边界、Agent 规则与验收条件。
- [开发计划](./product/2026-09-17-development-plan.md)：代码修改顺序、模块职责、同步修复与测试范围。
- [已知问题](./product/known-issues.md)：基线接受的问题、触发条件、当前提示方式与完整处理方向。
- [改进路线](./product/improvement-roadmap.md)：基线完成后的并行 Agent、合并、恢复、隔离和分析能力。

## 调研归档

### 2026-08-09

- [ACP Agent 调研](./research/2026-08-09/acp-agent.md)：ACP 接入、Proposal、Agent 候选与保留结论。

### 2026-09-17

- [Agent runtime 调研](./research/2026-09-17/agent-runtime.md)：OpenCode、DeepSeek Harness、session、trace 与并发模型。
- [文档同步调研](./research/2026-09-17/document-sync.md)：磁盘、Yjs、终端与 Agent 共同修改文件时的同步规则。
- [Agent 并行执行调研](./research/2026-09-17/parallel-agent.md)：OpenCode 多 session、独立工作目录和并行合并路线。

### 2026-09-21

- [协作 Activity 与 Agent 会话保存调研](./research/2026-09-21/collaboration-history-persistence.md)：Activity、Agent session、run、trace 与稳定用户标识的保存边界。

## 阅读顺序

开发人员依次阅读基线需求、开发计划和已知问题。需要了解某项决定的来源时，再进入对应日期的调研目录。

文档合并前的完整材料保存在提交 `167e3e0`。
