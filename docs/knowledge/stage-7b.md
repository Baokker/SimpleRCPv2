# 阶段 7B：实验工具与试跑记录

日期：2026-10-07。分支为 `feature/process-knowledge`。Agent 与知识模型固定为 `minimax / MiniMax-M2`，实际 OpenCode 版本为 1.18.31，Node.js 为 24.7.0。模型地址和最小请求依据阶段 6 的 [请求记录](evidence/stage-6/minimax-endpoint.json)，该记录返回 HTTP 200。本阶段执行工具验证、试跑与难度校准；阶段 8 的完整实验矩阵尚未执行。

冻结数据提交为 `18f9bac`，manifest SHA-256 为 `62c2f65e7e28b83b23398e9dc8340e6ad4da7012fa1b9c831c3933a0e177f454`。入口逐个检查 1509 项文件哈希，并调用 schema v3 守卫。数据包含 10 个陷阱、4 个对照、4 对迁移任务和 2 段脚本。数据 README 的自查规模与读取结果一致；README 没有列出 manifest 整体哈希，整体哈希在本报告和每份结果中记录。数据工作区没有修改。

## 工具与运行方式

工具位于 [experiments/knowledge](../../experiments/knowledge/README.md)，由 TypeScript 和 `tsx` 执行。K3、K4、在线 K1 与 K2 通过真实 HTTP、presence WebSocket 和 Yjs 驱动三个独立实验实例。端口为 4179、4183、4187；对应 OpenCode 端口为 4181、4185、4189。数据分别保存在实验目录的 `.work/server/data`、`.work/online-data`、`.work/k4-data-2`。

实验入口单独注册卡片导入、T2 确认、录制读取、脚本 Agent 事件、草稿生成、停止捕获和等待文档保存接口。修改配置、导入、确认和草稿生成均记录活动。普通产品入口保持阶段 1 到 6 的接口与行为。服务端保管模型凭据，OpenCode 使用本机代理，实验终端关闭。

| 工具 | 输入与操作 | 结果 |
|---|---|---|
| K3 | 每个任务、条件、重复创建独立项目，导入夹具与卡片，执行个人 Agent | 状态、usage、trace、diff、工作区快照、实际判定、目标卡片注入与取回记录 |
| K4 | 团队 Agent 接收 Ta 与纠正原文，支持 Yjs 修改，按 T0 到 T5 确认，再由乙执行 Tb | 纠正前 Ta 判定、纠正运行、草稿与修改数量、Tb 判定、跨属主与复用时间 |
| K1 | 转换 script schema 1，调用 replayEvents；在线编辑经过真实协作连接 | 按类型的精确率、召回率、延迟，共现 Top-1/3，真实录制的重复比较 |
| K2 | 普通草稿、服务端复盘、Agent 自我复盘；按输入哈希缓存 | 原始响应、全部引用检查、结构与对象覆盖、两份人工评分 CSV |
| K5 | 包内检索与平台排序规则，支持实际工具查询、活动文件扰动、可选 embedding | Recall@1/3/5、MRR、nDCG@5、对照误注入数量、输入来源 |
| K7 | 48 个旧锚点、六类操作、五个种子，多个 Y.Doc 并发同步 | 独立字符归属真值、五种策略结果、删除复核、同种子一致性 |
| analysis | uv、pandas、scipy、statsmodels | 多数投票、精确 McNemar、任务随机效应 Bayesian logistic、TOST、bootstrap、Holm、Cohen's κ、表格与 PNG |

每行结果保存工具提交、配置哈希、manifest 哈希、provider 与 model。已有组合按 key 跳过，未结束的运行按 run id 继续等待。进程锁阻止同目录并行写入。提交、配置、服务端捕获配置或来源结果变化时终止续跑。K3 的 C6 分别记录过期与矛盾条件；C7 的实验副本按完整卡片格式匹配 C5 长度。

