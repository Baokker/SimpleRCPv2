# 第三轮结果选择

正式统计使用 ROUND3_RUNS.json 中的明确路径。没有按照目录排序选择结果。

X2a 的 648 条正式记录来自 x2a-20261006034939，backup-script 的 72 条来自 x2a-20261006040056。完整合成 raw.jsonl 位于后一目录，tracePath 保留采集时的路径。两个目录的 trace 与审计一并保存。三个固定种子顺序重复均完成，240 个条件格子的主要指标没有顺序差异。

X2a 的早期兼容检查目录没有进入正式结果。其运行工作区含嵌套 Git 仓库，已通过本目录的 .gitignore 排除提交。X1、X3、X6 的中间运行同样在本机保留，.gitignore 排除相应中间目录。版本控制保留 ROUND3_RUNS.json 指定的正式结果及其引用的完整 trace。

X2b 正式目录 x2-20261006035453 包含两任务检查的 12 条以及续跑的 48 条。raw-source.jsonl 保留采集字段，raw.jsonl 经 finalize-round3.ts 从 trace、审计与探针重新派生。状态与尝试结局的派生依据写入 derivation.json。

MiniMax 兼容检查使用 x2-20261006034451；x2-20261006034906 的 12 条属于计步检查，不进入正式指标。X4 的第一条兼容检查输出使用 JSON 正文，其余 515 条使用 submit_judgment Function Call。两种输出均通过结构验证，模型和温度相同，报告明确这一调用方法差异。

所有新模型调用使用 MiniMax。DeepSeek 的 696 条是已有输出的离线重放，没有重新调用 DeepSeek API。
