# 阶段 6 报告

## 功能与文件

- `apps/server/src/knowledge/mcpServer.ts` 提供本机认证的 Streamable HTTP MCP，注册 `knowledge_search`、`knowledge_get`、`knowledge_propose`。
- `knowledge/provider.ts` 复用检索与排序，解析当前锚点，记录工具用量、run 关联和首次其他成员工具命中时间。`toolEnabled`、`proposeEnabled`、`recapLanguage` 写入项目配置。
- `knowledge/documentIO.ts` 使用 mdast 读取 Markdown，校验模型返回的原文行号，生成预置草稿和团队 Markdown。`routes/knowledgeRoutes.ts` 提供导入、导出接口；`captureService.ts` 通过 Inbox 管理预置草稿与 Agent 提议。
- `KnowledgePanel.tsx` 提供规范导入、原文与草稿编辑、选择确认、逐条丢弃和工作区导出。
- `config.ts`、`openCodeProcess.ts`、`openCodeRuntime.ts`、`agentSettingsStore.ts`、共享类型和设置界面支持 MiniMax/DeepSeek。`processEnv.ts` 限定 Agent 子进程接收的模型 Key，终端环境不包含模型 Key。
- `agentRunManager.ts` 在既有自我复盘和任务用量位置读取 provider、模型与语言，并估算 MiniMax-M2 费用；原有任务执行结构保持完整。`openCodeProcess.ts` 通过 `openCodeProviderId` 与配置函数加入 provider、MCP 和权限字段。
- `extract/recapPrompt.ts` 要求具体代码规则和配置语言，提供正反示例，要求检查表达式针对最终代码。`retrieval/index.ts` 支持逐个处理活动文件集合，同时保留单个 `activeFile` 参数。
- `workspaceWatcher.ts` 关闭时等待已开始的文件处理完成；`projectRuntime.ts` 随后等待文档、捕获与知识写入完成。

验证脚本位于 `apps/server/scripts/knowledge-stage6-*.ts`，真实任务使用 `demo/stage6-model-tasks` 和 `demo/stage6-mcp-workspace`。脱敏记录保存在 [evidence/stage-6](evidence/stage-6/)。

## MCP 与真实 OpenCode

核查 OpenCode v1.18.31 的 remote MCP 实现：依次尝试 Streamable HTTP、SSE。本项目使用 SDK 的无会话 Streamable HTTP JSON transport，HTTP 服务绑定 `127.0.0.1`，验证连接地址与随机 Bearer 令牌。`KNOWLEDGE` 为其他模式时不注册 MCP，也不向 OpenCode 配置添加 MCP。

OpenCode 工具名称带服务器前缀，权限项为 `knowledge_knowledge_search`、`knowledge_knowledge_get`、`knowledge_knowledge_propose`，均设置为 `allow`。提议工具仍要求项目配置允许、能够唯一关联运行中的任务、最终由成员确认。与点一集成时需要保留 `openCodeConfig` 中的 provider、mcp 和 permission 字段。

真实验证使用 `deepseek/deepseek-flash`，关闭卡片注入，开启工具：

| 任务 | 观察 | 结果 |
| --- | --- | --- |
| 提示查询 Session 约束 | 调用 search、get、propose；search/get 返回团队 constraint 卡片 | completed，运行 npm test；提议经成员接受与确认 |
| 任务文本未要求查询 | 调用 search，取得同一 constraint 卡片；使用共享 helper 修改状态 | completed，运行 npm test |

两个任务的 trace 均记录 `knowledge_tool_call`，可关联唯一 run。卡片没有作为内容预先注入；知识工具说明仍写入任务提示。自发查询观察依赖该工具说明，来自一次任务，不能用作查询率结论。[mcp-smoke.json](evidence/stage-6/mcp-smoke.json) 保存任务和工具记录，[mcp-proposal-confirm.json](evidence/stage-6/mcp-proposal-confirm.json) 保存人工确认链路，[mcp-reuse.json](evidence/stage-6/mcp-reuse.json) 保存首次工具命中时间。

