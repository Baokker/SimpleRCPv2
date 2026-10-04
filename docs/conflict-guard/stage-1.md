# 阶段 1：语义冲突预防地基

## 改动内容

- 新增 `@simplercp/conflict-guard` 包，提供来源编辑模型、范围变换、编辑批次、活跃变更集和轨迹回放校验。
- 服务端接入 `CONFLICT_GUARD=off|observe|rules|full`。当前 `rules` 和 `full` 使用 observe 行为并写启动提示；`off` 不创建追踪器、不监听 Yjs、不创建轨迹文件。
- 文档准备时建立文本镜像并监听 Y.Text 事务。WebSocket 连接映射到成员，`FILESYSTEM_ORIGIN` 记录为 filesystem，未知事务来源记录警告。
- 增加光标记录、批次结束计时、活跃变更集完成 API、状态查询和轨迹下载 API。

## 范围变换实现

使用基于字符位置的纯函数 `transformRanges`。插入操作按范围起点和终点处理，删除操作把被删除区域内的边界收缩到删除起点，再应用长度差。这个实现不依赖 Y.RelativePosition，便于阶段 4 使用虚拟时钟回放，也能直接对 trace 中的 `ops` 重放。

## 测试结果

`@simplercp/conflict-guard` 测试通过：2 个测试文件、7 项测试。服务端测试通过：28 个测试文件、97 项测试；冲突防护新增集成测试与 `off` 测试通过：3 项测试。`pnpm -r build` 通过，演示测试通过 2 项，`CONFLICT_GUARD=off pnpm test:collab` 与 `CONFLICT_GUARD=observe pnpm test:collab` 均通过 2 项。

## 手动验证观察

真实 WebSocket 集成测试使用 Node `WebsocketProvider` 验证两名成员归属、文件系统回灌、范围更新和轨迹回放。两种开关模式的浏览器协作回归均通过；长时间双浏览器编辑观察仍属于后续实验记录，接口已经提供 state 与 trace 读取能力。

## 阶段 2 接口建议

阶段 2 可以在 `batch_closed` 事件上挂载符号解析。`FileChange.symbols` 已保留扩展字段，`TrackedRange` 继续使用当前文本坐标；符号索引可以把范围映射到符号后写入批次扩展字段，服务端 API 不需要改变。

## 遗留问题

Yjs 连接 origin 依赖 y-websocket 当前实现，升级 y-websocket 后需要重新验证。未知来源记录为 `unknown`，Agent 来源留给阶段 6。浏览器双成员手动长时间验证仍需要在开发服务器上执行。
