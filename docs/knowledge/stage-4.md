# 阶段四报告

阶段四把已确认的知识接入 Agent 运行流程。服务端新增 `KnowledgeProvider`、项目级 `knowledge/config.json`、Agent 预览接口、复用指标接口、任务后核对和确认后的在途提醒。`agentRunManager` 只在任务开始构造运行提示词前调用 `buildContext`，在任务完成、失败或取消后调用 `postRunCheck`；卡片确认通过 `KnowledgeService` 回调 `onCardConfirmed`。

客户端 Agent 面板增加防抖知识预览、卡片排除勾选、运行卡片中的参考知识和任务后核对提示。共享消息增加 `knowledge_update_available`，客户端收到消息后刷新知识数据并显示非模态提示。

在途确认提示会关联到具体 run 卡片，提示该任务下一次运行可以参考新确认的卡片；检查结果存在失败项时，任务后核对区域使用红色提示。

服务端测试覆盖了预览、知识段注入、排除卡片、trace 事件与任务后核对事件。执行记录：

- `pnpm build`：通过。
- `pnpm test`：通过，server 105 项、knowledge 132 项、demo 2 项。
- `pnpm test:e2e`：通过，默认开关下 21 项通过，知识场景按开关跳过 13 项。
- `pnpm test:e2e:knowledge`：通过，11 项通过，覆盖阶段二、阶段三与阶段四场景。
- `pnpm --filter @simplercp/server test -- src/__tests__/knowledgeInjection.test.ts`：通过，并验证预览不会增加 `usage.injectedCount`。

阶段四截图保存在 `docs/knowledge/screenshots/S4-1-agent-injection.png`；阶段二与阶段三的既有验收截图在同一目录中保留。

OpenCode 的 `session.prompt` 返回值和事件流当前没有稳定的 token 用量字段。报告记录模型、注入字符数和运行 trace，真实 token 用量需要运行时接口提供明确字段后再接入。

本次自动验证使用仓库已有的 fake Agent runtime，确认知识段位于范围声明之后、相关文件之前，且 `fake-reply` 与 `fake-write` 标记仍然有效。当前运行环境没有可用于阶段报告的稳定 OpenCode token 字段，真实模型冒烟未纳入自动测试；后续接入明确的用量字段后再记录模型行为与 token 数量，不写入任何凭据。

阶段五可以复用 `KnowledgeProvider.postRunCheck` 的命中结构，补充 Agent 修改归属、复盘事件和矛盾处理。阶段六可以在 provider 之上提供 Agent 主动检索工具，继续沿用项目配置、可见性门控和 `isReusable`。阶段七可以复用 `reuse-metrics.json` 的时间点与 trace 记录开展实验分析。

遗留问题包括 OpenCode token 统计缺口、工作区快照在缺少 patch 时只能使用文件级行段，以及在途提醒依赖运行管理器绑定 provider。后续可以从 OpenCode 事件中补充修改行段和用量数据。
