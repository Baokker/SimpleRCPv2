import { createHash } from "node:crypto";
import * as Y from "yjs";
import type { TraceEvent } from "../trace/trace.js";
import type { BenchManifest, BenchRelationGroup, BenchVariant, SeedProject } from "./types.js";
import { OPERATOR_SPECS } from "./operators.js";
import { operatorTemplate } from "./templates.js";

export interface GenerateOptions { groups: number; seed: number; projects: SeedProject[]; generatedBy?: string; codeCommit?: string; generationCommand?: string }
export function generateManifest(options: GenerateOptions): BenchManifest {
  if (!Number.isInteger(options.groups) || options.groups < 1) throw new Error("groups 必须为正整数");
  if (options.projects.length === 0) throw new Error("至少需要一个种子项目");
  const random = createRandom(options.seed);
  const projects = [...options.projects].sort((a, b) => a.name.localeCompare(b.name));
  const shuffled = [...projects].sort((a, b) => hash(`${options.seed}:${a.name}`).localeCompare(hash(`${options.seed}:${b.name}`)));
  const devProjects = new Set(shuffled.slice(0, Math.max(1, Math.round(projects.length * 0.4))).map((project) => project.name));
  const reserved = new Set(["EB-1", "SS-3"]);
  const groups: BenchRelationGroup[] = [];
  for (let index = 0; index < options.groups; index += 1) {
    const project = projects[index % projects.length]!;
    const eligible = OPERATOR_SPECS.filter((operator) => operator.id !== "SF-4" && (!devProjects.has(project.name) || !reserved.has(operator.id)));
    const operator = index % 10 === 9 ? OPERATOR_SPECS.find((operator) => operator.id === "SF-4")! : eligible[(index - Math.floor(index / 10)) % eligible.length]!;
    const seed = random.nextInt(2_147_483_647);
    const variants = (kind: "conflict" | "safe"): BenchVariant => {
      const template = operatorTemplate(operator.id, kind === "safe", seed);
      const baseline = { ...project.files, ...template.baseline };
      const leftOnly = { ...baseline, ...template.left };
      const rightOnly = { ...baseline, ...template.right };
      const merged = { ...baseline, ...template.left, ...template.right, ...template.merged };
      return { id: `d1-${index + 1}-${kind}`, kind, operatorId: operator.id, dependencyMode: operator.id === "SF-4" ? "unrelated" : kind === "safe" ? "new-behavior" : "old-behavior", probes: template.probes, truth: kind === "safe" ? "allow" : operator.expectedTruth, detectability: kind === "safe" ? "none" : operator.expectedDetectability, baseline, leftOnly, rightOnly, merged, trace: buildTrace(baseline, template.left, template.right, seed) };
    };
    groups.push({ id: `d1-${String(index + 1).padStart(4, "0")}`, project: project.name, operator, split: devProjects.has(project.name) ? "dev" : "holdout", seed, variants: { conflict: variants("conflict"), safe: variants("safe") } });
  }
  const unrelated = Math.floor(options.groups / 10) * 2;
  return { version: "d1-v1", seed: options.seed, generatedBy: options.generatedBy ?? "@simplercp/conflict-guard bench:generate", generationCommand: options.generationCommand ?? `bench:generate --seeds bench/seeds --out bench/datasets/d1-v1 --groups ${options.groups} --seed ${options.seed}`, codeCommit: options.codeCommit ?? "unspecified", typing: { characterIntervalMs: 20, pauseEveryCharacters: 24, pauseMs: 180, startGapMs: [100, 399] }, dependencyMix: { oldBehavior: options.groups - unrelated / 2, newBehavior: options.groups - unrelated / 2, unrelated, schedule: "每十个关系组包含一个无关组；其余组分别包含依赖旧行为与依赖新行为的两个变体。" }, projects: projects.map((project) => project.name), groups, split: { development: groups.filter((group) => group.split === "dev").map((group) => group.id), holdout: groups.filter((group) => group.split === "holdout").map((group) => group.id) } };
}

