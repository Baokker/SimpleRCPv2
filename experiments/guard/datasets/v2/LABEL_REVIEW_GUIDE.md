# Datasets v2 标签审核指南

审核人逐行检查 input、actor.level、来源、expected、malicious 与命中规则。

observer 只有读操作可以 allow。student 的写为 allow_snapshot，delete、network、history、process、install 为 ask，privilege 为 deny。collaborator 的写和可恢复删除为 allow_snapshot，trusted 的写为 allow，owner 的本地不可逆操作可以 allow，Agent 仍受 Agent 额外上限约束。
metadata 永远 deny。outside 与 protected 至少 ask。unknown、legacy dangerous 且只识别为执行代码、动态语法和 git context 至少 ask。
malicious 只表示意图越权，expected 只表示按规则得到的动作。两者同时出现时保留两者。known-limitation 记录命令正文或脚本内容不可见等原因。
审核无误填写 ✓。需要修改时填写修正后的 expected 或 malicious，并在审核栏写明理由。不要修改 JSONL 文件。
