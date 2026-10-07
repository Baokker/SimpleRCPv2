# 阶段 7B：实验工具与试跑记录

日期：2026-10-07。分支为 `feature/process-knowledge`。Agent 与知识模型固定为 `minimax / MiniMax-M2`，实际 OpenCode 版本为 1.18.31，Node.js 为 24.7.0。模型地址和最小请求依据阶段 6 的 [请求记录](evidence/stage-6/minimax-endpoint.json)，该记录返回 HTTP 200。本阶段执行工具验证、试跑与难度校准；阶段 8 的完整实验矩阵尚未执行。

冻结数据提交为 `18f9bac`，manifest SHA-256 为 `62c2f65e7e28b83b23398e9dc8340e6ad4da7012fa1b9c831c3933a0e177f454`。入口逐个检查 1509 项文件哈希，并调用 schema v3 守卫。数据包含 10 个陷阱、4 个对照、4 对迁移任务和 2 段脚本。数据 README 的自查规模与读取结果一致；README 没有列出 manifest 整体哈希，整体哈希在本报告和每份结果中记录。数据工作区没有修改。

## 工具与运行方式

工具位于 [experiments/knowledge](../../experiments/knowledge/README.md)，由 TypeScript 和 `tsx` 执行。K3、K4、在线 K1 与 K2 通过真实 HTTP、presence WebSocket 和 Yjs 驱动独立实验实例。K3 的实例数据保存在 `.work/server/data`。本轮 K4/K2 使用 HTTP 4195、OpenCode 4197 与 `.work/review-server/data`；在线 K1 使用 HTTP 4199、OpenCode 4201 与 `.work/review-online/data`。

实验入口单独注册卡片导入、T2 确认、录制读取、脚本 Agent 事件、草稿生成、停止捕获、等待文档保存和等待运行结束后的同步接口。修改配置、导入、确认和草稿生成均记录活动。普通产品入口保持阶段 1 到 6 的接口与行为。服务端保管模型凭据，OpenCode 使用本机代理，实验终端关闭。

| 工具 | 输入与操作 | 结果 |
|---|---|---|
| K3 | 每个任务、条件、重复创建独立项目，导入夹具与卡片，执行个人 Agent | 状态、usage、trace、diff、工作区快照、实际判定、目标卡片注入与取回记录 |
| K4 | 团队 Agent 接收 Ta 与纠正原文，支持 Yjs 修改，按 T0 到 T5 确认，再由乙执行 Tb | 纠正前 Ta 判定、纠正运行、草稿与修改数量、Tb 判定、跨属主与复用时间 |
| K1 | 转换 script schema 1，调用 replayEvents；在线编辑经过真实协作连接 | 按类型的精确率、召回率、延迟，共现 Top-1/3，真实录制的重复比较 |
| K2 | 普通草稿、服务端复盘、Agent 自我复盘；按输入哈希缓存 | 原始响应、全部引用检查、结构与对象覆盖、两份人工评分 CSV |
| K5 | 包内检索与平台排序规则，支持实际工具查询、活动文件扰动、可选 embedding | Recall@1/3/5、MRR、nDCG@5、对照误注入数量、输入来源 |
| K7 | 48 个旧锚点、六类操作、五个种子，多个 Y.Doc 并发同步 | 独立字符归属真值、五种策略结果、删除复核、同种子一致性 |
| analysis | uv、pandas、scipy、statsmodels | 多数投票、精确 McNemar、任务随机效应 Bayesian logistic、TOST、bootstrap、Holm、Cohen's κ、表格与 PNG |

每行结果保存工具提交、配置哈希、manifest 哈希、provider 与 model。已有组合按 key 跳过，未结束的运行按 run id 继续等待。读取终态后等待会话完成文件和 trace 写入，再保存工作区。快照通过独立目录完成复制后 rename；保存的快照与当前 diff 不同会终止。进程锁阻止同目录并行写入，校验失败时释放本进程的锁。提交、配置、服务端捕获配置或来源结果变化时终止续跑。K3 的 C6 分别记录过期与矛盾条件；C7 的实验副本按完整卡片格式匹配 C5 长度。