function buildTrace(baseline: Record<string, string>, left: Record<string, string>, right: Record<string, string>, seed: number): TraceEvent[] {
  const events: TraceEvent[] = [{ schema: 3, seq: 1, at: 0, type: "session_start", mode: "rules", seed, config: { idleMs: 1500, maxBatchDurationMs: 5000, activeIdleMs: 600000 }, typing: { characterIntervalMs: 20, pauseEveryCharacters: 24, pauseMs: 180 } }];
  for (const file of Object.keys(baseline).sort()) events.push({ schema: 3, seq: events.length + 1, at: 0, type: "doc_open", file, text: baseline[file], textHash: hash(baseline[file]!) });
  const edits: Array<{ file: string; memberId: string; at: number; from: number; deleted: string; inserted: string }> = [];
  const documents = new Map<string, Y.Doc>();
  const anchors = new Map<string, { cursor: Y.RelativePosition; end: Y.RelativePosition }>();
  for (const file of Object.keys(baseline).sort()) {
    const document = new Y.Doc(); document.clientID = documents.size + 1;
    document.getText("content").insert(0, baseline[file]!); documents.set(file, document);
  }
  for (const [memberId, changes, start] of [["origin", left, 100], ["candidate", right, 200 + seed % 300]] as const) {
    for (const [file, after] of Object.entries(changes)) {
      const before = baseline[file]!;
      let prefix = 0;
      while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
      let suffix = 0;
      while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
      const removed = before.slice(prefix, before.length - suffix);
      const added = after.slice(prefix, after.length - suffix);
      const text = documents.get(file)!.getText("content");
      anchors.set(`${memberId}:${file}`, { cursor: Y.createRelativePositionFromTypeIndex(text, prefix, -1), end: Y.createRelativePositionFromTypeIndex(text, before.length - suffix, -1) });
      if (removed.length) edits.push({ file, memberId, at: start, from: prefix, deleted: removed, inserted: "" });
      for (let index = 0; index < added.length; index += 1) edits.push({ file, memberId, at: start + index * 20 + Math.floor(index / 24) * 180, from: prefix + index, deleted: "", inserted: added[index]! });
    }
  }
  const revisions = new Map<string, number>();
  const ordered = edits.sort((a, b) => a.at - b.at || a.memberId.localeCompare(b.memberId));
  for (const edit of ordered) {
    const document = documents.get(edit.file)!;
    const text = document.getText("content");
    const anchor = anchors.get(`${edit.memberId}:${edit.file}`)!;
    const from = Y.createAbsolutePositionFromRelativePosition(anchor.cursor, document)!.index;
    const end = edit.deleted ? Y.createAbsolutePositionFromRelativePosition(anchor.end, document)!.index : from;
    const deleted = text.toString().slice(from, end);
    if (edit.deleted && deleted !== edit.deleted) throw new Error(`算子的文本区域发生重叠：${edit.file}`);
    document.transact(() => { if (deleted) text.delete(from, deleted.length); if (edit.inserted) text.insert(from, edit.inserted); });
    anchor.cursor = Y.createRelativePositionFromTypeIndex(text, from + edit.inserted.length, -1);
    const revision = (revisions.get(edit.file) ?? 0) + 1;
    revisions.set(edit.file, revision);
    events.push({ schema: 3, seq: events.length + 1, at: edit.at, type: "edit", file: edit.file, origin: { kind: "human", memberId: edit.memberId }, ops: [{ from, deleted, inserted: edit.inserted }], revisionAfter: revision });
  }
  for (const memberId of ["origin", "candidate"]) {
    const last = [...ordered].reverse().find((edit) => edit.memberId === memberId);
    if (last) events.push({ schema: 3, seq: events.length + 1, at: (ordered.at(-1)?.at ?? 0) + 5000, type: "cursor", memberId, file: last.file, position: { lineNumber: 1, column: 1 } });
  }
  for (const document of documents.values()) document.destroy();
  return events;
}
function hash(text: string) { return createHash("sha256").update(text).digest("hex"); }
function createRandom(seed: number) { let state = seed >>> 0 || 1; return { nextInt(max: number) { state = (state * 1_664_525 + 1_013_904_223) >>> 0; return state % max; } }; }
