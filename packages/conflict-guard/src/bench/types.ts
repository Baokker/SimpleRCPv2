import type { TraceEvent } from "../trace/trace.js";

export type OperatorFamily = "IC" | "CP" | "SS" | "EB" | "SF";
export type BenchTruth = "lock" | "warn" | "allow";
export type Detectability = "text-merge" | "typecheck" | "runtime-only" | "none";

export interface SeedProject {
  name: string;
  files: Record<string, string>;
}

export interface OperatorSpec {
  id: string;
  family: OperatorFamily;
  conflictPattern?: "overlap-contamination" | "confluent-interference" | "assignment-override" | "execution-perturbation";
  expectedTruth: BenchTruth;
  expectedDetectability: Detectability;
  description: string;
}

export interface BenchVariant {
  id: string;
  kind: "conflict" | "safe";
  operatorId?: string;
  dependencyMode?: "old-behavior" | "new-behavior" | "unrelated";
  probe?: string;
  probes?: BenchProbe[];
  truth: BenchTruth | "exclude";
  detectability: Detectability;
  baseline: Record<string, string>;
  leftOnly: Record<string, string>;
  rightOnly: Record<string, string>;
  merged: Record<string, string>;
  trace: TraceEvent[];
  traceFile?: string;
  traceHash?: string;
  entryPoints?: { producer: string; consumer: string };
  aliasOf?: string;
  site?: { producerKey: string; consumerKey: string; producerName: string; consumerName: string };
  expectedMergedObservations?: Record<string, unknown>;
  baselineReference?: Record<string, string>;
  schedule?: "simultaneous" | "sequential" | "alternating";
}

export type ProbeOwner = "origin-intent" | "candidate-intent" | "shared-regression" | "observation";
export interface BenchProbe { id: string; owner: ProbeOwner; expression: string; expected?: unknown; expectedExpression?: string; expectedMergedExpression?: string; statement: string }

export interface BenchRelationGroup {
  id: string;
  project: string;
  operator: OperatorSpec;
  split: "dev" | "holdout";
  seed: number;
  variants: { conflict: BenchVariant; safe: BenchVariant };
}

export interface BenchManifest {
  version: "d1-v1";
  seed: number;
  generatedBy: string;
  generationCommand: string;
  codeCommit: string;
  typing?: { characterIntervalMs: number; pauseEveryCharacters: number; pauseMs: number; startGapMs: [number, number]; intervalDistribution?: string; intervalRangeMs?: [number, number]; thoughtPauseRangeMs?: [number, number]; schedules?: string[] };
  dependencyMix?: { oldBehavior: number; newBehavior: number; unrelated: number; schedule: string };
  projects: string[];
  groups: BenchRelationGroup[];
  split: { development: string[]; holdout: string[] };
  programStats?: { uniquePrograms: number; seedPrograms?: number; uniqueVariantPrograms?: number; samples?: number; developmentHoldoutOverlap: number; groupsByProject: Record<string, number>; groupsByOperator: Record<string, number>; heldoutFamilies?: string[] };
}

export interface ProbeRun {
  passed: boolean;
  observations: Record<string, string | number | boolean>;
  typeError?: boolean;
  probes?: Record<string, { owner: ProbeOwner; passed: boolean; value?: unknown; error?: string }>;
  timeout?: boolean;
  stdout?: string;
  stderr?: string;
  diagnostics?: string[];
  expectedMergedObservations?: Record<string, string | number | boolean>;
  regression?: { passed: boolean; tests: number; stdout: string; stderr: string };
}

export interface BenchLabel {
  id: string;
  relationGroupId: string;
  variant: "conflict" | "safe";
  label: BenchTruth | "exclude";
  reason: "invalid-baseline" | "invalid-side" | "flaky" | "text-conflict" | "merged-probe-failed" | "emergent-behavior" | "compatible";
  detectability: Detectability;
  states: Record<"baseline" | "leftOnly" | "rightOnly" | "merged", ProbeRun[]>;
}
