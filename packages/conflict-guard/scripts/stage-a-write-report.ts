import fs from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "./model-runtime.ts";

const root = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A");
const selection = JSON.parse(await fs.readFile(path.join(root, "selection-final.json"), "utf8"));
const human = JSON.parse(await fs.readFile(path.join(root, "human-comparison.json"), "utf8"));
const budget = JSON.parse(await fs.readFile(path.join(repositoryRoot, ".test-workspaces/stage-a-call-budget.json"), "utf8"));
const config = JSON.parse(await fs.readFile(path.join(root, "config.json"), "utf8"));
const deepRows = selection.rows.filter((row: any) => row.id === "pair-v4 G1" || row.id === "pair-v1 G1（完整声明输入）");
const fastRow = selection.rows.find((row: any) => row.id === "G2");
if (deepRows.reduce((sum: number, row: any) => sum + row.requestCount, 0) !== budget.deep || fastRow.requestCount !== budget.fast) throw new Error("请求记录与阶段 A 调用预算不一致");
if (selection.rows.some((row: any) => row.cacheMisses !== 0)) throw new Error("级联比较存在缓存缺失");
const knownCostUsd = [...deepRows, fastRow].reduce((sum: number, row: any) => sum + row.costUsd, 0);
const missingUsage = [...deepRows, fastRow].reduce((sum: number, row: any) => sum + row.missingUsage, 0);
const probe = JSON.parse(await fs.readFile(path.join(repositoryRoot, "docs/conflict-guard/evidence/jev-proxy/results.json"), "utf8"));
const probeCostUsd = probe.rows.reduce((sum: number, row: any) => sum + (row.usage.inputTokens * config.prices.fastInputPerMillion + row.usage.outputTokens * config.prices.fastOutputPerMillion) / 1e6, 0);
const percent = (value: number | null) => value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
const milliseconds = (value: number | null) => value === null ? "N/A" : value.toFixed(0);
const lines = [
  "# 阶段 A 开发集结果", "",
  "日期：2026-10-16。D1-v3 开发集包含 119 个有效轨迹、97 个关系组；共同灰区主表为 61 个轨迹、54 个关系组，真值为 12 个需要拦截、49 个安全修改。保留集尚未运行。", "",
  "## 代理与模型", "",
  "Jev 三次连通验证均为 HTTP 200，响应型号为 jev-1.13.0，均包含 usage，时延为 1881.037、1067.896、938.913 ms。完整响应见 ../../../evidence/jev-proxy/results.json。开发集 Jev 请求经本机代理，代理开销包含在时延中。MiniMax-M3 使用 https://api.minimaxi.com/v1 直连，关闭推理，温度 0，最多输出 1024 token，每次研判总时限为 8 秒。", "",
  "## 输入与调度", "",
  "| 项目 | 完成内容与验证 |", "|---|---|",
  "| A1 声明完整性 | 检查簇内双方完整声明；不完整时等待后续修改，批次结束后仍不完整时显示提醒。等待结果不进入最终判定缓存，恢复完整后重新检查。回归测试覆盖多次输入、恢复完整、批次结束和零模型请求。 |",
  "| A2 分析证据 | 提供签名前后、删除和导出状态、四状态诊断、合并新增诊断、当前关系路径中最多三处使用位置与函数名。单元测试核对五个开发集关系组，并使用独立代码覆盖导出和删除状态。 |",
  "| A3 判定触发 | 半成品代码暂时失去语义路径时保留候选，批次结束时完成检查。d1-0026-conflict 的真实轨迹回归通过。 |",
  "| A4 输出长度 | pair-v4 保留八字段 JSON，提示词要求最多三条证据、两句中文解释，输出上限为 1024 token。 |",
  "| A5 评价范围 | 使用位置与调用方证据限定在当前关系路径；提示词要求仅评价该路径内的共同使用。d1-0045 的配套修改使用位置已核对。 |", "",
  "语法等待采用首次发现声明不完整至恢复完整或批次结束的累计时间；期间代码保持完整的时间不计入等待。它来自回放轨迹，独立于真实 HTTP 时延。完整声明和分析证据均参与缓存身份，等待计时作为运行统计独立保存。", "",
  "## 共同灰区对照", "",
  "| 条件 | 一致率 | 漏阻断 | 安全误拦 | 安全提醒 | 请求有效率 | 有效时延 p50 / p95 ms | 升级率 | 语法不完整输入 | 等待 p50 / p95 ms | 请求数量 | 费用估算 USD |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
];
for (const row of selection.rows) lines.push(`| ${row.id} | ${percent(row.agreement)} | ${row.missed}/12 | ${row.falseBlockCount}/49 | ${row.safeWarningCount}/49 | ${percent(row.validResponseRatio)} | ${milliseconds(row.p50Ms)} / ${milliseconds(row.p95Ms)} | ${percent(row.escalationRatio)} | ${row.syntaxDeferredRequests ?? "N/A"} | ${milliseconds(row.syntaxWaitP50Ms)} / ${milliseconds(row.syntaxWaitP95Ms)} | ${row.requestCount} | ${row.costUsd.toFixed(6)} |`);
lines.push("", "质量指标按共同轨迹的最终决策统计，语法不完整导致的提醒和请求失败均保留。请求有效率和时延使用开发集全部请求；级联时延包含快判与深判顺序执行的耗时，快判完成后只给深判剩余时间。请求有效率以模型请求为单位，级联中升级深判会增加一次请求，深判超过剩余时间计为无效。语法不完整输入列统计去重后的输入数量，同一变更对可能含有多次输入；修改版本的推迟次数另见下表。", "",
  "旧 pair-v1 使用历史输入和历史录制。pair-v4 使用完整声明与新证据，录制时间也不同，两者差异同时包含输入整理和时段影响。选中 pair-v1 后的新输入深判结果单列，用于与同输入的快判、级联比较。", "",
  `新增灰区轨迹：${selection.additionalGrey.join("、") || "无"}。这些轨迹由本地分区确定，未加入共同主表。`, "",
  "## 选择结果", "",
  `已登记的选择规则选中提示词 ${selection.prompt}，级联阈值为 ${selection.threshold}，进入 P4 的灰区策略为 ${selection.policy}。选择依据见 selection-prompt.json 与 selection-final.json。规则文件的提交为 d4e735f，录制后保持不变。`, "",
  "提示词选择使用登记的历史 pair-v1 与新 pair-v4：两者的安全误拦率均低于 15%，漏阻断分别为 3 个和 7 个，因此选择 pair-v1。级联阈值 0.2 的一致率高于阈值 0，且有效响应率满足阈值候选之间的要求，因此选择 0.2。最终策略比较中，Jev 单独快判的有效响应率为 100%，选中阈值的级联为 93.5%，相差超过 5 个百分点，按规则由快判进入 P4。级联保留为对照条件，所选阈值属于该对照条件。", "",
  "## 人与人回放指标", "",
  "| 条件 | 未及时通知的冲突写入 | 漏阻断 | 安全误拦 | 安全提醒 | 冻结人·秒 | 本地决定比例 |", "|---|---:|---:|---:|---:|---:|---:|"
);
for (const id of ["P3", "P4"]) {
  const row = human[id];
  lines.push(`| ${id} | ${row.unnotifiedWriteCount}/${row.denominators.escapeRatio} | ${percent(row.missBlockRatio.value)} | ${percent(row.falseBlockRatio.value)} | ${percent(row.safeWarningRatio)} | ${row.frozenPersonSeconds.toFixed(3)} | ${percent(row.localDecisionRatio?.value ?? null)} |`);
}
lines.push("", "本表仅反映开发集回放。比例区间与完整分组指标保存在 human-comparison.json；正式保留集比较和配对检验尚未执行。", "",
  "## 调用与费用", "",
  `新增深判 ${budget.deep}/400 次，快判 ${budget.fast}/600 次，另有 Jev 连通验证 3 次。阶段 A 未运行真实 Agent。预算原始记录见 call-budget.json。`, "",
  `本阶段开发集录制的已知 usage 费用合计为 ${knownCostUsd.toFixed(6)} USD，${missingUsage} 次请求缺少 usage，费用未知。代理验证费用估算为 ${probeCostUsd.toFixed(6)} USD。历史 pair-v1 录制和离线级联条件均未加入本阶段新增费用。`, "",
  "各条件的费用根据已知 usage 和配置中的标准单价计算，深判价格日期为 2026-10-10、国内站、人民币，美元换算使用配置值；未计算供应方缓存折扣。缺少 usage 的请求费用未知，因此费用属于估算。各级联阈值复用相同快判和深判缓存，表中费用表示该条件独立运行的估算，不能将五个阈值费用相加视为实际新增支出。", "",
  "| 条件 | 成功及失败状态 | 缺少 usage | 输入 token | 输出 token |", "|---|---|---:|---:|---:|"
);
for (const row of selection.rows) lines.push(`| ${row.id} | ${Object.entries(row.callStatus).map(([status, count]) => `${status}: ${count}`).join("；")} | ${row.missingUsage} | ${row.usage.inputTokens} | ${row.usage.outputTokens} |`);
lines.push("", "## 语法等待", "", "| 条件 | 观察到的不完整修改版本次数 | 等待 p50 ms | 等待 p95 ms |", "|---|---:|---:|---:|");
for (const row of selection.rows) lines.push(`| ${row.id} | ${row.observedIncompleteRevisions ?? "N/A"} | ${milliseconds(row.syntaxWaitP50Ms)} | ${milliseconds(row.syntaxWaitP95Ms)} |`);
lines.push("", "## 需要注意的结果", "",
  "- 新输入中的 124 份语法不完整输入没有请求模型，相关轨迹继续进入质量统计，最终仍不完整时按提醒处理。",
  "- pair-v4 的决策一致率提高，同时漏阻断数量增加；按预先登记的规则选中 pair-v1。输入整理与录制时段也有变化，不能单独将差异归因于提示词。",
  "- 选中的快判仍漏阻断 12 个灰区冲突中的 7 个，尚不能据此认为灰区质量达标。整个开发集上，完整方法的未及时通知比例与本地方法相同，冻结人·秒有所增加。",
  ...deepRows.filter((row: any) => row.validResponseRatio < 0.95).map((row: any) => `- ${row.id} 的请求有效率为 ${percent(row.validResponseRatio)}，成功及失败数量见调用表；需要在正式保留集报告中继续说明该限制。`),
  ...selection.rows.filter((row: any) => row.noJudgement.length).map((row: any) => `- ${row.id} 未产生判定的共同样本：${row.noJudgement.join("、")}。`),
  "- 新输入下，d1-0066-safe 的候选变更对在模型返回前关闭，原始结果中保留 pair_closed 事件；快判在关闭前返回。未产生判定的样本仍保留在质量分母中，候选状态与结束时间见 selection-final.json 的 noJudgementDetails。",
  "- 缺少 usage 的调用费用未知；语法等待采用轨迹时间，HTTP 时延采用真实测量，两者分别报告。", ""
);
lines.push("", "## 工程验证", "",
  "完整构建通过；conflict-guard 包测试 34 个文件、289 项通过；服务端测试 309 项通过、9 项跳过；演示测试 2 项通过；关闭、观察、本地规则、完整方案四种模式的协作浏览器测试各 2 项通过。阶段 A 的输入准备、录制、统计和报告脚本通过独立 TypeScript 检查。模型录制使用真实接口；语法检查测试使用 TypeScript 解析器、语义索引和实际状态机。", "",
  "## 适用范围", "",
  "数据来自生成项目与预定编辑轨迹，可执行探针只覆盖已定义的行为。开发集用于选择配置；这些数字不能替代保留集结果。旧提示词的历史输入与当前输入不同，比较不能单独证明提示词文本的作用。冻结、保留集与六个 Agent 场景等待阶段确认。", ""
);
await fs.writeFile(path.join(root, "summary.md"), lines.join("\n"));
await fs.writeFile(path.join(root, "call-budget.json"), JSON.stringify({ ...budget, limits: { deep: 400, fast: 600 }, proxyProbe: 3, realAgentRuns: 0, knownCostUsd, missingUsage, probeCostUsd }, null, 2) + "\n");
console.log(JSON.stringify({ report: "stage-A/summary.md", prompt: selection.prompt, threshold: selection.threshold, policy: selection.policy, calls: budget }));
