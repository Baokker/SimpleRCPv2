# E4 Agent 复犯与知识送达（K3）

## 研究问题

把知识送达和规则遵守分开记录，比较无知识、Oracle 目标卡片和无关卡片条件。

## 当前试跑

当前冻结快照运行 5 个组合（R1-T01、R1-T02、R2-T01、R2-T02、R1-C01），每个条件 1 次，共 15 次运行。命令：

```sh
pnpm --filter @simplercp/experiments experiment k3 \
  --config experiments/knowledge/.work/e4-config.json \
  --pilot --conditions C0,C5,C7 \
  --out experiments/knowledge/runs/E4-k3-pilot-current
```

## 结果

| 条件 | 运行数 | 功能通过 | 避开陷阱 | 联合成功 | 目标卡片送达 | 送达来源 |
|---|---:|---:|---:|---:|---:|---|
| C0 | 5 | 4 | 1 | 1 | 0/5 | — |
| C5 | 5 | 3 | 4 | 3 | 4/5 | lexical 2、fileRelated 2 |
| C7 | 5 | 5 | 1 | 1 | 0/5 | lexical 4（无关卡片） |

C5 的目标卡片送达率为 4/5；送达成功的四次中，陷阱避开 4 次。C0 与 C7 的联合成功各为 1/5。C5 的 Oracle 条件显示卡片送达后通常能够帮助 Agent 避开陷阱，但样本包含一个对照任务，不能把该数字当作陷阱任务成功率。

同一冻结提交的 C2 试跑包含 R1-T01、R1-T02、R2-T01、R2-T02 四个陷阱任务和 R1-C01 对照任务，目标卡片送达 2/4；R1 的两次活动文件为空，词法候选占满 top-5，项目级兜底没有替代目标卡片。结果在 `experiments/knowledge/runs/E4-k3-c2-current/results.jsonl`。此前的 E4-C2 目录保留了相同输入的旧提交记录。项目级团队规则的兜底回归测试已通过，该规则用于没有活动文件的通用约束，不会把 block 级目标卡片强行改成项目规则。

注入字符总量：C0 为 0，C5 为 2075，C7 为 2075。总 token（运行记录中的 `usage.totalTokens`）分别为 1,765,452、1,822,163、2,284,863。墙钟时间总量分别为 238,551 ms、235,725 ms、284,009 ms。

## 送达失败清单

C5 未送达的一次为 R1-T01；当前试跑没有出现项目级兜底命中，因为这五个任务的活动文件集合已提供文件相关候选。空活动文件的团队级 constraint 与 negative 兜底已经由注入器和回归测试覆盖，后续正式矩阵应单独报告 `project-fallback`。

## 统计边界

完整方案要求 22 个任务、每条件 3 次重复和 C0、C1、C2、C5、C7、C6a、C6b 七个条件。当前只完成 5 个组合的 C0、C5、C7 试跑，未执行 McNemar、混合效应 logistic 和 TOST；正式实验需要补齐任务、条件和重复后再计算。
