import fs from "node:fs/promises";
import path from "node:path";
import { redactSensitive } from "../agent/traceStore.js";
import type { ApprovalOutcome, ApproverRole } from "./approvals.js";
import type { Action, GuardDecision, Level } from "./types.js";

type ModelAudit = NonNullable<GuardDecision["llm"]> | {
  mode: NonNullable<GuardDecision["llm"]>["mode"];
  unavailable: true;
  applied: false;
  latencyMs: number;
};

export interface GuardAuditRecord {
  timestamp: string;
  projectId: string;
  memberId: string;
  source: "terminal" | "agent" | "team";
  agentRunId?: string;
  sessionScope?: "personal" | "team";
  agentHandle?: string;
  command?: string;
  paths?: string[];
  action: Action;
  matchedRules: string[];
  approver?: string;
  approverRole?: ApproverRole;
  approvedAt?: string;
  result?: ApprovalOutcome;
  durationMicros: number;
  stage?: "decision" | "llm" | "approval" | "owner-self" | "remembered";
  model?: ModelAudit;
  sourceLevel?: Level;
}

export function createGuardAudit(storagePath: string, sensitiveValues: string[] = []) {
  let operations = Promise.resolve();
  return {
    append(record: GuardAuditRecord) {
      const safe = redactSensitive(record, sensitiveValues) as GuardAuditRecord;
      operations = operations.then(async () => {
        await fs.mkdir(path.dirname(storagePath), { recursive: true });
        await fs.appendFile(storagePath, `${JSON.stringify(safe)}\n`, { mode: 0o600 });
      });
      return safe;
    },
    async awaitIdle() { await operations; }
  };
}
