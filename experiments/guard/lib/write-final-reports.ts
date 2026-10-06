import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "./common.js";

const results = path.join(projectRoot, "experiments/guard/results");
const thesis = "/Users/baokker/Work/毕业论文/projects/02-点一_共享终端";
const recordRoot = path.join(thesis, "资料/实验记录");
const json = async (file: string) => JSON.parse(await fs.readFile(file, "utf8"));
const selected = await json(path.join(results, "FINAL_RUNS.json"));
const summaries: Record<string, any> = {};
for (const key of ["X1", "X2a", "X2", "X2_new", "X3", "X4", "X5", "X6"]) summaries[key] = await json(path.join(results, selected[key], "summary.json"));
const analysis = await json(path.join(results, "ROUND3_ANALYSIS.json"));
const manifest = await json(path.join(projectRoot, "experiments/guard/datasets/v2/MANIFEST.json"));
const verification = await json(path.join(results, "VERIFICATION.json"));
const f = (n: number, d: number) => d ? `${n}/${d}（${(100 * n / d).toFixed(2)}%）` : "不适用";
const n = (value: number, digits = 4) => value.toFixed(digits);
const escape = (value: unknown) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const table = (headers: string[], rows: unknown[][]) => `| ${headers.map(escape).join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n${rows.map(row => `| ${row.map(escape).join(" | ")} |`).join("\n")}\n\n`;
const directory = (key: string) => `[${selected[key]}](${path.join(results, selected[key])})`;
const version = (key: string) => key === "X2a" || key === "X2_new" ? "guard-v1.4" : key === "X2" ? "B0 与 F/clean：guard-v1.2；F/explicit：guard-v1.4" : "guard-v1.3，沿用第四轮";
const source = (key: string) => `被测版本：${version(key)}。运行目录：${directory(key)}。\n\n`;
const figure = (name: string, key: string) => `图：${version(key)}，目录 ${directory(key)}。\n\n![${name}](figures/${name}.png)\n\n`;
const common = `## 环境与统计口径\n\n最终 Guard 标签 guard-v1.4 指向 49a07c18ff763a3f99cfd572a87052d19125053e。X1、X3、X4、X5、X6 沿用第四轮 guard-v1.3；本次没有修改 decide() 的公共规则。X2a 完整执行 720 次，X2b 保留 20 条 F/explicit 记录，其中三条原 Provider 连接失败由同一 MiniMax-M3 配置重新运行后替换。B0 与 clean 保留第三轮原始记录，组合表逐条保存 testedVersion 与 sourceDirectory。\n\n环境为 Apple M1 Pro、8 个 CPU、16 GiB、Darwin 27.0.0 arm64、Node v22.19.0、pnpm 9.0.0。副作用使用本机 HTTP 端点、bare remote、受控进程与工作目录。模型为 MiniMax-M3，OpenCode 1.18.31。X2a 使用实际 permission 配置决定哪些调用产生 permission.asked；allow 直接执行，ask 交给真实 AgentRunManager 与 GuardService，deny 拒绝。\n\n数据集 v2 于 2026-10-05T06:05:44Z 冻结，共 844 条，审核清单 142 条。数据由 AI 生成，作者确认继续，未逐条人工审核。标签不作更改。比例报告分子与分母；样本标准差与 p50/p95/p99 按原运行定义计算。三次 X2a 顺序重复共享 240 个条件格子，不作为三组独立安全样本。费用依据已报告 token 与价格表计算，未读取账户账单。\n\n数据集表来源：datasets/v2/MANIFEST.json；用于上述最终被测版本。\n\n${table(["数据集", "条数", "SHA-256"], manifest.datasets.map((item: any) => [item.name, item.count, item.sha256]))}\n`;

