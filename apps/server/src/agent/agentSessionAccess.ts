import type { AgentSession } from "@simplercp/shared";
import type { ProjectRuntime } from "../projectRuntime.js";
import type { AgentRunStore } from "./agentRunStore.js";
import type { AgentSessionStore } from "./agentSessionStore.js";

export async function migrateLegacyAgentSessions(
  projectId: string,
  runStore: AgentRunStore,
  sessionStore: AgentSessionStore
) {
  const runs = await runStore.list();
  const migrated = new Map<
    string,
    Awaited<ReturnType<typeof sessionStore.create>>
  >();

  for (const run of runs) {
    if (run.sessionId && await sessionStore.get(run.sessionId)) continue;
    const legacyRuntimeSessionId = run.runtimeSessionId ?? run.sessionId;
    const migrationKey = `${run.memberId}:${legacyRuntimeSessionId ?? run.id}`;
    let session = migrated.get(migrationKey);
    if (!session) {
      session = await sessionStore.create({
        projectId,
        memberId: run.memberId,
        memberName: run.memberName,
        title: run.prompt.slice(0, 80),
        runtime: "opencode",
        runtimeSessionId: legacyRuntimeSessionId,
        lastRunId: run.id
      });
      migrated.set(migrationKey, session);
    }
    await runStore.update(run.id, {
      sessionId: session.id,
      runtimeSessionId: legacyRuntimeSessionId
    });
  }
}

export async function claimLegacyAgentSession(
  projectRuntime: ProjectRuntime,
  sessionStore: AgentSessionStore,
  session: AgentSession,
  participantId: string,
  displayName: string
) {
  return session;
}
