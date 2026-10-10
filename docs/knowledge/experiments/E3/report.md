# E3 检索（K5）

## 查询来源诊断

诊断保存于 `experiments/knowledge/runs/E3-query-diagnosis-v21-m3/diagnosis.json`。16 个陷阱分别使用功能首段、完整任务提示，以及提示中实际存在的路径、目标卡片文件，合计 192 组确定性查询。这里没有模型调用。

| 查询内容 | 活动文件 | 条件 | Recall@1 | Recall@5 | 陷阱数 |
|---|---|---|---:|---:|---:|
| 功能首段 | 提示中实际路径 | R1 | 1/16 | 12/16 | 16 |
| 功能首段 | 提示中实际路径 | R2 | 1/16 | 12/16 | 16 |
| 功能首段 | 提示中实际路径 | R3 | 3/16 | 12/16 | 16 |
| 功能首段 | 目标卡片文件 | R2 | 0/16 | 0/16 | 16 |
| 功能首段 | 目标卡片文件 | R3 | 12/16 | 15/16 | 16 |
| 完整提示 | 提示中实际路径 | R1 | 0/16 | 0/16 | 16 |
| 完整提示 | 提示中实际路径 | R2 | 0/16 | 0/16 | 16 |
| 完整提示 | 提示中实际路径 | R3 | 1/16 | 5/16 | 16 |
| 完整提示 | 目标卡片文件 | R2 | 0/16 | 0/16 | 16 |
| 完整提示 | 目标卡片文件 | R3 | 6/16 | 16/16 | 16 |

legacy 词法分上限为 1.2。完整提示包含大量接口、字段与路径，无关卡片也达到上限。同分按卡片编号排序，目标编号排在无关编号之后。legacy 的活动文件加分在上限前加入，达到上限后失去区分作用。R1 与 R2 的完整提示结果均为零，因此对照任务分母和活动文件为空只能解释部分现象。bounded 在词法分之后加入活动文件信息，目标文件上下文能够改善排名。正式查询使用产品同一函数推导实际存在的文件，保留完整提示；诊断中的目标文件仅用于解释来源差异。检索权重与上限保持冻结前的产品设置。

正式统计将16个陷阱和6个对照分别计算；对照的 Recall、MRR、nDCG 为空，只累计误注入数量。每条记录保存显式上下文、发起人成员当前文件、提示中实际路径或为空的来源。

## v2 试跑

下列数据来自 `E3-k5-final-v2`，对应旧的14任务查询集；正式结果使用 v2.1 的独立目录。

## 研究问题

比较纯词法、legacy 和 bounded 三种排序，并检查错误活动文件对结果的影响；同时验证线上注入与离线重放的一致性。

## 运行

```sh
pnpm --filter @simplercp/experiments experiment k5 \
  --config experiments/knowledge/.work/e4-config.json \
  --source experiments/knowledge/runs/E4-C2-pilot \
  --out experiments/knowledge/runs/E3-k5-final-v2
experiments/knowledge/analysis/.venv/bin/python \
  experiments/knowledge/analysis/analyze.py \
  experiments/knowledge/runs/E3-k5-final-v2/results.jsonl \
  --out experiments/knowledge/runs/E3-k5-final-v2/analysis/statistics
```

输入 70 条检索记录，线上 provider 与离线 `selectKnowledgeInjection` 的前五名全部一致；线上没有实际知识工具查询，R4 记录为无数据；R5 没有 embedding 配置。

## 结果

| 条件 | Recall@1 | Recall@3 | Recall@5 | MRR | nDCG@5 | 误注入数 | 查询数 |
|---|---:|---:|---:|---:|---:|---:|---:|
| R1 | 0.00 | 0.00 | 0.00 | 0.0362 | 0.0000 | 20 | 14 |
| R2 | 0.00 | 0.00 | 0.00 | 0.0362 | 0.0000 | 20 | 14 |
| R2-wrong-file | 0.00 | 0.00 | 0.00 | 0.0362 | 0.0000 | 20 | 14 |
| R3 | 0.10 | 0.10 | 0.30 | 0.1947 | 0.1861 | 20 | 14 |
| R3-wrong-file | 0.00 | 0.00 | 0.00 | 0.0657 | 0.0000 | 20 | 14 |

R3 的 bounded 排序在当前任务中排名更好。错误活动文件明显改变排序，线上保持活动文件与词法分的既有融合方式，并在 E4 中记录实际候选来源，避免把错误活动文件结果当作正常送达。

## 产物

`results.jsonl` 保存每条查询、活动文件来源、排名和误注入；`analysis/statistics/retrieval.md` 保存汇总表；`source.json` 保存 E4 输入结果哈希。
