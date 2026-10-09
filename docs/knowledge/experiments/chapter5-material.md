# 第五章实验材料事实表

以下条目只记录当前结果和出处，不写成论文段落。

## 知识捕获

- 两段脚本各标注 26 个知识时刻，离线召回率均为 1.00，出处：`experiments/E1/report.md`、`runs/E1-k1-final/results.jsonl`。
- 总体预测 64 条、真阳性 52 条，精确率 0.8125；`chat.dense` 精确率 0.50，`magicNumber.added` 精确率 0.3333，出处同上。
- 共现锚点 Top-3 均值 0.8846，Top-1 均值 0.1538，出处同上。

## 并发锚点

- yjs-relative 精确存活率 79.42%，yjs-multi 83.42%，multi-strategy 62.08%，出处：`experiments/E2/report.md`、`runs/E2-k7-final/analysis/statistics/anchors.md`。
- yjs-relative 边界容忍存活率 79.75%，yjs-multi 83.58%，出处同上。
- 删除操作统一请求人工复核；三人随机编辑下组合策略复核较多，出处同上。

## 检索和送达

- E3 的 R3 Recall@5 为 0.30、MRR 为 0.1947，错误活动文件时 Recall@5 为 0，出处：`experiments/E3/report.md`。
- E3 的线上前五名和离线重放全部一致，出处：`runs/E3-k5-final-v2/results.jsonl`。
- E4 C2 试跑目标卡片送达 2/4；R1 的任务因活动文件为空而漏送达，项目级团队约束兜底已加入注入器，出处：`docs/knowledge/agent-injection.md`、`runs/E4-C2-pilot/results.jsonl`。

## Agent 复犯和纠正迁移

- 当前 E4 只完成 C2 送达试跑，C0、C5、C7 的当前快照结果见 `runs/E4-k3-pilot-current`；完整条件矩阵未完成。
- E5 当前试跑有 4 个组合。T3 两次均注入目标卡片；P01 的 Tb 避开陷阱，P03 的 Tb 仍然复犯，出处：`experiments/E5/report.md`。
- 迁移卡片为团队作用域，记录 `captureBypassed`、`naturallyTriggered` 和 reuse 链路，出处：`runs/E5-k4-pilot-v2/results.jsonl`。

## 复盘质量

- 旧快照参考：标识符覆盖 6/9，自动检查保留 4/8，出处：`experiments/E6/report.md`及阶段 7B 复核记录。
- 当前快照 K2 重跑因服务端请求被中止，结果不能作为正式质量数字，出处：`runs/E6-k2-current-pilot/failure.json`。

## 局限

- 任务规模是 10 个陷阱、4 个对照，低于方案目标 16 与 6。
- E4 完整条件、E6 当前复盘、E5 其余条件和重复次数未完成。
- 数据来自半合成脚本和构造任务，真人 pilot 需要独立报告。
- provider 的费用估算依赖 token；DeepSeek cost 为零时只写 token 对比。
