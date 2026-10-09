import type { AgentRunStore } from "./agentRunStore.js";
import type { AgentSessionStore } from "./agentSessionStore.js";

export async function migrateLegacyAgentSessions(
  projectId: string,
  runStore: AgentRunStore,
  sessionStore: AgentSessionStore,
  memberIds: Set<string>
) {
  for (const session of await sessionStore.list()) {
    if ((session.scope ?? "personal") !== "team" && !memberIds.has(session.memberId) && !session.historical) {
      await sessionStore.update(session.id, { historical: true });
    }
  }
  const runs = await runStore.list();
  const migrated = new Map<
    string,
    Awaited<ReturnType<typeof sessionStore.create>>
  >();

  for (const run of runs) {
    const storedSession = run.sessionId ? await sessionStore.get(run.sessionId) : undefined;
    if (storedSession) {
      if (!run.sessionScope) await runStore.update(run.id, { sessionScope: storedSession.scope ?? "personal" });
      continue;
    }
    const legacyRuntimeSessionId = run.runtimeSessionId ?? run.sessionId;
    const migrationKey = `${run.memberId}:${legacyRuntimeSessionId ?? run.id}`;
    let session = migrated.get(migrationKey);
    if (!session) {
      session = await sessionStore.create({
        projectId,
        memberId: run.memberId,
        memberName: run.memberName,
        historical: !memberIds.has(run.memberId),
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
