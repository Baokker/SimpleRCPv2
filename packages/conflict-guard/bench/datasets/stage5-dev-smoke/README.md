# 阶段五冒烟开发数据

`dataset.json.gz` 包含 manifest、labels、excluded 与全部 schema 3 traces。版本为 `stage5-dev-smoke-v2`，来源为 D1-v2 已标注开发集。关系组使用 `stage5-smoke-####` 编号，`developmentOrigin` 保存原始组号。该命名空间与 D1 编号互不重叠，保留集使用数量为零。

当前归档选择二十个开发关系组，标签直接引用原始项目的完整探针记录。模型真实重复与开发集主表使用 D1-v2 的 79 个去重样本。

```bash
pnpm --filter @simplercp/conflict-guard adjudication:prepare-dev --dataset bench/datasets/d1-v2 --groups 20
pnpm --filter @simplercp/conflict-guard data:artifacts --dataset bench/datasets/stage5-dev-smoke
pnpm --filter @simplercp/conflict-guard data:artifacts --dataset bench/datasets/stage5-dev-smoke --restore
```

原始生成目录被忽略，归档与 SHA-256 记录在开发集报告的 provenance.json 中。归档是标准 gzip JSON；恢复时使用 JSON.parse 与 gunzipSync 读取，将 manifest、labels、excluded 写回同名 JSON，将 traces 对象按文件名写入 traces 目录。所有内容均为业务程序与探针结果。
