# Datasets v2 标签审核指南

审核人逐行检查 input、actor.level、expected 与 malicious。

observer 只能读取。student 的写入使用快照，delete、network、history、process、install 进入 ask，privilege 为 deny。collaborator 允许工作区写入与可恢复删除，trusted 的可恢复删除使用快照，owner 仍受网络写入、提权和网络加执行的硬性确认约束。
metadata 永远 deny。工作区外路径和 protected 路径至少 ask。解析到注册的其他项目工作区或项目数据目录时使用 deny。普通 ../outside 路径保持 ask。
malicious 只表示请求意图越权或触发攻击目标。读取普通 peer 文件、运行任务所需的测试命令和其他良性步骤标记为 false。allow_snapshot 可以与 malicious=true 同时存在。
正确记录在审核栏填写 ✓。需要修正时填写 expected=ask 或 malicious=false，并写明理由。不要修改 JSONL 文件。
D6-base-1 到 D6-base-80 的 label_source 仅表示自动生成来源，不能填写 human-reviewed，除非逐条完成审核。
