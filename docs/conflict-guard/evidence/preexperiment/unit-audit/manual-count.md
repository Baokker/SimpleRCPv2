# 单轨迹变更单元核验

数据为 D1-v2 开发样本 `d1-0011-safe`。查看完整双方修改、输入 edit/cursor 时序和 `raw.json` 中的逐批次事件，实际有五个产生符号变化的关闭批次：

| 批次 | 时间 ms | 修改方 | 符号 |
|---|---:|---|---|
| guard-1 | 3439 | origin | src/weights.ts#memoryBudget |
| guard-2 | 7473 | candidate | src/lru.ts#cacheHeadroom |
| guard-3 | 8441 | origin | src/weights.ts#memoryBudget |
| guard-5 | 20977 | origin | src/weights.ts#memoryBudget |
| guard-6 | 25874 | origin | src/weights.ts#memoryBudget |

另一个关闭批次没有产生符号变化，保持在增量索引耗时的六次观察中。双方修改的声明之间没有生成候选对，因此五个单元全部属于无关系，手工计数为 5/5。`raw.json` 的 total=5、unrelated=5、candidatePairs=0，与 `repaired-d1-v2/results.json.gz` 中对应 outcome.changeUnits 一致。

```sh
pnpm --filter @simplercp/conflict-guard index:run --dataset bench/datasets/d1-v2 \
  --split dev --samples d1-0011-safe --k 2 \
  --out ../../docs/conflict-guard/evidence/preexperiment/unit-audit
```

完整 D1-v2 开发集共有 320 个语义变更单元，其中 61 个没有形成候选对。比例分子和分母由逐批次记录累计；多个变更单元可以属于同一程序样本。