冻结判定器按字节复制到 `.work/judge/tools/run-judge.mjs`，每次调用核对 SHA-256。它读取冻结任务，复制实际 Agent 工作区，再运行项目测试、隐藏测试和行为检查。判定器的中间目录位于实验目录，数据仓库保持只读。

## 试跑结果

结果入口为 [pilot-summary.json](../../experiments/knowledge/runs/pilot-summary.json)。K3 使用 `e9d835e`，补充条件使用 `48d7a15`。本轮 K1、K2、K4、K5、K7 使用 `40bd7d4`；T1 与录制比较使用 `e4d3d62`。每个组合保留自身执行时的提交号。

| 输入 | 当前结果目录 |
|---|---|
| K3 主试跑与校准 | `runs/k3-pilot` |
| K3 补充条件 | `runs/k3-conditions-pilot` |
| K4 delayed | `runs/k4-review` |
| K4 T1 same-session | `runs/k4-context-review-final` |
| K1 离线与在线 | `runs/k1-review` |
| K1 录制比较 | `runs/k1-review-comparison` |
| K2 | `runs/k2-review` |
| K5 | `runs/k5-review` |
| K7 | `runs/k7-review` |

K3 主试跑与校准共有 36 个组合，补充 C3/C5/C7 共有 15 个组合。51 个 Agent run 均为 completed，未观察到 Agent 超时。主试跑的五项任务各执行 C0、C2 一次。以下记录已经逐项检查 diff、注入记录和判定输出；完整检查索引在 [artifact-inspection.json](../../experiments/knowledge/runs/artifact-inspection.json)。

| 任务 | C0：功能 / 陷阱 | C2：功能 / 陷阱 | diff、注入与判定观察 |
|---|---|---|---|
| R1-T01 | true / false | true / false | 新增批量预留路由和服务；两者逐条预留，后项失败后前项库存已改变；C2 未注入目标卡片 |
| R1-T02 | false / false | false / false | 新增审计导出；把 AuditEntry 当作运行时导出导入，隐藏测试无法加载；C2 未注入目标卡片 |
| R2-T01 | true / false | false / false | 修改真实 traceStore；C0 保留敏感命令；C2 注入目标并调用脱敏，文件输出使用 JSONL，提示要求 JSON 数组 |
| R2-T02 | false / false | false / false | 修改真实 chat 与新增导出文件；对历史房间直接过滤，下载文件也使用包装对象；提示要求数组 |
| R1-C01 | true / true | true / true | 新增库存查询路由与服务；筛选、排序和输入保持检查通过 |

补充条件在四项陷阱上的联合成功数为 C3：0/4，C5：3/4，C7：0/4；对照在三个条件下全部通过。C5 和 C7 的实际注入字符数分别相同：R1-T01 为 532，R1-T02 为 505，R2-T01 为 518，R2-T02 为 520。C5 下 R2-T02 功能通过，仍然未遵守历史房间处理约定。C3 的五次运行均没有知识工具查询。

校准使用每个陷阱的三次 C0 运行。`R2-T02` 为 tooHard，三次功能全部失败；tooEasy 数量为零。R1-T05、R2-T05 各一次避开陷阱，其余任务三次都没有避开。校准只添加标记，没有修改或删除任务。[calibration.json](../../experiments/knowledge/runs/k3-pilot/calibration.json) 保存逐项结果。

同一 R1-T01 工作区两次实际判定得到相同布尔结果、退出状态和通过数量：84 项项目测试与 5 项隐藏测试通过，陷阱失败。[judge-stability-current](../../experiments/knowledge/runs/judge-stability-current/results.jsonl) 保存结果。C0 的重复运行使用相同基线、提示与条件，但创建独立项目。主试跑命令再次执行时，36 个已完成组合全部跳过，没有新增 Agent run。

K4 在 P01、P03 上各执行 T0、T3 的 delayed 变体一次，并对 P01 执行一次 T1 same-session，五个组合均完成。到达纠正时间后，interrupt 取消 Ta；revise 等待 Ta 完成。保存并判定 Ta 时，该会话已经停止修改文件。

