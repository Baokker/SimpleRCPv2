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

仅这个入口注册 `experiments/*` 接口。修改配置、导入、确认与生成草稿写入实验活动记录。接口涵盖 schema v3 卡片导入、T2 原草稿确认、独立项目停止捕获、脚本 Agent 事件、录制读取、运行结束后的同步等待和 K2 草稿生成。卡片导入逐个检查快照与指定范围的文本相同。正常产品入口保持原有接口与行为。

所有命令支持 `--config <JSON>` 与 `--out <目录>`。配置包括 origin、provider、model、concurrency、timeoutMs、delayMs、speed、repetitions、seed，可选 embedding 的 origin 和 model。embedding 地址应提供服务端代理接口，配置文件不保存凭据。

| 工具 | 命令参数 | 输出 |
|---|---|---|
| K3 | `k3 --pilot --calibration`；完整矩阵用 `--tasks`、`--conditions` | 四项陷阱与一项对照的 C0/C2，以及全部陷阱三次 C0；实际判定、usage、注入和调用记录 |
| K4 | `k4 --pilot`；`--pairs`、`--conditions`、`--variants delayed,same-session` | Ta、纠正运行、Tb 的工作区与判定，草稿、确认修改量、复用延迟 |
| K1 | `k1`；在线增加 `--online` | 触发指标、共现 Top-1/3、录制回放与脚本比较 |
| K1 录制复核 | `k1-compare --source <在线结果目录>` | 对保存的真实录制重复计算两条路径的比较，保存原始与去重后的建议 |
| K2 | `k2 --source <K4目录>`；小规模检查用 `--limit 1` | 三种草稿的原始响应、指标、两名标注者的 CSV |
| K5 | `k5 --source <K3目录>` | R1/R2/R3 排名、错误活动文件扰动、实际工具查询 R4、可选 R5 |
| K7 | `k7` | 48 个锚点、六类操作、五个种子、五种策略；真值、同步和重复生成检查 |
| 判定稳定性 | `judge-stability --tasks R1-T01 --workspace <快照>` | 同一工作区两次实际判定结果 |
| 汇总 | `summarize --source <结果目录>` | `summary.json` |

例子：

```sh
pnpm --filter @simplercp/experiments experiment k3 --config experiments/knowledge/pilot.json --pilot --calibration --out experiments/knowledge/runs/k3-pilot
pnpm --filter @simplercp/experiments experiment k4 --config experiments/knowledge/transfer-pilot.json --pilot --out experiments/knowledge/runs/k4-pilot
pnpm --filter @simplercp/experiments experiment k5 --source experiments/knowledge/runs/k3-pilot --out experiments/knowledge/runs/k5-pilot
pnpm --filter @simplercp/experiments experiment k7 --out experiments/knowledge/runs/k7-pilot
```

在线 K1 需要以 `EXPERIMENT_SPEED=10` 启动实例，并使用 `online.json`，将 origin 设置为该实例的端口。在线人类动作经过真实协作接口，Yjs 编辑保留脚本指定的删除和插入范围；每次编辑等待服务端文档与保存文件同时出现预期文本，随后才能执行下一项动作。HTTP 文件写入后等待打开的文档收到更新。脚本中的 Agent 生命周期与工具事件按各自时间经过实验接口；这条路径检验录制和捕获。K3/K4 执行真实 OpenCode。`recordedEqual` 比较服务端建议与录制事件回放的类型、成员、锚点，时间容许 300ms 计时误差；`scriptTypesEqual` 比较两边采用产品去重规则之后的类型序列，`rawScriptTypesEqual` 比较两边原始类型序列。同时保存全部原始建议。离线触发指标使用包的原始建议序列，服务端建议数量另列。触发匹配按建议时间和标注窗口结束时间进行一对一匹配；共现评价按标注时间执行。