冻结判定器按字节复制到 `.work/judge/tools/run-judge.mjs`，每次调用核对 SHA-256。它读取冻结任务，复制实际 Agent 工作区，再运行项目测试、隐藏测试和行为检查。判定器的中间目录位于实验目录，数据仓库保持只读。

## 试跑结果

结果入口为 [pilot-summary.json](../../experiments/knowledge/runs/pilot-summary.json)。K3 使用 `e9d835e`，补充条件与在线 K1、K4 使用 `48d7a15`，K2、K7 使用 `222089a`，统一规则的录制比较使用 `5478762`，K5 使用 `e670c12`。每个组合保留自身执行时的提交号。

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

K4 在 P01、P03 上各执行 T0、T3 一次，均完成。

| 迁移对 | Ta 是否功能通过且踩坑 | T0 的 Tb | T3 的 Tb | T3 目标注入 | 确认至其他成员首次注入 |
|---|---|---|---|---|---|
| P01 | true | 功能与陷阱均通过 | 功能与陷阱均通过 | true | 60.046 秒 |
| P03，跨属主 | false | 功能与陷阱均失败 | 功能与陷阱均失败 | true | 60.055 秒 |

P03-Ta 的 OutboxMessage 类型导入导致功能失败，分析文件单独记录 taActuallyTrapped，并另外输出 Ta 确实踩坑的子集。试跑采用 delayed 变体。为使纠正原文被识别，实验实例使用 `EXPERIMENT_CORRECTION_TERMS=dataset`，包含 transaction、logicalId、requestId、redactSensitive、actorId 与 serverMember。实际配置随结果保存。T3 的两张卡片都正常生成、确认和注入，scope 为 team。

K1 离线共有 52 个标注知识时刻、34 条建议、17 次命中：精确率 50.00%，召回率 32.69%，共现 Top-1 为 15.38%，Top-3 为 46.15%。20 个标注干扰窗口中没有建议。每类触发的发现延迟保存在 results.jsonl；命中的编辑与 Agent 类事件延迟为 24 到 28 秒。

两段脚本按 10 倍速度驱动真实服务。S01 的服务端建议为 16 条，录制回放原始建议为 18 条；S02 分别为 14 条、16 条。服务端采用同源证据去重。两条路径采用同一规则后，类型、成员、锚点一致，时间误差在 300ms 内；原脚本与录制的原始建议类型序列也一致。统一规则的可重复比较在 [k1-recording-check](../../experiments/knowledge/runs/k1-recording-check/results.jsonl)，真实录制保存在 k1-online-final 的 raw 目录。脚本 Agent 生命周期与工具动作经过实验接口输入捕获；脚本中的模型任务没有执行。

K2 使用 P01 的真实纠正证据，各生成三种草稿。结构合法与全部引用可解析均为 3/3，指定对象 InventoryStore.transaction 覆盖为 0/3，自动 grounded 为 0/3。耗时分别为 11.563、17.434、10.599 秒。服务端模式进行了两次实际请求，原始响应全部缓存。自动 grounded 检查结构、引用和指定对象覆盖；规则语义与范围由两名标注者评分。两份 [评分表](../../experiments/knowledge/runs/k2-pilot/ratings-a.csv) 已生成，尚未填写，因此 κ 和人工均分为空。

K5 使用 10 个陷阱、4 个对照。活动文件来自 K3 注入 trace；没有记录的任务使用提示中的文件路径。R1、R2、R3 和两种扰动共执行 70 次检索。

| 条件 | Recall@1 | Recall@3 | Recall@5 | MRR | nDCG@5 |
|---|---|---|---|---|---|
| R1 纯词法 | 0.20 | 0.20 | 0.50 | 0.3305 | 0.3248 |
| R2 legacy | 0.20 | 0.20 | 0.50 | 0.3294 | 0.3248 |
| R3 bounded | 0.40 | 0.60 | 0.90 | 0.5442 | 0.6204 |
| R2 错误活动文件 | 0.20 | 0.20 | 0.50 | 0.3294 | 0.3248 |
| R3 错误活动文件 | 0.00 | 0.20 | 0.60 | 0.2358 | 0.2766 |