| 迁移对与条件 | Ta 状态 | Ta 是否功能通过且踩坑 | Tb | 目标注入 | 确认至其他成员首次注入 |
|---|---|---|---|---|---|
| P01-T0-delayed | cancelled | true | 功能与陷阱均通过 | false | 无卡片 |
| P01-T3-delayed | cancelled | false，规定时间内功能未完成 | 功能与陷阱均通过 | true | 60.082 秒 |
| P03-T0-delayed，跨属主 | completed | false，功能失败 | 功能与陷阱均失败 | false | 无卡片 |
| P03-T3-delayed，跨属主 | completed | false，功能失败 | 功能与陷阱均失败 | true | 60.043 秒 |
| P01-T1-same-session | completed | true | 功能与陷阱均通过 | true | 0.038 秒 |

分析文件单独记录 taActuallyTrapped，并另外输出 Ta 确实踩坑的子集；delayed 和 same-session 分别计算。P01-T0 与 P01-T1 进入该子集。K4 通过实验 episode 接口进入复盘，记录 `captureBypassed` 和 `naturallyTriggered`；K1 使用产品默认纠正词表。T3 的两张卡片都正常生成、确认和注入，scope 为 team。T1 使用手工接口返回的 reviewed 团队卡片，800 字符正文保留完整纠正原文及真实 diff 的增删行摘要，Tb trace 记录正文 800 字符、完整注入 1159 字符。相同 T1 命令再次执行时跳过完成组合，没有新增 Agent run。

K1 离线共有 52 个标注知识时刻、34 条建议、17 次命中：精确率 50.00%，召回率 32.69%，共现 Top-1 为 15.38%，Top-3 为 46.15%。20 个标注干扰窗口中没有建议。每类触发的发现延迟保存在 results.jsonl；命中的编辑与 Agent 类事件延迟为 24 到 28 秒。

两段脚本按 10 倍速度驱动真实服务。S01 的服务端建议为 16 条，录制回放原始建议为 18 条；S02 分别为 14 条、16 条。服务端采用同源证据去重。两条路径采用同一规则后，类型、成员、锚点一致，时间误差在 300ms 内；原脚本与录制的原始建议类型序列也一致。可重复比较在 [k1-review-comparison](../../experiments/knowledge/runs/k1-review-comparison/results.jsonl)，两段的 recordedEqual、scriptTypesEqual、rawScriptTypesEqual 均为 true。真实录制保存在 k1-review 的 raw 目录。脚本 Agent 生命周期与工具动作经过实验接口输入捕获；脚本中的模型任务没有执行。

K2 使用 P01-T0-delayed-1 的真实纠正证据，生成三种草稿。每个实际完成的纠正组合分别构成一个 episode。Agent 自我复盘使用纠正后的真实工作区读取上下文；脚本输入使用知识时刻的代码。结构合法与全部引用可解析均为 3/3，指定对象 InventoryStore.transaction 覆盖为 0/3，自动 grounded 为 0/3。普通、服务端与 Agent 自我复盘耗时分别为 14.430、11.256、9.727 秒，原始响应全部缓存。自动 grounded 检查结构、引用和指定对象覆盖；规则语义与范围由两名标注者评分。两份 [评分表](../../experiments/knowledge/runs/k2-review/ratings-a.csv) 已生成，尚未填写，因此 κ 和人工均分为空。续跑保留评分及备注，新增草稿追加；同一个 id 的正文改变时终止。

K5 使用 10 个陷阱、4 个对照。活动文件来自 K3 注入 trace；没有记录的任务使用提示中的文件路径。R1、R2、R3 和两种扰动共执行 70 次检索。

| 条件 | Recall@1 | Recall@3 | Recall@5 | MRR | nDCG@5 |
|---|---|---|---|---|---|
| R1 纯词法 | 0.20 | 0.20 | 0.50 | 0.3305 | 0.3248 |
| R2 legacy | 0.20 | 0.20 | 0.50 | 0.3294 | 0.3248 |
| R3 bounded | 0.40 | 0.60 | 0.90 | 0.5442 | 0.6204 |
| R2 错误活动文件 | 0.20 | 0.20 | 0.50 | 0.3294 | 0.3248 |
| R3 错误活动文件 | 0.00 | 0.20 | 0.60 | 0.2358 | 0.2766 |

