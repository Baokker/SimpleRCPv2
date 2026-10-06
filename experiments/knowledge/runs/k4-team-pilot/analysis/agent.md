| condition   | metric       |   mean | ci         |   tasks |
|:------------|:-------------|-------:|:-----------|--------:|
| T0          | recurrence   |    0.5 | [0.0, 1.0] |       2 |
| T0          | jointSuccess |    0.5 | [0.0, 1.0] |       2 |
| T0          | functional   |    0.5 | [0.0, 1.0] |       2 |
| T3          | recurrence   |    0.5 | [0.0, 1.0] |       2 |
| T3          | jointSuccess |    0.5 | [0.0, 1.0] |       2 |
| T3          | functional   |    0.5 | [0.0, 1.0] |       2 |

| metric       | condition_a   | condition_b   |   tasks |   left_only |   right_only |   mcnemar_p |   difference | difference_ci   |   tost_bound | tost_p   | tost_reason   |   holm_p |
|:-------------|:--------------|:--------------|--------:|------------:|-------------:|------------:|-------------:|:----------------|-------------:|:---------|:--------------|---------:|
| trapAvoided  | T0            | T3            |       2 |           0 |            0 |           1 |            0 | [0.0, 0.0]      |         0.05 |          | 样本数量或差值方差不足   |        1 |
| jointSuccess | T0            | T3            |       2 |           0 |            0 |           1 |            0 | [0.0, 0.0]      |         0.05 |          | 样本数量或差值方差不足   |        1 |