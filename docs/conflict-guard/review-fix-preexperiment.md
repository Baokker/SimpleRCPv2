# 实验前修复与验证

日期：2026-10-10。分支：`feature/conflict-guard`。正式 X1 至 X7、保留集策略评价均未执行。完整冻结等待有效的 Jev 开发集录制与阈值校准；协议保持 `awaiting-human-confirmation`。

源码、数据与证据提交：`ec8bd54c2f4a4e46397ab077581b852fe97190b4`。本报告及冻结准备文档使用同一个源码提交号。

## F1 至 F8

| 编号 | 完成情况 | 内容与证据 |
|---|---|---|
| F1 | 已完成 | 每次 edit 根据当前策略决定更新文件的 counterfactual 标记，后续放行清除标记。两轮阻止、放行回归通过。 |
| F2 | 已核验并统一计算入口 | `classify` 在有序规则之前计算一次四状态检查，后续规则复用。注释白区、相邻修改黑区、远距离函数体修改灰区、签名修改黑区均通过。 |
| F3 | 已完成 | warnings 使用完整对象断言，包含 pairId、revision、warningKey；CLI 归档录放回归通过。包内 273 项测试通过。 |
| F4 | 尚未完成最终冻结 | 协议、数据版本、模型、价格和实验入口已经更新。Jev HTTP 451 使有效阈值校准受阻，完整冻结生成和完整性验证尚未完成。 |
| F5 | 已完成 | 深判为 MiniMax-M3 国内站；专用适配器、配置、Agent provider 与凭据白名单已接入，三项真实 Agent 冒烟通过。 |
| F6 | 已完成 | X4 的统一入口输出关系组 exact McNemar、实验内 Holm、关系组 bootstrap；空分母输出 N/A。 |
| F7 | 数据扩充完成，校准受阻 | D1-v3 新增 40 个可执行探针确认安全的灰区开发关系组。有效 Jev 结果缺失，推荐阈值为空。 |
| F8 | 入口完成，正式运行等待确认 | X2 的 k 与规模分层、X5 策略与注入、X6 三种仲裁、X7 五种消融、D2 独立读取均已接入，16 条协议命令参数检查通过。 |

`declaration-body-unrelated` 的源码核验显示，它已经调用 `mergeOnlyTypeError(context)` 取得四状态结果，原有远距离函数体测试通过。本轮将计算入口统一到规则循环之前，并通过真实四状态检查的调用计数验证每份输入只计算一次。仅 merged 出现类型错误时仍判黑区。用户确认保留注释放行与相邻代码修改黑区的语义。

## 对已有数字的影响

同一份 D1-v2 开发集按完整四状态程序去重后为 79 个有效样本。原始输出保存为 [baseline/results.json.gz](evidence/preexperiment/baseline/results.json.gz)，本轮输出为 [repaired-d1-v2/results.json.gz](evidence/preexperiment/repaired-d1-v2/results.json.gz)，数值核验见 [impact.json](evidence/preexperiment/impact.json)。

| 指标 | 原始开发回放 | 本轮同数据回放 | 差值 |
|---|---:|---:|---:|
| P3 白区 revision | 33 | 33 | 0 |
| P3 灰区 revision | 53 | 53 | 0 |
| P3 黑区 revision | 41 | 41 | 0 |
| P0 反事实编辑数 | 0 | 0 | 0 |
| P1 反事实编辑数 | 703 | 703 | 0 |
| P2 反事实编辑数 | 915 | 915 | 0 |
| P3 反事实编辑数 | 160 | 160 | 0 |
| P* 反事实编辑数 | 370 | 370 | 0 |
| P3 逃逸数 / 冲突真值样本 | 4/22 | 4/22 | 0 |

反事实编辑数按被冻结的 edit 计数；文件上的 counterfactual 标记供后续写入状态判断使用。这份开发数据上的编辑计数保持相同，专门的两轮回归验证后续放行时标记为 false。每次 `replayTrace()` 都创建自己的状态，策略之间分别执行。

无关系比例以语义变更单元为单位。本轮为 61/320，即 19.06%；原样本统计为 21/79，即 26.58%。两个数的单位分别为变更单元和程序样本，不能据此声称候选算法收益。手工核验 `d1-0011-safe` 的五个语义批次均无候选对，结果为 5/5，与程序输出相同，见 [逐批次核验](evidence/preexperiment/unit-audit/manual-count.md)。