每种条件在四个对照上返回共 20 张卡片，按对照相关集为空计为误注入。K3 主试跑和补充 C3 都没有实际知识工具查询，R4 的输入数量为零。没有配置 embedding 服务，R5 跳过。两个 availability.json 分别记录这些原因。

K7 完成 1440 条轨迹、7200 次策略评价。同种子两次生成的文本、操作、真值与同步更新哈希全部一致。存活率和错误迁移率以下使用 1200 条可定位轨迹作为分母，删除类另计 240 条。

| 策略 | 存活率 | 错误迁移率 | 请求复核率 | 删除类请求复核率 |
|---|---|---|---|---|
| range-only | 0.00% | 100.00% | 0.00% | 0.00% |
| snapshot-only | 40.00% | 0.00% | 60.00% | 100.00% |
| multi-strategy | 62.08% | 32.17% | 5.75% | 100.00% |
| yjs-relative | 79.42% | 20.08% | 0.50% | 100.00% |
| yjs-multi | 83.42% | 0.25% | 16.33% | 100.00% |

Yjs 加多策略仍有 3 条错误迁移。三人并发编辑中，该策略请求复核率为 80%，反映当前相似度阈值的作用。六类操作的完整结果见 [anchors.csv](../../experiments/knowledge/runs/k7-final-pilot/analysis/anchors.csv)。这些数字来自受控并发轨迹。

## 数据与平台复核事项

数据脚本保留 packageJson.dependencySwitch 与 diagnostics.fixed，当前平台触发名称和事件输入不能直接对应这两项。常量恢复没有达到产品的 500 字符或 20 行恢复触发门槛，带注释的数字编辑没有产生 magicNumber.added。chat.dense 与 agent.retried 的部分建议位于标注窗口之外，计为未命中；模型工具输出还需要人工核对是否具有可恢复错误的描述。冻结脚本和标注保持原样。

R2-T02 的提示已经列明输出字段及数组格式，当前失败来自 Agent 输出；是否替换 tooHard 任务由数据负责人决定。P03 的两次 Ta 功能失败，不能作为已完成纠正迁移的证据。数据 README 还要求复核 P03-Ta 的第二份手工踩坑参考补丁与脚本人工标注，本阶段保留这些复核事项。

人工检查中没有确认判定器误判。功能失败时，陷阱检查也可能因加载或输出格式失败；保留完整原因，解释时同时查看 functional 与 trapEvidence。卡片导入没有异常，C2 的目标卡片只命中 R2-T01；其他任务注入了相关性较低的卡片。C5 的四项陷阱都收到目标卡片，三个联合成功。知识工具虽已开启，C3 的 Agent 没有调用它，R4 尚未得到端到端输入验证。

K2 的完整 56 个 episode、T1/T2/T4/T5、same-session 和 revise 路径具备工具支持，本阶段没有执行这些完整矩阵。两名标注者的评分、embedding 条件，以及实验配置增加的纠正词对结果的影响，需要在阶段 8 前明确记录。当前小样本支持工具检查；C0/C2 的四个配对任务在多数投票后没有联合成功差异，McNemar p=1。对照只有一项，TOST 返回空值及样本不足原因，不能作等价结论。混合 logistic 使用 statsmodels 的 Bayesian 估计，完整方法与参数保存在 statistics.json。

## 正式实验估算与运行顺序

估算按冻结材料、每组合三次重复计算。K3 包含 C6 的两个子条件，共九个条件；没有目标卡片的对照在 C5/C7 使用关闭注入的配置，结果保留该配置。K4 每个组合独立执行 Ta、纠正运行与 Tb。