每项组合创建独立项目。`raw/<组合>/` 保存项目身份、run、trace、注入、diff、快照和判定输出。`results.jsonl` 追加结果，包含代码提交、配置哈希、manifest 哈希、provider 与 model。`raw/` 和 `.work/` 由 gitignore 排除；结果与汇总提交。相同命令和输出目录再次运行会读取完成记录，跳过已完成组合；未结束的 Agent 按 run id 继续等待。读取终态后等待该会话完成文件与 trace 写入，再保存快照；已有快照与当前 diff 不同会终止。活跃 runner 的进程锁禁止同目录并发执行，失效进程锁可恢复，校验失败释放本进程取得的锁。续跑要求提交、配置、数据版本与来源目录一致。中断的在线脚本保留原始目录并在独立新项目中重新执行。

判定使用冻结 `run-judge.mjs` 的逐字副本，执行前比较 SHA-256。副本放在 `.work/judge/tools/`，判定器的临时目录因此位于实验目录内。任务和隐藏测试仍从只读数据目录读取。

K4 的甲通过团队 Agent 聊天提交 Ta。到达纠正时间后，interrupt 取消仍在运行的 Ta；revise 等待 Ta 完成。两条路径都等待会话停止修改文件，再保存 Ta 工作区并判定。纠正成员用原文向同一团队 Agent 发送消息，Tb 由乙的个人 Agent 执行。T2 到 T5 使用 `POST /api/projects/:projectId/experiments/recap-from-episode`，提交 `runId`、`correctionRunId`、`correctionAction`、`correctionText` 与完整 `correctionFiles`。接口创建 `agent.revised` 或 `agent.corrected` 建议，复用 Inbox 的草稿与确认流程。结果记录 `captureBypassed: true` 与 `naturallyTriggered`。K4 测量确认后的纠正迁移，产品触发是否自然识别作为附带观察；K1 使用产品默认纠正词表，遗漏计入召回率。确认规则在 `review-rules.json` 中预先定义。缺少指定标识符或 fallback 草稿时替换 gold 的规则正文、标题、摘要与类型；缺少指定文件范围时替换 appliesTo。记录修改字段、字符编辑数量（增加和删除的字符数）和规则哈希。T1 使用手工创建接口返回的 reviewed 团队卡片，正文保留完整纠正原文，后接真实 diff 的增删行摘要，合计不超过 800 字符。T4 检查卡片由甲拥有且保持个人范围。草稿与确认步骤按服务端当前状态继续执行。`same-session` 表示确认后立即由乙提交 Tb，乙使用自己的 Agent session；`delayed` 等待配置的固定间隔。

C6-stale 在实验副本中将过期卡片设为 reviewed，使注入器能够选择它。C7 选择一张指定无关卡片，调整实验副本正文长度，使固定卡片完整格式的字符预算等于 C5，包含标题、摘要、id 和锚点。`knowledge-config.json` 记录卡片 id 与长度差，trace 记录实际注入字符数。冻结卡片文件保持原样。

K2 逐条读取来源 K4 中已经完成的纠正组合，以组合 key 区分重复与条件。缺少来源目录时仅评价脚本知识时刻。迁移草稿使用真实运行、diff、纠正原文或保存的建议证据，Agent 上下文使用纠正后的工作区；脚本代码证据取自对应知识时刻。自动 grounded 检查结构完整、原始响应的全部引用路径存在、正文覆盖指定对象；规则语义由两名标注者评价。结构解析采用产品解析器，引用评价直接读取原始 JSON 中的 evidenceCitations。原始模型响应按输入哈希缓存。续跑保留评分表的已填写内容，补充新增草稿；草稿文字改变时终止。

K7 的真值由 Y.Text 的字符归属属性跟踪，所有被测策略只读取纯文本与旧锚点。移动操作给迁移后的文本保留归属标记；并发编辑在原位置保留的字符单独记录 fragmented。删除后的真值为请求复核。相对位置与产品共同采用 start assoc=0、end assoc=-1。Yjs 分支使用 0.65 字符相似度及 0.5 行修改比例阈值；文本分支使用包返回的 confidence 与行修改比例。主要指标要求起止字符位置完全正确；`boundaryTolerant` 另行统计起点精确、终点行号误差最多一行的结果。

