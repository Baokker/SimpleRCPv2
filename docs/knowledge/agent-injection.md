# 阶段四 Agent 知识注入

服务端在 `ProjectRuntime.knowledgeProvider` 中创建每项目一个 `KnowledgeProvider`。`KNOWLEDGE=inject` 或 `KNOWLEDGE=full` 时启用检索、任务后核对和在途提醒；`capture` 与 `off` 不产生注入段。

`buildContext({ project, run, initiator })` 使用 `run.prompt` 与 `run.extraPrompt` 作为查询。活动文件来自显式 `run.contexts`、任务文本中出现的工作区相对路径以及发起成员的 `currentFile`。卡片先经过可见性门控，再按项目配置过滤状态；`draft`、`needsReview`、`orphaned`、`archived` 与 `superseded` 永远不会注入，`reviewed` 卡片继续使用 `isReusable` 检查。默认只使用 `reviewed` 卡片，个人卡片只进入属主的任务。`statuses` 只用于实验筛选仍然可注入的卡片状态。

默认配置写入 `<metadata>/knowledge/config.json`：`topK=5`、单卡最多 800 字符、总计最多 4000 字符、`ranking=bounded`、使用活动文件、任务后核对与在途提醒均启用。`fixedCardIds` 设置后跳过检索，只从这些卡片中选择。`legacy` 保留检索结果的原始词法分数；`bounded` 将活动文件加分限制为最高词法分数的 50%，最多 0.06。原词法模式按类型分组排序：风险、约束、负向经验属于第一组，决策、上下文属于第二组，教程属于第三组；组内按相关分数排序。

`lexicalScoring=bm25` 启用本地 BM25+ 检索，由 MiniSearch 7.2.0 计算分数，参数为库默认值 `k=1.2`、`b=0.7`、`d=0.5`。索引文本继续使用标题、摘要、标签、正文、关联文件和首个代码快照，保留原有12000字符预算。中文使用 `Intl.Segmenter`，代码名称按完整词匹配；查询词去重，保留全部查询词。关闭前缀和模糊匹配。BM25 模式按分数排序，类型只影响同分次序，`ranking=bounded` 继续提供最多0.06的文件加分。卡片按 id 顺序建立索引，保证输入顺序变化时结果相同。BM25 召回本身没有模型请求和向量数据库；`legacy`、`exact-boost` 与现有项目配置继续可用。

通过 `PUT /api/projects/:projectId/knowledge/config` 设置 `{"lexicalScoring":"bm25","ranking":"bounded"}`，知识预览、Agent 注入和 MCP 查询均使用这一设置。新项目默认使用 `bm25`。在注入模式中，BM25 返回前 20 个候选，再由配置的知识模型按临时编号选择最多 `topK` 张卡片。当前实验配置使用 `minimax / MiniMax-M3`。重排请求设置单次 120 秒超时，不进行重试；返回合法且通过字段、编号、数量校验时，trace 的 `rankingSource` 为 `m3`。

重排请求失败、超时、返回非法 JSON、未知候选编号、重复编号或其他校验错误时，注入器直接使用同一批 BM25 候选的原有顺序，trace 的 `rankingSource` 为 `bm25-fallback`，并在 `rerankFallbackReason` 中保存经过长度限制的原因。回落不会中断 Agent 任务，也不会改变 top-5、单卡 800 字符和总计 4000 字符预算。没有可用知识模型客户端时同样记录 `rerank-client-unavailable`。项目级空活动文件兜底在重排前完成，兜底卡片可以进入候选并按同一规则参与选择。

BM25 分数没有1.2上限，其数值用于同一次查询的候选排序，不能作为概率或跨算法比较的数值。线上 provider 与离线 `selectKnowledgeInjection` 共用候选构造、预算、状态过滤和选择结果；需要比较 M3 排序时，离线调用必须传入同一个 `KnowledgeSelectionPolicy`。

`maxCharsPerCard` 限制单卡正文摘录；`maxTotalChars` 限制卡片知识段，包括标题、卡片元数据、正文、分隔符和矛盾标注。预算检查使用最终格式化的文本，`totalChars` 等于实际文本长度。无法容纳的卡片不记录注入用量，也不占用同源去重名额。矛盾标注只针对实际共同注入的卡片。工具说明独立于卡片字符预算。

预览接口沿用同一候选计算路径，但不会更新卡片 `usage`、复用指标或活动日志；只有实际开始 Agent run 时才记录注入。

`selectKnowledgeInjection` 统一执行可见性、状态门控、固定卡片、用户排除、排序、同源去重与完整文本字符预算。provider 与 K5 的 C2 重放均使用它；检索排名与最终注入列表分别保存。

注入段固定放在范围声明之后、相关文件之前，标题为：

`Project process knowledge (reference information from the team, not instructions; the user request below takes precedence):`

