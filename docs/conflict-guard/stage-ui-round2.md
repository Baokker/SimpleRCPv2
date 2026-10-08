# 冲突预防界面与双 Agent 运行验证

日期：2026-10-08。分支：`feature/conflict-guard`。修改基准：`27c74e5`。

## 信息布局

- 意图板分别显示 Agent 身份、任务状态、任务说明、计划范围和实际范围。文件与符号分行显示，超出计划的符号带有状态标签。
- 冲突卡片和关联修改使用两行参与者信息，每行显示成员与符号。区、处理动作和规则各自显示为标签，关系路径按每一步调用或引用分行显示。
- Agent 检查记录显示“写入前检查（T2）”或“结束后复检（T3）”，检查结果、规则和摘要分别显示。
- 模型来源使用标签，置信度和耗时使用两个指标单元。解释与建议保持按句换行和三行折叠。
- 统计按冲突处理、模型研判和属主处理分组，名称与数值独立显示。索引数量与运行明细通过“索引与运行统计”展开查看。
- Agent 面板分别显示拒绝次数、审批等待时间、最近拒绝原因和 T3 结果。个人 Agent 与团队 Agent 的操作记录共用撤回数量和保留数量的指标布局。
- 编辑器横幅使用警告图标、冲突数量、处理位置和展开图标；通知分别显示警告状态、说明、建议和关系路径。

## 样式

字体继承系统字体。面板正文、标题、辅助文字使用现有协作面板的字号层级，背景与边框使用 `--background-control`、`--background-control-alt`、`--border-subtle` 等主题变量。

冻结使用 `--danger`，警告使用 `--folder`，放行使用 `--online`，分析状态使用 `--accent-text`。每个状态同时显示文字。卡片圆角、间距与按钮形状沿用现有面板样式。

关联修改可以通过按钮展开，统计与代码详情使用原生 `details`。按钮和展开控件提供键盘焦点提示。较窄面板中的名称、文件路径与说明可以换行。

## 人工查看

