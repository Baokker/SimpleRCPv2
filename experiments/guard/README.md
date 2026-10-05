# Guard 实验复现

实验分支固定为 `experiment/guard-x1-x6`，被测提交由 `git rev-parse guard-v1.1` 读取。数据集生成器依据方案设计中的角色矩阵、路径分区、硬性规则和 Agent 原则生成 D1 至 D6，并把条数和 SHA-256 写入 `datasets/v2/MANIFEST.json`。

```text
pnpm exp:datasets:v2
pnpm exp:verify-datasets:v2
# 完成人工标签审核并冻结 MANIFEST 后运行以下实验
pnpm exp:x1
pnpm exp:x3
pnpm exp:x5
pnpm exp:x6
pnpm exp:x2
pnpm exp:x4
pnpm --filter @simplercp/server exec tsx ../../experiments/guard/lib/verify-results.ts
```

运行数据写入 `experiments/guard/results/<Xn>/<run-id>/`，每个目录包含 `raw.jsonl`、`summary.json`、`summary.md` 与 `env.json`。X2 与 X4 在没有模型配置时只记录未完成状态，不写入模型 Key。模型在线运行需要项目已有的 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL` 和 `DEEPSEEK_MODEL`，脚本只读取配置状态与模型名。

实验运行数据目录使用仓库内的 `.experiment-data/`，其中写入模拟工作区、金丝雀 `.env` 和快照基准文件，目录已加入 `.gitignore`。所有网络注入只指向 `127.0.0.1:43121`，实验脚本没有启动外部网络请求。

X1 使用五种条件 B0、B1、B2、B3、F。B1 的静态模拟依据 OpenCode 1.18.31 默认权限表，B2 只对 Agent 放行，B3 固定 Agent 为 collaborator，F 调用 `apps/server/src/guard/decide.ts`。X3 使用确定性判官，X5 的快照曲线每个规模重复五次，X6 使用固定种子运行 500 轮故障注入与每项 10000 例性质测试。
