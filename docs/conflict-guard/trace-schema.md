# 协作轨迹 Schema 1

每个启用 observe 的项目使用一个 `conflict-guard/trace.jsonl` 文件。每行是一个 JSON 对象，包含 `schema: 1`、连续递增的 `seq`、毫秒时间戳 `at` 和事件 `type`。写入错误直接传播。当前代码提交为 `0cd88f6`，运行证据见 [self-acceptance/README.md](evidence/self-acceptance/README.md)。

## 事件字段

- `session_start`：`mode`、阈值配置和服务端提交号。服务重启后追加事件，回放保留跨会话文本、批次、变更集和脱敏状态。
- `doc_open`：普通文件记录 `file`、初始全文 `text` 和 `textHash`；敏感文件记录 `{ file, skipped: "sensitive" }`。
- `edit`：`file`、`origin`、`ops`、`revisionAfter`。每个操作包含相对于修改前文本的 `from`、`deleted` 和 `inserted`；按顺序应用时累计前序操作的长度变化。`revisionAfter` 为 collaborativeDocuments 的 revision。
- `cursor`：`memberId`、`file`、`position`、`selection` 和时间。服务端内存保留每个成员的最新光标，轨迹每 200 毫秒窗口登记最后一个位置。
- `batch_opened`、`batch_closed`：批次编号、参与者、文件、时间和范围。关闭事件增加 `endedAt`、`closeReason`、文本哈希，`at` 使用批次结束时间。
- `change_set_opened`、`change_set_closed`：参与者与涉及文件，文件记录包含范围及触碰时间。打开事件已经包含首个文件。
- `change_set_file_closed`：`actor`、`file` 和 `reason`。
- `doc_retired`：被删除或停用的文件。
- `mirror_resync`：文件、修改前文本哈希、替换后的全文和新文本哈希。该事件成为该文件的回放起点。
- 脱敏按已配置的精确敏感值执行。一个文件首次出现敏感值后，后续该文件事件持续带有 `redacted: true`，包括重启后的事件。校验结果通过 `validateTraceDetailed` 返回 `redactedFiles` 和 `skippedFiles`。

## 最小回放条件

回放从每个 `doc_open.text` 或 `mirror_resync.text` 建立文件状态，按 `seq` 顺序校验 edit 并应用操作。`batch_closed.textAfterHash` 必须等于回放后的文件文本 SHA-256。脱敏改变了文本长度，这些文件跳过 edit 操作和哈希核验，并列入 `redactedFiles`。敏感文件列入 `skippedFiles`。校验拒绝空轨迹、缺少 session 起点、缺失或乱序事件、错误删除文本和未关闭批次。

`mirror_resync` 前 tracker 关闭已有批次、移除该文件的活跃范围，再设置新的基线。`session_start` 保持已有文件状态，序列继续递增。