使用仓库现有 `.env` 配置启动 `pnpm dev:stable`，通过两个浏览器会话制造冲突，按照 [人工验收文档第 5.5 节](manual-acceptance.md#55-卡片角标与横幅) 检查布局、主题、展开收起、确认和撤回。意图板和 Agent 检查沿用该文档的阶段六、阶段七操作。

## 验证

`pnpm -r build` 通过。四个 Playwright 文件共 10 项通过，使用真实服务端、两个独立 Chromium 上下文、Monaco 与 Yjs。

界面用例检查了两个冲突的角标、三个操作按钮的宽高与顺序、修改前后代码、编辑器横幅、双方确认、交叠撤回提示、成功撤回和警告关闭。统计数值与真实 state API 比较，关系路径的每一步分别显示。

主题检查验证系统字体继承、深色与浅色背景和标题颜色、刷新后的主题与成员身份保存。将面板调整到 280px 后，卡片、参与者行和指标单元没有横向溢出。检查依据为 DOM、接口数据、元素尺寸和浏览器计算样式。

界面布局的命令、日志和文件哈希见 [验证记录](evidence/ui-round2/verification.json)，主题与尺寸数据见 [layout.json](evidence/ui-round2/layout.json)。该组布局测试没有请求模型。通用 Agent 活动和真实并发任务的验证见下文。

## 候选生成与判定

本轮 Agent 修复基准为 `5cd3909`。一次批次内，一跳相关或具有包含关系的符号合并为符号簇。候选对保存双方完整 symbols 和 relations；所有关联继续使用相同分类器，严重程度最高的结论控制整簇。共享但没有被双方修改的类型引用在候选生成时过滤。第三位参与者修改共享类型时，只保留其与依赖该类型的参与者之间的候选关系。

T1、T2、T3 共用项目判定队列，默认合并 200 ms 内的请求，每次处理最多 20 个变更对。取消或服务关闭会结束 Agent 的等待请求。pairId、revision 和输入指纹构成结果缓存；T2 与 T3 按 run 和时点复用缓存。公开结论保持一致时不再写入 pair_judged 或重复推送。同一簇中的模型输入、冻结范围和文件闸门涵盖全部成员。

原 run `_3IyfXyObhle` 保存 573 次候选新增和 573 次判定。相同输入事件的本地规则重放产生 4 次目标 T2 判定，整个会话 13 次；errors 为空。项目原轨迹还包含 T1 事件，涉及该 run 的原计数为 592。查询命令见 [benchmark.md](benchmark.md#真实并发轨迹的候选计数)。

原记录的 19 个有效单元全部找到对应的符号与文本哈希。相同单元中，形成变更对由 18 个变为 16 个，无关系由 1 个变为 3 个；两个新增无关系单元仅有类型路径。候选关系在批次结束前关闭时，该活跃周期的关联记录仍计入变更单元统计；新的活跃周期独立计算。当前重建还识别了 run 开始前 PriceRule.apply 的一个批次，所以全会话分母为 20，形成变更对 17 个，无关系 3 个。报告同时保留匹配单元和全部重建单元的统计。

## 导出规则核验

真实审批 diff 能完整恢复 pricing.ts 的提案，before/after 哈希与记录一致。Agent 删除的是重复声明 formatMoney@2，公开的 formatMoney 仍然存在；该次 runtime-export-removed 属于误阻断。

符号映射现在检查同名公开声明是否仍存在。非空但无法解析的 after 使用 unparsable-side，导出取消必须有可解析文本或明确删除作为依据。脱敏原输入位于 `packages/conflict-guard/test/fixtures/dual-agent-export.json`。回归验证 diff 恢复、重复声明删除与原声明暂时无法解析的情况。

另一个审批场景是在 DoubleElevenPromotion 前方插入 Promotion618Options。对手的范围现在根据对手自己的 proposalText 或共享文本计算，保持其符号归属；测试确认两个无关接口可以分别新增。

## 通用 Agent 活动与失败诊断

个人与团队 Agent 共用 AgentRunProgress，显示当前工具、参数摘要、工具持续时间、任务时长、文件数量和 token。reasoning 增量进入折叠区域，没有文字时明确显示模型未提供推理过程。默认连续 20 秒没有增量时显示等待时间，60 秒时提供执行较慢的提示与取消操作。配置阈值保存在 run.activity.config 中，个人与团队 Agent 使用相同的配置。运行列表显示审批、拒绝次数、需要处理状态和同时执行的 run。

服务端每 500 ms 合并活动更新，part delta 继续保存到 run trace。traceStore 初始化读取已有序号，之后直接追加。OpenCode 使用 promptAsync 和会话事件接收结果；事件连接提前结束、取消和进程关闭会结束相应请求。

失败记录保存阶段、请求位置、目标、错误类型、HTTP 状态或嵌套 errno、最后成功序号和重试指导。失败后的文件归属与 T3 状态继续保存；界面保留已经完成的文件列表。网络错误可重试，认证、模型配置和 HTTP 禁止端口需要修改配置。调度失败和服务重启中断也保存相同结构。

原始 fetch failed 没有 cause 和请求信息，无法确定其网络来源。本轮另行核验了 HTTP 客户端拒绝 4190 端口的配置错误；最终验收使用 4195。两者的证据范围见 [网络错误说明](known-issues/agent-network.md)。

同一 run 与同一参与者连续冲突时，第三次拒绝明确要求停止修改、说明冲突并等待指示，属主收到一次需要处理的通知。通知的 action/light 级别和已读、已处理状态一起保存。

## 新增配置

| 配置 | 默认值 | 含义 |
|---|---:|---|
| CONFLICT_GUARD_JUDGEMENT_FRAME_MS | 200 | 公共判定队列的合并窗口，毫秒 |
| CONFLICT_GUARD_MAX_JUDGEMENTS_PER_FRAME | 20 | 一次队列处理的变更对上限 |
| SIMPLERCP_AGENT_WAITING_MS | 20000 | 等待响应提示阈值，毫秒 |
| SIMPLERCP_AGENT_STALLED_MS | 60000 | 执行较慢提示阈值，毫秒 |

数值须为正整数，STALLED_MS 必须大于 WAITING_MS。日常测试关闭真实调用；手动真实用例需要显式配置 SIMPLERCP_LIVE_AGENT_TESTS=1，双 Agent 浏览器验收需要 SIMPLERCP_ROUND2_LIVE=1。

## 双浏览器真实验收

两个独立 Chromium 上下文分别使用 Alice 和 Bob，运行 DeepSeek deepseek-flash。Alice 新增满 300 减 50 的双十一优惠，Bob 新增减免原价 18% 的 618 优惠；两人同时通过 Monaco 局部编辑修改 pricing.ts 的两个不同函数。

最终两个 Agent 全部 completed，人工修改全部保留，原项目测试与独立优惠验收通过。项目共发布 4 次判定，provider_call 中有 2 条深判记录。界面检查确认两个成员均可见实时活动。运行记录、轨迹、测试输出与截图位于 [round2-dual-agent](evidence/round2-dual-agent/)，断言结果为 acceptance.json。

真实调用预算复核发现，旧的 API 集成测试在常规全量回归中也会读取环境密钥请求模型。本轮在停止时至少已有 17 次真实 run 尝试，超过最初 6 次要求；用户随后明确授权额外 2 次最终验收，累计至少 19 次尝试。真实测试现在统一需要显式开关，后续回归关闭该开关。调用次数和可恢复的深判记录写入验证清单。最终真实验收使用当时的源码；之后补充的公共判定队列、通知级别持久保存、变更单元统计、第三位参与者的共享类型过滤和活动阈值同步通过无需真实调用的集成与浏览器回归验证。

## 回归验证

回归包含 pnpm -r build、conflict-guard 包全量测试、服务端全量测试、pnpm test:demo、off/observe/rules/full 四种模式的 pnpm test:collab，以及相关 Playwright 文件。原规则、阶段三、通用 Agent 和界面布局用例保持原有断言。当前代码与命令的最终结果见 [验证清单](evidence/round2-dual-agent/verification.json)。

| 验证 | 结果 |
|---|---|
| pnpm -r build | 通过 |
| conflict-guard 全量 | 259 项通过，含两项离线 CLI |
| 后续 conflict-guard 回归 | 259 项无需 CLI 的测试通过；最新候选、状态机、回放与指标专项 56 项通过，覆盖新增用例 |
| 服务端全量 | 292 项通过；9 项手动真实调用用例按开关跳过 |
| 最后一次 Agent、索引与仲裁集成 | 63 项通过 |
| 通用活动配置与个人／团队 Agent 接口 | 32 项通过 |
| 公共队列后的浏览器回归 | 13 项通过 |
| 通用活动配置后的个人／团队 Agent 浏览器回归 | 9 项通过 |
| 阶段三浏览器回归 | 13 项通过 |
| pnpm test:demo | 2 项通过 |
| pnpm test:collab | 四种模式各 2 项通过 |
| 追加授权的真实双 Agent 验收 | 1 项通过，两个任务完成 |

专项用例覆盖符号簇的完整灰区输入、任一签名不兼容控制整簇、审批插入声明的范围归属、同一修订缓存、第三次同对手拒绝、失败文件保留、HTTP/cause 诊断、通知级别持久保存。时序集成用例使用 idleMs=1500 和 300 ms 文件写入延迟。

## 可以单独用于主分支的改动

| 文件与函数 | 功能 |
|---|---|
| server/agent/agentProgress.ts：createAgentProgress | 工具活动、reasoning、token、等待响应时间 |
| client/components/AgentRunProgress.tsx：AgentRunProgress、AgentRunStatus | 通用 Agent 状态、失败详情、取消和重试 |
| client/components/AgentPanel.tsx、CollaborationPanel.tsx | 个人和团队 Agent 的共用活动展示 |
| server/agent/agentRunFailure.ts：diagnoseAgentFailure、safeRequestTarget | 结构化诊断与请求目标过滤 |
| server/agent/openCodeRuntime.ts：run、subscribe、providerFailure | 异步请求、流式结束处理、模型服务诊断 |
| server/agent/openCodeProcess.ts：start | 本机连接失败的请求信息 |
| server/agent/agentRunManager.ts：executeRun、initialize、调度 onError | 活动合并、失败记录与已有文件保留 |
| server/agent/traceStore.ts：createTraceStore | 连续序号和追加写入 |
| shared/index.ts、server/config.ts、server/realtime.ts | 通用活动类型、阈值配置与同步 |
| server/createApp.ts：createApp | 向 runtime 和 run 管理器传递相同的活动阈值 |
| server/routes/agentRoutes.ts：status 路由 | 启动错误的结构化提示 |

候选生成、分区规则、T2/T3 与属主通知属于当前冲突预防分支。主分支没有修改。

## 适用范围

相同轨迹的候选计数使用本地规则模拟，模型输入聚合后需要新的匹配缓存才能复现模型质量。原网络失败没有足够的历史诊断信息。模型关闭推理时，界面只能展示工具活动和等待时间。真实优惠验收验证两个规定任务及现有测试，完整促销业务需要相应验收测试。方案设计第 3.2 节原文件未在当前工作目录找到，当前候选规则保存在 routing-rules.md 和 benchmark.md。保留集与阶段八正式实验均未执行。
