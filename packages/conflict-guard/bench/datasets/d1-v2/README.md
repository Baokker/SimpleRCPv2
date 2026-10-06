# D1-v2

八个独立手写业务项目，种子 20261008，200 个关系组；开发集 75 组、保留集 125 组。283 个非 alias 样本完成标注，7 个剔除；开发集去重后评价 79 个样本。程序交集与站点交集均为零，跨项目文件 token 相似度最大 0.5994397759。

```bash
pnpm --filter @simplercp/conflict-guard data:artifacts --dataset bench/datasets/d1-v2 --restore
pnpm --filter @simplercp/conflict-guard bench:prepare --seeds bench/seeds/native --out bench/datasets/d1-v2 --groups 200 --seed 20261008 --concurrency 8
```

归档保存完整 manifest、每状态三次原始探针结果与轨迹，哈希见 archive-sha256.json。项目及算子来源、划分、标签规则和统计方法见 `docs/conflict-guard/benchmark.md`。保留集仅完成生成与标注。
