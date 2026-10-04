# 阶段二锚点解析

服务端负责锚点创建与解析，客户端只使用解析后的行列范围。锚点创建时记录文件相对路径、关联粒度、捕获范围、选区文本、SHA-256、上下文前后缀和最多五条 landmark 行。

## 四层顺序

1. **Yjs 相对位置**：文件已有服务端 Y.Doc 时，使用 `Y.createRelativePositionFromTypeIndex` 保存起止位置。解析时用 `Y.createAbsolutePositionFromRelativePosition` 还原起止位置，并比较当前位置文本与快照文本的相似度。相似度低于 `0.65` 时放弃这一层。
2. **范围**：检查 `rangeAtCapture` 转换后的范围是否仍然等于快照文本。
3. **唯一快照**：在当前文件中查找唯一的完整快照文本。
4. **上下文指纹**：使用 landmark 行和前后缀寻找候选范围，沿用阶段一的文本解析器。

范围层命中返回 `ok`。Yjs 层只要相对位置解析成功并通过相似度检查就返回 `ok`，因为位置变化属于 Yjs 相对位置的预期行为。唯一快照或指纹层命中返回 `moved`。全部策略失败，或者最佳置信度低于 `0.65`，返回 `needsReview`。读取解析保持卡片的业务状态；文本策略解析成功时会刷新相对位置与 `docEpoch`。写回操作与编辑、确认、重选使用同一项目队列。

## docEpoch

每个服务端 Y.Doc 实例在初始化时生成随机 `docEpoch`，与 `yjsRelative` 一起保存。解析前要求卡片中的 epoch 与当前文档 epoch 相同。epoch 不同时跳过 Yjs 层，使用文本策略解析；文本策略成功后用当前范围重新生成相对位置和 epoch 并写回卡片。

Yjs 相对位置使用 JSON 形式保存：`type` 保存文本类型名，`item` 保存 `client:clock`，`assoc` 保存关联方向，避免把 Yjs 的内部对象直接写入卡片文件。

## y-websocket 回收结论

当前依赖为 `y-websocket 2.1.0`。`bin/utils.cjs` 的 `closeConn` 在连接从 `doc.conns` 移除后检查连接数量；最后一个连接关闭时调用 `persistence.writeState(doc.name, doc)`，随后调用 `doc.destroy()` 并从模块级 `docs` Map 删除文档。SimpleRCPv2 的持久化回调先刷新文本并释放文档记录。因此服务端重启或最后连接断开后的文档重建都会产生新的 `docEpoch`，旧相对位置不能跨文档实例直接使用。

## 并发编辑

两个客户端共用同一个 Y.Doc。一个客户端在锚点前插入多行，另一个客户端在锚点内部修改字符时，Yjs 相对位置跟随结构变化，服务端仍能得到正确范围。内部字符变化由相似度阈值检查，变化过大时转入文本策略或 `needsReview`。
