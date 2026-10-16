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

HTTP 默认端口 4179，OpenCode 默认端口 4181，数据目录为 `experiments/knowledge/.work/server/data`。`PORT`、`SIMPLERCP_OPENCODE_PORT`、`SIMPLERCP_DATA_DIR` 可指定独立位置。凭据从平台 `.env` 读取，在服务端进程中保管。OpenCode 通过本机 HTTP 代理请求 MiniMax。Agent 与服务端知识模型统一使用 `minimax/MiniMax-M3`，启动后 runner 会核对两者的模型设置和实验时钟。

`formal-v3.json` 是四组实验配置，使用 HTTP 4203、OpenCode 4205、三次重复和原始时间窗口。结果记录实际 provider 与模型，并核验 Agent、知识模块两者均为 M3。M3 使用官方标准价格逐请求估算人民币费用；运行时费用与估算字段分别保留，供应商账单单独记录。`formal-v21.json` 仅用于读取历史结果。

K4 的唯一正式入口为平台 `k4` 命令。数据仓库的 `tools/run-transfer.ts` 用于数据校准。

仅这个入口注册 `experiments/*` 接口。修改配置、导入、确认与生成草稿写入实验活动记录。接口涵盖 schema v3 卡片导入、T2 原草稿确认、独立项目停止捕获、脚本 Agent 事件、录制读取、运行结束后的同步等待和 K2 草稿生成。卡片导入逐个检查快照与指定范围的文本相同。正常产品入口保持原有接口与行为。

所有命令支持 `--config <JSON>` 与 `--out <目录>`。配置包括 origin、provider、model、concurrency、timeoutMs、delayMs、speed、repetitions、seed，可选 embedding 的 origin 和 model。embedding 地址应提供服务端代理接口，配置文件不保存凭据。

| 工具 | 命令参数 | 输出 |
|---|---|---|
| K3 | `k3 --pilot --calibration`；完整矩阵用 `--tasks`、`--conditions` | 四项陷阱与一项对照的 C0/C2，以及全部陷阱三次 C0；实际判定、usage、注入和调用记录 |
| K4 | 历史试跑使用 `k4 --pilot`；正式迁移使用 `k4 --shared-episode --conditions T0,T3` | 每个 pair 与 repetition 只执行一次 Ta、纠正和复盘，再在独立项目中执行 T0/T3 的 Tb；保存草稿、确认修改量、送达来源与复用延迟 |
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

正式 K4 使用 `--shared-episode --conditions T0,T3`。甲通过团队 Agent 聊天提交 Ta，捕获服务保持开启。Ta 结束并保存行为判定后，服务端通过 `runs/:id/correction-baseline` 保存纠正文件的当前版本；纠正成员按 `correction.json` 使用 Yjs 写入参考修订并发送聊天说明。纠正后的文件再次通过行为判定，随后经 `recap-from-episode` 和收集箱的 AI 草稿接口生成复盘。甲按 `review-rules.json` 确认卡片，再经团队升级确认接口形成团队知识。纠正成员仍按冻结数据规定，作者、确认人和卡片属主分别记录。

同一个片段派生两个独立项目与会话，均由乙执行 Tb。T0 不导入卡片；T3 显式映射甲、乙的成员编号，保留源确认时间，使用正常检索注入。每对三次，共18次 Ta、36次 Tb，没有额外纠正 Agent。结果保存 `episodeKey`、原始 Ta runId、`captureBypassed`、`naturallyTriggered`、草稿结构和全部原始引用的校验、确认修改字段与字符数、`rankingSource`、重排用量、确认到乙首次注入的时间。Ta 未踩坑的片段保留，统计分别使用全部片段和实际踩坑子集，以片段配对 T0、T3。

确认规则在 `review-rules.json` 中预先定义，requiredTokens 和 files 与冻结数据的 `tools/transfer-review-rules.json` 一致。缺少指定标识符或 fallback 草稿时采用 gold 的规则正文、标题、摘要与类型；缺少指定文件范围时采用规定的 appliesTo。修改字段、增加和删除的字符数与规则哈希随结果保存。产品自然识别作为附带观察。历史 T1 到 T5 入口保留用于读取历史结果，数据仓库工具用于校准。

正式运行入口 `formal-run.ts` 使用 `knowledge-exp-freeze-v3.1`，分别核验实验三198条、实验四36条 Tb 与18个共享片段。额度或请求速率限制会停止新任务并取消当前 Agent，中断证据保存在原尝试目录；恢复时已完成组合直接跳过，中断 Tb 使用新的项目，已完成 Ta 保持原片段。重排请求失败直接采用 BM25，不重试。冻结前的真实验收使用 `preflight-v31.ts` 和 `verify-v31.ts`，结果位于 `.work/preflight-v31`，独立于正式结果。

C6-stale 在实验副本中将过期卡片设为 reviewed，使注入器能够选择它。C7 选择一张指定无关卡片，调整实验副本正文长度，使固定卡片完整格式的字符预算等于 C5，包含标题、摘要、id 和锚点。`knowledge-config.json` 记录卡片 id 与长度差，trace 记录实际注入字符数。冻结卡片文件保持原样。