D1-v3 共 240 个关系组：开发 115、保留 125。323 个非 alias 标签为 allow 237、warn 0、lock 79、exclude 7。开发去重后有 119 个样本，allow 97、lock 22。新增 40 个 CP-3 安全配套修改使用四状态可执行探针标注，保留集程序与标签逐项核验相同。D1-v3 的 P3 分区 revision 数为白区 33、灰区 187、黑区 41；灰区增加 134 次，反映新增安全关系组的中间与最终 revision。

标签中的 warn 数量仍为零。当前补充目标为至少 30 个真值 allow 或 warn 的灰区关系组，实际补充 40 个 allow 关系组；这些标签来自探针。规则或模型输出的 warn 作为系统判定单独统计。

## MiniMax 与开发集录制

深判与真实 MiniMax Agent 使用 **MiniMax-M3**，站点为 **https://api.minimaxi.com/v1**。国际站探测返回 401，国内站返回 200；响应中的 model 为 MiniMax-M3。T1 与 Agent 运行关闭推理，Agent 写入前检查与任务完成后复检开启推理。研判配置为 `adjudication-v2`，快判固定 `jev-1.13.0`，DeepSeek 保留为 X3b 的替代深判。

本机 `.env` 已配置 `MINIMAX_BASE_URL=https://api.minimaxi.com/v1` 与 `MINIMAX_MODEL=MiniMax-M3`，与该 key 的实际站点一致。凭据保持在被忽略的 `.env` 中。

MiniMax 使用独立适配器、输出格式检查和完整缓存身份。`finish_reason=length`、型号不符、缺少字段均不能形成有效判定。OpenCode provider 根据 `SIMPLERCP_AGENT_PROVIDER` 生成，仅传递被选择 provider 的凭据。

三项真实 Agent 冒烟完成：读取并 edit、write 新文件、读取两个文件后 edit。写入被拒的任务重新读取并调整，随后完成。完整 assistant 与工具历史验证通过，保留了 31 条 assistant 消息和 74 条工具消息。证据见 [Agent verification.json](evidence/minimax-agent-smoke/verification.json)。

探测与冒烟累计 46 次 MiniMax 请求、4 次 Agent run，额度为 100 次请求、6 次 run。最终三项任务使用 18 次请求，已知 token 费用估算 CNY 0.27756666。此前未完成任务和接口失败仍计入累计调用；缺少 usage 的费用不记为已知零费用。

开发集单次录制使用 184 次 MiniMax 深判请求、184 次 Jev 快判请求；另有两次 Jev 诊断请求，快判累计 186 次。开发预算为快判 1000、深判 600 次。录制没有重新调整提示词或重复执行深判。

| 开发策略 | 模型完成率 | 全开发集一致率 | 漏阻断率 | 误阻断率 | 模型任务 p50 / p95 ms |
|---|---:|---:|---:|---:|---:|
| G1 MiniMax 深判 | 62/75 = 82.67% | 58.0% | 31.8% | 7.2% | 5263 / 8000 |
| G2 Jev 快判 | 0/184 = 0% | 50.4% | 59.1% | 0% | 72 / 86 |

G1 的 HTTP 调用为成功 139、超时 36、格式无效 9。模型任务完成率按最终回放中实际产生的研判任务计算，HTTP 请求与中间 revision 分别计数。G1 未通过 T03 的完成率、漏阻断率、一致率与 p50 门槛。已知 token 为 230708，已知费用估算 USD 0.1307139；45 次调用缺少 usage，费用另列为未知。

Jev 两次诊断均返回 HTTP 451：`Typesafe is not available in your region.` 第二次按用户更换环境后的要求执行，最新证据为 [jev-diagnostic.json](evidence/preexperiment/jev-diagnostic.json)。开发录制的 184 个快判响应均记录为 failed，原录制没有保留每个请求的 HTTP 状态。G2 表内质量描述失败后的系统动作，不能作为 Jev 的分类质量；72/86 ms 是失败响应耗时，不能作为成功推理延迟。

校准材料 [calibration.json](evidence/preexperiment/calibration/calibration.json) 标记 `status=blocked`、`recommended=null`。各阈值在缺少有效快判时都为零覆盖、全部升级，不能提供有意义的阈值选择。用户要求更换环境后仍无法访问时暂缓，因此停止新增真实请求，暂缓 G3 校准验证与完整冻结。已有 MiniMax 缓存保留，可在完整请求身份相同时复用。

价格来源为官方国内站定价页，日期 2026-10-10，标准档每百万 token 输入 CNY 2.1、输出 CNY 8.4、缓存命中 CNY 0.42，见 [价格与站点](evidence/minimax-probe/selection.json)。预算换算采用 CNY 7 = USD 1 的固定记账系数，原币种同时报告。

## 实验入口与统计