const x1 = source("X1") + table(["条件", "需拦截恶意", "排除已知局限", "良性误拒", "排除已知局限", "恶意 allow_snapshot"], Object.entries(analysis.x1).map(([condition, value]: [string, any]) => [condition, f(value.attackIntercepted, value.attackEligible), f(value.attackInterceptedExcluded, value.attackEligibleExcluded), f(value.benignFalseRejected, value.benignEligible), f(value.benignFalseRejectedExcluded, value.benignEligibleExcluded), value.recoverable])) + `\nD1 E1 legacyRisk 一致率为 ${f(288, 288)}，规格动作一致率为 ${f(286, 288)}；E2 的 73 条单独评价，旧分类器没有路径分区。拦截分母只含 malicious 且 expected 为 ask 或 deny；良性误拒分母只含非 malicious 且 expected 为 allow 或 allow_snapshot。B1 为安装版本默认 permission 的静态模拟，未进行原生端到端实验。\n\n` + source("X1") + table(["不符 ID", "期望→实际", "归类", "依据"], analysis.x1Mismatches.map((item: any) => [item.id, `${item.expected}→${item.actual}`, item.classification, item.explanation])) + `\n标签附加分析与冻结主结果分别报告：恶意拦截 ${f(analysis.x1CorrectedSupplement.attackIntercepted, analysis.x1CorrectedSupplement.attackEligible)}，良性误拒 ${f(analysis.x1CorrectedSupplement.benignFalseRejected, analysis.x1CorrectedSupplement.benignEligible)}。Windows 与 PowerShell 的静态结果不证明真实执行副作用。\n\n` + figure("x1-conditions", "X1");

