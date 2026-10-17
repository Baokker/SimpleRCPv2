# E6 复盘质量（K2）

## 研究问题与正式输入

比较普通草稿、服务端复盘、Agent 自我复盘的结构合法率、原始引用可解析率、标识符覆盖率、自动检查保留率及人工质量。

冻结标签 `knowledge-exp-freeze-v2.1`，平台提交 `418a4ccc758de803efc5427bea0b0cd09cc26dc5`，数据提交 `ea11a85ed344c522fe3b63288cd8577c94fa6498`。manifest 哈希 `3e536a77fb0724316e10fee1bf9d0d409f88caf57b13e0a7a189c9a339950137`，配置哈希 `1251aac44831146db92c9adb574fedb933cfcc2928164e6ec8f5ded51540d0ef`。全部生成路径使用 `minimax / MiniMax-M3`。

正式输入包括 E5 核心矩阵中 Ta 实际踩坑的全部纠正 episode，以及 S01/S02 的52个脚本知识时刻。每个 episode 生成三种草稿；实际数量依据 E5 完成结果记录。服务端保存完整证据用于引用和自动检查，模型请求按修改函数附近截取，每份文件前后代码合计800字符。

```sh
pnpm --filter @simplercp/experiments exec tsx formal-run.ts E6 E6
```

正式目录为 `experiments/knowledge/runs/E6-k2-formal-v21-m3/`。失败或兜底结果单独统计失败率，排除于内容质量与评分表。自动指标使用原始模型响应，人工规则语义由两名标注者独立评分，未填写时不报告均分或 Cohen's κ。

## 冻结前真实验收

服务端单次复盘120秒，首次失败后最多重试两次，间隔5秒。配置项为 `KNOWLEDGE_RECAP_TIMEOUT_MS`。对同一真实 InventoryStore.transaction episode 连续请求三次：

```sh
pnpm --filter @simplercp/experiments exec tsx verify-recap-v21.ts E6-recap-acceptance-v21-m3-final
```

| 次数 | 结构合法 | 引用可解析数 | 兜底 | InventoryStore.transaction 覆盖 | 耗时 |
|---|---|---:|---|---|---:|
| 1 | 是 | 9 | 否 | 是 | 8.633秒 |
| 2 | 是 | 11 | 否 | 是 | 15.162秒 |
| 3 | 是 | 9 | 否 | 是 | 7.774秒 |

原始结果在 `experiments/knowledge/runs/E6-recap-acceptance-v21-m3-final/results.jsonl`，模型文字在对应 raw 响应中。完整证据33462字符、请求证据13568字符。这三次验收与正式样本分别保存。

P03 的三条路径验收均返回合法、引用可解析的草稿；服务端和自我复盘的两个检查均通过版本验证。三份文字没有覆盖完整指定对象 NotificationOutbox.logicalId，类型均未满足预定 constraint，因此不能据此宣称内容质量合格。记录见 `preparation-v21.md`。

## 历史试跑

v2/M2 的三次复盘请求在30秒超时处中止。记录分别为 `runs/E6-k2-current-pilot/failure.json`、`runs/E6-k2-current-pilot-v2/failure.json`、`runs/E6-k2-minimax-m2/failure.json`，这些失败没有计入正式质量。

阶段7B 的标识符覆盖6/9、自动检查保留4/8属于历史模型与数据版本。正式 M3 表使用本次冻结版本的独立结果。两份评分表字段为规则正确性、可检查性、适用范围、边界合理性和备注。
