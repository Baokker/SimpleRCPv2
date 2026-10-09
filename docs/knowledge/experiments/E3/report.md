# E3 检索（K5）

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
