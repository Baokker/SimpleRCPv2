import fs from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "./model-runtime.ts";

const root = path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A2");
const read = async <T>(file: string) => JSON.parse(await fs.readFile(path.join(root, file), "utf8")) as T;
type OfflineGroup = { id: string; truth: string; decision: string; operatorFamily: string; detectability: string; probability?: { lock?: number } };
type OfflineRow = { id: string; quality: Record<string, any>; completion: { rate: number; completedChangePairs: number; totalChangePairs: number }; model: { requestCompletionRate: number; calls: number; p50Ms: number | null; p95Ms: number | null; syntaxDeferred: number; syntaxWaitP50Ms: number | null; syntaxWaitP95Ms: number | null; costUsd: number }; groups?: OfflineGroup[] };
type Offline = { results: OfflineRow[] };
const v4 = await read<Offline>("offline-pair-v4-grey.json");
const v5 = await read<Offline>("offline-pair-v5.json");
const v5New = await read<Offline>("offline-pair-v5-standard.json");
const g3a = await read<{ quality: Record<string, any>; threshold: { lower: number; upper: number }; promptVersion: string; greySamples: number; deepInputCount: number; exploratory?: boolean; executionMode?: string; completion?: { rate: number; completedChangePairs: number; totalChangePairs: number }; timing?: { deepApplied: number; deepInvalidated: number }; model: { fast?: { requestCompletionRate: number; calls: number; p50Ms: number | null; p95Ms: number | null; costUsd: number }; deep?: { requestCompletionRate: number; calls: number; p50Ms: number | null; p95Ms: number | null; costUsd: number }; totalCalls?: number; totalCostUsd?: number; calls: Array<{ status: string; latencyMs: number; costUsd: number }>; stats: { p50Ms: number; p95Ms: number; costUsd: number } } }>("g3a-results.json");
const data = await read<{ development: Record<string, any>; holdout: Record<string, any>; rows: Array<{ grey: boolean; operatorFamily: string }> }>("data-check.json");
const fair = await read<{ greySamples: number; matchedGroupCount: number; unmatchedGroups: Array<{ id: string; pairV1InputCount: number; pairV4InputCount: number }>; commonInputCount: number; normalizedInputCoverage: Record<string, number>; pairV1: Record<string, any>; pairV4: Record<string, any>; changedFinalDecisions: Array<{ id: string; pairV1: string; pairV4: string }> }>("fair-comparison.json");
const unavailable = await read<{ unavailableCount: number; unavailable: Array<{ sample: string; decision: string; cause: string }>; callStatus: Record<string, number>; conclusion: string }>("model-unavailable.json");
const b1 = await read<{ comparedGroups: number; changedCount: number; changes: Array<{ id: string; before: string; after: string; reason: string }>; focus?: Array<{ id: string; before: string | null; after: string | null; changed: boolean }> }>("b1-final-decision-changes.json");
const human = JSON.parse(await fs.readFile(path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A/human-comparison.json"), "utf8")) as { P3: Record<string, any>; P4: Record<string, any> };
const oldSelection = JSON.parse(await fs.readFile(path.join(repositoryRoot, "docs/conflict-guard/experiment/v2/stage-A/selection-final.json"), "utf8")) as { rows: Array<Record<string, any>> };
const percent = (value: number | null | undefined) => value === null || value === undefined ? "N/A" : `${(value * 100).toFixed(2)}%`;
const number = (value: number | null | undefined) => value === null || value === undefined ? "N/A" : value.toFixed(1);
const strategyRows: OfflineRow[] = [
  ...v4.results.map((row) => ({ ...row, id: `${row.id}(pair-v4)` })),
  ...v5.results.map((row) => ({ ...row, id: row.id === "G2" ? "G2(pair-v5)" : `${row.id}(pair-v5)` })),
  ...v5New.results
];
const rows = strategyRows.map((row) => `| ${row.id} | ${percent(row.quality.balancedAccuracy)} | ${percent(row.quality.missBlockRate)} | ${percent(row.quality.falseBlockRate)} | ${percent(row.quality.conflictNotificationRate)} | ${percent(row.quality.safeWarningRate)} | ${percent(row.quality.threeClassAgreement)} | ${percent(row.completion.rate)} | ${percent(row.model.requestCompletionRate)} | ${number(row.model.p50Ms)} / ${number(row.model.p95Ms)} | — | ${row.model.calls} | ${row.model.costUsd.toFixed(5)} |`);
const syntaxRows = strategyRows.map((row) => `| ${row.id} | ${row.model.syntaxDeferred} | ${number(row.model.syntaxWaitP50Ms)} / ${number(row.model.syntaxWaitP95Ms)} |`);
const selectedV5 = v5.results.find((row) => row.id === "G2");
const missedRows = (selectedV5?.groups ?? []).filter((row) => row.truth === "lock" && row.decision !== "lock").map((row) => `| ${row.id} | ${row.operatorFamily} | ${row.detectability} | ${row.probability?.lock === undefined ? "N/A" : row.probability.lock.toFixed(2)} |`);
const subsetQuality = (groups: OfflineGroup[]) => {
  const conflicts = groups.filter((group) => group.truth === "lock");
  const safe = groups.filter((group) => group.truth === "allow");
  const locked = conflicts.filter((group) => group.decision === "lock").length;
  const continued = safe.filter((group) => group.decision !== "lock").length;
  return {
    groups: new Set(groups.map((group) => group.id.replace(/-(?:conflict|safe)$/, ""))).size,
    samples: groups.length,
    conflicts: conflicts.length,
    safe: safe.length,
    balancedAccuracy: conflicts.length && safe.length ? (locked / conflicts.length + continued / safe.length) / 2 : null,
    missBlockRate: conflicts.length ? (conflicts.length - locked) / conflicts.length : null,
    falseBlockRate: safe.length ? (safe.length - continued) / safe.length : null,
    conflictNotificationRate: conflicts.length ? conflicts.filter((group) => group.decision !== "allow").length / conflicts.length : null,
    safeWarningRate: safe.length ? safe.filter((group) => group.decision === "warn").length / safe.length : null,
    threeClassAgreement: groups.length ? groups.filter((group) => group.truth === group.decision).length / groups.length : null
  };
};
const selectedGroups = selectedV5?.groups ?? [];
const addedGroups = selectedGroups.filter((group) => group.id.startsWith("d1-v4-dev-"));
const historicalGroups = selectedGroups.filter((group) => !group.id.startsWith("d1-v4-dev-"));
const subsetRows = [
  ["历史关系组", subsetQuality(historicalGroups)],
  ["新增 CP 关系组", subsetQuality(addedGroups)]
].map(([name, quality]) => `| ${name} | ${quality.groups} | ${quality.samples} | ${quality.conflicts} | ${quality.safe} | ${percent(quality.balancedAccuracy)} | ${percent(quality.missBlockRate)} | ${percent(quality.falseBlockRate)} | ${percent(quality.threeClassAgreement)} |`);
const g3aStatus = (status: string) => g3a.model.calls.filter((call) => call.status === status).length;
const familyNames = [...new Set([...Object.keys(data.development.operatorFamilies ?? {}), ...Object.keys(data.holdout.operatorFamilies ?? {})])].sort();
const familyRows = familyNames.map((family) => `| ${family} | ${data.development.operatorFamilies?.[family] ?? 0} | ${data.rows.filter((row) => row.grey && row.operatorFamily === family).length} | ${data.holdout.operatorFamilies?.[family] ?? 0} |`);
const oldRows = oldSelection.rows.filter((row) => ["pair-v4 G1", "G2", "G3-0.2"].includes(String(row.id))).map((row) => `| ${row.id} | d1-v3 | ${percent(row.agreement)} | ${row.missed} | ${row.falseBlockCount} | ${percent(row.validResponseRatio)} | ${number(row.p50Ms)} | ${number(row.p95Ms)} |`);
const g3aTimingNote = g3a.timing ? `G3a 的深判确认时间线已记录：${g3a.timing.deepApplied} 条深判结果生效，${g3a.timing.deepInvalidated} 条因后续修订失效。` : "当前 g3a-results.json 只包含阶段 A2 已完成的 10 条深判结果，异步时间线尚未由完整缓存重算。";
const selectionOrder = ["G2(pair-v5)", ...v5.results.filter((row) => row.id !== "G2").map((row) => `${row.id}(pair-v5)`), ...v5New.results.map((row) => row.id), "G3a"];
const selectionCandidates = strategyRows.filter((row) => !row.id.endsWith("(pair-v4)")).map((row) => ({ id: row.id, order: selectionOrder.indexOf(row.id), completion: row.completion.rate, falseBlockRate: row.quality.falseBlockRate as number | null, balancedAccuracy: row.quality.balancedAccuracy as number | null, safeWarningRate: row.quality.safeWarningRate as number | null, p50Ms: row.model.p50Ms }));
const completedCandidates = selectionCandidates.filter((row) => row.completion >= 0.95);
const qualityCandidates = completedCandidates.filter((row) => row.falseBlockRate !== null && row.falseBlockRate <= 0.15);
const selectedNew = qualityCandidates.filter((row) => row.id.startsWith("G2p-new-")).sort((left, right) => left.order - right.order)[0];
const g3aFormal = g3a.exploratory !== true && g3a.executionMode === "async-cascade";
const g3aCandidate = selectedNew && g3aFormal ? { id: "G3a", order: selectionOrder.indexOf("G3a"), completion: g3a.completion?.rate ?? selectedNew.completion, falseBlockRate: g3a.quality.falseBlockRate as number | null, balancedAccuracy: g3a.quality.balancedAccuracy as number | null, safeWarningRate: g3a.quality.safeWarningRate as number | null, p50Ms: g3a.model.fast?.p50Ms ?? selectedNew.p50Ms } : undefined;
const finalCandidates = g3aCandidate ? [...qualityCandidates, g3aCandidate] : qualityCandidates;
const chooseCandidate = (candidates: typeof finalCandidates) => {
  const bestBalancedAccuracy = candidates.reduce<number | null>((best, row) => row.balancedAccuracy === null ? best : best === null ? row.balancedAccuracy : Math.max(best, row.balancedAccuracy), null);
  const withinBalancedAccuracy = bestBalancedAccuracy === null ? [] : candidates.filter((row) => row.balancedAccuracy !== null && bestBalancedAccuracy - row.balancedAccuracy <= 0.02);
  const bestWarningRate = withinBalancedAccuracy.reduce<number | null>((best, row) => row.safeWarningRate === null ? best : best === null ? row.safeWarningRate : Math.min(best, row.safeWarningRate), null);
  const withinWarningRate = bestWarningRate === null ? withinBalancedAccuracy : withinBalancedAccuracy.filter((row) => row.safeWarningRate === bestWarningRate);
  const bestP50 = withinWarningRate.reduce<number | null>((best, row) => row.p50Ms === null ? best : best === null ? row.p50Ms : Math.min(best, row.p50Ms), null);
  return (bestP50 === null ? withinWarningRate : withinWarningRate.filter((row) => row.p50Ms === bestP50)).sort((left, right) => left.order - right.order)[0];
};
const selected = chooseCandidate(finalCandidates);
const selection = {
  rule: "completion>=0.95, falseBlockRate<=0.15, max balancedAccuracy, then safeWarningRate, fast p50, registration order",
  counts: { total: selectionCandidates.length, completed: completedCandidates.length, quality: qualityCandidates.length, g3aComputed: Boolean(g3aCandidate) },
  excluded: selectionCandidates.filter((row) => !completedCandidates.includes(row)).map((row) => ({ id: row.id, reason: "completion-below-95-percent" })),
  excludedForFalseBlock: completedCandidates.filter((row) => !qualityCandidates.includes(row)).map((row) => ({ id: row.id, reason: "false-block-rate-above-15-percent" })),
  selected,
  candidates: finalCandidates
};
await fs.writeFile(path.join(root, "selection-result.json"), JSON.stringify(selection, null, 2) + "\n");
const report = `# 阶段 A2 灰区策略复核报告

日期：2026-10-17。数据选择范围为 D1-v4 开发集 P3 实际进入灰区的 83 个变更对；保留集只完成标签与关系组统计，没有执行模型或回放评价。

## 复核结论

- 论文仓库关于阶段 A 的 67 条历史灰区样本、15 条冲突和 52 条安全修改与录制一致；D1-v4 开发集灰区为 83 条，其中冲突 23 条、安全修改 60 条。
- 结论聚合修复后，d1-0059-conflict 与 d1-0082-conflict 的最终结果都保留为黑区拦截；模型失败和语法等待没有覆盖此前的有效拦截。
- “syntax-incomplete-final” 在当前回放中只在变更集结束或持久写入前生成；中途不完整版本保持等待状态。
- B1 离线重放比较了 ${b1.comparedGroups} 个开发集样本，最终判定变化 ${b1.changedCount} 条；d1-0059-conflict 与 d1-0082-conflict 均保持黑区拦截，逐条记录见 b1-final-decision-changes.json。
- 当前 pair-v4 Jev 录放中的 ${unavailable.unavailableCount} 条 “model-unavailable” 已按原因分类：${Object.entries(unavailable.unavailable.reduce<Record<string, number>>((counts, row) => ({ ...counts, [row.cause]: (counts[row.cause] ?? 0) + 1 }), {})).map(([cause, count]) => `${cause} ${count} 条`).join("、")}；90 次真实 Jev 请求全部成功。
- 论文仓库关于 Jev 偏向提醒、运行时冲突区分不足和输入概率重叠的分析与当前 pair-v5 结果一致；未发现需要改写事实的地方。

## 修复与测试

| 项目 | 结果 |
|---|---|
| 结论聚合 | 已完成；有效拦截不会因模型失败或语法等待降级，先前有效放行遇到模型失败改为提醒 |
| 语法结束提醒 | 已完成；中途不完整只等待，变更集结束或写入前最多生成一次结束提醒 |
| 同输入公平比较 | 已完成；逐变更对核对后 ${fair.matchedGroupCount}/${fair.greySamples} 个变更对的输入完全一致，其余 ${fair.unmatchedGroups.length} 个变更对列入排除清单 |
| Jev 新输入 | 已完成；pair-v5 录制 90 次真实请求，全部成功 |
| 定向测试 | 3 个核心测试文件共 46 项通过；完整包测试进入原有长时间基准用例后未在本轮完成，不能宣称全部通过 |

## D1-v4

开发集为 ${data.development.groups} 个关系组、${data.development.samples} 个有效样本，冲突 ${data.development.truth.lock} 个、安全修改 ${data.development.truth.allow} 个；P3 进入灰区 ${data.development.greySamples} 个样本、${data.development.greyRelationGroups} 个关系组，其中冲突 23 个，未达到预设的至少 30 个目标。保留集为 ${data.holdout.groups} 个关系组、${data.holdout.samples} 个有效样本，冲突 ${data.holdout.truth.lock} 个、安全修改 ${data.holdout.truth.allow} 个。新增关系组使用 CP 算子族，开发集与保留集各增加 20 个关系组；标签来自四状态探针。

| 算子族 | 开发集有效样本 | 开发集灰区样本 | 保留集有效样本 |
|---|---:|---:|---:|
${familyRows.join("\n")}

## 开发集灰区结果

系统决定为 lock 时计为阳性，warn 与 allow 计为阴性。完成率按变更对统计，有效响应率按请求统计。

| 策略 | 平衡准确率 | 漏阻断率 | 误拦率 | 冲突通知率 | 安全提醒比例 | 三分类一致率 | 变更对完成率 | 请求有效率 | 快判 p50/p95（毫秒） | 深判确认 p50/p95（毫秒） | 调用次数 | 费用（USD） |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rows.join("\n")}
| G3a（串行探索，未作为正式候选） | ${percent(g3a.quality.balancedAccuracy)} | ${percent(g3a.quality.missBlockRate)} | ${percent(g3a.quality.falseBlockRate)} | ${percent(g3a.quality.conflictNotificationRate)} | ${percent(g3a.quality.safeWarningRate)} | ${percent(g3a.quality.threeClassAgreement)} | ${percent(g3a.completion?.rate ?? selectedV5?.completion.rate)} | 快判 ${percent(g3a.model.fast?.requestCompletionRate ?? selectedV5?.model.requestCompletionRate)}；深判 ${percent(g3a.model.deep?.requestCompletionRate)} | ${number(g3a.model.fast?.p50Ms ?? selectedV5?.model.p50Ms)} / ${number(g3a.model.fast?.p95Ms ?? selectedV5?.model.p95Ms)} | ${number(g3a.model.deep?.p50Ms ?? g3a.model.stats.p50Ms)} / ${number(g3a.model.deep?.p95Ms ?? g3a.model.stats.p95Ms)} | 快判 ${g3a.model.fast?.calls ?? selectedV5?.model.calls ?? 0}；深判 ${g3a.model.deep?.calls ?? g3a.model.calls.length} | ${(g3a.model.totalCostUsd ?? ((g3a.model.fast?.costUsd ?? selectedV5?.model.costUsd ?? 0) + (g3a.model.deep?.costUsd ?? g3a.model.stats.costUsd))).toFixed(5)} |

## 语法不完整等待

以下统计按变更对汇总，等待时间单位为毫秒；同一变更对的多个修订只取该变更对记录的累计等待时间。

| 策略 | 推迟次数 | 等待时长 p50/p95 |
|---|---:|---:|
${syntaxRows.join("\n")}

G3a 深判输入 ${g3a.deepInputCount} 个，${g3aStatus("success") + g3aStatus("cache-hit")} 次有效、${g3aStatus("invalid-format")} 次格式无效、${g3aStatus("timeout")} 次超时，深判提示词为 ${g3a.promptVersion}。当前文件中的 G3a 是基于已有缓存的离线虚拟时间线探索，尚未实现正式级联要求的运行时并行请求，因此不进入候选选择；调用次数和费用只作为探索记录。${g3aTimingNote}

G2(pair-v5) 在新增关系组上的结果单独列出，便于观察 D1-v4 扩充样本带来的影响。

| 子集 | 关系组数 | 变更对数 | 冲突数 | 安全修改数 | 平衡准确率 | 漏阻断率 | 误拦率 | 三分类一致率 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${subsetRows.join("\n")}

## 漏阻断样本

以下为 pair-v5 的 G2 结果中真值为冲突但最终没有拦截的样本。“p_lock” 取同一次 Jev 请求的结构化概率；请求未获得有效结果时记为 N/A。

| 样本 | 算子族 | 可检测性 | p_lock |
|---|---|---|---:|
${missedRows.join("\n")}

## 人与人协作回放对照

以下数字来自阶段 A 已有开发集回放，P4 使用阶段 A 选中的 pair-v1 与 Jev 快判；阶段 A2 没有登记新的 P4。

| 条件 | 未及时通知的冲突写入 | 漏阻断率 | 安全修改误拦率 | 安全修改提醒比例 | 冻结人·秒 | 本地决定比例 |
|---|---:|---:|---:|---:|---:|---:|
| P3 | ${human.P3.unnotifiedWriteCount}/${human.P3.denominators.missBlockRatio} | ${percent(human.P3.missBlockRatio.value)} | ${percent(human.P3.falseBlockRatio.value)} | ${percent(human.P3.safeWarningRatio)} | ${human.P3.frozenPersonSeconds.toFixed(3)} | ${percent(human.P3.localDecisionRatio.value)} |
| P4 | ${human.P4.unnotifiedWriteCount}/${human.P4.denominators.missBlockRatio} | ${percent(human.P4.missBlockRatio.value)} | ${percent(human.P4.falseBlockRatio.value)} | ${percent(human.P4.safeWarningRatio)} | ${human.P4.frozenPersonSeconds.toFixed(3)} | ${percent(human.P4.localDecisionRatio.value)} |

P4 的冻结人·秒高于 P3，原因是 P4 将部分原本由本地规则直接结束的关系交给 Jev 快判，判定等待期间保留了冻结区间；P4 的安全修改提醒比例较低，但这组结果仍属于阶段 A 开发集探索。

## 公平比较

pair-v1 与 pair-v4 使用 D1-v3 的共同灰区 ${fair.greySamples} 个样本；逐变更对比较后，${fair.matchedGroupCount}/${fair.greySamples} 个变更对的归一化输入完全一致，${fair.unmatchedGroups.length} 个变更对被排除。匹配变更对中的共同输入集合为 ${fair.commonInputCount} 个。pair-v1 平衡准确率 ${percent(fair.pairV1.balancedAccuracy)}、漏阻断率 ${percent(fair.pairV1.missBlockRate)}、误拦率 ${percent(fair.pairV1.falseBlockRate)}；pair-v4 平衡准确率 ${percent(fair.pairV4.balancedAccuracy)}、漏阻断率 ${percent(fair.pairV4.missBlockRate)}、误拦率 ${percent(fair.pairV4.falseBlockRate)}。最终判定变化 ${fair.changedFinalDecisions.length} 条，明细见 fair-comparison.json。

## 选择结果

登记规则要求变更对完成率至少 95%。选择脚本已按完成率、误拦率、平衡准确率、安全修改提醒比例、快判时延和登记顺序执行筛选；候选统计见 selection-result.json。${selection.selected ? `当前选中 ${selection.selected.id}。` : "当前候选集合为空，阶段 A2 不登记新的 P4 策略。"} G3a 当前只保留串行探索结果，未进入候选。pair-v5 的 G2 平衡准确率达到 83.95%，误拦率为 1.67%，但完成率为 85.54%。

## 阶段 A 历史对照

| 策略 | 数据版本 | 三分类一致率 | 漏阻断样本数 | 误拦样本数 | 有效响应率 | p50 | p95 |
|---|---|---:|---:|---:|---:|---:|---:|
${oldRows.join("\n")}

## 仍需处理

主要剩余误差来自语法不完整、候选关系在请求前关闭，以及 CP 运行时冲突中 Jev 将提醒与拦截分开的能力不足。B1 修复只改变了 ${b1.changedCount} 条最终判定，两个已被本地规则拦截的冲突仍保持拦截。本报告没有读取保留集模型输出。

原始材料：

- data-check.json：D1-v4 规模、标签与 P3 灰区入口。
- offline-pair-v4-grey.json、offline-pair-v5.json、offline-pair-v5-standard.json：G2 与阈值网格。
- g3a-results.json：MiniMax-M3 深判调用与结果。
- fair-comparison.json：pair-v1 与 pair-v4 同输入比较。
- model-unavailable.json：模型不可用成因分类。
`;
await fs.writeFile(path.join(root, "summary.md"), report);
console.log(JSON.stringify({ output: path.join(root, "summary.md"), rows: rows.length, candidate: selection.selected?.id ?? null }));
