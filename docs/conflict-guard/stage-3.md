# 阶段 3：规则分区与干预

本阶段增加包内分区器、四状态 TypeScript 诊断、变更对状态机和 `rules/full` 模式的写盘闸门。客户端显示白区、黑区、灰区判定，并在黑区变更对上显示冻结行装饰和冲突摘要。`observe` 模式只计算结果，`off` 模式不建立 guard。

分区器移植 GreyLock 的可观察性、等价重构、引用删除、导出删除、调用签名、返回属性和接口成员规则，并保留灰区兜底。本阶段没有模型调用。四状态检查使用一个 LanguageService 临时切换文件快照，超过 500 毫秒返回跳过结果。

## 验证命令

- `pnpm -r build`
- `pnpm --filter @simplercp/conflict-guard test`
- `pnpm --filter @simplercp/server test`
- `pnpm test:demo`
- `CONFLICT_GUARD=off|observe|rules pnpm test:collab`
- `pnpm test:e2e -- tests/e2e/conflict-guard-panel.spec.ts tests/e2e/conflict-guard-intervention.spec.ts`

本轮实际结果：`pnpm -r build` 通过；conflict-guard 包 58 项测试通过；server 全部 141 项测试通过；阶段 3 规则集成测试 3 项通过；阶段 3 Playwright 2 项通过。包内三百文件合成索引测试记录全量耗时约 42 ms，服务端 `conflict-shop` 广泛引用文件增量更新 p50 约 4.4 ms、p95 约 6.1 ms，调用签名场景服务端判定与写盘闸门测试通过。

包内测试覆盖同一声明并发修改、注释和日志修改、等价重构、删除引用、返回属性删除、调用签名不兼容、类型关联放行、不可解析修改、四状态类型检查、状态机重判、自动解冻和双方确认。state 接口返回 `pairDecisions`、`frozenFiles`、闸门阻挡文件、冻结总时长、区统计、本地决定比例和写盘冲突次数。

## 已知局限与后续

冻结只在客户端拦截输入，服务端仍接受 Yjs update，并记录 `freeze_violation`。闸门打开时如果磁盘已经发生外部修改，系统记录 `persist_conflict` 并以当前 Y.Doc 内容写入。“我来改”使用服务端为成员和文件维护的 `Y.UndoManager`，撤回范围是该文件本轮活跃变更。阶段 4 可以直接重放 `pair_judged` 的修订号、规则编号、双方符号键和哈希，复现每次本地判定。当前 T0 提示通过 state 轮询发送，服务端状态推送将在后续阶段统一接入。