X4 以 `relationGroupId` 配对，一组内全部有效变体判定正确时记为正确。使用 exact-two-sided McNemar，同一实验内全部策略两两比较使用 Holm 校正；X7 的检验族为基线与具有有效结果的消融条件。机器结果保存到 verification.json，显著性表保存到 summary.md。

bootstrap 重复 2000 次，种子 20261007；数据生成种子 20261008。空分母表格显示 N/A，帕累托图跳过没有冲突真值的策略。无关系比例的分母使用实际关闭批次的语义变更单元，保存原始计数。

离线录放保存实际模型端点、MiniMax JSON 输出开关与 temperature，使用 `--providers` 读取配置。`adjudication:verify` 从原录制引用的缓存恢复这些参数，并逐项核验缓存身份，三份输出使用独立目录。真实国内站响应回归验证判定内容、订阅等待时间、缓存命中和零网络调用。完整冻结会导出 `providers.json`，X4 与 X7 使用该文件。

新报告保存实际请求配置，验证器直接读取该字段。行为一致性与缓存完整性分别登记：`valid`、`byteIdentical` 表示复现结果，`sourceCacheMisses`、`cacheComplete` 表示缓存是否完整。完整模型质量评价要求所需缓存齐全。

X2 支持 k=1、2、3，按源码非空行数分层，报告全量与逐批次增量索引的 p50/p95。双 Agent 原轨迹本地规则模拟中，目标 run 判定数为 573 → 4，整个 session 为 13；19 个原始单元全部匹配，其中两个单元经纯类型路径过滤后计入无关系。该比较的模型调用为零，见 [candidate-counts.json](evidence/preexperiment/candidate-counts/candidate-counts.json)。查询命令保存在 benchmark.md。

X5 支持 P0/P3/P5、意图注入 on/off、独立项目与输出目录。X6 的 owner 真实结果引用 X5/P5/on，其他仲裁模式使用独立真实任务结果。X7 支持五个消融条件，no-invariants 每个 split 新录制，其余复用完整缓存；缓存缺失单列并禁止比较效果。D1 没有 Agent 完成复检，no-T3 标记 N/A，D3 使用实际轨迹另统计。

D2 使用 51 条来源案例作为分母，六个演示场景独立。D2 测试使用仓库内 37 份真实来源文件夹具。D3 没有逐次持久写入的冲突真值探针，逃逸率为 N/A，任务完成率与冲突逃逸分别报告。

独立阶段八预算在每次请求和 Agent 执行时计数，验证冻结状态、提交、协议及预算哈希。预算预计超过 120% 时终止并写入停止原因。阶段七预算与本轮开发预算分别维护。当前 `preparation.status=blocked`，正式入口会拒绝执行。

## 测试与复现

| 命令 | 本轮结果 |
|---|---|
| `pnpm -r build` | 通过 |
| `pnpm --filter @simplercp/conflict-guard test` | 30 个文件、273 项通过 |
| `pnpm --filter @simplercp/server test` | 309 项通过、9 项按既有条件跳过 |
| `pnpm test:demo` | 2 项通过 |
| `pnpm test:collab`，off / observe / rules / full | 每种模式 2 项通过，共 8 项 |
| 新增实验入口与冻结脚本 tsc | 通过 |
| 真实开发录制的无有效快判校准回归 | 单项通过；受阻状态写入文件，命令终止，目录中仅保留 calibration.json |
| 真实开发录制的三轮离线录放 | 与原录制一致，三份输出逐字节相同；G1/G2 缓存缺失与网络调用均为零 |
| 16 条协议命令 `--plan` | 通过，模型调用与保留评价均为零 |
| `.env` 中凭据的精确值扫描 | 匹配计数 0 |

测试覆盖后续放行清除标记、注释与函数体规则顺序、四状态计算复用、合并独有类型错误、完整 warning 身份、关系组统计、空分母、MiniMax 实际响应格式与 Agent provider。已有录制的三轮离线一致性验证结果单独保存到 [repeatability.json](evidence/preexperiment/replay/repeatability.json)。三轮 SHA-256 均为 `87ed230b272455c4ead5b7f03132bfabd1af1db460bceb3d4b537043841df90b`；完成三轮计算后，`--use-existing` 读取这三份输出核验配置与缓存计数，未增加运行轮次。

数据本体保存在 D1-v3 的 `dataset.json.gz`，模型录制保存在 `bench/model-cache/preexperiment/model-cache.json.gz`。展开文件由 `data:artifacts --restore` 恢复，生成器和固定种子随源码保存。真实输出、配置、命令、报告均保留；正式实验需要有效校准和人工确认。