K5 与线上 provider 共用 `searchRankedKnowledgeCards`。全部候选进入类型重排，同分时按卡片 id 排序，原词法打分与活动文件权重保持一致。来源 K3 的空 `activeFiles` 原样保留；每个 C2 组合在 `raw/replay-<key>/comparison.json` 保存实际 query、参数和线上、离线前五名。旧 trace 的查询摘要由完整 run 提示重建。`KNOWLEDGE_BENCH_ROOT` 可指定独立冻结数据目录，仍执行全部 manifest 校验。

审阅复盘验证命令为 `pnpm --filter @simplercp/experiments exec tsx review-recaps.ts`。使用同一 K2 episode 与真实执行的两个 Session 纠正场景，每个场景请求 MiniMax 三次，记录原始响应、代码标识符与检查验证结果。`toolInstructionPlacement` 可选 `prompt` 或 `system`；对应审阅配置为 `review-fixes.json` 和 `review-fixes-system.json`。

2026-10-07 审阅验证中，四个 C3 陷阱在 prompt 与 system 两种位置各执行一次，知识工具调用均为零。阶段 8 的 K3 命令显式选择 `--conditions C0,C1,C2,C5,C6,C7`，C3、C4 不进入正式矩阵，R4 标记为没有实际查询数据。汇总证据使用 `pnpm --filter @simplercp/experiments exec tsx review-evidence.ts`，输出 `runs/review-20261007.json`。复盘验证对已有响应立即报告错误，重新验证使用独立结果目录。

K5 的活动文件取自 `--source` 中知识注入 trace 的 activeFiles；缺少记录时使用任务提示明确列出的 src 文件路径。每行记录 activitySource。错误活动文件使用另一张卡片的锚点文件，排除目标卡片的文件。目标卡片 id 只用于相关性评价和错误活动文件的选择。实际工具查询统一记录为 R4，以 queryIndex 与 querySource 区分各次查询；明确属于多次运行的查询单独排除。R4 统计先求每个任务的查询均值，再求任务均值。

统计工具：

```sh
cd experiments/knowledge/analysis
uv sync
uv run python -m unittest test_analyze.py
uv run analyze.py ../runs/k3-pilot/results.jsonl --out ../runs/k3-pilot/analysis
uv run analyze.py ../runs/k7-pilot/results.jsonl --out ../runs/k7-pilot/analysis
uv run analyze.py ../runs/k2-pilot/results.jsonl --out ../runs/k2-pilot/analysis --ratings-a ../runs/k2-pilot/ratings-a.csv --ratings-b ../runs/k2-pilot/ratings-b.csv
```

统计包括按任务多数投票（平票记为缺失）、精确 McNemar、任务随机效应的 Bayesian logistic、5 个百分点等价界的配对 TOST、10000 次按任务 bootstrap、Holm、Cohen's κ。K4 按 delayed 与 same-session 分别计算，输出到对应子目录。对照任务的功能等价结果单独写入 controls.json；样本数量或差值方差不足时返回空值和原因。统计入口拒绝重复 key 与未完成结果；两份评分表必须包含相同 id 和草稿正文。报告同时保留原始重复结果。图输出为 PNG，分别呈现条件成功率与置信区间、额外 token 与复犯率减少、锚点策略结果。

运行 `pnpm --filter @simplercp/experiments exec tsx report.ts` 生成 pilot-summary.json 与 artifact-inspection.json。默认读取 k3-pilot、k3-conditions-pilot、k1-review、k1-review-comparison、k4-review、k4-context-review-final、k2-review、k5-review、k7-review。可依次传入 K4、K5、K7、K2、K4 上下文试跑的目录名，目录均位于 runs/。原始模型响应和 K2 上下文运行记录必须保留在对应 raw/ 目录。检索汇总按任务平均，并保留查询总数；K7 汇总单独记录 rightBoundaryExpanded。正式规模按每个实际纠正组合生成 K2 episode，当前材料与三次重复对应 196 个 episode。
