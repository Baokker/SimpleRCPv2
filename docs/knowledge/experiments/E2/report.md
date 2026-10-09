# E2 并发锚点（K7）

## 研究问题

在 48 个锚点、6 类并发操作和 5 个随机种子下，比较五种锚点策略的存活、错误迁移和人工复核请求。

## 运行

```sh
pnpm --filter @simplercp/experiments experiment k7 \
  --config experiments/knowledge/.work/e4-config.json \
  --out experiments/knowledge/runs/E2-k7-final
experiments/knowledge/analysis/.venv/bin/python \
  experiments/knowledge/analysis/analyze.py \
  experiments/knowledge/runs/E2-k7-final/results.jsonl \
  --out experiments/knowledge/runs/E2-k7-final/analysis/statistics
```

共有 1440 条轨迹，7200 次策略评价。删除操作的 240 条轨迹统一请求人工复核，主要指标按其余 1200 条可定位轨迹计算。

## 主要结果

| 策略 | 精确存活率 | 边界容忍存活率 |
|---|---:|---:|
| range-only | 0.00% | 0.00% |
| snapshot-only | 40.00% | 40.00% |
| multi-strategy | 62.08% | 67.92% |
| yjs-relative | 79.42% | 79.75% |
| yjs-multi | 83.42% | 83.58% |

边界容忍指标要求起点正确且终点行号误差不超过一行。`yjs-relative` 在移动类操作中经常请求复核；`yjs-multi` 在三人随机编辑中复核比例较高。移动类操作仍需要快照策略补位，三人随机编辑中的人工复核保护了不确定结果。

## 结果文件

`results.jsonl` 保存 1440 条轨迹；`analysis/statistics/anchors.md` 与 `anchors.csv` 保存按操作类型分组的结果，`anchors.png` 为图形输出。删除操作不把错误位置当作存活，避免夸大策略效果。