K2 逐条读取来源 K4 中已经完成的纠正组合，以组合 key 区分重复与条件。缺少来源目录时仅评价脚本知识时刻。迁移草稿使用真实运行、diff、纠正原文或保存的建议证据，Agent 上下文使用纠正后的工作区；脚本代码证据取自对应知识时刻。自动 grounded 检查结构完整、原始响应的全部引用路径存在、正文覆盖指定对象；规则语义由两名标注者评价。结构解析采用产品解析器，引用评价直接读取原始 JSON 中的 evidenceCitations。原始模型响应按输入哈希缓存。续跑保留评分表的已填写内容，补充新增草稿；草稿文字改变时终止。

K7 的真值由 Y.Text 的字符归属属性跟踪，所有被测策略只读取纯文本与旧锚点。移动操作给迁移后的文本保留归属标记；并发编辑在原位置保留的字符单独记录 fragmented。删除后的真值为请求复核。相对位置与产品共同采用 start assoc=0、end assoc=-1。Yjs 分支使用 0.65 字符相似度及 0.5 行修改比例阈值；文本分支使用包返回的 confidence 与行修改比例。主要指标要求起止字符位置完全正确；`boundaryTolerant` 另行统计起点精确、终点行号误差最多一行的结果。

K5 与线上 provider 共用 `searchRankedKnowledgeCards`。全部候选进入类型重排，同分时按卡片 id 排序，原词法打分与活动文件权重保持一致。C2 重放另使用 `selectKnowledgeInjection`，应用状态、用户排除、固定卡片、同源去重与字符预算，比较最终卡片列表和完整注入字符数。来源 K3 的空 `activeFiles` 原样保留；每个 C2 组合在 `raw/replay-<key>/comparison.json` 保存实际 query、参数、候选与线上、离线最终列表，任何不一致都会终止执行。K3 在任务开始前保存 `knowledge-cards.json`；旧记录按冻结卡片与 run 的成员信息恢复导入状态，比较结果标明 `cardSource`。完整查询使用 trace，旧 trace 的查询摘要由完整 run 提示重建。R1 到 R5 继续评价检索排名。`KNOWLEDGE_BENCH_ROOT` 可指定独立冻结数据目录，仍执行全部 manifest 校验。

审阅复盘验证命令为 `pnpm --filter @simplercp/experiments exec tsx review-recaps.ts`。使用同一 K2 episode 与真实执行的两个 Session 纠正场景，每个场景请求 MiniMax 三次，记录原始响应、代码标识符与检查验证结果。`toolInstructionPlacement` 可选 `prompt` 或 `system`；对应审阅配置为 `review-fixes.json` 和 `review-fixes-system.json`。

2026-10-07 审阅验证中，四个 C3 陷阱在 prompt 与 system 两种位置各执行一次，知识工具调用均为零。阶段 8 的 K3 命令显式选择 `--conditions C0,C1,C2,C5,C6,C7`，C3、C4 不进入正式矩阵，R4 标记为没有实际查询数据。汇总证据使用 `pnpm --filter @simplercp/experiments exec tsx review-evidence.ts`，输出 `runs/review-20261007.json`。复盘验证对已有响应立即报告错误，重新验证使用独立结果目录。

K5 的活动文件取自 `--source` 中知识注入 trace 的 activeFiles；缺少记录时与产品共用 `knowledgeActiveFiles`，仅纳入工作区中实际存在的路径。每行记录 activitySource 和逐文件来源，包括显式上下文、成员当前文件、提示中的已有路径或为空。陷阱的 Recall、MRR、nDCG 与对照的误注入分别计算。错误活动文件使用另一张卡片的锚点文件，排除目标卡片的文件。目标卡片 id 只用于相关性评价和错误活动文件的选择。实际工具查询统一记录为 R4，以 queryIndex 与 querySource 区分各次查询；明确属于多次运行的查询单独排除。R4 统计先求每个任务的查询均值，再求任务均值。

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

运行 `pnpm --filter @simplercp/experiments exec tsx report.ts` 生成历史试跑的 pilot-summary.json 与 artifact-inspection.json。默认读取 k3-pilot、k3-conditions-pilot、k1-review、k1-review-comparison、k4-review、k4-context-review-final、k2-review、k5-review、k7-review。可依次传入 K4、K5、K7、K2、K4 上下文试跑的目录名，目录均位于 runs/。原始模型响应和 K2 上下文运行记录必须保留在对应 raw/ 目录。检索汇总按任务平均，并保留查询总数；K7 汇总单独记录 rightBoundaryExpanded。正式矩阵使用 `formal-run.ts`，每步核验冻结提交、M3 和样本量，再执行 summarize 与 analysis/analyze.py。K2 episode 来自 Ta 实际踩坑的正式 K4 组合，加上两段脚本中的全部标注知识时刻，实际数量在 E6 报告中记录。
