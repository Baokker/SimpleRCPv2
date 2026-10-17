# E2 并发锚点（K7）

## 正式输入与复现

冻结标签 `knowledge-exp-freeze-v2.1`，平台提交 `418a4ccc758de803efc5427bea0b0cd09cc26dc5`。manifest 哈希 `3e536a77fb0724316e10fee1bf9d0d409f88caf57b13e0a7a189c9a339950137`，配置哈希 `1251aac44831146db92c9adb574fedb933cfcc2928164e6ec8f5ded51540d0ef`。离线评价没有模型请求。

```sh
pnpm --filter @simplercp/experiments experiment k7 \
  --config experiments/knowledge/formal-v21.json \
  --out experiments/knowledge/runs/E2-k7-formal-v21-m3
```

48个锚点、6类操作、5个种子，共1440条轨迹，每条评价5种策略，合计7200次评价。主要存活指标使用1200条可定位轨迹；240条删除轨迹单独评价复核。正式结果的真值与全部策略结果逐条同 `E2-k7-final` 比较，差异为0。

## 正式结果

| 策略 | 精确存活 / 1200 | 精确存活率（95% CI） | 边界容忍存活率 | 错误迁移率 | 复核请求率 |
|---|---:|---|---:|---:|---:|
| range-only | 0 | 0% [0%, 0%] | 0% | 100% | 0% |
| snapshot-only | 480 | 40% [40%, 40%] | 40% | 0% | 60% |
| multi-strategy | 745 | 62.08% [61.33%, 62.92%] | 67.92% | 32.17% | 5.75% |
| yjs-relative | 953 | 79.42% [79.00%, 79.75%] | 79.75% | 20.08% | 0.50% |
| yjs-multi | 1001 | 83.42% [82.33%, 84.50%] | 83.58% | 0.25% | 16.33% |

CI 使用既有 `bootstrap_tasks`，以48个锚点为重采样单位，每个锚点汇总25条可定位轨迹，10000次重采样、种子20261007。yjs-multi 相对 multi-strategy 增加21.33个百分点，配对重采样95% CI 为[19.92, 22.75]个百分点。CI 表示这个构造锚点集合中的差异；没有进行总体显著性检验。

| 操作（每类240条） | range-only | snapshot-only | multi-strategy | yjs-relative | yjs-multi |
|---|---:|---:|---:|---:|---:|
| insert-around | 0% | 100% | 100% | 100% | 100% |
| duplicate-before | 0% | 0% | 0% | 100% | 100% |
| interleaved | 0% | 0% | 100% | 99.17% | 97.50% |
| move-and-edit | 0% | 100% | 100% | 0% | 100% |
| three-members | 0% | 0% | 10.42% | 97.92% | 19.58% |
| delete | 不计存活，错误100% | 复核100% | 复核100% | 复核100% | 复核100% |

边界容忍要求起点精确、终点行号误差不超过一行，正文以精确指标为主。移动类需要快照补充：相对位置策略有234/240条错误迁移、6/240条请求复核，组合策略240/240条精确定位。

三人随机编辑下，yjs-multi 请求复核192/240条；这些相同轨迹中，yjs-relative 可以精确定位188条、错误定位4条。组合策略降低错误迁移，同时增加复核要求；不能把全部复核都解释成阻止了错误。该类组合策略还有47条精确、1条错误。完整操作矩阵保留正确、错误与复核的分别计数。

## 产物与限制

`experiments/knowledge/runs/E2-k7-formal-v21-m3/results.jsonl` 为正式结果，`analysis/statistics/anchors.md`、`anchors.csv`、`anchors.png` 为分类表与图。全部1440条轨迹完成，没有失败或待查数字。固定文本样本和构造并发操作不能代表真实项目的全部编辑分布。