每种条件在四个对照上返回共 20 张卡片，按对照相关集为空计为误注入。K3 主试跑和补充 C3 都没有实际知识工具查询，R4 的输入数量为零。没有配置 embedding 服务，R5 跳过。availability.json 记录这些原因。R4 的多次查询保留 queryIndex 与 querySource；汇总和统计均先计算任务内查询均值，再计算任务均值。

K7 完成 1440 条轨迹、7200 次策略评价。同种子两次生成的文本、操作、真值与同步更新哈希全部一致。存活率和错误范围率以下使用 1200 条可定位轨迹作为分母，删除类另计 240 条。

| 策略 | 精确存活率 | 边界容忍存活率 | 错误范围率 | 请求复核率 | 删除类请求复核率 |
|---|---|---|---|---|---|
| range-only | 0.00% | 0.00% | 100.00% | 0.00% | 0.00% |
| snapshot-only | 40.00% | 40.00% | 0.00% | 60.00% | 100.00% |
| multi-strategy | 62.08% | 67.92% | 32.17% | 5.75% | 100.00% |
| yjs-relative | 79.42% | 79.75% | 20.08% | 0.50% | 100.00% |
| yjs-multi | 83.42% | 83.58% | 0.25% | 16.33% | 100.00% |

主要判定使用精确起止位置；边界容忍要求起点精确、终点所在行误差不超过一行。平台与实验均使用 start assoc=0、end assoc=-1。Yjs 分支采用产品的相似度与行修改比例阈值。真实 HTTP/Yjs 测试检查实验策略与平台接口返回的范围一致。完整轨迹见 [k7-boundary-review](../../experiments/knowledge/runs/k7-boundary-review/results.jsonl)，六类操作见本报告审阅修复记录。真值、并发操作与精确判定保持冻结。

## 数据与平台复核事项

数据脚本保留 packageJson.dependencySwitch 与 diagnostics.fixed，当前平台触发名称和事件输入不能直接对应这两项。常量恢复没有达到产品的 500 字符或 20 行恢复触发门槛，带注释的数字编辑没有产生 magicNumber.added。chat.dense 与 agent.retried 的部分建议位于标注窗口之外，计为未命中；模型工具输出还需要人工核对是否具有可恢复错误的描述。冻结脚本和标注保持原样。

R2-T02 的提示已经列明输出字段及数组格式，当前失败来自 Agent 输出；是否替换 tooHard 任务由数据负责人决定。P01-T3 的 Ta 在规定时间内功能未完成，P03 的两次 Ta 功能失败，这三个组合单独标记，资格子集由 taActuallyTrapped 筛选。数据 README 还要求复核 P03-Ta 的第二份手工踩坑参考补丁与脚本人工标注，本阶段保留这些复核事项。

人工检查中没有确认判定器误判。功能失败时，陷阱检查也可能因加载或输出格式失败；保留完整原因，解释时同时查看 functional 与 trapEvidence。卡片导入没有异常，C2 的目标卡片只命中 R2-T01；其他任务注入了相关性较低的卡片。C5 的四项陷阱都收到目标卡片，三个联合成功。知识工具虽已开启，C3 的 Agent 没有调用它，R4 尚未得到端到端输入验证。

K2 的完整 196 个 episode，以及 K4 的 T2/T4/T5 和全部迁移对矩阵尚未执行。两名标注者的评分与 embedding 条件需要在阶段 8 前明确记录。当前小样本支持工具检查；C0/C2 的四个配对任务在多数投票后没有联合成功差异，McNemar p=1。对照只有一项，TOST 返回空值及样本不足原因，不能作等价结论。混合 logistic 使用 statsmodels 的 Bayesian 估计，完整方法与参数保存在 statistics.json。

## 正式实验估算与运行顺序

估算按冻结材料、每组合三次重复计算。K3 包含 C6 的两个子条件，共九个条件；没有目标卡片的对照在 C5/C7 使用关闭注入的配置，结果保留该配置。K4 每个组合独立执行 Ta、纠正运行与 Tb。

