# 检查点 B 修复验收

## Agent 修改审批

| 编号 | 修改位置与行为 | 验证用例 |
|---|---|---|
| A1 | workspacePath.ts 缓存工作区 realpath，并从存在的父目录规范化请求路径；workspace、提案、台账、快照、T3 和回灌共用。permissionDispatcher.ts 对同文件内部错误计数，第三次起停止重复修改并通知属主。 | accepts and rejects Agent edits through a symbolic workspace using production timings；accepts canonical OpenCode paths through a workspace symlink and rejects external symlinks；stops repeated internal failures on one file and notifies the owner once；limits failures raised while normalizing a permission's file path |
| A2 | conflictGuardEditHandler.ts 在批准前重新核验磁盘 before；projectAgentGuard.ts 登记两秒预约，collaborativeDocuments.ts 在确认期间暂停 Yjs 文件写入，并从保存快照合并 Agent 与人类修改。第二份同文件全文提案等待首次确认后重新读取。 | rejects a stale full-file T2 write and keeps a human edit during its 1500ms judgement；merges an approved Agent write with a human edit made before write confirmation；prevents a second whole-file Agent write until the first reservation is confirmed |
| A3 | conflictGuardEditHandler.ts 通过 tool.callID 优先读取 edit/write 输入；后备使用 diff 库，支持 hunk 的统一缩进恢复。 | reconstructs a deeply indented trimDiff and prefers exact tool input |
| A4 | openCodeRuntime.ts 的 createRunSessionFilter 登记 session.created 后代，agentRunManager.ts 将事件交给同一分发器，回复使用请求的 sessionID。 | tracks descendant OpenCode sessions and excludes unrelated permission requests；replies to an edit permission from a child Agent session |
| A5.1 | apply_patch 接受 patch ?? diff、filePath、relativePath、type、movePath；stage-6.md 与 agent-guard.md 列出 SDK、夹具和 edit/write 的真实证据来源。 | accepts the OpenCode apply_patch metadata patch field |
| A5.2 | T3 的无法核验范围限定为本次台账及本次 user messageID 的 session diff 文件。 | ignores earlier session files during the next run's T3 verification；reports incomplete T3 attribution when a member edits a bash-written file |
| A5.3 | proposalFileChange 计算精确修改范围，SemanticChangeTracker 读取对方提案自己的 after。 | reserves precise disjoint functions in one file for two Agent proposals |
| A5.4 | 预约两秒后读取实际内容并清理，记录 reservation_mismatch；批准删除文件也能确认。 | clears a formatted approval after its two-second confirmation deadline；confirms an approved deletion without keeping its write reservation |
| A5.5 | projectAgentGuard.ts 按文件维护 Promise 队列，多文件提案等待涉及的全部文件；30 秒预算从开始判定计算。 | reserves precise disjoint functions in one file for two Agent proposals；pauses a short run timeout while a T2 model request is pending |
| A5.6 | createGuardConflict 生成双方显示名、符号、前后签名、规则、中文解释与建议；拒绝消息和属主摘要均使用中文。 | rejects an Agent signature conflict, accepts a compatible retry and keeps the human editable；includes multiline parameters in function and method signatures |
| A5.7 | humanPair 过滤覆盖人类后开始编辑的场景；批准后的同文件修改通过 Yjs 快照合并。 | keeps a later human dependency edit editable while an Agent run is active；merges an approved Agent write with a human edit made before write confirmation |
| A5.8 | 确认、撤回、T0 使用 ActorRef 的 actorKey，人与 Agent 的冲突继续仅通知 Agent 属主。 | P2 先后编辑在判定前和判定后保持调用方磁盘内容；C9 单方接口变化结束批次后即可触发依赖方 T0；人类后开始编辑用例 |

Agent 集成用例位于 apps/server/src/__tests__/agentGuard.integration.test.ts，使用 createApp、两个 WebsocketProvider、文件监听与真实磁盘。idleMs=1500，文件写入延迟为 300 ms。提案和分发器单元测试分别位于 agentEditProposal.test.ts、permissionDispatcher.test.ts、openCodeRuntime.test.ts。

## 数据与模型评价

