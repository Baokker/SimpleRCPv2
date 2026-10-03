import fs from "node:fs/promises";
import path from "node:path";
import { redactSensitive } from "../agent/traceStore.js";

export interface GuardAuditRecord {
  timestamp: string;
  projectId: string;
  memberId: string;
  source: string;
  agentRunId?: string;
  sessionScope?: "personal" | "team";
  agentHandle?: string;
  command?: string;
  paths?: string[];
  action: string;
  matchedRules: string[];
  approver?: string;
  result?: string;
  durationMicros: number;
  model?: unknown;
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