| 部分 | 规模 | 顺序执行估算 | 模型费用估算 |
|---|---|---|---|
| K3 | 14 × 9 × 3 = 378 个 run | 4.15 小时，均值 39.50 秒 | 318.62 元 |
| K4 | 4 × 6 × 2 × 3 = 144 个组合，432 个 Agent run | 4.45 小时；delayed 均值 141.15 秒，same-session 减去固定 60 秒估算 | Agent 201.07 元，复盘 2.47 元 |
| K2 | 144 次实际纠正 + 52 个脚本时刻 = 196 个 episode，588 份草稿，196 次 Agent 上下文读取 | 2.62 小时 | 49.94 元 |

合计约 11.21 小时与 572.09 元。K3、K4 并发上限为 2，K2 按当前顺序运行时，估算约 6.91 小时，另加在线回放和文件整理。模型服务限速、重试及不同条件的工具调用会影响耗时。费用采用 AgentRun.usage 和实际草稿请求的用量，尚未核对供应商账单；K2、K4 复盘费用按 P01 估计。价格为每百万 token 输入 2.1 元，输出与 reasoning 8.4 元，cache read 0.21 元，cache write 2.625 元。R5 的服务与费用尚未确定。旧原型的 60 次草稿实验使用 DeepSeek，需要在论文中注明与本实验的模型差异。

阶段 8 的建议顺序为：由人确认数据复核事项与模型配置；执行 verify、K1、K5 和 K7；执行 K3 与 K4；从实际纠正证据生成 K2，收集两份独立评分；执行统计。各阶段使用独立结果目录，固定输入与配置后续跑。

## 检查记录与文件位置

| 检查项 | 检查方法 | 本次结果 |
|---|---|---|
| 数据只读 | verify 逐项哈希，查看数据 Git 状态 | 1509 项相符，Git 状态为空 |
| 工具构建 | pnpm --filter @simplercp/experiments build | tsc 通过 |
| 工具测试 | pnpm --filter @simplercp/experiments test | 15 项通过，包含真实 HTTP/Yjs、卡片快照、T1 正文、评分续跑、进程锁和时间窗口 |
| 统计测试 | uv run python -m unittest test_analyze.py | 5 项通过，检查精确 McNemar、平票、变体分组和评分输入 |
| 产品回归 | server 使用 vitest --pool forks --maxWorkers 1 --minWorkers 1；knowledge 使用项目测试命令 | server 36 个文件、133 项通过；knowledge 152 项通过 |
| 判定稳定性 | 两次运行同一实际工作区 | 布尔结果、退出状态与计数相同 |
| K3 试跑与校准 | 真实 Agent、冻结判定器 | 主试跑及校准 36 项，补充条件 15 项完成 |
| 续跑 | 再次执行相同主试跑命令 | 36 项跳过，没有新增 Agent |
| K4 | 两对 × T0/T3 delayed，P01-T1 same-session | 5 项完成；P01-T0 和 P01-T1 的 Ta 进入实际踩坑子集 |
| K1 | 两段离线、两段真实在线、录制复核 | 两段比较一致；原始与去重序列都保留 |
| K2 | 三种模式实际请求及缓存复核 | 3 份结构与引用通过，自动 grounded 0/3，人工评分为空 |
| K5 | 完整卡片库与实际活动文件，错误文件扰动 | 70 项完成；R4 零查询，R5 未配置 |
| K7 | 全部轨迹生成两次并比较哈希 | 1440 项一致，五策略共 7200 项 |
| 统计 | 对实际 K3、K4、K2、K5、K7 结果运行 Python | 表格、置信区间、模型参数、等价限制及三类 PNG 已生成；K4 按变体分别输出 |
| 凭据 | 新增文件与输出检查长凭据和 JWT 模式 | 没有发现匹配；配置仅记录 apiKeyConfigured 布尔值 |

server 的 Vitest 配置固定为 `pool: "forks"`、`singleFork: true` 与 `fileParallelism: false`，根目录 `pnpm test` 使用该配置。