| 编号 | 修改位置与行为 | 验证或证据 |
|---|---|---|
| E1 | bench/seeds/native 中八个独立手写业务项目，每个五份生产文件和一份测试，非空代码行含测试均超过 300。diversity.ts 检查跨项目 identifier 归一化 token LCS Dice；generator.ts 检查程序及站点交集。D1-v2 生成并标注 200 组，开发集 75 组、三个项目。 | nativeTemplates.test.ts 的 copied business file、真实符号选择和确定性测试；seed-diversity.json；D1-v2 manifest、labels、excluded 的归档 |
| E2.1 | provider_call 带 cacheKey；replay-check.ts 从 full 轨迹恢复策略、模型与缓存，核验判定、闸门、文件写入、冻结。 | conflictGuardAdjudication.integration.test.ts 四项生产参数测试；05-full.jsonl 与 05-full-cache.json |
| E2.2 | 缓存身份包含角色、提示词正文和请求参数哈希，区分 temperature、reasoning、截止时间、endpoint。 | separates fast and deep cache entries when adapter and model names match；selects G4 T2 deep reasoning with its own budget and cache identity |
| E2.3 | statistics.ts/evaluation.ts 实现 exact McNemar、Holm 和关系组 bootstrap；checkpoint-b-report.ts 主表包含 P*、逃逸率、token 与冻结上界。 | statistics.test.ts；statistics.json、families.md、summary.md |
| E2.4 | G1、G2 各三轮独立真实 HTTP 录制，使用三个独立缓存目录；其余条件通过录放核验。 | real-round1/2/3、real-repeatability.json；G1 最终一致 78/79，G2 为 77/79 |
| E2.5 | invariants.ts 穿透别名，筛选引用修改符号或调用方的断言，记录四类上下文比例。 | follows an exported alias and keeps only relevant assertions；provenance.json：调用点/断言/返回用法/注释为 84.6%/25.0%/84.6%/13.5% |
| E2.6 | adapters.ts/config.ts 按配置注册快判，支持兼容端点的 logprobs 与 temperature 1 单词采样；能力响应只计 token。 | uses conditional choice logprobs for the compatible fast role；estimates fast probabilities with one-word samples when logprobs are unsupported；excludes the temperature-zero capability response from sampling probabilities |
| E2.7 | metrics.ts 在最后一次编辑处截断冻结积分，另报 unattendedFrozenPersonSeconds。 | replay.test.ts；主表同时保存两个时长指标 |
| E2.8 | 检查点 A 的 P2 变异同时取消 pending/stale 与 pending(file) 两处保护，并重新构建包。 | 生产用例的 500 ms 磁盘内容断言失败；mutations/pending.log |

开发集去重评价 79 个样本，真值 lock 22、allow 57。生成器没有调用模型，保留集没有执行策略。开发与保留项目之间程序交集和站点交集均为零，最大跨项目文件相似度为 0.5994397759。原始项目业务测试十六项通过。全部项目来源为本仓库手写基准代码。

P0/P1/P2/P3/P* 的逃逸率分别为 100%/40.9%/13.6%/13.6%/13.6%，误阻断率分别为 0%/40.4%/71.9%/0%/0%。P* 未阻止的三个组没有候选对。G1/G2/G3 一致率为 88.6%/89.9%/88.6%，漏阻断率为 31.8%/27.3%/31.8%，均未达到 T03 的漏阻断条件，其余五项条件通过。

校准十二个最终灰区 revision 全部为 lock 标签。阈值改变升级比例，未改善当前子集的漏阻断率；推荐值为 0。该子集无法评价灰区安全样本的误阻断率，报告保留这一限制。兼容端点未配置，额外模型的真实 X3b 冒烟待补，接口与概率算法单元测试通过。

## 界面与后续接口

| 编号 | 修改位置与行为 | 验证用例 |
|---|---|---|
| U1 | api.ts 对 204、空响应体返回 undefined，冲突确认和撤回接口返回 204。 | two conflicts use one expandable banner and a successful undo has no JSON error；既有确认、撤回 Playwright 用例 |
| U2 | EditorArea.tsx/styles.css 使用一个可折叠单行横幅，合并冲突数量；编辑器保留装饰与悬停说明。 | 两个冲突、一个横幅、无 editor-conflict-overlay 的 DOM 断言 |
| U3 | projectConflictGuard.ts 在副本 Y.Doc 上执行 Undo，TypeScript 语法验证通过后才更新主文档；交叠导致无效声明返回 409，保持原内容与状态。 | U3 rejects an undo that would produce an invalid overlapping function declaration |
| U4 | 状态不允许与没有可撤回内容分别返回 409 文案；routes 使用 guard 保存的失败原因。 | P5 拒绝观察模式下确认和撤回并保持内容；锁定、切换文件和交叠撤回测试 |
| U5 | adapters.ts 校验 DeepJudge 响应 model。 | rejects a deep response from another model |
| U6 | 模型解释、建议和通知生成时执行 trim。 | 适配器与模型警告测试；真实页面验收 |
| U7 | adjudication-prepare-dev.ts 使用 stage5-smoke-####，developmentOrigin 保存来源。 | stage5-dev-smoke-v2 归档与 README |
| S1 | permissionDispatcher.ts 支持 defer、单独预算、resolve、超时/取消/结束拒绝；挂起不占判定队列。 | defers one permission while other requests complete and rejects deferred requests on dispose；resolves a deferred permission and applies the handler-specific deadline；accepts an immediate deferred resolution and preserves approval cleanup |
| S2 | createGuardConflict 共用于 T2/T3、通知和人类卡片；状态按成员确定 self、other，签名使用 TypeScript AST。 | T3 reverts an unchanged block and skips the block edited by Bob 的通知结构断言；P2 生产测试中的人类 GuardConflict、afterSignature 断言 |
| S3 | notificationStore.ts 持久化 read/handled，重启恢复，按属主限制更新，保存前过滤敏感值。 | restores notification read and handled state and restricts updates to its owner；filters configured sensitive values before notification persistence and retrieval |
| S4 | ownerId 与团队 Agent 通知对象使用本次触发成员。 | Agent 归属集成用例；agent-guard.md、agent-concurrency.md |

