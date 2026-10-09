# E1 捕获（K1）

## 研究问题

离线回放能否从两段协作脚本发现标注的知识时刻，并给出相关锚点。

## 条件与样本

输入为冻结数据仓库的 `S01`、`S02`。每段脚本有 26 个标注知识时刻，共 52 个标注时刻。运行命令：

```sh
pnpm --filter @simplercp/experiments experiment k1 \
  --config experiments/knowledge/.work/e4-config.json \
  --out experiments/knowledge/runs/E1-k1-final
```

结果文件：`experiments/knowledge/runs/E1-k1-final/results.jsonl`。

## 结果

| 指标 | S01 | S02 | 合计或均值 |
|---|---:|---:|---:|
| 标注知识时刻 | 26 | 26 | 52 |
| 预测建议 | 32 | 32 | 64 |
| 真阳性 | 26 | 26 | 52 |
| 召回率 | 1.00 | 1.00 | 1.00 |
| 精确率 | 0.8125 | 0.8125 | 0.8125 |
| 发现延迟 | 由脚本事件记录 | 由脚本事件记录 | 见原始结果 |
| 锚点 Top-1 | 0.0385 | 0.2692 | 0.1538 |
| 锚点 Top-3 | 0.9231 | 0.8462 | 0.8846 |

按触发类型，两段脚本的召回率均为 1.00。`chat.dense` 精确率为 0.50，`magicNumber.added` 精确率为 0.3333；`todo.cleared`、`dependency.changed`、`agent.toolRecovered`、`rollback.detected`、`edit.overwritten`、`agent.interrupted`、`agent.revised`、`agent.corrected`、`agent.retried` 的精确率为 1.00。输入是半合成脚本，结果不代表真人协作中的精确率。

## 文件与限制

`results.jsonl` 保留逐段结果、触发类型混淆、延迟数组和锚点候选。共现锚点的 Top-3 明显高于 Top-1，说明候选排序适合交给后续复核。真人 pilot 需要单独录制并按同一字段分析。
