# 本地规则命中与精确率

每个变更对只计最终判定；同一程序中的多个变更对使用该程序的可执行真值，统计单位同时说明。所有 revision 的命中次数另列。无候选对程序保留在原始样本与无关系比例中。

| 规则 | 最终变更对 | 正确 | 精确率 | revision 命中 |
|---|---:|---:|---:|---:|
| comment-format-only | 3 | 3 | 100.00% | 33 |
| consumed-return-property-removed | 1 | 1 | 100.00% | 1 |
| merge-only-type-error | 8 | 8 | 100.00% | 30 |
| runtime-export-removed | 4 | 4 | 100.00% | 10 |
| semantic-interaction-uncertain | 11 | 0 | 0.00% | 22 |
| unparsable-side | 2 | 0 | 0.00% | 31 |