## Blocker 变异检验

| 项目 | 临时变异 | 预期失败与结果 |
|---|---|---|
| A1 | canonical root 使用 path.resolve | 生产符号链接用例因 Path escapes workspace root 失败 |
| A2 | 取消批准前磁盘与 proposal.before 的核验 | 1500 ms 研判用例没有产生预期拒绝，断言失败 |
| A3 | 禁用统一缩进恢复 | 八格缩进的 trimDiff 夹具无法还原，断言失败 |
| A4 | session.created 不登记后代 | 真实 runtime 的 session filter 单元断言失败；子会话审批另由生产参数集成测试验证 |
| E1 | 相似度阈值调整为 1 | 复制业务文件被接受，生成器拒绝断言失败 |
| 检查点 A P2 | 同时取消两处 pending 保护 | 生产参数的 500 ms 磁盘内容断言失败 |

全部临时变异通过文件编辑恢复，修复后的测试通过。原始失败输出保存于 evidence/checkpoint-b-dev-report/mutations/。

## 浏览器执行

tests/playwright.checkpoint-b.config.ts 使用 full/G3/record、真实 OpenCode 1.18.31 和 DeepSeek，工作区经 macOS 符号链接访问。测试使用两个真实浏览器上下文，截图保存在 evidence/checkpoint-b-manual/。

1. Alice 修改 applyDiscount 签名，Bob 的 Agent 修改 checkout 前缀。审批回复 once，附模型警告，run completed、T3 passed；人类无冻结，路径核验无内部错误。
2. Agent 研判期间 Alice 修改 Cart.add；首次提案因文件已变化被拒绝，Agent 重新读取并再次提交，随后获得 once。最终文件保留 prepend 修改与 Agent 的空购物车检查，run completed、T3 passed。
3. 同时形成两个黑区冲突，DOM 中只有一个横幅，展示冲突数量；详情在页签中，代码没有叠加说明浮层。
4. 点击“我来改”后文件恢复，页面和卡片没有 JSON 解析错误。
5. 真实 full 灰区经 G3 判定，缓存回放的判定、六条闸门事件及冻结事件无差异；该锁定轨迹没有 persist 事件。allow/warn 的文件写入由四项 full 服务端集成核验覆盖。

真实 Agent 共执行三次，包括一个语义拒绝场景和上述两份交付记录。角色调用与取消请求、预算、端点配置布尔值及归档哈希见 provenance.json。限额为 fast 2000、deep 1000、Agent run 20。

## 回归记录

| 命令或范围 | 结果 |
|---|---|
| pnpm -r build | 通过 |
| conflict-guard 包测试 | 195 项通过，包含新数据、统计、录放 CLI |
| 服务端全部测试 | 260 项通过 |
| 最终结构化冲突与生产 Agent 复查 | 两个文件、62 项通过 |
| full 服务端缓存轨迹核验 | 四项通过 |
| pnpm test:demo | 两项通过 |
| off、observe、rules、full 的 pnpm test:collab | 每种模式两项通过 |
| 既有 Playwright | 38 项通过，十项按条件跳过 |
| 最终卡片与撤回复查 | 十三个 Playwright 用例通过 |
| 检查点 B 真实浏览器 | 四个用例通过，额外同文件兼容提交通过 |
| 八个种子项目原始业务测试 | 十六项通过 |
| 密钥精确值扫描 | 匹配计数 0 |

机器记录位于 evidence/checkpoint-b-dev-report/verification.json；各录制目录的 repeatability.json 保存三轮离线比较范围、哈希和网络调用次数。CLI 回归测试针对 79 样本的三轮完整回放，设置与数据规模相符的时间预算。

完整基线结果使用 rules/results.json.gz 保存，`data:artifacts --report <目录> --restore` 可恢复原始 JSON。数据集与模型缓存采用同一归档入口，哈希保存于 provenance.json。

## 使用限制

额外兼容模型端点的真实调用待配置后执行。原始 apply_patch 权限事件尚未新增，支持依据 SDK 和真实格式夹具验证。当前校准灰区没有 allow 真值，置信度阈值的收益仍需更多开发数据。静态关系未覆盖的运行时冲突可能没有候选对。bash 写入只在 T3 检查，同一行被其他参与者继续修改时交由人工处理；服务重启后活跃 run 和审批预约需要重新建立。
