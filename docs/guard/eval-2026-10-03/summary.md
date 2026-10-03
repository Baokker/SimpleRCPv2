# Guard 评价 2026-10-03

攻击样例数量：15。full 条件下需要审批或拒绝的样例：15。不可逆样例自动放行数量：0。
良性样例数量：23。full 条件下进入审批的数量：2。
decide 判定耗时 p50：12.25 微秒，p95：56.00 微秒。

`human-only` 对 Agent 请求直接允许，用于表示只管控人的对照条件。C7 的角色变化使用每次调用当前 `memberLevel`，第二次 Agent 请求立即采用新档位。

详细决策见 `decisions.csv`，审批次数见 `approval-counts.csv`。