## 导入与静态导出

真实 MiniMax 导入 CONTRIBUTING.md 生成两条草稿，证据对应原文第 5、9 行，记录见 [import-real.json](evidence/stage-6/import-real.json)。界面可以逐条查看原文、编辑草稿、选择确认或丢弃。模型不可用或结构与行号校验失败时使用 mdast 的标题和列表节点生成确定性条目。

导出只包含 reviewed/team 卡片，并保留项目级或文件模式适用范围。卡片正文使用引用块，导出的 Markdown 再经确定性导入时，每张卡片生成一个条目。读取和写入路径拒绝符号链接与工作区外路径。

没有 AGENTS.md 时写入该文件，OpenCode 默认读取。已有 AGENTS.md 时写入 AGENTS.knowledge.md，OpenCode 默认不会读取这个文件；可配置 `instructions: ["AGENTS.knowledge.md"]`。本阶段接口不改变全局 instructions，实验 C1 应记录文件名称和启用方式。

## MiniMax Agent 对比与思考内容

实际验证地址为 `https://api.minimaxi.com/v1`，模型为 `MiniMax-M2`；最小请求返回 HTTP 200，`reasoning_split: true` 产生独立 reasoning_content，记录见 [minimax-endpoint.json](evidence/stage-6/minimax-endpoint.json)。OpenCode 配置声明 `reasoning: true`、`interleaved: { field: "reasoning_content" }`，下一轮工具交互保留该字段。知识 JSON 解析还支持清理 think 标签。

每种模型在四个多文件任务上各运行两次，均使用独立工作区与 session、关闭知识，判定器执行原始测试并检查测试文件保持原内容。

| 指标 | minimax / MiniMax-M2 | deepseek / deepseek-flash |
| --- | --- | --- |
| completed，功能通过，Agent 执行测试 | 8/8 | 8/8 |
| 工具失败 | 0 | 0 |
| 源文件或最终回复出现 think 标签 | 0 | 0 |
| 墙钟时间合计 / 平均 | 150.971 / 18.871 秒 | 68.057 / 8.507 秒 |
| totalTokens | 1144390 | 823154 |
| 费用 | 估算人民币 2.471606 元 | SDK cost=0，实际账单未取得 |

MiniMax 的错误与完成结果符合本阶段标准，作为点三默认 Agent 模型。平均耗时约为 DeepSeek 的 2.22 倍，总 token 数约为 1.39 倍。各任务记录、价格与来源见 [agent-model.md](agent-model.md)。MiniMax 的估算费用独立保存为 `estimatedCost`、`estimatedCostCurrency`、`estimatedCostSource`；SDK `cost` 保持原值。其他模型名称需要对应价格才提供估算。旧原型的 60 次草稿实验使用 DeepSeek，论文需要记录模型差异。

## 六次复盘与上一轮比较

服务端使用 `minimax/MiniMax-M2`，默认 `recapLanguage=zh`。跨属主改回与追加纠正各运行三次，6/6 通过结构和引用校验，6/6 未使用兜底。以下保留本轮规则原文；上一轮原文见阶段 5 报告“2026-10-06 第二次审阅修复”。完整本轮草稿见 [recaps.json](evidence/stage-6/recaps.json)。

