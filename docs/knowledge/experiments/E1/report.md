# E1 捕获（K1）

## 正式输入与复现

冻结标签 `knowledge-exp-freeze-v2.1`，平台提交 `418a4ccc758de803efc5427bea0b0cd09cc26dc5`，数据提交 `ea11a85ed344c522fe3b63288cd8577c94fa6498`。manifest 哈希 `3e536a77fb0724316e10fee1bf9d0d409f88caf57b13e0a7a189c9a339950137`，配置哈希 `1251aac44831146db92c9adb574fedb933cfcc2928164e6ec8f5ded51540d0ef`。

研究问题为两段协作脚本的知识时刻捕获与锚点推断。离线回放没有模型请求；结果中的 M3 表示统一实验配置。

```sh
pnpm --filter @simplercp/experiments experiment k1 \
  --config experiments/knowledge/formal-v21.json \
  --out experiments/knowledge/runs/E1-k1-formal-v21-m3
```

正式结果保存于 `experiments/knowledge/runs/E1-k1-formal-v21-m3/results.jsonl`。两段脚本共52个标注知识时刻和20个干扰窗口。

## 正式结果

| 指标 | S01 | S02 | 合计或均值 |
|---|---:|---:|---:|
| 标注知识时刻 | 26 | 26 | 52 |
| 预测建议 | 32 | 32 | 64 |
| 真阳性 | 26 | 26 | 52 |
| 精确率 | 81.25% | 81.25% | 81.25% |
| 召回率 | 100% | 100% | 100% |
| F1 | 89.66% | 89.66% | 89.66% |
| 共现锚点 Top-1 | 1/26 | 7/26 | 8/52（15.38%） |
| 共现锚点 Top-3 | 24/26 | 22/26 | 46/52（88.46%） |
| 标注干扰窗口未触发 | 10/10 | 10/10 | 20/20 |

| 触发类型 | TP / FP / FN | 精确率 | 召回率 | F1 | 发现延迟 |
|---|---|---:|---:|---:|---|
| chat.dense | 4 / 4 / 0 | 50% | 100% | 66.67% | 每次60秒 |
| magicNumber.added | 4 / 8 / 0 | 33.33% | 100% | 50% | 每次0秒 |
| dependency.changed | 8 / 0 / 0 | 100% | 100% | 100% | 每次0秒 |
| agent.toolRecovered | 8 / 0 / 0 | 100% | 100% | 100% | 每次0秒 |
| todo.cleared、rollback.detected、edit.overwritten、agent.interrupted、agent.revised、agent.corrected、agent.retried（每类） | 4 / 0 / 0 | 100% | 100% | 100% | 每次0秒 |

52个真阳性的平均发现延迟4.615秒，中位数0秒。时间来自脚本虚拟时钟；零延迟表示触发事件与标注窗口结束时刻一致。12条假阳性位于正例窗口之外；20个指定干扰窗口未触发，这两个口径分别报告。

## 结论范围与异常

正式结果与 v2 试跑相同。这里只有两段半合成脚本，不报告总体置信区间或统计检验；精确率、召回率与 F1 描述这52个标注时刻。共现排序的 Top-3 高于 Top-1，人工确认仍需要查看多个候选。真人协作的捕获表现需要独立 pilot 数据。

两段脚本均完成，没有超时或判定错误。逐类型延迟、干扰窗口和锚点结果保存在原始结果中；运行命令与完成检查保存在 `command.json`、`checkpoint.json`。旧试跑结果仍位于 `runs/E1-k1-final/`，分别保存。
