# 文档同步调研

调研日期：2026-09-17

## 问题

项目文件同时接受三类写入：浏览器成员通过 Yjs 修改，共享终端直接修改磁盘，OpenCode 直接修改磁盘。

现有实现存在两个确认问题：

- 服务端写入磁盘后，延迟到达的 watcher 回调可能把旧内容重新写入 Yjs。
- 外部变化使用全文删除加全文插入，会替换全部 CRDT 字符标识，使其他成员的光标和选区错位。

Agent 接入会显著增加外部文件变化，这两个问题需要在基线中修复。

## 基线同步方式

每个打开文件维护一个异步操作队列和递增 revision。成员更新和 watcher change 都向这个队列提交操作，同一文件不会同时执行两个同步操作。

成员更新操作：

1. 增加 revision。
2. 操作开始时读取最新 Yjs 内容。
3. 写入同目录临时文件。
4. 提交前检查文件仍然允许编辑。
5. 通过 rename 更新项目文件。

watcher 操作：

1. 操作开始时记录 revision。
2. 读取当前磁盘内容。
3. 读取完成后 revision 已变化时，把 watcher 操作重新加入队列。
4. revision 稳定且磁盘内容与 Yjs 不同时，计算最小 delta。
5. 使用 `FILESYSTEM_ORIGIN` 更新 `Y.Text`。
6. 文件系统来源的 Yjs transaction 不再写入磁盘。

Agent 启动和共享终端提交命令之前等待全部文件队列空闲，保证命令开始时可以读取已经保存的成员内容。

## 最小 delta

使用固定版本的 `fast-diff` 计算字符差异，再转换为 Y.Text 的 `retain`、`insert` 和 `delete`。计算前裁剪公共前缀和后缀，减少大文件小改动的输入范围。

超过 `SIMPLERCP_COLLAB_TEXT_MAX_BYTES` 的文本文件只读，默认限制为 2 MiB。基线不使用全文替换处理大文件。

## 删除和类型变化

watcher 收到 unlink 时立即把文档设置为 retired。新的编辑被拒绝，队列中尚未开始的写入被丢弃。已经写入临时文件的操作在 rename 前再次检查 retired，检查失败时删除临时文件。

文本变为二进制时采用相同处理。再次打开该路径时重新读取磁盘并创建新的文档实例。

## 文件生命周期与过滤

- watcher 忽略 `node_modules`、`.git`、`__MACOSX` 和 `.DS_Store`。
- 没有成员打开的文件不创建 `Y.Doc`。
- watcher 事件只表示需要重新读取，不使用事件时间戳判断内容来源。
- 固定忽略路径可以由终端和 OpenCode 访问，但不进入浏览器协作事件。

## Agent 过期写入

Agent 读取 V0，成员修改成 V1，Agent 再根据 V0 写出 V2 时，V1 中的内容可能缺失。同步层只能把 V2 显示给所有成员，无法恢复 V2 中没有的内容。

基线记录 Agent 文件读取观察和成员 revision，检测到风险时显示 `concurrent_change`。完整处理需要独立工作目录和三方合并，见产品已知问题与改进路线。

## 测试重点

- watcher 延迟期间继续输入不会恢复旧内容。
- 外部中段修改不会改变未变化区域的 RelativePosition。
- 多处外部修改保留中间未变化内容。
- 同一文件连续写入不会交错。
- revision 在磁盘读取期间变化会重新执行 watcher 操作。
- 文件系统来源的 transaction 不触发再次写入。
- 删除和类型变化不能被排队写入恢复。
- 固定忽略路径不会创建文档或广播变化。

## 参考资料

- [Y.Text API](https://docs.yjs.dev/api/shared-types/y.text)
- [Yjs Delta 格式](https://docs.yjs.dev/api/delta-format)
- [jupyter-collaboration issue #243](https://github.com/jupyterlab/jupyter-collaboration/issues/243)
- [jupyter-server-documents issue #320](https://github.com/jupyter-ai-contrib/jupyter-server-documents/issues/320)
- [Gutenberg PR #73699](https://github.com/WordPress/gutenberg/pull/73699)
