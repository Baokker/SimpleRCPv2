# 阶段 1：过程性知识包移植

## 基线

基线来自分支创建前的 `main`（HEAD `4c96c95`）。依赖安装完成；`git check-ignore .env` 返回 `.env`，文件内容没有进入日志。`pnpm build` 通过。基线 `pnpm test` 启动 26 个测试文件，75/93 项通过，18 项失败；失败集中在当前 Node 24 环境的 `node-pty` `posix_spawnp failed` 与依赖该初始化的 API 集成测试。基线 `pnpm test:e2e` 启动 23 个用例，2 项通过、19 项失败、2 项跳过；失败用例均在页面加载后等待 `display-name` 或服务端初始化超时。

## 代码变更

- 新增 `packages/knowledge`，提供 schema v3、v1/v2 迁移、锚点解析与复核、六类触发阈值、Guide/Timeline、演示卡片、hash、时钟、确认与作用域门控。
- 移植知识抽取、字段 refine、检索索引和注入预算逻辑；检索支持显式卡片或目录，默认使用 `isReusable`，向量能力通过 `LlmClient.embed` 注入。
- 新增 `createOpenAICompatibleClient`，支持 DeepSeek 等 OpenAI 兼容服务的 chat、embedding、超时、HTTP 错误、usage 和可选 `response_format`。
- 服务端 `config.ts` 增加 `KNOWLEDGE` 解析，启动日志打印模式；`off` 为默认值。服务端声明 workspace 依赖，但本阶段没有接入事件、路由、Agent 或客户端。
- 移植锚点、检索、规模、缓存、触发阈值和状态门控实验；结果提交在 `packages/knowledge/bench/results/`。规模实验覆盖 10、50、100、500、1000 张卡片，每个实验均有独立的 `bench:*` 入口。
- 补充显式 v1/v2 卡片迁移、目录来源的自定义过滤、schema 守卫、严格 JSON 抽取和证据路径收集。索引目录由调用方传入，向量服务错误直接报告。

## 验证结果

`pnpm --filter @simplercp/knowledge build` 通过；知识包 18 个测试文件、75 项测试通过，当前修正后的 schema 测试与抽取路径测试也已通过。`pnpm --filter @simplercp/knowledge bench:deterministic` 与独立的 `bench:scale` 入口通过并生成六组摘要，规模结果包含 1000 张卡片。全仓库 `pnpm build` 通过。服务端配置测试 6 项通过。`pnpm test` 在服务端阶段为 20 个测试文件通过、6 个测试文件失败，94 项中 76 项通过、18 项失败；失败集中于当前 Node 24 环境的 `node-pty` 启动错误和依赖该初始化的接口测试。`pnpm test:demo` 通过 2 项。`pnpm test:e2e` 运行 23 项，17 项通过、4 项失败、2 项跳过；失败涉及页面初始化等待、目录监听、Agent 中断文件记录和测试运行参数回显。完整回归需要在项目支持的 Node 20/22 环境重新执行。

## 阶段 2 接口建议

服务端可以在项目元数据目录传入 `cards[]`，用 `confirmCard(card, { memberId, now, edited })` 写入确认演化记录，用 `isReusable(card, { viewerMemberId })` 作为注入与风险提醒的共同门控。Agent 任务开始时调用 `buildKnowledgeContext({ query, cards, viewerMemberId, maxTotalChars })`，把返回的 `text` 插入提示词并把 `cards` 明细写入 trace。捕获服务只需把证据装配成 `KnowledgeExtractionInput` 并传入服务端构造的 `LlmClient`。

## 遗留问题

- 真实服务端事件、卡片存储、审阅路由、Agent 注入和客户端界面留在后续阶段。
- `yjsRelative` 目前只保留 schema 字段，未连接 Y.Doc。
- 向量检索只有调用方显式提供 embedding 客户端时启用；本阶段没有访问外部 embedding 服务。
- 基线与本阶段根测试受 Node 24 和 `node-pty` 原生模块环境影响，需使用项目支持的 Node 20/22 环境复验。
