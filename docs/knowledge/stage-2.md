# 阶段二报告

## 已完成内容

- 新增服务端 `KnowledgeService`，按项目读取和写入 `knowledge/cards/`，创建 `knowledge/inbox/`，实现列表、读取、创建、编辑、确认、归档、重选锚点、Guide、Timeline 和 Demo 卡片。Demo 优先使用 `demo/workspace/src/projectStatus.js`，六类卡片的正文对应其中的任务统计与终端格式化逻辑。
- 手动卡片记录 `manual` 来源、属主、确认人和演化记录；个人与待确认团队卡片按属主过滤，团队卡片对项目成员可见。
- 服务端接入 Yjs 相对位置、`docEpoch` 和四层文本解析，广播不携带卡片全文。
- 客户端新增 Knowledge 标签、当前文件、全部卡片、导览、时间线、卡片编辑器、已有卡片编辑、确认、归档、Demo 生成、选区 Pin、编辑器背景高亮、gutter 标记与 hover；锚点失效时可在当前选区重选锚点。
- 新增 REST、WebSocket 类型、服务端集成测试与知识阶段二端到端测试入口。
- 服务端测试增加两个 `WebsocketProvider` 的并发编辑场景，以及最后一个连接关闭后重建 Y.Doc 的 epoch 场景；服务端测试同时覆盖编辑、确认、归档和活动日志。

## 验证记录

- `pnpm --filter @simplercp/knowledge test -- --run`：18 个测试文件、75 项测试通过。
- `pnpm --filter @simplercp/server test -- src/__tests__/knowledgeApi.test.ts`：4 项知识接口、可见性、锚点、生命周期、并发和开关测试通过。
- `pnpm build`：shared、knowledge、server、client 均通过。
- `pnpm test:e2e:knowledge`：使用 `KNOWLEDGE=capture` 启动独立服务，`tests/e2e/knowledge.spec.ts` 的 5 项场景通过；截图目录为 `docs/knowledge/screenshots/`，包含 FV-6 至 FV-11。
- `pnpm test:e2e:terminal-disabled`：1 项通过。
- `pnpm test`：知识接口测试、知识包测试和 Demo 测试通过；服务端全量测试仍有 18 项未通过，原因集中在当前环境的 `node-pty` `posix_spawnp failed` 与依赖终端初始化的成员、Agent 接口。该结果与阶段一记录一致。
- `pnpm test:e2e`：首个用例通过，随后已有 Agent 用例在等待 `display-name` 时超时；该回归在继续运行前终止，知识专用端到端入口独立通过。

现有服务端测试在当前执行环境中有部分终端 PTY 初始化限制，知识接口测试使用 `terminalEnabled: false` 完成验证。默认健康接口在 `KNOWLEDGE=off` 时继续只返回原有终端字段，知识接口返回 `404`。

## 阶段三接口建议

阶段三可以复用 `KnowledgeService.create` 的卡片字段构造，先把自动捕获结果写入 `knowledge/inbox/`，确认后再调用正式卡片写入路径。捕获器只需要提供成员、来源、证据引用和可选锚点草稿；卡片的可见性、活动日志、广播和原子保存由阶段二接口统一处理。

## 遗留问题

- 持久化层只保存文件文本，Yjs 更新历史没有持久化，文档实例重建后必须依赖文本策略刷新相对位置。
- 端到端截图已经保存到 `docs/knowledge/screenshots/`；截图由 Playwright 测试生成，未保存浏览器地址栏等无关窗口内容。
- 阶段二没有实现自动捕获、Inbox 内容、Agent 注入、作用域升级和复杂治理流程。
