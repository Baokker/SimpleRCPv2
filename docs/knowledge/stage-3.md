# 阶段三报告

## 代码与行为

- `packages/knowledge/src/capture/` 新增规范化事件、注入时钟、编辑区间归属、捕获引擎、共现推断、通知策略及 replay CLI。六类自动触发共享线上与离线计算代码，全部阈值通过配置对象提供。
- `apps/server/src/knowledge/attribution.ts` 维护 WebSocket 身份映射与 Y.Text 镜像，使用真实 `transaction.origin` 识别成员、文件系统和未知来源。原有 Yjs 接收与文本持久化流程继续负责协作文档。
- Node 侧捕获测试与模型验收脚本通过 CommonJS 入口加载 Yjs 和 `WebsocketProvider`，与服务端文档工具、知识锚点服务共用同一套 `Doc` 构造函数。
- `captureService.ts` 接收文档、光标、聊天、文件变化与成员状态，录制事件，保存 Inbox，检索重复知识和风险卡片，处理草稿、确认前证据、复现、未读状态及提示限制。模型凭据只用于服务端 HTTP 客户端。
- `projectRuntime.ts`、`realtime.ts`、`collaborativeDocuments.ts`、`config.ts` 和 `createApp.ts` 接入捕获生命周期。`KNOWLEDGE=off` 不创建捕获服务、不注册捕获观察者、不生成 knowledge 文件，接口返回 `404`。
- `knowledgeService.ts` 和 `knowledgeRoutes.ts` 增加草稿创建、候选范围锚点、草稿作者修改、复现记录、确认耗时和 Inbox REST。并发处理同一建议返回 `409`，一条建议只生成一张草稿。
- 客户端的 `App.tsx`、`KnowledgePanel.tsx`、`CollaborationPanel.tsx`、`api.ts`、`types.ts` 和 `styles.css` 增加 Inbox、我的/全部建议、原始证据、候选锚点、AI 草稿、确认、复现、丢弃、聊天多选、未读数和风险提醒。关闭草稿后重新打开可继续查看原始建议。
- shared 增加 `knowledge_suggestion` 与 `knowledge_risk_warning` 消息。消息携带标识和提示标志，内容通过成员身份读取。

## 测试记录

验证日期：2026-10-05。执行记录保存在仓库 `artifacts/`，该目录由 `.gitignore` 排除。

| 命令 | 结果 | 记录 |
| --- | --- | --- |
| `pnpm build` | shared、knowledge、server、client 全部通过 | `artifacts/stage3-build.log` |
| `pnpm test` | server：28 个文件、104 项；knowledge：19 个文件、106 项；Demo：2 项，全部通过 | `artifacts/stage3-regression-unit.log` |
| `pnpm test:e2e` | 21 项通过，10 项按功能开关与录制开关跳过 | `artifacts/stage3-regression-e2e.log` |
| `pnpm test:e2e:knowledge` | 8 项通过，包括阶段二五项与阶段三三项 | `artifacts/stage3-e2e-knowledge.log` |
| 知识捕获真实集成测试 | 6 项通过，覆盖双成员归属与定向通知、磁盘依赖变化、持久恢复、并发接受、风险可见性与冷却、关闭功能 | `artifacts/stage3-capture-final.log` |
| replay CLI | 两条自动建议：`edit.overwritten` 一条、`chat.dense` 一条 | `artifacts/stage3-replayed-suggestions.jsonl`、`stage3-replay-counts.json` |
| 真实模型浏览器验收 | 两类建议均从 Inbox 调用 AI 草稿，并通过编辑器确认成 `reviewed` 卡片 | `artifacts/stage3-real-model.log` |
| 已配置凭据检查 | 仓库交付文件与阶段三验证记录中匹配数量为零 | `artifacts/stage3-secret-check.json` |

知识包的 31 项捕获测试覆盖区间变换、各触发正例和边界/冷却反例、覆写成员限制、多个大删除后的恢复、候选排序、成员离开后的光标停留、事件校验、小时上限及确定性草稿的证据保留。

端到端场景使用真实浏览器和平台 Yjs 通道。知识入口设置 `KNOWLEDGE=capture`，接受动作使用正式的确定性草稿路径；默认端到端入口保持知识功能关闭，知识场景通过独立命令执行。

本机 `node-pty` 的 `spawn-helper` 需要可执行权限，验证时已为当前 clone 的依赖文件设置 `u+x`。应用 PTY 代码保持原有实现，完整终端回归已经通过。

## 真实协作与回放

集成测试建立两个 `WebsocketProvider`，两名成员通过真实连接交错编辑同一文件，并经 HTTP 聊天接口讨论。另一个成员连接 `/ws`，核对建议分发范围。录制会话持续约 120 秒，生成 65 条规范化事件，包含成员编辑、光标、聊天和文档状态。

观察到一次 `edit.overwritten` 和一次 `chat.dense`。覆写证据正确记录原作者与改写者，建议只发送给两名参与者；第三名成员没有提示，但能在全部建议中读取。编辑镜像与 Y.Text 保持一致，`mirror_resync` 数量为零。聊天候选 Top-1 为实际协作的 `code.ts`，理由包括成员编辑、聊天提及文件和 identifier。

