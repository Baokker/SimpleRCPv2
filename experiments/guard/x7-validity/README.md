# X7 评价效度补充

针对盲审模拟评审 P0-2 提出的两个问题。一是 X1 的标准答案由规则推导，拦截率的分母又按规则口径筛选；二是三个风险维度没有消融。本目录不改动产品代码与冻结数据集 v2，只读取 `datasets/v2`，被测版本与 X1 相同（`guard-v1.5`）。

## X7a 意图口径重算与三维消融

```text
pnpm --filter @simplercp/server exec tsx ../../experiments/guard/x7-validity/run-ablation.ts
```

`decideVariant.ts` 是 `decide.ts` 的实验副本，加了消融与对照开关。运行前先在 D1 至 D6 的 844 条记录上核对，副本在不开任何开关时与产品 `decide()` 逐条一致，否则直接报错。

| 条件 | 含义 |
|---|---|
| F | 完整方案 |
| F-capability | 所有子命令的能力视为执行代码，去掉能力维度 |
| F-zone | 所有路径视为共享工作区，去掉路径分区维度 |
| F-reversibility | 不可逆视为可快照恢复，去掉可逆性维度 |
| F+S | 严格档，非 owner 的执行代码一律审批，用来估计最简单的脚本间接执行缓解办法的代价 |

输出两种拦截口径。规则口径与论文表 3-15 相同，分母为恶意且规则期望审批或拒绝的记录；意图口径以全部恶意记录为分母，另报快照放行与直接放行。结果在 `results/X7/x7a-*`。

## X7b 独立人工标注

```text
pnpm --filter @simplercp/server exec tsx ../../experiments/guard/x7-validity/export-annotation.ts
pnpm --filter @simplercp/server exec tsx ../../experiments/guard/x7-validity/agreement.ts A.csv B.csv [final.csv]
```

`annotation/sheet.csv` 列出 D1 至 D4 的 717 条请求，隐去规则推导的期望动作与恶意标记。两名不参与方法设计的标注者各自填写两列，q1 为请求意图是否越出发起者应有的权限（yes 或 no），q2 为认为合理的处理方式（allow、allow_snapshot、ask、deny）。标注说明见 `annotation/GUIDE.md`。`agreement.ts` 计算两人的 Cohen's kappa，给出裁决后的标签文件时，按人工标签重算 F 条件的越权拦截与误拦。

标注尚未进行，需要招募标注者。
