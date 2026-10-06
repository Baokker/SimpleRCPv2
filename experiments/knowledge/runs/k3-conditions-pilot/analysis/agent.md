| condition   | metric       |   mean | ci          |   tasks |
|:------------|:-------------|-------:|:------------|--------:|
| C3          | recurrence   |   1    | [1.0, 1.0]  |       4 |
| C3          | jointSuccess |   0    | [0.0, 0.0]  |       4 |
| C3          | functional   |   0.25 | [0.0, 0.75] |       4 |
| C5          | recurrence   |   0.25 | [0.0, 0.75] |       4 |
| C5          | jointSuccess |   0.75 | [0.25, 1.0] |       4 |
| C5          | functional   |   1    | [1.0, 1.0]  |       4 |
| C7          | recurrence   |   1    | [1.0, 1.0]  |       4 |
| C7          | jointSuccess |   0    | [0.0, 0.0]  |       4 |
| C7          | functional   |   0.5  | [0.0, 1.0]  |       4 |

| metric       | condition_a   | condition_b   |   tasks |   left_only |   right_only |   mcnemar_p |   difference | difference_ci   |   tost_bound |     tost_p | tost_reason   |   holm_p |   tost_holm_p |
|:-------------|:--------------|:--------------|--------:|------------:|-------------:|------------:|-------------:|:----------------|-------------:|-----------:|:--------------|---------:|--------------:|
| trapAvoided  | C3            | C5            |       4 |           0 |            3 |        0.25 |         0.75 | [0.25, 1.0]     |         0.05 |   0.966074 | nan           |        1 |             1 |
| trapAvoided  | C3            | C7            |       4 |           0 |            0 |        1    |         0    | [0.0, 0.0]      |         0.05 | nan        | 样本数量或差值方差不足   |        1 |           nan |
| trapAvoided  | C5            | C7            |       4 |           3 |            0 |        0.25 |        -0.75 | [-1.0, -0.25]   |         0.05 |   0.966074 | nan           |        1 |             1 |
| jointSuccess | C3            | C5            |       4 |           0 |            3 |        0.25 |         0.75 | [0.25, 1.0]     |         0.05 |   0.966074 | nan           |        1 |             1 |
| jointSuccess | C3            | C7            |       4 |           0 |            0 |        1    |         0    | [0.0, 0.0]      |         0.05 | nan        | 样本数量或差值方差不足   |        1 |           nan |
| jointSuccess | C5            | C7            |       4 |           3 |            0 |        0.25 |        -0.75 | [-1.0, -0.25]   |         0.05 |   0.966074 | nan           |        1 |             1 |