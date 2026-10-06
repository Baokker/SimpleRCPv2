# 阶段 7B 实验工具

工具由 `tsx` 执行。在线工具通过 HTTP、presence WebSocket 与 Yjs 连接独立服务端。离线工具使用 `@simplercp/knowledge`。冻结数据目录只读，入口会检查 manifest 的全部文件哈希与 schema v3 卡片。

在平台根目录安装依赖并检查工具：

```sh
pnpm install
pnpm --filter @simplercp/experiments build
pnpm --filter @simplercp/experiments test
pnpm --filter @simplercp/experiments experiment verify
```

启动服务端：

```sh
SIMPLERCP_KNOWLEDGE_EXPERIMENTS=true EXPERIMENT_SPEED=1 pnpm --filter @simplercp/experiments run server
```

HTTP 默认端口 4179，OpenCode 默认端口 4181，数据目录为 `experiments/knowledge/.work/server/data`。`PORT`、`SIMPLERCP_OPENCODE_PORT`、`SIMPLERCP_DATA_DIR` 可指定独立位置。凭据从平台 `.env` 读取，在服务端进程中保管。OpenCode 通过本机 HTTP 代理请求 MiniMax。固定 Agent 为 `minimax/MiniMax-M2`，启动后 runner 会核对模型设置。

仅这个入口注册 `experiments/*` 接口，全部写入实验活动记录。接口涵盖 schema v3 卡片导入、T2 原草稿确认、独立项目停止捕获、脚本 Agent 事件、录制读取和 K2 草稿生成。正常产品入口保持原有接口与行为。

所有命令支持 `--config <JSON>` 与 `--out <目录>`。配置包括 origin、provider、model、concurrency、timeoutMs、delayMs、speed、repetitions、seed，可选 embedding 的 origin 和 model。embedding 地址应提供服务端代理接口，配置文件不保存凭据。

| 工具 | 命令参数 | 输出 |
|---|---|---|
| K3 | `k3 --pilot --calibration`；完整矩阵用 `--tasks`、`--conditions` | 四项陷阱与一项对照的 C0/C2，以及全部陷阱三次 C0；实际判定、usage、注入和调用记录 |
| K4 | `k4 --pilot`；`--pairs`、`--conditions`、`--variants delayed,same-session` | Ta、纠正运行、Tb 的工作区与判定，草稿、确认修改量、复用延迟 |
| K1 | `k1`；在线增加 `--online` | 触发指标、共现 Top-1/3、录制回放与脚本比较 |
| K2 | `k2 --source <K4目录>`；小规模检查用 `--limit 1` | 三种草稿的原始响应、指标、两名标注者的 CSV |
| K5 | `k5 --source <K3目录>` | R1/R2/R3 排名、错误活动文件扰动、实际工具查询 R4、可选 R5 |
| K7 | `k7` | 48 个锚点、六类操作、五个种子、五种策略；真值、同步和重复生成检查 |
| 判定稳定性 | `judge-stability --tasks R1-T01 --workspace <快照>` | 同一工作区两次实际判定结果 |
| 汇总 | `summarize --source <结果目录>` | `summary.json` |

例子：

```sh
pnpm --filter @simplercp/experiments experiment k3 --config experiments/knowledge/pilot.json --pilot --calibration --out experiments/knowledge/runs/k3-pilot
pnpm --filter @simplercp/experiments experiment k4 --config experiments/knowledge/pilot.json --pilot --out experiments/knowledge/runs/k4-pilot
pnpm --filter @simplercp/experiments experiment k5 --source experiments/knowledge/runs/k3-pilot --out experiments/knowledge/runs/k5-pilot
pnpm --filter @simplercp/experiments experiment k7 --out experiments/knowledge/runs/k7-pilot
```

在线 K1 需要以 `EXPERIMENT_SPEED=10` 启动实例，并使用 `online.json`。在线人类动作经过真实协作接口，脚本中的 Agent 生命周期与工具事件经过实验接口；这条路径检验录制和捕获，不执行脚本中描述的模型任务。K3/K4 执行真实 OpenCode。

每项组合创建独立项目。`raw/<组合>/` 保存项目身份、run、trace、注入、diff、快照和判定输出。`results.jsonl` 追加结果，包含代码提交、配置哈希、manifest 哈希、provider 与 model。`raw/` 和 `.work/` 由 gitignore 排除；结果与汇总提交。相同命令和输出目录再次运行会读取完成记录，跳过已完成组合；未结束的 Agent 按 run id 继续等待。活跃 runner 的进程锁禁止同目录并发执行，失效进程锁可恢复。续跑要求提交、配置、数据版本一致。

判定使用冻结 `run-judge.mjs` 的逐字副本，执行前比较 SHA-256。副本放在 `.work/judge/tools/`，判定器的临时目录因此位于实验目录内。任务和隐藏测试仍从只读数据目录读取。

K4 确认规则在 `review-rules.json` 中预先定义。缺少指定标识符或 fallback 草稿时替换 gold 的规则正文、标题、摘要与类型；缺少指定文件范围时替换 appliesTo。记录修改字段、字符数量和规则哈希。T4 保持个人范围。`same-session` 表示确认后立即由乙提交 Tb，乙使用自己的 Agent session；`delayed` 等待配置的固定间隔。Ta 没有出现功能通过且陷阱失败时，结果显式标记。

K2 的 grounded 沿用旧评价：结构完整、引用路径存在、正文覆盖指定对象。这个自动指标只检查证据引用与对象覆盖；规则语义由两名标注者评价。原始模型响应按输入哈希缓存。

K7 的真值由 Y.Text 的字符归属属性跟踪，所有被测策略只读取纯文本与旧锚点。移动操作给迁移后的文本保留归属标记；并发编辑在原位置保留的字符单独记录 fragmented。删除后的真值为请求复核。Yjs 加多策略使用平台 0.65 字符相似度及 0.5 行修改比例阈值。

统计工具：

```sh
cd experiments/knowledge/analysis
uv sync
uv run analyze.py ../runs/k3-pilot/results.jsonl --out ../runs/k3-pilot/analysis
uv run analyze.py ../runs/k7-pilot/results.jsonl --out ../runs/k7-pilot/analysis
uv run analyze.py ../runs/k2-pilot/results.jsonl --out ../runs/k2-pilot/analysis --ratings-a ../runs/k2-pilot/ratings-a.csv --ratings-b ../runs/k2-pilot/ratings-b.csv
```

统计包括按任务多数投票（平票记为缺失）、精确 McNemar、任务随机效应的 Bayesian logistic、5 个百分点等价界的配对 TOST、10000 次按任务 bootstrap、Holm、Cohen's κ。报告同时保留原始重复结果。图输出为 PNG，分别呈现条件成功率、token 与成功、锚点策略结果。