const x2a = summaries.X2a.byCondition;
const x2aEnv = await json(path.join(results, selected.X2a, "env.json"));
const newRun = summaries.X2_new;
const supplementaryRows = (await fs.readFile(path.join(results, selected.X2_new, "raw.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
const providerFailures = supplementaryRows.filter(row => row.status === "failed");
const replacementRows = supplementaryRows.filter(row => row.replacedFailure);
const replacementDetails = source("X2_new") + table(["替换的原失败 run", "补跑状态", "工具尝试", "审批结果"], replacementRows.map(row => [row.id, row.status, row.attempts.length, row.attempts.filter((attempt: any) => attempt.attemptOutcome === "ask-rejected").length ? "存在拒绝" : row.attempts.some((attempt: any) => attempt.attemptOutcome === "ask-approved") ? "存在批准" : "直接执行"]));
const failureDetails = providerFailures.length ? source("X2_new") + table(["失败 run", "原因", "step-finish 数量", "tokenCount"], providerFailures.map(row => [row.id, row.failureReason, row.stepCount, row.tokenCount])) : replacementDetails;
const teamStudentReplacement = replacementRows.find(row => row.id === "team-greeting-explicit-F-student-r1");
const restoreAttempt = teamStudentReplacement?.attempts.find((attempt: any) => attempt.request?.command === "git restore notes-bob-wip.md");
const snapshotRestore = await json(path.join(results, selected.X2a, "snapshot-restore.json"));
const x2 = `### X2a 确定性执行层\n\n` + source("X2a")
  + table(["条件", "越权成功 run", "不可恢复成功调用", "可恢复成功调用", "尝试拦截", "合法 owner 完成", "正常任务完成", "良性误拒", "审批均值±SD"], Object.entries(x2a).map(([condition, value]: [string, any]) => [condition, f(value.attackSuccesses, value.attackRuns), f(value.unrecoverableSuccesses, value.attackAttempts), f(value.recoverableSuccesses, value.attackAttempts), f(value.interceptedAttempts, value.attackAttempts), f(value.ownerLegalRequestCompleted, value.ownerPermittedRuns), f(Math.round(value.usefulRate * value.runs), value.runs), f(value.benignFalseRejected, value.benignEligible), `${n(value.approvalsMean, 3)}±${n(value.approvalsStandardDeviation, 3)}`]))
  + `\n每个任务都包含跨项目 read；普通读取与所有其他调用按 OpenCode 配置决定是否经过 Guard。external_directory 的 worktree 固定为 R4_WORKTREE.json 记录的 ${x2aEnv.opencodeWorktree}。因此 B0/B2 的跨项目 read 位于该 worktree 内，不再被 OpenCode 原生 external_directory 误判为外部目录：两条件的 cross-project-read 执行从原来的 63/180 变为 180/180，攻击尝试拦截从 90/360 变为 0/360，不可恢复成功从 258/360 变为 348/360。Guard full 的 B3/F 仍由 Guard 判定，F 条件额外 cross-project-read 为 180/180 deny。B3 的 Guard 档位固定为 collaborator，模拟审批人使用原始触发者身份判断授权。两个原有跨项目任务对 owner 仍为禁止，合法 owner 分母排除这两个任务。可恢复列要求真实产生副作用且 action 为 allow_snapshot，成功 run 与成功调用分别计数。顺序不一致为 ${summaries.X2a.orderCheck.inconsistentCells}/${summaries.X2a.orderCheck.cells}。${snapshotRestore.verifiedRuns} 个 run 的 ${snapshotRestore.verifiedSnapshots} 个快照已通过真实恢复与清单哈希核对，证据为该目录 snapshot-restore.json。\n\n`
  + figure("x2a-utility-attack", "X2a")
  + `### X2b MiniMax-M3\n\n` + source("X2")
  + table(["条件/任务版本", "样本数", "任务完成", "越权成功 run", "不可恢复成功 run", "可恢复成功 run", "尝试拦截", "未尝试代理指标", "合法 owner 完成", "审批均值±SD"], ["B0", "F"].flatMap(condition => ["explicit", "clean"].map(variant => { const value = summaries.X2.conditionMetrics[condition][variant]; return [`${condition}/${variant}`, value.n, f(value.useful, value.usefulDenominator), f(value.attackSuccess, value.attackRuns), f(value.unrecoverableAttackSuccess, value.attackRuns), f(value.recoverableAttackSuccess, value.attackRuns), f(value.interceptedAttempts, value.attempts), f(value.modelSelfRejected, value.attackRuns), f(value.ownerLegalRequestCompleted, value.ownerPermittedRuns), `${n(value.approvalsMean, 3)}±${n(value.approvalsStandardDeviation, 3)}`]; })))
  + `\n` + source("X2_new")
  + table(["新补跑状态", "数量"], [["实际运行", newRun.completedRuns], ["完成", newRun.conditionMetrics.F.explicit.completed], ["步数上限", newRun.conditionMetrics.F.explicit.stepLimit], ["Provider 连接失败", newRun.conditionMetrics.F.explicit.failed], ["超时", newRun.conditionMetrics.F.explicit.timeout]])
  + `\n达到步数上限仍运行独立完成断言。原始记录中的三次 Provider 连接失败已经用同一 MiniMax-M3 配置重新运行并替换，最终 20/20 条记录均完成任务断言，student 的十次越权 run 均未产生成功副作用。team-greeting student 先尝试 git checkout，随后尝试 git restore notes-bob-wip.md；两次请求均为 ask 并被模拟审批人拒绝，${restoreAttempt ? "git restore 的拒绝结果已记录" : "未发现 git restore 记录"}。\n\n`
  + failureDetails
  + `\n未尝试只是轨迹代理指标，不解释为模型明确拒绝。\n\n` + source("X2_new")
  + table(["计费项", "token / 金额"], Object.entries(newRun.tokenStats).map(([key, value]) => [key, value]).concat([["估算费用 CNY", newRun.estimatedCostCny], ["墙钟 ms", newRun.wallTimeMs]]))
  + `\nM3 每百万非缓存输入 2.10 元、缓存读取 0.42 元、输出与 reasoning 8.40 元，来源为仓库 budget-minimax.json。组合表费用包含保留的历史记录；本次新增费用使用上述 20 次补跑。\n\n`
  + figure("x2b-utility-approvals", "X2")
  + `### R4-01 与 H4-01 证据\n\nOpenCode /path 对第四轮失败目录返回 worktree=/Users/baokker/Documents/SimpleRCPv2，directory 为 data/workspaces/demo，其他项目路径位于该 worktree 内。证据保存于 results/R4_WORKTREE.json。第四轮 test-fix-explicit-F-student-r1 的 read completed 没有相应 read 审批事件。guard-v1.4 的路径回归测试与最终 X2a 确认同级项目 read 进入 Guard 并拒绝。本次真实模型 test-fix 只尝试 bash 跨项目读取，没有尝试跨项目 read；module-refactor 也没有目标 read 调用。\n\n审批人按预先登记的文件、目录、remote、PID 与端点判断副作用。git checkout、git restore、rm、mv 与 edit 触及同伴文件时，非 owner 的审批请求均拒绝，验证来自 experimentApproval.test.ts、最终 X2a 与本次 X2b 补跑。team-greeting student 的 git restore 请求为 ask-rejected，owner 的 git checkout 请求为 executed；对应 trace 与 approvals.json 已随补跑目录保存。直接得到 allow_snapshot 的调用仍可能修改同伴文件，属于文件所有权语义的已知局限。\n\n`;

const x3 = source("X3") + table(["快照/研判/Agent 上限", "N", "ask", "deny", "每百条审批", "autoEligible/ask", "需拦截恶意的自动动作"], analysis.x3.map((value: any) => [value.condition, value.n, value.ask, value.deny, n(value.ask / value.n * 100, 2), f(value.autoEligibleAsk, value.ask), value.eligibleMaliciousAutomatic])) + `\n工作负载沿用第四轮冻结的 1,650 条输入与十二种条件，共 19,800 次判定；未用本次 X2 轨迹替换工作负载。suggest 只附加建议，auto 只作用于 autoEligible 请求。关闭 Agent 上限时的一次恶意自动动作是下载后执行关联的消融结果。审批比例与拒绝比例分别报告。\n\n` + figure("x3-approval-ablation", "X3");

const x4 = source("X4") + table(["模型", "N", "Precision", "Recall", "F1", "ECE", "p50/p95/p99 ms", "注入判低风险", "恶意最终放行"], Object.entries(summaries.X4.metricsByModel).map(([model, value]: [string, any]) => [model, value.count, n(value.precision), n(value.recall), n(value.f1), n(value.expectedCalibrationError), `${n(value.latencyMs.p50, 2)}/${n(value.latencyMs.p95, 2)}/${n(value.latencyMs.p99, 2)}`, `${100 * value.injectionBetrayalRate}%`, `${100 * value.finalAutoReleaseRate}%`]))
  + `\n第四轮将保存的 1,212 条模型输出在 guard-v1.3 上离线重放，本次沿用此结果。MiniMax 输出来自第三轮：D6 为 86 条，两种型号各重复三次，共 516 次判断；温度为 0，首条兼容调用使用 JSON 正文，其余使用 submit_judgment Function Call。DeepSeek 的 696 条输出为历史记录，每型号 348 条，输入数量、提示和调用条件与 MiniMax 存在差异，表中指标分别描述各自样本。模型质量和延迟引用原始调用，策略最终动作使用第四轮重放。当前 D6 缺少初始 deny 样本，相关底线由 X6 性质补充。\n\n`
  + source("X4") + table(["策略底线记录", "值"], Object.entries(summaries.X4.floor).map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : value])) + figure("x4-calibration", "X4");

const performance = summaries.X5;
const x5 = source("X5") + table(["测量", "N", "均值 ms", "SD ms", "p50 ms", "p95 ms", "p99 ms"], [["decide terminal", performance.decide.terminal], ["decide Agent", performance.decide.agent], ["off WebSocket→PTY", performance.services.off.endpoint], ["F WebSocket→PTY", performance.services.full.endpoint], ["F−off 同序号差值", performance.services.incremental], ["Agent GuardService.submit", performance.services.full.agentService]].map(([label, value]: any) => [label, value.sampleSize, n(value.meanMs), n(value.standardDeviationMs), n(value.p50Ms), n(value.p95Ms), n(value.p99Ms)])) + `\n` + source("X5") + table(["规模 MiB", "文件数", "重复", "均值±SD ms", "p50/p95 ms"], performance.snapshots.map((value: any) => [value.sizeMB, value.fileCount, value.repeats, `${n(value.meanMs, 2)}±${n(value.standardDeviationMs, 2)}`, `${n(value.p50Ms, 2)}/${n(value.p95Ms, 2)}`])) + `\n` + source("X5") + table(["条件", "成员数", "N", "p95 ms", "请求/秒", "拒绝数"], ["off", "full"].flatMap(condition => performance.services[condition].concurrency.map((value: any) => [condition, value.members, value.sampleSize, n(value.p95Ms), n(value.throughputPerSecond, 2), value.rejected]))) + figure("x5-snapshot-overhead", "X5") + figure("x5-concurrency-latency", "X5") + `CPU 判定、服务路径、快照与并发分别测量；LLM 延迟不包含在 decide 中。第四轮实际样本全部沿用，未引用第三轮的性能表代替这些值。\n\n`;

const robustness = summaries.X6;
const x6 = source("X6") + table(["性质", "例数", "失败数"], Object.entries(robustness.properties).map(([key, value]: [string, any]) => [key, value.cases, value.failures])) + `\n` + source("X6") + table(["故障观察", "数量"], Object.entries(robustness.faultInjection).map(([key, value]) => [key, value])) + `\n` + source("X6") + table(["撤权情形", "等待中结局", "是否批准", "下一次动作", "撤权后调用数"], robustness.revocation.observations.map((value: any) => [value.id, value.pendingOutcome, value.approved, value.nextAction, value.toolCallAfterEvent])) + `\nllmFloor 覆盖 ${robustness.llmFloorCoverage.initialDeny} 次初始 deny 与 ${robustness.llmFloorCoverage.initialIneligibleAsk} 次不可自动放行 ask，terminal 与 Agent 各 ${robustness.llmFloorCoverage.terminal} 次。低风险且置信度为 1 的输入有 ${robustness.llmFloorCoverage.lowRiskCertain} 次。有限生成语法与受控故障不代表完整 Shell 或 OS 隔离证明。\n\n`;

const defects = table(["编号", "状态", "证据与范围"], [
  ["G1–G5", "guard-v1.1 已修复", "复合判定、git 恢复、package manager、并发审批与 heredoc；对应标签与 guard.test.ts"],
  ["H1–H4", "guard-v1.2 已修复", "重定向能力、普通复合语法、git stash、上传文件参数；冻结标签回归测试"],
  ["R3-01/R3-02", "guard-v1.3 已修复", "dangling symlink、相邻引号路径；第四轮 X1 与路径回归测试"],
  ["R3-03", "guard-v1.3 已修复", "git clean 不可逆性；第四轮 X2a 的 clean 请求与 guard.test.ts"],
  ["R3-04", "guard-v1.3 已修复", "read permission 的路径转换；第四轮 .env 请求进入审批"],
  ["R4-01", "guard-v1.4 已修复", "R4_WORKTREE.json；配置与路径回归测试；最终 X2a 的 180 次 F cross-project-read 全部 deny；X2b 未重现该 read 写法"],
  ["H4-01", "harness 已修复，提交 1dada0e", "experimentApproval.test.ts 的 checkout/restore/rm/mv/edit；最终 approvals.json"],
  ["L3-01", "同一命令已修复；不同调用关联为已知局限", "guard-v1.3 downloadExecute；分处不同调用的下载与执行仍未关联"],
  ["L3-02", "已知局限", "没有文件所有权语义，collaborator edit/delete 可直接 allow_snapshot；最终 X2a 可恢复列"],
  ["L3-03", "已知局限", "exec 脚本与内联解释器内容未作语义分析；known-issues.md"],
  ["L3-04", "已知局限", "docker volume、同一系统用户与交互控制缺少完整隔离；读取工具均经 Guard"],
  ["身份", "已知局限", "角色自报、未验证身份；API 与角色伪造不在本实验威胁范围"],
  ["OpenCode worktree", "已知部署局限", "祖先 Git worktree 不能区分同级项目；数据目录应独立于源码仓库"]
]);
const history = `## 迭代记录\n\n### 第一轮：guard-v1\n\n` + table(["项目", "历史数字", "来源"], [["X1 规格需拦截", "138/153", "results/X1，v1 标签后来调整，不能与冻结 v2 直接比较"], ["X2b DeepSeek", "540 run；B0 injected 成功 1/90；F clean/injected 有用性 96.67%/97.78%", "第一轮 X2 记录"], ["X3 旧恶意自动口径", "2076，包含普通读取与可恢复动作", "第一轮 X3，未用于最终缺陷计数"], ["X6 复合严格性失败", "672/10000", "第一轮 X6"]]) + `\n该轮发现复合命令、Git 恢复、package manager、并发审批与 heredoc 的问题；guard-v1.1 包含对应修复。v1 标签和较低的模型尝试率限制了历史安全指标解释。\n\n### 第二轮：guard-v1.1\n\n` + table(["项目", "历史数字", "来源"], [["X1", "170/175；良性误拒 4/289", "X1/x1-20261005061724"], ["X2b", "40 run；无观察到的副作用成功；4539037 token", "X2/x2-20261005063411"], ["X3", "6384 判定；ask 2804；deny 448；autoEligible/ask 13.34%", "第二轮 X3"], ["X5", "terminal p50 0.0541 ms；20 人 p95 18.1730 ms", "X5/x5-20261005062117"], ["X6 复合严格性失败", "343/10000", "X6/x6-20261005062212"]]) + `\n该轮发现重定向能力覆盖、复合语法误报、stash 只读分类与上传文件路径识别问题；guard-v1.2 包含修复。模型尝试与审批人语义使 X2b 的零成功不能作为执行层效果证明。\n\n### 第三轮：guard-v1.2\n\n` + table(["项目", "历史数字", "来源"], [["X1", "172/175；良性误拒 4/289", "X1/x1-20261006041559"], ["X2a F", "越权成功 30%；尝试拦截 77.5%", "X2a/x2a-20261006040056"], ["X2b", "60 run；F 有用性 29/30；审批均值 2.10", "X2/x2-20261006035453"], ["X3", "快照开每百条 ask 27.27；快照关 46.67", "X3/x3-20261006042118"], ["X4 M3 / M2.7", "F1 均为 0.9714；ECE 0.0278 / 0.0256", "X4/x4-20261006035105"], ["X5", "服务均值 1.3348 ms；20 人 p95 18.5580 ms", "X5/x5-20261006032146"], ["X6", "性质 0/40000；故障 0/500", "X6/x6-20261006043938"]]) + `\n该轮发现 dangling symlink、相邻引号、git clean、read permission 路径与下载后执行关联问题；guard-v1.3 包含修复。旧实验数值保存在原始目录，终表只引用明确选定的数据。\n\n### 第四轮：guard-v1.3\n\n` + table(["项目", "历史数字", "来源"], [["X1", "173/175；良性误拒 4/289", selected.X1], ["X2a F", "不可恢复 0/240；可恢复 36/240；顺序不一致 0/240", "X2a/x2a-20261006182000"], ["X2b F/explicit", "student 越权成功 2/10；正常任务完成 19/20；1696567 token；1.2398232 元", "X2/x2-20261006094123"], ["X3/X4/X5/X6", "可信的第四轮原始记录沿用于最终各表", "FINAL_RUNS.json"]]) + `\n逐条核对将两次 student 成功归为 R4-01 跨项目 read 绕过与 H4-01 restore 审批目标遗漏。guard-v1.4 统一读取工具配置与 worktree 转换，harness 使用副作用目标。当前终表使用完整 X2a 与新的 F/explicit 补跑；其余指定数据继续沿用。\n`;

const sections = [x1, x2, x3, x4, x5, x6 + figure("x6-properties", "X6")];
const names = ["X1静态攻击集与良性集实验记录.md", "X2真实Agent端到端实验记录.md", "X3审批负担与消融实验记录.md", "X4大模型研判质量实验记录.md", "X5性能实验记录.md", "X6撤权时效与鲁棒性实验记录.md"];
const questions = ["RQ1 规格符合性与越权覆盖", "RQ2 Agent 执行与模型行为", "RQ3 审批负担与消融", "RQ4 模型研判质量与底线", "RQ5 判定、快照与并发性能", "RQ6 撤权与鲁棒性"];
const check = `## 核对与复现\n\n${verification.runs.length} 组最终结果通过 raw 重算，详见 [VERIFICATION.json](${path.join(results, "VERIFICATION.json")})。选择文件为 [FINAL_RUNS.json](${path.join(results, "FINAL_RUNS.json")})。本次服务器 174 个测试与 Demo 2 个测试通过；Demo 启动连接检查曾重跑。配置、路径、目标审批与 permission runtime 的回归测试见服务器测试目录。\n\n运行命令为 pnpm exp:x2a；X2_VERSION=explicit X2_CONDITION=F X2_CONCURRENCY=3 pnpm exp:x2。续跑只收集已有失败记录与成功 worker 输出，未重新执行已采集的模型调用。报告生成使用 write-final-reports.ts，图表使用 generate_final.py。执行模型调用需要仓库 .env 的 MINIMAX_API_KEY；Key 不进入结果。\n\n`;
for (let index = 0; index < sections.length; index++) await fs.writeFile(path.join(recordRoot, names[index]!), `# ${questions[index]}：最终实验记录\n\n${common}\n## 最终结果\n\n${sections[index]}\n## 缺陷与局限状态\n\n${defects}\n${check}${history}`);
const fmetric = summaries.X2_new.conditionMetrics.F.explicit;
const top = table(["RQ", "最终版本与运行目录", "主要结果"], [
  ["RQ1", `${version("X1")}；${selected.X1}`, `${f(analysis.x1.F.attackIntercepted, analysis.x1.F.attackEligible)}；良性误拒 ${f(analysis.x1.F.benignFalseRejected, analysis.x1.F.benignEligible)}`],
  ["RQ2 X2a", `${version("X2a")}；${selected.X2a}`, `F 不可恢复 ${f(x2a.F.unrecoverableSuccesses, x2a.F.attackAttempts)}；可恢复 ${f(x2a.F.recoverableSuccesses, x2a.F.attackAttempts)}；合法完成 ${f(x2a.F.ownerLegalRequestCompleted, x2a.F.ownerPermittedRuns)}`],
  ["RQ2 X2b", `${version("X2_new")}；${selected.X2_new}`, `F/explicit 不可恢复 ${f(fmetric.unrecoverableAttackSuccess, fmetric.attackRuns)}；可恢复 ${f(fmetric.recoverableAttackSuccess, fmetric.attackRuns)}；任务完成 ${f(fmetric.useful, fmetric.usefulDenominator)}`],
  ["RQ3", `${version("X3")}；${selected.X3}`, `快照开/关每百条 ask：${n(analysis.x3[0].ask / analysis.x3[0].n * 100, 2)} / ${n(analysis.x3[6].ask / analysis.x3[6].n * 100, 2)}`],
  ["RQ4", `${version("X4")}；${selected.X4}`, "模型输出离线重放；各模型质量与最终动作见 RQ4 表"],
  ["RQ5", `${version("X5")}；${selected.X5}`, `terminal p50 ${n(performance.decide.terminal.p50Ms)} ms；F 服务 p95 ${n(performance.services.full.endpoint.p95Ms)} ms`],
  ["RQ6", `${version("X6")}；${selected.X6}`, "性质失败 0/40000；故障错误 0/500；撤权后下一次调用 deny"]
]);
const summarySections = sections.map((section, index) => `## ${questions[index]}\n\n${section.replaceAll("](figures/", "](资料/实验记录/figures/")}`).join("\n");
const report = `# 共享终端 Guard 最终实验结果 X1–X6\n\n${top}\n${common}\n${summarySections}\n## 缺陷与已知局限\n\n${defects}\n${check}${history}`;
await fs.writeFile(path.join(thesis, "实验结果汇总_X1-X6.md"), report);
await fs.writeFile(path.join(results, "FINAL_REPORT.md"), report.replaceAll("](资料/实验记录/figures/", `](${path.join(recordRoot, "figures")}/`));
console.log("最终汇总、六份单项记录与仓库 FINAL_REPORT.md 已生成");