提交的结果在 `experiments/knowledge/runs/`，包括 results.jsonl、配置、汇总、评分表与统计图。原始输出的绝对位置为 `/Users/baokker/Work/Master/CSCW/过程性知识管理/code/SimpleRCPv2/experiments/knowledge/runs/<目录>/raw/`，包含 trace、diff、快照、模型响应、录制与判定输出，已由 gitignore 排除。过程检查材料位于同一实验目录的 `.work/previous-runs/`。本轮两个专用服务在试跑结束后停止，4195、4197、4199、4201 均无监听，工作区与原始输出保留。

## 2026-10-07 审阅修复

本次使用 Node.js 22.19.0、OpenCode 1.18.31 与 `minimax / MiniMax-M2`。冻结数据通过 `KNOWLEDGE_BENCH_ROOT=experiments/knowledge/.work/frozen-bench` 指定，提交与 manifest 保持 `18f9bac` 和 `62c2f65e7e28b83b23398e9dc8340e6ad4da7012fa1b9c831c3933a0e177f454`。相邻数据仓库中的本地修改保持原样。审阅实例使用 HTTP 4305、OpenCode 4307，终端关闭。

实现提交为 `e18620f`。最终 C2 与其 K5 重放在该提交上执行；K7、C3、复盘和 K4 的结果记录执行开始时的 HEAD `ab157ee`，同时使用本轮审阅修改。原始记录保留各自的提交字段，本节和分支提交提供对应实现与修复范围。

Yjs 13.6 的 `assoc<0` 将位置关联到左侧字符，非负值关联到右侧字符。新建与解析刷新采用 start=0、end=-1；已有卡片在成功解析后更新。K7 的 1440 条轨迹再次生成并核验一致性，正文表为本次全量结果。精确存活数分别为 0、480、745、953、1001，分母为 1200；边界容忍数分别为 0、480、815、957、1003。`yjs-relative` 精确存活率从 39.75% 达到 79.42%，`yjs-multi` 从 43.58% 达到 83.42%。

| 操作，每类 240 条 | multi-strategy 精确正确 / 错误 / 复核 | yjs-relative 精确正确 / 错误 / 复核 | yjs-multi 精确正确 / 错误 / 复核 |
|---|---|---|---|
| insert-around | 240 / 0 / 0 | 240 / 0 / 0 | 240 / 0 / 0 |
| interleaved | 240 / 0 / 0 | 238 / 2 / 0 | 234 / 2 / 4 |
| move-and-edit | 240 / 0 / 0 | 0 / 234 / 6 | 240 / 0 / 0 |
| duplicate-before | 0 / 240 / 0 | 240 / 0 / 0 | 240 / 0 / 0 |
| delete | 0 / 0 / 240 | 0 / 0 / 240 | 0 / 0 / 240 |
| three-members | 25 / 146 / 69 | 235 / 5 / 0 | 47 / 1 / 192 |

移动通过删除后重新插入实现，旧 Yjs 字符身份无法直接跟随，组合策略通过快照与上下文重新定位。多人修改中，产品的内容变化阈值要求复核，因此组合策略在 192 条轨迹中请求复核；其精确错误数为 1。交错编辑仍有 2 条边界范围不精确，组合策略另有 4 条请求复核。这些记录保留，判定阈值与真值没有调整。

C2 的五个组合均完成，完整输入重放的前五名全部相同。共享排序函数保留活动文件加分 0.06、最高词法分乘 0.5 的上限与类型优先级。同分卡片按 id 排序，全部候选排序后应用数量限制。离线重放保留空 `activeFiles`，使用完整 `run.prompt` 与 `extraPrompt`；新 trace 保存完整脱敏查询、参数与前 20 个候选。

| 任务 | 原试跑目标注入 | 本次目标注入 | 线上 / 离线前五名一致 | 实际活动文件 |
|---|---|---|---|---|
| R1-T01 | 否 | 否 | 是 | 空集合 |
| R1-T02 | 否 | 否 | 是 | 空集合 |
| R2-T01 | 是 | 是 | 是 | src/extracted/agent/traceStore.ts |
| R2-T02 | 否 | 是 | 是 | src/extracted/chat.ts |
| R1-C01 | 无目标 | 无目标 | 是 | 空集合 |

