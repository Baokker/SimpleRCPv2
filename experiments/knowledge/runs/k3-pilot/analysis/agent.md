| condition   | metric       |   mean | ci          |   tasks |
|:------------|:-------------|-------:|:------------|--------:|
| C0          | recurrence   |   1    | [1.0, 1.0]  |      10 |
| C0          | jointSuccess |   0    | [0.0, 0.0]  |      10 |
| C0          | functional   |   0.6  | [0.3, 0.9]  |      10 |
| C2          | recurrence   |   1    | [1.0, 1.0]  |       4 |
| C2          | jointSuccess |   0    | [0.0, 0.0]  |       4 |
| C2          | functional   |   0.25 | [0.0, 0.75] |       4 |

| metric       | condition_a   | condition_b   |   tasks |   left_only |   right_only |   mcnemar_p |   difference | difference_ci   |   tost_bound | tost_p   | tost_reason   |   holm_p |
|:-------------|:--------------|:--------------|--------:|------------:|-------------:|------------:|-------------:|:----------------|-------------:|:---------|:--------------|---------:|
| trapAvoided  | C0            | C2            |       4 |           0 |            0 |           1 |            0 | [0.0, 0.0]      |         0.05 |          | 样本数量或差值方差不足   |        1 |
| jointSuccess | C0            | C2            |       4 |           0 |            0 |           1 |            0 | [0.0, 0.0]      |         0.05 |          | 样本数量或差值方差不足   |        1 |