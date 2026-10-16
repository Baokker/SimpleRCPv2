# knowledge-exp-freeze-v3.1

## 版本与数据

| 项目 | 固定值 |
|---|---|
| 冻结标签 | `knowledge-exp-freeze-v3.1` |
| 实现提交 | `95bf21a3379487f647edb2b3ebb2f79b200f9383` |
| 数据提交 | `ea11a85ed344c522fe3b63288cd8577c94fa6498` |
| manifest SHA-256 | `3e536a77fb0724316e10fee1bf9d0d409f88caf57b13e0a7a189c9a339950137` |
| 解析后的配置 SHA-256 | `1251aac44831146db92c9adb574fedb933cfcc2928164e6ec8f5ded51540d0ef` |
| Agent 与知识模型 | `minimax / MiniMax-M3` |
| Node / pnpm | `v24.7.0 / 9.0.0` |
| OpenCode | `1.18.31`，真实服务状态为 ready |
| 记录时间 | `2026-10-16T16:11:16.523Z` |

标签指向包含实现提交与本记录的提交。使用 `git rev-parse knowledge-exp-freeze-v3.1` 取得完整冻结提交；正式结果的 commit 必须等于该值。全部配置文件、提示词文件、依赖文件的哈希与服务状态见 [environment.json](freeze-v31-checks/environment.json)。数据工作区没有修改。

## 运行协议

实验三为22个任务、C0/C2/C5、三次重复，共198次。实验四为6对任务、每对三次，共18次 Ta 和36次 Tb。并发上限2，单次 Agent 等待600000毫秒，种子20261007。配置为 `experiments/knowledge/formal-v3.json`。

C2 使用 BM25 候选与 M3 重排，重排失败直接采用 BM25，不重试。top-5、单卡800字符、合计4000字符；空活动文件时保留项目级规则补充。trace 保留送达来源、rankingSource 与失败原因，模型调用日志保留用量和估算费用。

实验四保持捕获服务开启，Ta 结束后保存行为判定。纠正文件的原版本由服务端保存，Yjs 修改后再次核验。纠正成员依据 correction.json，甲生成并确认草稿，团队升级经过确认接口。T0、T3 使用独立工作区和会话，由乙执行 Tb；导入映射属主、作者与确认人，保留原确认时间。两个条件共用相同 Ta runId，统计以片段为单位，另列 Ta 实际踩坑子集。

额度或请求速率限制会停止新任务并取消当前 Agent，保留中断记录；恢复时跳过已完成组合，中断任务使用新项目。已完成 Ta 不重复运行。原 `knowledge-exp-freeze-v3` 标签与43条部分结果保留在 `runs/exp3-freeze-v3/`，本轮使用独立目录，不合并到正式样本。

## 冻结前验证

| 检查 | 结果 | 证据 |
|---|---|---|
| 数据 validate.mjs | 34个任务、124份参考补丁通过，逐份包含行为判定 | [data-validation.jsonl](freeze-v31-checks/data-validation.jsonl) |
| pnpm build | 通过 | [build.log](freeze-v31-checks/build.log) |
| pnpm test | server 164、knowledge 162、Demo 2通过 | [test.log](freeze-v31-checks/test.log) |
| 实验工具构建与测试 | 构建通过，22项测试通过 | [tools-test.log](freeze-v31-checks/tools-test.log) |
| 统计测试 | 5项通过；历史结果与共享片段均能完成分析 | `analysis/test_analyze.py` |
| M3 额度检查 | 最小真实请求成功 | `.work/preflight-v31/quota-check.json` |
| 真实端到端验收 | P01、P03各一个片段，共2次Ta、4次Tb；2份草稿结构与引用合法；T3均收到卡片 | [preflight-statistics.json](freeze-v31-checks/preflight-statistics.json) |
| 真实取消检查 | 两个实际任务均终止，调度停止并保留中断记录 | [cancel-check.json](freeze-v31-checks/cancel-check.json) |

验收数据位于 `.work/preflight-v31/`，不进入正式样本。P01 的 T3 避开陷阱，P03 的 T3 收到卡片后仍复犯，保留其完整记录。费用为标准 token 价格估算，供应商账单另计。

## 执行与保存

```sh
pnpm --filter @simplercp/experiments exec tsx formal-run.ts EXP3 EXP3
pnpm --filter @simplercp/experiments exec tsx formal-run.ts EXP4 EXP4
```

结果分别保存到 `runs/exp3-freeze-v31/`、`runs/exp4-freeze-v31/`。入口核验当前提交等于标签，完成后检查样本量、重复 key、模型与提交，再生成统计和检查记录。先检查实验三汇总，再执行实验四。

冻结后不修改代码、数据、提示词、阈值、判定器与配置。需要修改时停止运行，记录影响范围，由用户决定新的冻结版本。实验一和实验二使用已有数据，不新增模型请求。
