# 协作轨迹 Schema 1

每个启用 `observe` 的项目使用一个 `conflict-guard/trace.jsonl` 文件。每行是一个 JSON 对象，包含 `schema: 1`、连续递增的 `seq`、毫秒时间戳 `at` 和事件 `type`。写入失败只记录服务端警告，不影响协作。

## 事件字段

- `session_start`：`mode`、阈值配置和服务端提交号。
- `doc_open`：`file`、初始全文 `text` 和 `textHash`。
- `edit`：`file`、`origin`、`ops`、`revisionAfter`。每个操作包含相对于修改前文本的 `from`、`deleted` 和 `inserted`。
- `cursor`：成员、文件、行列位置和时间。服务端内存中只保留最新光标，轨迹写入由适配层负责节流。
- `batch_opened`：批次编号、参与者、文件、开始时间和范围。
- `batch_closed`：批次完整字段、关闭原因、范围、`textBeforeHash` 和 `textAfterHash`。
- `change_set_opened`、`change_set_closed`：参与者与涉及文件的范围和时间。
- `doc_retired`：被删除或停用的文件。
- `mirror_resync`：文件、修改前文本哈希和重新同步后的文本哈希。

## 最小回放条件

从 `doc_open.text` 建立每个文件的文本状态，按照 `seq` 顺序校验每个 `edit` 的删除文本并应用插入内容。校验必须拒绝缺失或乱序事件。`batch_closed.textAfterHash` 必须等于回放后的文件文本 SHA-256。包中的 `readTrace` 和 `validateTrace` 提供这套检查，阶段 4 可以在此基础上增加符号和依赖状态。
