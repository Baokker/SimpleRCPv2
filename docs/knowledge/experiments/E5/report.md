# E5 纠正迁移（K4）

## 研究问题

确认纠正卡片后，另一成员的 Agent 能否在后续任务中得到同一条团队知识，并减少重复陷阱。

## 条件与运行

当前试跑使用 P01、P03，各运行 T0 与 T3 delayed，各 1 次。T3 通过 `recap-from-episode` 直接记录纠正建议，结果包含 `captureBypassed: true` 与 `naturallyTriggered`。

```sh
pnpm --filter @simplercp/experiments experiment k4 \
  --config experiments/knowledge/.work/e4-config.json \
  --pilot --variants delayed \
  --out experiments/knowledge/runs/E5-k4-pilot-v2
```

## 结果

| 组合 | Ta 功能 | Ta 踩坑 | Tb 功能 | Tb 避开陷阱 | 目标卡片注入 | 自然触发 |
|---|---|---|---|---|---|---|
| P01-T0 | 通过 | 是 | 通过 | 是 | 否 | — |
| P01-T3 | 通过 | 是 | 通过 | 是 | 是（lexical） | 否 |
| P03-T0 | 失败 | 否 | 通过 | 否 | 否 | — |
| P03-T3 | 通过 | 是 | 通过 | 否 | 是（lexical） | 是 |

T3 的目标卡片均为团队作用域，迁移链路中的卡片确认、注入和 reuse 记录保存在原始目录。P03 的 Tb 即使收到卡片仍然复犯，说明送达和遵守需要分开统计。当前样本只有 4 个组合，不能报告统计检验。

## 路径修复记录

冻结数据使用 `correction.revision.referencePatch`，平台工具已支持该字段并在 `experiments/knowledge/k4.ts` 中检查路径类型。旧的四对读取限制已改为按目录加载 P01–P06。
