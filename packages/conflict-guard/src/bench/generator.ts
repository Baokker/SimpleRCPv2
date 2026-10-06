import { createHash } from "node:crypto";
import diff from "fast-diff";
import * as Y from "yjs";
import type { TraceEvent } from "../trace/trace.js";
import type { BenchManifest, BenchRelationGroup, BenchVariant, SeedProject } from "./types.js";
import { OPERATOR_SPECS } from "./operators.js";
import { operatorTemplate } from "./templates.js";
import { nativeOperatorIds, nativeOperatorTemplate } from "./nativeTemplates.js";
import { inspectSeedDiversity } from "./diversity.js";

export interface GenerateOptions { groups: number; seed: number; projects: SeedProject[]; generatedBy?: string; codeCommit?: string; generationCommand?: string }
export function generateManifest(options: GenerateOptions): BenchManifest {
  if (!Number.isInteger(options.groups) || options.groups < 1) throw new Error("groups 必须为正整数");
  if (!options.projects.length) throw new Error("至少需要一个种子项目");
  const native = options.projects.every((project) => project.layout === "native");
  const diversity = native ? inspectSeedDiversity(options.projects) : undefined;
  if (diversity && !diversity.valid) throw new Error(`种子项目未通过结构独立性检查：${JSON.stringify({ projectCount: diversity.projectCount, sizes: diversity.sizes, maximumObserved: diversity.maximumObserved, violations: diversity.violations.slice(0, 5) })}`);
  const random = createRandom(options.seed);
  const projects = [...options.projects].sort((left, right) => left.name.localeCompare(right.name));
  const shuffled = [...projects].sort((left, right) => hash(`${options.seed}:${left.name}`).localeCompare(hash(`${options.seed}:${right.name}`)));
  const development = new Set(shuffled.slice(0, Math.max(1, Math.floor(projects.length * 0.4))).map((project) => project.name));
  const heldoutFamilies = new Set(["SS", "EB"]);
  const groups: BenchRelationGroup[] = [];
  let conflictGroups = 0;
  for (let index = 0; index < options.groups; index += 1) {
    const projectIndex = index % projects.length;
    const project = projects[projectIndex]!;
    const nativeIds = native ? new Set(nativeOperatorIds(project, OPERATOR_SPECS.map((operator) => operator.id))) : undefined;
    const eligible = OPERATOR_SPECS.filter((operator) => (!development.has(project.name) || !heldoutFamilies.has(operator.family)) && (!nativeIds || nativeIds.has(operator.id)));
    if (!eligible.length) throw new Error(`项目没有可执行算子：${project.name}`);
    const operator = eligible[(Math.floor(index / projects.length) + projectIndex * 3) % eligible.length]!;
    const seed = random.nextInt(2_147_483_647);
    const unrelated = operator.family !== "SF" && conflictGroups++ % 3 === 2;
    const groupId = `d1-${String(index + 1).padStart(4, "0")}`;
    const makeVariant = (kind: "conflict" | "safe"): BenchVariant => {
      const template = (native ? nativeOperatorTemplate : operatorTemplate)(operator.id, kind === "safe" || operator.family === "SF", seed, project, unrelated);
      const baseline = template.baseline;
      const leftOnly = { ...baseline, ...template.left };
      const rightOnly = { ...baseline, ...template.right };
      return { id: `${groupId}-${kind}`, kind, operatorId: operator.id, dependencyMode: operator.family === "SF" ? undefined : unrelated ? "unrelated" : kind === "safe" ? "new-behavior" : "old-behavior", probes: template.probes, truth: kind === "safe" || operator.family === "SF" || unrelated ? "allow" : operator.expectedTruth, detectability: kind === "safe" || operator.family === "SF" || unrelated ? "none" : operator.expectedDetectability, baseline, leftOnly, rightOnly, merged: template.merged, entryPoints: template.entryPoints, site: template.site, baselineReference: template.reference ?? baseline, schedule: (["simultaneous", "sequential", "alternating"] as const)[seed % 3], trace: synthesizeTrace(baseline, template.left, template.right, seed) };
    };
    const conflict = makeVariant("conflict");
    const safe = makeVariant("safe");
    if (statesFingerprint(conflict) === statesFingerprint(safe)) {
      if (operator.family === "SF") conflict.aliasOf = safe.id;
      else safe.aliasOf = conflict.id;
    }
    groups.push({ id: groupId, project: project.name, operator, split: development.has(project.name) ? "dev" : "holdout", seed, variants: { conflict, safe } });
  }
  const allVariants = groups.flatMap((group) => Object.values(group.variants).filter((variant) => !variant.aliasOf));
  const programs = (split: "dev" | "holdout") => new Set(groups.filter((group) => group.split === split).flatMap((group) => Object.values(group.variants).flatMap((variant) => [variant.baseline, variant.leftOnly, variant.rightOnly, variant.merged].map(programFingerprint))));
  const developmentPrograms = programs("dev"); const holdoutPrograms = programs("holdout");
  const dependencyVariants = groups.filter((group) => group.operator.family !== "SF").flatMap((group) => Object.values(group.variants).filter((variant) => !variant.aliasOf));
  const siteKeys = (split: "dev" | "holdout") => [...new Set(groups.filter((group) => group.split === split).flatMap((group) => Object.values(group.variants).map((variant) => `${group.project}:${variant.site?.producerKey}:${variant.site?.consumerKey}`)))].sort();
  const developmentSites = siteKeys("dev"); const holdoutSites = siteKeys("holdout");
  return {
    version: native ? "d1-v2" : "d1-v1", seed: options.seed, generatedBy: options.generatedBy ?? "@simplercp/conflict-guard bench:generate",
    generationCommand: options.generationCommand ?? `bench:generate --seeds bench/seeds --out bench/datasets/d1-v1 --groups ${options.groups} --seed ${options.seed}`,
    codeCommit: options.codeCommit ?? "unspecified", typing: { characterIntervalMs: 150, pauseEveryCharacters: 24, pauseMs: 1800, startGapMs: [5_000, 60_000], intervalDistribution: "四次均匀采样之和生成对数对称间隔，中位数为 150 ms", intervalRangeMs: [65, 350], thoughtPauseRangeMs: [1800, 7000], schedules: ["simultaneous", "sequential", "alternating"] },
    dependencyMix: { oldBehavior: dependencyVariants.filter((variant) => variant.dependencyMode === "old-behavior").length, newBehavior: dependencyVariants.filter((variant) => variant.dependencyMode === "new-behavior").length, unrelated: dependencyVariants.filter((variant) => variant.dependencyMode === "unrelated").length, schedule: "每三个冲突算子组包含一个无关修改组；按去重样本计数，旧行为、新行为、无关修改的比例为 40%、40%、20%。安全算子单独统计。" },
    projects: projects.map((project) => project.name), groups, split: { development: groups.filter((group) => group.split === "dev").map((group) => group.id), holdout: groups.filter((group) => group.split === "holdout").map((group) => group.id) },
    programStats: { uniquePrograms: new Set(allVariants.flatMap((variant) => [variant.baseline, variant.leftOnly, variant.rightOnly, variant.merged].map(programFingerprint))).size, seedPrograms: new Set(projects.map((project) => programFingerprint(project.files))).size, uniqueVariantPrograms: new Set(allVariants.map(statesFingerprint)).size, samples: allVariants.length, developmentHoldoutOverlap: [...developmentPrograms].filter((fingerprint) => holdoutPrograms.has(fingerprint)).length, groupsByProject: countBy(groups, (group) => group.project), groupsByOperator: countBy(groups, (group) => group.operator.id), heldoutFamilies: [...heldoutFamilies] },
    ...(diversity ? { diversity, siteStats: { development: developmentSites, holdout: holdoutSites, overlap: developmentSites.filter((key) => holdoutSites.includes(key)) } } : {})
  };
}

