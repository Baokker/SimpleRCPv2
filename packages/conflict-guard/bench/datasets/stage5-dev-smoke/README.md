# 阶段五冒烟开发数据

`dataset.json.gz` 包含 manifest、labels、excluded 与全部 schema 3 traces。版本为 `stage5-dev-smoke-v1`，种子为 20261007。它只使用 D1 开发集中的 billing、calendar 项目与 IC、CP、SF 算子。清单的 developmentOrigin 记录来源，保留项目与保留算子族使用数量均为零。

生成器申请 120 组后保留 105 组，151 个非 alias 样本通过四状态探针，每个状态运行三次，无剔除样本。灰区筛选得到 21 个不同关系组，真实冒烟选择其中 20 组。该补充数据用于连接与延迟验证，正式开发集主表使用原始 D1 的 18 个关系组、28 个去重样本。

```bash
pnpm --filter @simplercp/conflict-guard adjudication:prepare-dev --groups 120 --seed 20261007
pnpm --filter @simplercp/conflict-guard bench:label --dataset bench/datasets/stage5-dev-smoke --concurrency 8
pnpm --filter @simplercp/conflict-guard adjudication:smoke --dataset bench/datasets/stage5-dev-smoke --count 20
```

原始生成目录被忽略，归档与 SHA-256 记录在开发集报告的 provenance.json 中。归档是标准 gzip JSON；恢复时使用 JSON.parse 与 gunzipSync 读取，将 manifest、labels、excluded 写回同名 JSON，将 traces 对象按文件名写入 traces 目录。所有内容均为业务程序与探针结果。
