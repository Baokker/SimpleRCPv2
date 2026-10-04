# 协作轨迹 Schema 1

每个启用 observe 的项目使用一个 `conflict-guard/trace.jsonl` 文件。每行是一个 JSON 对象，包含 `schema: 1`、连续递增的 `seq`、毫秒时间戳 `at` 和事件 `type`。写入失败只记录服务端警告，不影响协作。

## 事件字段

- `session_start`：`mode`、阈值配置和服务端提交号。服务重启后会追加新的 session 起点。
- `doc_open`：普通文件记录 `file`、初始全文 `text` 和 `textHash`；敏感文件记录 `{ file, skipped: "sensitive" }`。
- `edit`：`file`、`origin`、`ops`、`revisionAfter`。每个操作包含相对于修改前文本的 `from`、`deleted` 和 `inserted`。
- `cursor`：成员、文件、行列位置、选择区间和时间。服务端内存中保留每个成员的最新光标。
- `batch_opened`、`batch_closed`：批次编号、参与者、文件、时间、范围、关闭原因和文本哈希。
- `change_set_opened`、`change_set_file_closed`、`change_set_closed`：参与者、涉及文件、范围和文件关闭原因。
- `doc_retired`：被删除或停用的文件。
- `mirror_resync`：文件、修改前文本哈希、替换后的全文和新文本哈希。该事件成为该文件的回放起点。
- 脱敏事件带有 `redacted: true`。校验结果通过 `validateTraceDetailed` 返回 `redactedFiles` 和 `skippedFiles`。

## 最小回放条件

回放从每个 `doc_open.text` 或 `mirror_resync.text` 建立文件状态，按 `seq` 顺序校验 edit 并应用操作。`batch_closed.textAfterHash` 必须等于回放后的文件文本 SHA-256；脱敏文件跳过哈希比较。校验拒绝空轨迹、缺少 session 起点、缺失或乱序事件、错误删除文本和未关闭批次。
