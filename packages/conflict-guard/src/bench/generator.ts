import { createHash } from "node:crypto";
import type { TraceEvent } from "../trace/trace.js";
import type { BenchManifest, BenchRelationGroup, BenchVariant, OperatorSpec, SeedProject } from "./types.js";
import { OPERATOR_SPECS } from "./operators.js";

export interface GenerateOptions {
  groups: number;
  seed: number;
  projects: SeedProject[];
  generatedBy?: string;
}

export function generateManifest(options: GenerateOptions): BenchManifest {
  if (!Number.isInteger(options.groups) || options.groups < 1) throw new Error("groups 必须为正整数");
  if (options.projects.length === 0) throw new Error("至少需要一个种子项目");
  const random = createRandom(options.seed);
  const groups: BenchRelationGroup[] = [];
  for (let index = 0; index < options.groups; index += 1) {
    const project = options.projects[random.nextInt(options.projects.length)]!;
    const operator = OPERATOR_SPECS[index % OPERATOR_SPECS.length]!;
    const groupSeed = random.nextInt(2_147_483_647);
    const projectName = project.name || `seed-${index}`;
    const split = holdout(projectName, operator.id, index, options.groups) ? "holdout" : "dev";
    const baseline = projectFiles(project, index);
    const conflict = makeVariant({ id: `d1-${index + 1}-conflict`, kind: "conflict", operator, baseline, seed: groupSeed });
    const safe = makeVariant({ id: `d1-${index + 1}-safe`, kind: "safe", operator, baseline, seed: groupSeed });
    groups.push({ id: `d1-${String(index + 1).padStart(4, "0")}`, project: projectName, operator, split, seed: groupSeed, variants: { conflict, safe } });
  }
  return { version: "d1-v1", seed: options.seed, generatedBy: options.generatedBy ?? "@simplercp/conflict-guard bench:generate", generationCommand: "bench:generate --seeds <dir> --out <dataset> --groups <n> --seed <s>", codeCommit: "working-tree", projects: [...new Set(groups.map((group) => group.project))].sort(), groups, split: { development: groups.filter((group) => group.split === "dev").map((group) => group.id), holdout: groups.filter((group) => group.split === "holdout").map((group) => group.id) } };
}

function makeVariant(options: { id: string; kind: "conflict" | "safe"; operator: OperatorSpec; baseline: Record<string, string>; seed: number }): BenchVariant {
  const leftOnly = clone(options.baseline);
  const rightOnly = clone(options.baseline);
  const merged = clone(options.baseline);
  const producer = "src/producer.ts";
  const consumer = "src/consumer.ts";
  const origin = originText(options.operator, options.seed);
  const candidate = candidateText(options.operator, options.kind, options.seed);
  leftOnly[producer] = origin.producer;
  rightOnly[consumer] = candidate.consumer;
  merged[producer] = origin.producer;
  merged[consumer] = candidate.consumer;
  const trace = buildTrace(options.baseline, leftOnly, rightOnly);
  return { id: options.id, kind: options.kind, truth: options.kind === "safe" ? "allow" : options.operator.expectedTruth, detectability: options.kind === "safe" ? "none" : options.operator.expectedDetectability, baseline: clone(options.baseline), leftOnly, rightOnly, merged, trace };
}

function originText(operator: OperatorSpec, seed: number) {
  const marker = seed % 2 === 0 ? "origin" : "changed";
  if (operator.id === "IC-1") return { producer: `export function applyDiscount(price: number, rate: number, currency: string): number { return price * (1 - rate); }\n`, marker };
  if (operator.id === "IC-2") return { producer: `export function applyDiscount(price: number, rate: number): { value: number } { return { value: price * (1 - rate) }; }\n`, marker };
  if (operator.id === "IC-3") return { producer: `export function applyDiscount(price: number, rate: number): number { return price * (1 - rate) * 1000; }\n`, marker };
  if (operator.family === "CP") return { producer: `export function applyDiscount(price: number, rate: number): number { const ${marker} = price * (1 - rate); return ${marker}; }\n`, marker };
  if (operator.family === "SS") return { producer: `let shared = 0;\nexport function applyDiscount(price: number, rate: number): number { shared += 1; return price * (1 - rate); }\n`, marker };
  if (operator.family === "EB") return { producer: `export function applyDiscount(price: number, rate: number): number | undefined { if (rate < 0) return undefined; return price * (1 - rate); }\n`, marker };
  return { producer: `export function applyDiscount(price: number, rate: number): number { console.log("${marker}"); return price * (1 - rate); }\n`, marker };
}