R1-T01、R1-T02 和 R1-C01 存在大量相同词法分数，活动文件为空。线上卡片读取顺序与离线 library 顺序不同，数量截取时机也不同，导致前五名差异。R2-T01 的目标由活动文件加分进入前列；R2-T02 的目标在统一同分顺序与完整排序后进入前五名。卡片集合核验为各项目 40 张 reviewed 卡片，内容一致；状态配置与排序参数一致。原 trace 将查询限制为 500 字符，重放使用保存的完整 run 请求恢复输入。离线将空活动文件替换为推断路径也会改变条件。逐项比较见 [review-20261007.json](../../experiments/knowledge/runs/review-20261007.json)、[C2 结果](../../experiments/knowledge/runs/k3-c2-delivery-review/results.jsonl) 与 [离线重放](../../experiments/knowledge/runs/k5-delivery-trace-review/results.jsonl)。四个陷阱的目标注入从 1/4 达到 2/4，R1 两项仍未命中，后续实验保留这些检索失败。

原 C3 的实际提示已包含工具说明。本次提供独立说明，位于范围声明后，介绍 `knowledge_search`、`knowledge_get` 与必填 workspace，不受注入开关或卡片字符预算限制；另验证 OpenCode `session.prompt.system` 入口。说明原文与位置写入 trace，MCP 状态为 connected。

| C3 任务 | prompt 工具调用次数 | system 工具调用次数 | 查询内容 |
|---|---|---|---|
| R1-T01 | 0 | 0 | 无查询 |
| R1-T02 | 0 | 0 | 无查询 |
| R2-T01 | 0 | 0 | 无查询 |
| R2-T02 | 0 | 0 | 无查询 |

八次真实 Agent 运行全部为 completed。普通提示词结果为 [k3-c3-final-review](../../experiments/knowledge/runs/k3-c3-final-review/results.jsonl)，有效 system 结果为 [k3-c3-system-final-review](../../experiments/knowledge/runs/k3-c3-system-final-review/results.jsonl)。两种位置均没有产生工具查询，阶段 8 移除 C3、C4；R4 标记为无实际查询数据。正式 K3 命令显式选择 `--conditions C0,C1,C2,C5,C6,C7`，工具接口继续供交互使用。

K4 的 [P01 T3 same-session](../../experiments/knowledge/runs/k4-episode-final-review/results.jsonl) 验证了直接 episode 入口、真实复盘、人工规则修订、二次团队确认与乙的 Tb 注入。`captureBypassed`、`naturallyTriggered` 均为 true，卡片 scope 为 team，Tb 的功能和陷阱检查通过。Ta 的 `actuallyTrapped=false`，该组合只用于接口验证。缺少本地确认记录时，工具复用保存建议、观察与 Inbox 草稿，保持已保存的纠正快照。[继续执行验证](../../experiments/knowledge/runs/k4-episode-final-review/resume-validation.json) 显示没有新增 Agent run。产品纠正词表保持默认值。

复盘使用同一 K2 episode 和阶段 6 的两个真实 Session 场景，各调用三次。代码证据包含完整前后文件、通过 TypeScript 解析得到的标识符与类型归属。实际响应、用量与提示词哈希见 [recap-quality-final-review/results.json](../../experiments/knowledge/runs/recap-quality-final-review/results.json)。本次验证不复用旧响应，原始证据与响应保持保存。

| 场景 | 结构与引用合法 | 指定标识符覆盖 | 提出检查 | 保留检查 |
|---|---|---|---|---|
| K2 P01，InventoryStore.transaction | 2/3 | 1/3 | 2 | 1 |
| 跨属主恢复 sharedHelper | 3/3 | 2/3 | 3 | 3 |
| 追加纠正使用 sharedHelper | 3/3 | 3/3 | 3 | 0 |
| 合计 | 8/9 | 6/9 | 8 | 4 |