`replayEvents` 使用录制事件和相同配置重新生成建议，逐项比较类型、时间、actors 和 suggestedAnchors，结果完全一致。CLI 对同一事件文件返回相同的两类计数。输入、配置和比较结果分别保存为：

- `artifacts/knowledge-stage3-session/events.jsonl`
- `artifacts/knowledge-stage3-session/capture-config.json`
- `artifacts/knowledge-stage3-session/comparison.json`

该会话验证计算一致性与真实连接行为。K1 的精确率、召回率和锚点命中率仍需要带人工标签的实验事件集，报告未把本次功能测试作为这些实验指标。

## 真实模型草稿

`apps/server/scripts/knowledge-stage3-model-check.ts` 建立双成员 Yjs 会话，生成覆写与密集聊天建议，再使用 Playwright 操作实际 Inbox 的“AI 草稿”按钮，等待编辑器显示原始证据，通过“确认并保存”完成确认。模型为 `deepseek-flash`，两条草稿均返回 `source: ai`、`fallback: false`，确认后为 `reviewed`。

| 触发 | 耗时 | totalTokens | 草稿观察 |
| --- | --- | --- | --- |
| `edit.overwritten` | 15,468 ms | 5,671 | 类型为 `decision`。准确记录 `delay` 从固定等待改为有上限的指数等待、100 与 2000 的代码参数、22 ms 间隔；明确指出证据没有聊天协调记录。正文为英文，代码来源只有实现和成员标识，改写意图需要成员补充。 |
| `chat.dense` | 10,573 ms | 5,415 | 类型为 `decision`，中文标题“retry.ts delay 改为指数退避”。准确提取 `Math.min(base * 2 ** attempt, limit)`、`attempt` 从零开始、100 ms 基值、2000 ms 上限和 `attempts=5`，并引用对应聊天消息。 |

生成文本包含可阅读的规则与证据引用。正文较长，程序追加的证据 JSON 会增加阅读时间；确认界面允许删减与补充。聊天草稿准确区分等待公式和重试次数；代码改写草稿记录已观察到的变化，参与者仍需确认原因。浏览器检查使用真实模型结果，模型正文的质量观察来自对生成文本的阅读。

真实结果保存在 `artifacts/knowledge-stage3-model/1791149366218/results.json`。模型统计保存在对应项目元数据的 `knowledge/llm-calls.jsonl`；成功与失败均记录耗时、尝试次数、累计 token 和完成标志，提示词仅记录 SHA-256。

## 截图

Playwright 直接保存网页内容，截图之前使用 DOM 断言核对场景，截图不包含浏览器工具栏或其他应用。

| 文件 | 场景 |
| --- | --- |
| `screenshots/S3-1-overwrite-inbox-ada.png` | 原作者 Inbox 中的覆写建议与证据。 |
| `screenshots/S3-2-confirmed-team-card.png` | 接受草稿、重新打开证据并确认后的团队卡片。 |
| `screenshots/S3-3-FV-11-risk-warning.png` | `package.json` 检查点的非模态风险提醒。 |
| `screenshots/S3-4-selected-chat.png` | 多选聊天生成的建议与 `src/hello.ts` 候选。 |
| `screenshots/S3-5-AI-overwritten.png` | 真实模型覆写草稿、原始证据与确认编辑器。 |
| `screenshots/S3-6-AI-chat.png` | 真实模型聊天草稿、原始讨论与确认编辑器。 |

阶段二 FV-6 至 FV-11 的截图同时随知识回归更新。

## 阶段四、五接口建议

- 阶段四使用 `KnowledgeService.list/get` 和现有检索能力读取成员可见的已确认卡片；记录知识使用事件时保留 `cardId` 与 run id。任务前后预览可以引用同一锚点解析接口。
- 阶段五通过归属适配接口扩充 actor 的来源信息，把 `filesystem` 更新关联到具体 run；复用规范化编辑 ops、revision 与事件录制，继续通过虚拟时钟回放。
- 生命周期治理可以使用 `provenance.trigger.suggestionId`、evidenceRefs、`recurrence` 和 `knowledge_review_completed` 关联捕获、确认与后续修改。升级作用域与矛盾处理应继续按请求者可见性执行检索。
- 实验脚本直接调用 `replayEvents`，使用固定配置与标注事件文件比较触发和候选；提示统计从 `knowledge_notification` 读取，编辑比例与确认耗时从确认日志读取。

## 遗留限制

- 共现候选保存行范围；确认时需要检查当前代码范围，代码在生成建议之后移动时可能需要人工选择新的范围。正式卡片继续使用阶段二锚点机制。
- 数字触发使用 TypeScript scanner 判断字面量与注释；数字的领域含义和多文件引用之间的语义关系由草稿与人工确认补充。引用搜索采用文本匹配，不提供 AST 符号关联。
- 录制文件和已知文件文本会随项目会话增长；归属、活动、聊天及恢复候选按窗口清理，长期实验记录需要在运行结束后保存或归档。
- `KNOWLEDGE_RECORD_EVENTS=false` 保留 Inbox 持久化，重新启动时不能恢复未录制的触发历史。已录制项目继续使用相同 `capture-config.json`；更改实验配置需要使用新的录制目录。
- 模型生成质量需要成员核对，当前真实模型观察只包含上述两个会话建议；K1 实验质量指标需要独立的标注数据集。
