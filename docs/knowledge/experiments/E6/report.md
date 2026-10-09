# E6 复盘质量（K2）

## 研究问题

比较普通草稿、服务端复盘和 Agent 自我复盘的结构合法率、引用可解析率、标识符覆盖率和人工评分。

## 可复现输入

阶段 7B 已保存一组 MiniMax 复盘结果，目录为 `experiments/knowledge/runs/k2-review`。该目录使用旧 manifest 哈希，不能与 `knowledge-exp-freeze-v2` 的当前数据混合计算。当前冻结快照的 K4 试跑只包含 4 个组合。

## 当前执行状态

使用当前 E5 结果执行以下命令时，服务端在第一组 episode 的草稿请求中返回 `HTTP 400 {"error":"This operation was aborted"}`，因此没有把不完整结果写成正式质量指标：

```sh
pnpm --filter @simplercp/experiments experiment k2 \
  --config experiments/knowledge/.work/e4-config.json \
  --source experiments/knowledge/runs/E5-k4-pilot-v2 \
  --limit 4 --out experiments/knowledge/runs/E6-k2-current-pilot
```

错误证据保存在 `experiments/knowledge/runs/E6-k2-current-pilot/failure.json`。这次失败只影响 E6 的当前重跑，不改变 E1、E2、E3、E5 的结果。

在重新启动冻结配置的服务端后，以 `--limit 1` 重试，仍返回相同错误；证据保存在 `experiments/knowledge/runs/E6-k2-current-pilot-v2/failure.json`。这表明当前服务端的 drafts 模型请求通道需要单独排查，不能用旧快照数字替代当前结果。

随后显式设置 `MINIMAX_MODEL=MiniMax-M2`，确认本地模型代理的最小 JSON 请求能够返回 200，但同一 episode 的复盘请求仍在 30 秒复盘超时内被中止；第三次证据保存在 `experiments/knowledge/runs/E6-k2-minimax-m2/failure.json`。当前快照的复盘通道因此仍未产出合法草稿。

## 已有复盘质量参考

阶段 7B 的 K2 复核记录了标识符覆盖 6/9、自动检查保留 4/8。该数字只能作为旧快照的参考，正式论文表格需要在同一 manifest、同一提交和同一模型配置下重新生成。两名标注者的评分表格式已经由 `k2.ts` 创建，字段为规则正确性、可检查性、适用范围、边界合理性和备注。

## 待补工作

重新启动与冻结配置一致的 OpenCode 服务，确认 MiniMax 请求可用后续跑当前 E5 episode，再执行两份独立评分表和 Cohen's κ。当前没有把失败请求当作模型质量结论。