export function synthesizeTrace(baseline: Record<string, string>, left: Record<string, string>, right: Record<string, string>, seed: number): TraceEvent[] {
  const random = createRandom(seed);
  const pauseEvery = seed % 4 === 0 ? 48 : 24;
  const events: TraceEvent[] = [{ schema: 3, seq: 1, at: 0, type: "session_start", mode: "rules", pairRevisionMode: "judged-input", seed, config: { idleMs: 1500, maxBatchDurationMs: 5000, activeIdleMs: 600000 }, typing: { pauseEveryCharacters: pauseEvery, schedule: (["simultaneous", "sequential", "alternating"] as const)[seed % 3] } }];
  for (const file of Object.keys(baseline).filter((file) => !file.startsWith("test/")).sort()) events.push({ schema: 3, seq: events.length + 1, at: 0, type: "doc_open", file, text: baseline[file], textHash: hash(baseline[file]!) });
  interface Edit { file: string; memberId: string; at: number; block: string; deleted: string; inserted: string }
  const edits: Edit[] = [];
  const cursors: Array<{ file: string; memberId: string; at: number }> = [];
  const documents = new Map<string, Y.Doc>();
  const anchors = new Map<string, Y.RelativePosition>();
  for (const file of Object.keys(baseline).sort()) {
    const document = new Y.Doc(); document.clientID = documents.size + 1;
    document.getText("content").insert(0, baseline[file]!); documents.set(file, document);
  }
  const scheduleMode = seed % 3;
  let leftFinish = 100;
  for (const [actorIndex, memberId, changes] of [[0, "origin", left], [1, "candidate", right]] as const) {
    const start = actorIndex === 0 ? 100 : scheduleMode === 1 ? leftFinish + 5_000 + random.nextInt(55_001) : scheduleMode === 2 ? 4500 : 100 + random.nextInt(300);
    let at = start; let actorEdits = 0;
    for (const [file, after] of Object.entries(changes).sort(([a], [b]) => a.localeCompare(b))) {
      const before = baseline[file]!; let offset = 0; let blockIndex = 0;
      const parts = diff(before, after);
      for (let part = 0; part < parts.length; part += 1) {
        const [operation, text] = parts[part]!;
        if (operation === diff.EQUAL) { offset += text.length; continue; }
        let removed = ""; let added = "";
        while (part < parts.length && parts[part]![0] !== diff.EQUAL) {
          const [kind, content] = parts[part]!;
          if (kind === diff.DELETE) removed += content; else added += content;
          part += 1;
        }
        part -= 1;
        const block = `${memberId}:${file}:${blockIndex++}`;
        anchors.set(block, Y.createRelativePositionFromTypeIndex(documents.get(file)!.getText("content"), offset, -1));
        for (let character = 0; character < Math.max(removed.length, added.length); character += 1) {
          if (actorEdits > 0 && actorEdits % pauseEvery === 0) { cursors.push({ file, memberId, at: at + 1 }); at += 1800 + random.nextInt(5201); }
          if (scheduleMode === 2 && actorEdits > 0 && actorEdits % 12 === 0) at += 4500;
          edits.push({ file, memberId, at, block, deleted: removed[character] ?? "", inserted: added[character] ?? "" });
          actorEdits += 1;
          const sample = random.nextUnit() + random.nextUnit() + random.nextUnit() + random.nextUnit() - 2;
          at += Math.max(65, Math.min(350, Math.round(150 * Math.exp(sample * 0.65))));
        }
        offset += removed.length;
      }
      cursors.push({ file, memberId, at: at + 1 });
    }
    if (actorIndex === 0) leftFinish = at;
  }
  const revisions = new Map<string, number>();
  const ordered = edits.sort((a, b) => a.at - b.at || a.memberId.localeCompare(b.memberId));
  for (const edit of ordered) {
    const document = documents.get(edit.file)!; const text = document.getText("content");
    const absolute = Y.createAbsolutePositionFromRelativePosition(anchors.get(edit.block)!, document);
    if (!absolute) throw new Error(`编辑锚点不可用：${edit.file}`);
    const from = absolute.index; const deleted = text.toString().slice(from, from + edit.deleted.length);
    if (edit.deleted && deleted !== edit.deleted) throw new Error(`算子的文本区域发生重叠：${edit.file}`);
    document.transact(() => { if (deleted) text.delete(from, deleted.length); if (edit.inserted) text.insert(from, edit.inserted); });
    anchors.set(edit.block, Y.createRelativePositionFromTypeIndex(text, from + edit.inserted.length, -1));
    const revision = (revisions.get(edit.file) ?? 0) + 1; revisions.set(edit.file, revision);
    events.push({ schema: 3, seq: 0, at: edit.at, type: "edit", file: edit.file, origin: { kind: "human", memberId: edit.memberId }, ops: [{ from, deleted, inserted: edit.inserted }], revisionAfter: revision });
  }
  for (const cursor of cursors) events.push({ schema: 3, seq: 0, at: cursor.at, type: "cursor", memberId: cursor.memberId, file: cursor.file, position: { lineNumber: 1, column: 1 } });
  const lastEdit = ordered.at(-1);
  if (lastEdit) events.push({ schema: 3, seq: 0, at: Math.max(...events.map((event) => event.at)) + 600_001, type: "cursor", memberId: lastEdit.memberId, file: lastEdit.file, position: { lineNumber: 1, column: 1 } });
  events.sort((a, b) => a.at - b.at || (a.type === "edit" ? 1 : 0) - (b.type === "edit" ? 1 : 0));
  events.forEach((event, index) => event.seq = index + 1);
  for (const document of documents.values()) document.destroy();
  return events;
}

function programFingerprint(files: Record<string, string>) { return hash(JSON.stringify(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)))); }
function statesFingerprint(variant: BenchVariant) { return hash(JSON.stringify([variant.baseline, variant.leftOnly, variant.rightOnly, variant.merged])); }
function countBy<T>(values: T[], key: (value: T) => string) { return Object.fromEntries([...new Set(values.map(key))].sort().map((name) => [name, values.filter((value) => key(value) === name).length])); }
function hash(text: string) { return createHash("sha256").update(text).digest("hex"); }
function createRandom(seed: number) { let state = seed >>> 0 || 1; const next = () => state = (state * 1_664_525 + 1_013_904_223) >>> 0; return { nextInt: (max: number) => next() % max, nextUnit: () => next() / 4_294_967_296 }; }
