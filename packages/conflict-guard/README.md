# @simplercp/conflict-guard

这个包保存语义冲突预防所需的纯逻辑。它接收带来源的文本编辑和光标变化，维护编辑批次、活跃变更集以及随他人编辑移动的文本范围，并发出可写入轨迹的事件。

目录分为 `model/`、`tracking/` 和 `trace/`。服务端负责把 Yjs 事务转换为 `TextEdit`，把事件写入项目元数据目录，并提供查询接口。包不依赖 Express、WebSocket 或文件系统。

`ConflictGuardTracker` 的时间通过 `ConflictGuardClock` 注入，包含 `now`、`setTimeout` 和 `clearTimeout`。默认阈值是批次空闲 1.5 秒、光标离开范围 3 行、批次最长 5 秒、活跃变更集空闲 10 分钟。阶段 4 可以使用虚拟时钟驱动相同的追踪逻辑。

阶段 1 只产生 human、filesystem 和 unknown 来源。`batch_closed` 是后续语义分区的挂载点，`getActiveChangeSets()` 返回当前状态快照，其中变更文件包含基线文本和范围。

范围使用字符偏移。其他参与者在本人范围内部插入文本时，范围的结束位置会向后移动；替换操作与重叠删除会按照当前文本变换范围。阶段 2 映射到符号时需要保留这些边界语义。