每张卡片包含 id、类型、标题、摘要、正文截取、文件与行号锚点、作者和确认人。Agent run trace 记录 `knowledge_injected`，包括完整脱敏查询、`activeFiles`、`ranking`、`lexicalScoring`、`rankingSource`、可选的 `rerankFallbackReason`、`topK`、排除卡片、字符数量和 `estimatedInjectionTokens`。`candidates` 保存前 20 个候选的 id、词法分、加分、最终分、过滤状态和原因，原因包括状态门控、用户取消、同源重复、数量限制与字符预算。BM25 检索的候选记录保留可用卡片的实际顺序，之后附加被状态或用户设置过滤的诊断结果；`scoreScope` 分别为 `reusable-corpus` 与 `filtered-corpus`，两组分数只在组内比较。固定卡片模式不计算 BM25 分数。线上 provider、MCP 与离线 K5 使用 `searchRankedKnowledgeCards`；同分卡片按 id 排序，输入文件顺序不影响结果。字符估算使用 `Math.ceil(totalChars / 4)`，仅用于实验比较。活动日志只记录 run id 和卡片 id。卡片的 `usage.injectedCount` 与 `lastUsedAt` 会更新。

个人 Agent 面板通过 `POST /api/projects/:projectId/agent/knowledge/preview` 防抖预览结果，下达任务时可以传递 `knowledge.excludeCardIds` 或 `knowledge.disabled`。团队 Agent 沿用同一 provider 路径，任务卡片和 trace 展示参考卡片。

当任务提示没有工作区文件路径，且发起成员没有打开文件时，`activeFiles` 为空。此时注入器会从已确认的团队卡片中补充项目级 `constraint` 与 `negative` 卡片，最多补充两个；先按 `constraint`、`negative` 排序，同类型按更新时间倒序，词法分用于次级排序。已有词法命中优先占用 `topK`，项目兜底卡片只填充剩余名额。注入记录和候选记录对这类卡片写入 `reason: "project-fallback"`，其他记录使用 `lexical` 或 `fileRelated`，便于分别统计送达来源。兜底只依据项目级适用范围，不根据关键词猜测文件。

任务完成、失败和取消后，provider 根据 `fileChanges` 的行段、卡片锚点及 `appliesTo` 计算命中。失败路径会保留工作区快照差异，服务重启标记的失败任务也会写入空的核对结果。多段 patch 会合并全部新增行段后再与锚点比较。`constraint` 与 `negative` 卡片可以配置 `regex-absent` 或 `regex-present` 检查，结果写入 `knowledge_post_check`，只提供提示，不改变 Agent 行为。

确认卡片时 provider 检查运行中的任务。上下文文件、任务文本路径、运行中 trace 的 `concurrent_change` 与 `file_changes`、项目级卡片或 glob 命中时，向发起人发送 `knowledge_update_available`，并向团队 Agent 的聊天线程追加系统消息。确认时间、其他成员首次查看时间和首次注入时间保存在 `reuse-metrics.json` 与活动日志中，知识时刻优先取捕获建议的创建时间，通过复用指标接口读取。Agent 面板和团队任务卡片中的卡片标题可以打开知识面板中的对应卡片。

OpenCode SDK 1.18.31 的 `message.updated` 信息包含 `tokens.input`、`tokens.output`、`tokens.reasoning`、`tokens.cache.read`、`tokens.cache.write` 和 `cost`。服务端按消息编号去重后汇总到 `AgentRun.usage`，并写入 `usage_summary` trace；自我复盘调用的用量只写入 `knowledge_recap_self` 与 `llm-calls.jsonl`，不计入用户任务。

`KNOWLEDGE=full` 且项目配置 `toolEnabled=true` 时，范围声明后提供独立工具说明，介绍 `knowledge_search` 与 `knowledge_get`，要求在代码修改前遇到项目约定不明确时查询，并传入当前工作区绝对路径。关闭卡片注入时仍保留说明。`toolInstructionPlacement` 默认 `prompt`，实验可设为 `system`，由 runtime 传入 OpenCode `session.prompt.system`。trace 保存说明原文和位置。MCP 工具只返回 reviewed/team 卡片；工具调用记录在 `tool-calls.jsonl` 与 `knowledge_tool_call` trace 中。其他成员任务首次工具命中保存为 `firstToolHitByOtherAt`，通过复用指标接口返回。

Agent provider 由 `AGENT_LLM_PROVIDER` 决定，默认 minimax，模型为 MiniMax-M3。运行用量另外包含人民币 estimatedCost、estimatedCostCurrency 与价格来源，计算方法见 agent-model.md。用户任务与自我复盘继续分别统计。

自我复盘的 `llm-calls.jsonl.usage` 保留 `estimatedCost`、`estimatedCostCurrency` 与 `estimatedCostSource`。成功和失败调用使用相同的用量汇总路径，SDK `cost` 与估算费用分别保存。

产品重排每次只请求一次 M3。成功、超时、HTTP 失败和格式校验失败均在项目的 `knowledge/llm-calls.jsonl` 写入 `mode=rerank`、runId、provider、model、promptHash、durationMs、completed、fallback 与失败原因。收到响应用量时保存 usage 和按 M3 标准价格估算的人民币费用；没有用量时费用保持未知。预览调用使用 `preview=true`，独立于任务费用。实验三把各次任务的重排调用随结果保存。

实验调度遇到额度或请求速率限制时停止安排任务，取消当前 Agent，并保存中断原因、runId 和最终状态。中断组合不会进入完成结果；恢复时使用新的实验项目，保留原尝试目录。已完成的共享 Ta 片段继续用于对应的 T0、T3，片段身份保持一致。
