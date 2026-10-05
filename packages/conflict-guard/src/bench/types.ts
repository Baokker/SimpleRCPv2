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
  truth: BenchTruth;
  detectability: Detectability;
  baseline: Record<string, string>;
  leftOnly: Record<string, string>;
  rightOnly: Record<string, string>;
  merged: Record<string, string>;
  trace: TraceEvent[];
}

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
  projects: string[];
  groups: BenchRelationGroup[];
  split: { development: string[]; holdout: string[] };
}

export interface ProbeRun {
  passed: boolean;
  observations: Record<string, string | number | boolean>;
  typeError?: boolean;
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