function candidateText(operator: OperatorSpec, kind: "conflict" | "safe", seed: number) {
  if (kind === "safe") return { consumer: `import { applyDiscount } from "./producer.js";\nexport function checkout(price: number) { console.log("trace-${seed % 7}"); return applyDiscount(price, 0.1); }\n` };
  if (operator.id === "IC-1") return { consumer: `import { applyDiscount } from "./producer.js";\nexport function checkout(price: number) { return applyDiscount(price, 0.1) + 0; }\n` };
  if (operator.id === "IC-2") return { consumer: `import { applyDiscount } from "./producer.js";\nexport function checkout(price: number) { return applyDiscount(price, 0.1).value; }\n` };
  if (operator.id === "IC-3") return { consumer: `import { applyDiscount } from "./producer.js";\nexport function checkout(price: number) { return applyDiscount(price, 0.1) / 1000; }\n` };
  if (operator.family === "EB") return { consumer: `import { applyDiscount } from "./producer.js";\nexport function checkout(price: number) { try { return applyDiscount(price, 0.1) as number; } catch { return price; } }\n` };
  return { consumer: `import { applyDiscount } from "./producer.js";\nexport function checkout(price: number) { return applyDiscount(price, 0.1) + 1; }\n` };
}

function projectFiles(project: SeedProject, index: number) {
  const files = clone(project.files);
  files["src/producer.ts"] = `export function applyDiscount(price: number, rate: number): number { return price * (1 - rate); }\n`;
  files["src/consumer.ts"] = `import { applyDiscount } from "./producer.js";\nexport function checkout(price: number) { return applyDiscount(price, 0.1); }\n`;
  files[`src/fixture-${index % 3}.ts`] = `export const fixture${index % 3} = ${index};\n`;
  return files;
}

function buildTrace(baseline: Record<string, string>, leftOnly: Record<string, string>, rightOnly: Record<string, string>): TraceEvent[] {
  const events: TraceEvent[] = [{ schema: 3, seq: 1, at: 0, type: "session_start", mode: "rules", seed: 0 }];
  let seq = 2;
  const actor = (memberId: string) => ({ kind: "human", memberId });
  for (const file of ["src/producer.ts", "src/consumer.ts"]) {
    const text = baseline[file] ?? "";
    events.push({ schema: 3, seq: seq++, at: 0, type: "doc_open", file, text, textHash: hash(text) });
  }
  const edits: Array<[string, string, string, number]> = [["src/producer.ts", leftOnly["src/producer.ts"] ?? "", "origin", 100], ["src/consumer.ts", rightOnly["src/consumer.ts"] ?? "", "candidate", 220]];
  for (const [file, after, memberId, at] of edits) {
    const before = baseline[file] ?? "";
    events.push({ schema: 3, seq: seq++, at, type: "edit", file, origin: actor(memberId), ops: [{ from: 0, deleted: before, inserted: after }], revisionAfter: 1 });
  }
  return events;
}

function holdout(project: string, operator: string, index: number, total: number) {
  return index >= Math.max(1, Math.ceil(total * 0.4)) || project.toLowerCase().includes("holdout") || ["EB-1", "SS-3"].includes(operator);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function createRandom(seed: number) {
  let state = (seed >>> 0) || 1;
  return { nextInt(max: number) { state = (state * 1_664_525 + 1_013_904_223) >>> 0; return state % max; } };
}