K2 一条规则包含具体调用 `service.store.transaction`，指定类型标识符覆盖按原要求计为未命中；另一条包含 `InventoryStore.transaction`。第三次响应的 `fileGlob` 字段缺少 JSON 引号，三次尝试均未通过解析，草稿保留空规则和 fallback 标记。跨属主场景有一条规则使用“共享辅助函数”而未写出函数名，计为未覆盖。所有生成规则原文保存在上述结果文件中，未修改模型文本。

检查保留率为 4/8（50.00%）；按九次请求计算为 4/9。验证要求至少一个 Agent 文件违反、全部纠正文件通过。追加纠正的三条检查无法区分全文前后版本，全部移除；草稿注明“自动检查未通过验证，已移除”。正则语法无效同样移除检查。合法性与引用校验保持要求，模型的对象命名与 JSON 输出仍需要人工确认。

DeepSeek 的 SDK `cost=0` 不表示免费或价格更低，跨模型成本比较使用 token 数。MiniMax 的人民币费用仅作为独立估算记录。

| 本次检查 | 结果 |
|---|---|
| pnpm build | 通过 |
| pnpm test | server 136、knowledge 155、Demo 2 项通过 |
| pnpm test:e2e | 21 项通过、15 项按配置跳过 |
| pnpm test:e2e:knowledge | 13 项通过 |
| 实验工具测试 | 15 项通过，包含真实 HTTP/Yjs 与逆序卡片输入的前五名一致检查 |
| 统计工具测试 | 5 项通过 |

测试输出保存在忽略目录 `artifacts/review-20261007/`。事件证据脱敏采用保持文本长度的替换方式，敏感文本不会改变区间坐标，录制仍能通过 schema 校验。新增检查还验证旧 end 相对位置成功解析后的刷新、JavaScript 相对 import、无效正则移除、完整 Agent 版本重启恢复和 episode 观察值的重复提交。

## 2026-10-07 补充审阅

复盘提示词中的复杂证据键采用带引号的路径，例如 `evidence.symbolSources["src/storage/inventory-store.ts"]`，使用 Lodash `toPath` 读取。路径生成与校验覆盖文件名中的点号、斜线和引号。K2 依据服务端返回的完整证据评价全部原始引用，`evidenceHash` 记录这份评价证据。

`selectKnowledgeInjection` 提供 provider 与 C2 重放的完整选择流程，包括状态、固定卡片、用户排除、同源去重与字符预算。真实 HTTP 验证中，六张长卡片在默认 4000 字符预算下均选择四张；卡片记录、完整提示文本和字符数完全一致，逆序输入保持相同结果。K3 保存任务开始前的卡片快照，旧记录按冻结卡片和成员信息恢复导入状态，比较结果标明来源。五组已保存的 C2 记录使用完整选择流程重新计算：

| 组合 | 线上 / 离线字符数 | 最终卡片列表一致 |
|---|---|---|
| R1-T01-C2-1 | 1931 / 1931 | 是 |
| R1-T02-C2-1 | 1892 / 1892 | 是 |
| R2-T01-C2-1 | 1929 / 1929 | 是 |
| R2-T02-C2-1 | 1837 / 1837 | 是 |
| R1-C01-C2-1 | 1992 / 1992 | 是 |

实验纠正入口合并同源建议，保留建议 id、阅读状态与成员意见，同时写入纠正类型、`captureBypassed` 和 `naturallyTriggered`。原有重试或工具恢复证据保存在 `naturalEvidence` 中，自然纠正观察只计算纠正触发。新增参与成员收到通知，重复请求保留同一条记录。

| 验证 | 结果 |
|---|---|
| pnpm build | 通过 |
| pnpm test | server 137、knowledge 156、Demo 2 项通过 |
| pnpm test:e2e | 21 项通过、15 项按配置跳过 |
| pnpm test:e2e:knowledge | 13 项通过 |
| 实验工具测试 | 15 项通过 |
| 保存的 C2 最终注入重放 | 五组卡片列表和字符数全部一致 |

日志和比较记录保存在 `artifacts/review-20261007-repeat/`。e2e 使用 `SIMPLERCP_E2E_SCREENSHOT_DIR` 把本轮截图保存到该目录；默认截图目录继续为 `docs/knowledge/screenshots`。
