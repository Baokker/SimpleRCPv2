# 前三阶段审阅验证

审阅日期：2026-10-05。分支：`feature/process-knowledge`。审阅范围为 `main` 的 `4c96c95` 至阶段三提交 `c8a2da6`，以及本次修订涉及的检索、卡片操作、编辑器和捕获流程。

## 检索与索引

- `knowledge-index.ts` 的缓存内容包含作用域和属主，卡片内容保持相同时也会更新可见性字段。索引使用独立的 `.next` 文件和原子替换，并发构建保持 JSON 完整。
- `knowledge-inject.ts` 在检索排序和 `topK` 筛选之前应用复用规则或调用方过滤函数。字符预算包含标题、摘要、标签、路径、正文和格式字符，最终输出保持在总预算以内。
- 检索回归使用真实文件系统，覆盖作用域与属主变化、不可复用卡片占据高分位置、完整输出预算，以及不同可见卡片集合的并发构建。

## 卡片与编辑器

- `knowledgeService.ts` 和 `knowledgeRoutes.ts` 支持在同一个确认请求中修改并确认可见草稿。字段和作者通过校验后进行一次原子保存；普通编辑继续要求属主或已有确认人。作者显示名称由成员库提供，属主保持原值，确认者加入 `confirmedBy`。
- `editedBeforeConfirm` 根据卡片字段和作者变化记录。无效确认请求保持原卡片，确认日志保留审阅耗时。
- `KnowledgePanel.tsx` 通过确认请求提交草稿修改。`CollaborationPanel.tsx` 的选区 Pin 会切换知识标签，`App.tsx` 的打开卡片事件会显示 Collaboration 面板。
- `EditorArea.tsx` 为代码背景与 gutter 提供打开卡片链接。属主或确认人可以使用当前非空选区重新锚定 `needsReview` 锚点。命令按编辑器实例隔离，卡片文字经过 Markdown 转义，允许执行的命令范围明确，编辑器销毁时释放相关命令。
- Monaco 使用 0.52.2，gutter renderer 支持 Markdown command，模块路径兼容现有 `y-monaco`。重新锚定命令在无参数调用时直接返回。
- 平台 Demo 六类卡片的标题、摘要、正文、标签和演化说明对应真实 `src/projectStatus.js`。知识浏览器测试从 `demo/workspace` 复制同一源文件。

## 捕获与推断

- `capture/engine.ts` 为成员检查点和文件保存最近有效的依赖文本。未完成的 `package.json` 可以继续编辑；后续有效检查点、磁盘变化、文档重新打开和其他成员接续编辑使用有效文本比较依赖名称。
- 聊天多选按最早和最晚消息时间限定活动窗口，消息输入顺序保持推断一致。候选范围限定在当前文本内，完全超出文件的历史活动不参与计算。
- 历史清理保留每名成员在时间边界之前的最后一条光标或 presence，持续停留可以跨越历史窗口，切换文件和离开保持终止停留的效果。
- `captureService.ts` 在保存 Inbox 建议之前校验 schema。捕获回归覆盖有效与未完成依赖文本、磁盘事件、候选范围、窗口边界、持续停留和离线回放。

## 验证记录

运行日志和录制会话保存在 Git 忽略的 `artifacts/`。

| 命令 | 结果 | 记录 |
| --- | --- | --- |
| `pnpm build` | shared、knowledge、server、client 全部通过 | `artifacts/review-build-final.log` |
| `pnpm test` | server：28 个文件、104 项；knowledge：19 个文件、128 项；Demo：2 项，全部通过 | `artifacts/review-tests-final.log` |
| `pnpm test:e2e` | 21 项通过，12 项按功能开关或录制开关跳过 | `artifacts/review-e2e-final.log` |
| `pnpm test:e2e:knowledge` | 10 项通过 | `artifacts/review-e2e-knowledge-final.log` |
| replay CLI | `edit.overwritten` 和 `chat.dense` 各一条 | `artifacts/review-replayed-suggestions.jsonl`、`review-replay-counts.json` |

服务端六项捕获集成测试使用真实 WebSocket、Yjs 和 HTTP 接口。录制会话持续约 120 秒，包含 65 条事件；线上与回放生成的建议类型、时间、actors 和候选锚点逐项相同，`comparison.json` 中的 `matched` 为 `true`。记录位于 `artifacts/knowledge-stage3-session/`。

知识包的捕获测试共 49 项。锚点基准语料从 Git 跟踪文件中采集，测试临时文件与生成目录不参与语料选择。

最终差异通过 `git diff --check`。已配置凭据检查覆盖 Git 跟踪文件与本次验证日志，共 297 个文件，文本匹配数量为零；检查结果保存在 `artifacts/review-credential-check.json`。

知识浏览器回归覆盖真实 Demo 的六类分组、hover 打开卡片与显示隐藏面板、双浏览器范围跟随、gutter 当前选区重新锚定、导览顺序、时间线事件及时间顺序、个人可见性、默认 Chat 中的 Pin、双方 Inbox 与跨成员确认、风险提醒、聊天多选。

截图由 Playwright 保存，使用 DOM 断言核对对应内容。更新文件位于 `docs/knowledge/screenshots/`：

| 文件 | 内容 |
| --- | --- |
| `FV-6-demo-cards.png` | projectStatus.js 六类卡片。 |
| `FV-7-gutter-hover.png` | 编辑器 gutter 与知识摘要 hover。 |
| `FV-8-guide.png`、`FV-9-timeline.png` | 当前文件优先的导览与对应时间线。 |
| `FV-10-team-card.png`、`FV-10-personal-visibility.png` | 属主与另一名成员的卡片可见性。 |
| `FV-11-pin-editor.png` | 选区 Pin 打开的编辑器。 |
| `S3-1-overwrite-inbox-ada.png`、`S3-2-confirmed-team-card.png` | 覆写建议及跨成员确认结果。 |
| `S3-3-FV-11-risk-warning.png`、`S3-4-selected-chat.png` | 风险提醒与选中聊天创建的建议。 |

## Node 协作运行时验证

捕获测试与模型验收脚本通过 `createRequire` 加载 CommonJS 版本的 Yjs 和 `WebsocketProvider`。服务端文档、知识锚点与 Node 客户端共用相同的模块实例。捕获测试在真实连接同步完成后校验服务端文档为同一个 `Y.Doc` 构造函数的实例。

| 验证 | 结果 | 记录 |
| --- | --- | --- |
| `pnpm build` | 全部包通过 | `artifacts/review-yjs-build.log` |
| 协作文档、知识接口、捕获测试 | 3 个文件、17 项通过 | `artifacts/review-yjs-after.log` |
| 模型验收脚本严格类型检查 | 通过，继承服务端配置并包含浏览器回调的 DOM 类型 | `artifacts/review-yjs-script-types.log` |
| 真实会话与回放 | 65 条事件，类型、时间、actors、候选锚点一致；CLI 输出两条建议 | `artifacts/knowledge-stage3-session/comparison.json`、`review-yjs-replay-counts.json` |

## 保留边界

- Y.Doc 的二进制历史没有持久化，实例重建后继续通过文本策略解析并刷新相对位置。
- 捕获建议的候选范围使用行号，确认之前需要核对当前代码；确认后的正式卡片使用多策略锚点。
- 本次协作会话验证回放一致性，K1 的精确率、召回率和锚点命中率需要独立的人工标注事件集。
- 本次审阅覆盖已有模型接口，模型草稿的质量观察记录于 `stage-3.md`。