| 场景与次数 | 上一轮规则内容 | 本轮引用数 / 是否兜底 | 本轮规则原文 |
| --- | --- | --- | --- |
| 跨属主改回 1 | 修改共享 helper 文件前通过聊天咨询成员 | 5 / 否 | 在 src/session.ts 中更新 session setup 时，必须保留现有的共享辅助函数 sharedHelper，不得将其移除或替换为其他名称的函数。 |
| 跨属主改回 2 | 共享代码写入前要求成员审核或批准 | 6 / 否 | 在src/session.ts中修改session setup时，必须保留现有的sharedHelper函数。不得通过重命名、替换或删除的方式移除共享helper。如需添加新功能，应保留原有sharedHelper并扩展功能，而非直接替换。 |
| 跨属主改回 3 | 保留 helper，并在修改前咨询成员 | 7 / 否 | 在 src/session.ts 中，保留现有的 sharedHelper 函数。删除或重命名共享工具函数前需获得团队共识。 |
| 追加纠正 1 | Do not write directly to state in session files. Use shared helper functions for state mutations. | 5 / 否 | 在 src/session.ts 文件中，进行 session 状态变更时，禁止直接赋值 `state.xxx = value`，必须使用 sharedHelper 函数进行状态变更操作。 |
| 追加纠正 2 | Do not write session state directly. Use shared helper functions for all state mutations. | 5 / 否 | 在src/session.ts中修改session state时，必须使用sharedHelper(state, name)函数调用，不能使用直接赋值语法如state.name = name |
| 追加纠正 3 | Do not write state directly in src/session.ts; identify and use the shared helper for state operations. | 4 / 否 | 在 src/session.ts 文件中，session 状态的所有变更必须使用 sharedHelper(state, name) 方法，禁止直接对 state 对象进行属性赋值（如 state.name = name） |

六条规则都指向具体文件与函数，六条自然语言规则都使用中文。跨属主第 3 条仍增加“团队共识”的流程要求，证据没有支持这一部分。多份 notApplicable 增加了证据未说明的例外，需由人修改。追加纠正第 2、3 条的正则能够匹配属性赋值；第 1 条没有匹配 `state.name = name`。跨属主第 1、3 条将 sharedHelper 配置为 regex-absent，方向与保留函数的要求相反，第 2 条使用了 diff 标记。结构与引用通过仅证明输出可读取、引用路径存在，规则范围与可执行检查仍需人工核对。

## 测试

执行环境为 Node 22.19.0、pnpm 9。2026-10-06 至 2026-10-07 执行以下命令，永久记录见 [verification.md](evidence/stage-6/verification.md)：

- `pnpm build`：通过。
- `pnpm test`：server 128 项、knowledge 152 项、demo 2 项通过。
- `pnpm test:e2e`：21 项通过，15 项按条件跳过。
- `pnpm test:e2e:knowledge`：13 项通过，包括本阶段导入、编辑、批量确认与导出。
- 全部 38 项 Agent 测试分别在 `AGENT_LLM_PROVIDER=minimax` 和 `deepseek` 环境下通过，MiniMax 环境包含在完整单元回归中。
- `bench:retrieval-stress`：Lexical Recall@1 24.2%，Type-only 60.8%，Wrong-file+Type @1/@3 为 0%/63.3%，确定性数值保持一致。

MCP 测试使用 SDK 客户端与实际 HTTP 服务，覆盖工具列表、令牌错误、未知工作区、个人和草稿卡片过滤、关闭工具时的空结果与记录、运行时间关联、提议的人工确认、原文行号与导出往返。真实 MCP 验证覆盖运行时主动调用和唯一 run 关联；多个 run 的 ambiguous 分支通过运行时间区间测试验证。

## 阶段 7B 接口与限制

- 实验可通过项目 config 切换注入、工具和提议；tool-calls.jsonl、knowledge_tool_call、usage_summary、复用时间接口提供条件记录。
- MCP workspace 参数无法证明调用者身份。令牌属于进程，同一 OpenCode 进程共享工具配置；多个运行任务记录 ambiguous 和 candidates，正式实验可用 OpenCode trace 的工具时间与消息继续确认。
- MCP 令牌出现在 OpenCode 配置环境中；它与模型 Key 分别使用。端点认证与本机地址检查持续启用。
- AGENTS.knowledge.md 需要显式 instructions；实验 C1 需要确认最终启用的文档。
- 四个任务的模型对比与两次 MCP 查询属于兼容性冒烟，正式实验使用固定任务和判定器。费用估算没有替代实际账单。
- 复盘的引用路径校验没有验证规则的全部语义与正则方向。界面人工确认继续承担内容审核，正式 K2 需要分别评价规则与适用边界。
