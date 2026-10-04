# @simplercp/knowledge

`@simplercp/knowledge` 提供 SimpleRCPv2 第 5 章使用的过程性知识卡片纯 TypeScript 能力。包不依赖 Express、ws、Yjs、文件系统固定目录或 LLM SDK；需要文件时由调用方传入目录，需要模型时由调用方传入 `LlmClient`。

检索接口的 `cardsDirectory` 和 `indexDir` 都由调用方提供。`indexDir` 用于保存 schema v3 索引文件，缺少该参数时接口会直接抛出错误。目录中的旧 v1/v2 卡片和显式传入的旧卡片都会在进入索引前迁移，并通过 schema 守卫校验。

## 目录对应关系

| 旧原型文件 | 新包文件 |
| --- | --- |
| `open-collaboration-knowledge/src/schema.ts` | `src/schema.ts` 与 `src/schema/*` |
| `capture-trigger-policy.ts` | `src/capture/triggerPolicy.ts` |
| `anchor-resolver.ts`、`anchor-review.ts` | `src/anchor/*` |
| `knowledge-views.ts` | `src/views/*` |
| `demo-cards.ts` | `src/demo/demoCards.ts` |
| `hash.ts` | `src/util/hash.ts` 与根模块 |
| `knowledge-extract.ts`、`knowledge-prompt.ts` | `src/extract/*` |
| `knowledge-refine.ts`、`knowledge-refine-prompt.ts` | `src/extract/*` |
| `knowledge-index.ts` | `src/retrieval/index.ts` |
| `prompt.ts` 的知识注入与预算函数 | `src/retrieval/inject.ts` |

## 时钟与模型

需要时间的函数接收 `now()` 或使用 `Clock`，测试可以传入虚拟时间。系统时钟只集中在 `src/clock.ts`。模型调用使用 `LlmClient`：`createOpenAICompatibleClient` 通过 `fetch` 调用 `/chat/completions`，调用方提供 `baseUrl`、`apiKey`、`model` 与超时；传入 `embeddingModel` 后才提供 `/embeddings`。

## schema v3

v3 保留 v2 的内容、锚点、演化字段，新增 `superseded` 状态、`provenance`、`review`、`scope`、`ownerMemberId`、可空 `anchors`、`appliesTo`、`relations`、`check` 与派生 `usage`。`migrateKnowledgeCard` 将 v1/v2 卡片转换为 v3：旧 `source`、作者、聊天证据和 `reviewed` 状态按设计规则映射。`confirmCard`、`isReusable` 与 `appendEvolution` 是后续服务端与 Agent 阶段共享的纯函数。

## 检索与注入

`searchKnowledgeCards` 接受显式 `cards[]` 或调用方传入的 `cardsDirectory`，先尝试调用方提供的向量客户端，失败时使用旧词法分数与活动文件加分。目录中的 v1/v2 卡片会在建立索引时迁移为 v3。`buildKnowledgeContext` 默认只保留 `isReusable` 卡片，并按旧类型优先级和字符预算生成结构化文本与命中明细。