| 部分 | 规模 | 顺序执行估算 | 模型费用估算 |
|---|---|---|---|
| K3 | 14 × 9 × 3 = 378 个 run | 4.15 小时，均值 39.50 秒 | 318.62 元 |
| K4 | 4 × 6 × 2 × 3 = 144 个组合，432 个 Agent run | 3.81 小时；delayed 均值 125.36 秒，same-session 减去固定 60 秒估算 | Agent 175.48 元，复盘 3.31 元 |
| K2 | 56 个 episode，168 份草稿，56 次 Agent 上下文读取 | 0.86 小时 | 20.99 元 |

合计约 8.82 小时与 518.40 元。K3、K4 并发上限为 2，K2 按当前顺序运行时，估算约 4.84 小时，加上在线回放和文件整理约为 5 小时。模型服务限速、重试及不同条件的工具调用会影响耗时。费用采用 AgentRun.usage 和实际草稿请求的用量，尚未核对供应商账单；K2、K4 复盘费用按 P01 估计。价格为每百万 token 输入 2.1 元，输出与 reasoning 8.4 元，cache read 0.21 元，cache write 2.625 元。R5 的服务与费用尚未确定。旧原型的 60 次草稿实验使用 DeepSeek，需要在论文中注明与本实验的模型差异。

阶段 8 的建议顺序为：由人确认数据复核事项与模型配置；执行 verify、K1、K5 和 K7；执行 K3 与 K4；从实际纠正证据生成 K2，收集两份独立评分；执行统计。各阶段使用独立结果目录，固定输入与配置后续跑。

## 检查记录与文件位置

| 检查项 | 检查方法 | 本次结果 |
|---|---|---|
| 数据只读 | verify 逐项哈希，查看数据 Git 状态 | 1509 项相符，Git 状态为空 |
| 工具构建 | pnpm --filter @simplercp/experiments build | tsc 通过 |
| 工具测试 | pnpm --filter @simplercp/experiments test | 7 项通过 |
| 产品回归 | 平台 server 与 knowledge 测试 | server 133 项、knowledge 152 项通过 |
| 判定稳定性 | 两次运行同一实际工作区 | 布尔结果、退出状态与计数相同 |
| K3 试跑与校准 | 真实 Agent、冻结判定器 | 主试跑及校准 36 项，补充条件 15 项完成 |
| 续跑 | 再次执行相同主试跑命令 | 36 项跳过，没有新增 Agent |
| K4 | 两对 × T0/T3 | 4 项完成，P03 的 Ta 未进入实际踩坑子集 |
| K1 | 两段离线、两段真实在线、录制复核 | 两段比较一致；原始与去重序列都保留 |
| K2 | 三种模式实际请求及缓存复核 | 3 份结构与引用通过，自动 grounded 0/3，人工评分为空 |
| K5 | 完整卡片库与实际活动文件，错误文件扰动 | 70 项完成；R4 零查询，R5 未配置 |
| K7 | 全部轨迹生成两次并比较哈希 | 1440 项一致，五策略共 7200 项 |
| 统计 | 对实际 K3、K4、K2、K5、K7 结果运行 Python | 表格、置信区间、模型参数、等价限制及三类 PNG 已生成 |
| 凭据 | 新增文件与输出检查长凭据和 JWT 模式 | 没有发现匹配；配置仅记录 apiKeyConfigured 布尔值 |

提交的结果在 `experiments/knowledge/runs/`，包括 results.jsonl、配置、汇总、评分表与统计图。原始输出的绝对位置为 `/Users/baokker/Work/Master/CSCW/过程性知识管理/code/SimpleRCPv2/experiments/knowledge/runs/<目录>/raw/`，包含 trace、diff、快照、模型响应、录制与判定输出，已由 gitignore 排除。过程检查材料位于同一实验目录的 `.work/previous-runs/`。三个专用服务在试跑结束后停止，工作区与原始输出保留。
