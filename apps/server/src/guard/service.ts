import path from "node:path";
import type { GuardLlmMode, GuardSettings } from "@simplercp/shared";
import type { ProjectRecord } from "../projects.js";
import type { MemberStore } from "../auth/identity.js";
import type { EventLog } from "../eventLog.js";
import type { RoomStore } from "../rooms.js";
import { readJsonFile, writeJsonFileAtomically } from "../jsonFile.js";
import { createApprovalMemory, REMEMBERED_RULE } from "./approvalMemory.js";
import { createApprovalQueue, type ApprovalOutcome, type PendingApproval } from "./approvals.js";
import { createGuardAudit } from "./audit.js";
import { applyAgentProvenance, decide } from "./decide.js";
import { judgeGuardRequest, type JudgeResult } from "./llmJudge.js";
import { LEVELS, roleLevel } from "./roles.js";
import { applyScriptInspection, fileScriptSource, inspectScripts, lowerLevel, simpleCommands } from "./scriptInspection.js";
import { createSnapshotStore } from "./snapshots.js";
import { createWriteProvenance } from "./writeProvenance.js";
import { parseCommandPaths } from "./legacy/parser.js";
import type { Action, GuardDecision, GuardRequest, Level } from "./types.js";

interface GuardPolicy {
  protectedPaths: string[];
  llmMode: GuardLlmMode;
}

export function resolveGuardLlmMode(stored: GuardPolicy | undefined, configured: GuardLlmMode | undefined): GuardLlmMode {
  return stored?.llmMode ?? configured ?? "suggest";
}

export function effectiveGuardLlmMode(mode: GuardLlmMode, configured: boolean): GuardLlmMode {
  return configured ? mode : "off";
}

export function approvalTimeoutForMode(_mode: GuardLlmMode, requestedTimeout: number | null | undefined, _configuredTimeout: number): number | null | undefined {
  return requestedTimeout;
}

export function applyLlmJudgment(
  decision: GuardDecision,
  mode: GuardLlmMode,
  source: GuardRequest["source"],
  model: JudgeResult
): GuardDecision {
  const confidenceThreshold = source === "agent" ? 0.95 : 0.85;
  const applied = mode === "auto" && decision.autoEligible && model.confidence >= confidenceThreshold && (model.risk === "low" || model.risk === "high");
  const modelAction = model.risk === "high"
    ? "deny"
    : decision.segments.some((segment) => segment.reversibility === "snapshot") ? "allow_snapshot" : "allow";
  return {
    ...decision,
    action: applied ? modelAction : decision.action,
    llm: { mode, ...model, applied }
  };
}

export function createGuardService(options: {
  project: ProjectRecord;
  roomId: string;
  rooms: RoomStore;
  events: EventLog;
  members: MemberStore;
  metadataRoot: string;
  platformDataRoot: string;
  mode: "full" | "human-only" | "native" | "off";
  llmMode?: GuardLlmMode;
  llm?: { provider?: "deepseek" | "minimax"; baseUrl?: string; apiKey?: string; model?: string; timeoutMs?: number };
  approvalTimeoutMs?: number;
  approvalMemoryTtlMs?: number;
  otherWorkspaceRoots?: (currentProjectId: string) => string[];
  scriptInspection?: boolean;
  agentProvenance?: boolean;
}) {
  const policyPath = path.join(options.metadataRoot, "guard-policy.json");
  const audit = createGuardAudit(path.join(options.metadataRoot, "guard-audit.jsonl"), options.llm?.apiKey ? [options.llm.apiKey] : []);
  const approvals = createApprovalQueue(options.approvalTimeoutMs ?? 120_000);
  const approvalMemory = createApprovalMemory(options.approvalMemoryTtlMs);
  const membershipRevisions = new Map<string, number>();
  const runSourceLevels = new Map<string, Map<string, Level>>();
  const routingListeners = new Set<() => void>();
  function routingChanged() {
    for (const listener of routingListeners) listener();
  }
  const stopMembershipChanges = options.members.onMembershipChanged((projectId, memberId) => {
    if (projectId !== options.project.id) return;
    membershipRevisions.set(memberId, (membershipRevisions.get(memberId) ?? 0) + 1);
    approvalMemory.clearMember(memberId);
    routingChanged();
  });
  const snapshots = createSnapshotStore(options.metadataRoot, options.project.workspacePath);
  const provenance = createWriteProvenance(path.join(options.metadataRoot, "guard-provenance.json"), options.project.workspacePath);
  const pendingListeners = new Set<(approval: Omit<PendingApproval, "resolve" | "resolveOutcome" | "resolveApprover" | "timer">) => void>();
  const activityListeners = new Set<(event: ReturnType<EventLog["append"]>) => void>();
  const resolutionListeners = new Set<(id: string, outcome: ApprovalOutcome) => void>();
  const controlListeners = new Set<(holderMemberId: string | null, expiresAt?: string) => void>();
  let control: { memberId: string; expiresAt: number; timer: ReturnType<typeof setTimeout> } | undefined;
  let selectedLlmMode = options.llmMode;
  const cancelledRunIds = new Set<string>();
  // Paths that people changed from the shared terminal, so an Agent's change list does not claim them.
  const terminalChanges: Array<{ memberId: string; paths: string[]; at: number }> = [];

  async function policy(): Promise<GuardPolicy> {
    const stored = await readJsonFile<GuardPolicy>(policyPath);
    return {
      protectedPaths: stored?.protectedPaths ?? [".env*", "*.pem", "*.key", ".git/hooks/**", ".git/config"],
      llmMode: resolveGuardLlmMode(stored, selectedLlmMode)
    };
  }

  async function settings(): Promise<GuardSettings> {
    return { ...await policy(), llmConfigured: Boolean(options.llm?.baseUrl && options.llm.apiKey), guardMode: options.mode };
  }

  function publishActivity(input: Parameters<EventLog["append"]>[0]) {
    const event = options.events.append(input);
    for (const listener of activityListeners) listener(event);
    return event;
  }

  function publishResolution(id: string, outcome: ApprovalOutcome) {
    for (const listener of resolutionListeners) listener(id, outcome);
  }

  approvals.onResolution(publishResolution);

  async function currentMember(memberId: string) {
    const member = await options.members.getMember(options.project.id, memberId);
    if (!member) throw new Error("Project membership is required");
    const online = options.rooms.getRoom(options.roomId)?.members.some((candidate) => candidate.id === memberId && candidate.online) ?? false;
    return { member, online, level: roleLevel(member.role) as Level };
  }

  async function routeApprovers(request: GuardRequest, decision: GuardDecision) {
    if (decision.action !== "ask") return [];
    const records = await options.members.listMembers(options.project.id);
    const onlineIds = new Set(options.rooms.getRoom(options.roomId)?.members.filter((member) => member.online).map((member) => member.id));
    const trigger = records.find((member) => member.memberId === request.memberId);
    if (!trigger) return [];
    if (decision.approvers === "initiator" || decision.approvers === "provenance" && roleLevel(trigger.role) === "owner") {
      return onlineIds.has(trigger.memberId) ? [{ id: trigger.memberId, role: "trigger" as const }] : [];
    }
    const others = records.filter((member) => member.memberId !== trigger.memberId && onlineIds.has(member.memberId));
    const owners = others.filter((member) => roleLevel(member.role) === "owner");
    if (owners.length) return owners.map((member) => ({ id: member.memberId, role: "owner" as const }));
    const triggerRank = LEVELS.indexOf(roleLevel(trigger.role));
    return others.filter((member) => member.delegateApprover && LEVELS.indexOf(roleLevel(member.role)) > triggerRank)
      .map((member) => ({ id: member.memberId, role: "delegate" as const }));
  }

  async function makeDecision(request: GuardRequest, recordAudit = true) {
    const started = process.hrtime.bigint();
    const stored = await currentMember(request.memberId);
    const currentPolicy = await policy();
    const context = {
      memberLevel: stored.level,
      initiatorOnline: stored.online,
      workspaceRoot: options.project.workspacePath,
      platformDataRoot: options.platformDataRoot,
      otherWorkspaceRoots: options.otherWorkspaceRoots?.(options.project.id),
      protectedPaths: currentPolicy.protectedPaths
    };
    await provenance.load();
    const source = fileScriptSource(undefined, provenance.levelOf, provenance.writerOf);
    function evaluate(candidate: GuardRequest, memberLevel: Level) {
      const evaluationContext = { ...context, memberLevel };
      const base = decide(candidate, evaluationContext);
      if (options.scriptInspection === false) return base;
      return applyScriptInspection(base, inspectScripts(candidate, evaluationContext, source), memberLevel, candidate.source);
    }
    let decision = evaluate(request, stored.level);
    if (options.agentProvenance !== false && request.source === "agent" && request.agentRunId) {
      const authors = runSourceLevels.get(request.agentRunId);
      if (authors?.size) {
        const members = await options.members.listMembers(options.project.id);
        const sourceLevel = [...authors].filter(([author]) => author !== request.memberId).reduce<Level>((lowest, [author, recordedLevel]) => {
          const member = members.find((candidate) => candidate.memberId === author);
          return lowerLevel(lowest, member ? lowerLevel(recordedLevel, roleLevel(member.role)) : recordedLevel);
        }, "owner");
        if (LEVELS.indexOf(sourceLevel) < LEVELS.indexOf(stored.level)) {
          decision = { ...applyAgentProvenance(decision, evaluate({ ...request, source: "terminal" }, sourceLevel), sourceLevel), sourceLevel };
        }
      }
    }
    if (decision.approvers === "initiator") {
      const terminalRequest = { ...request, source: "terminal" as const };
      const terminalDecision = evaluate(terminalRequest, stored.level);
      if (terminalDecision.action === "deny" || terminalDecision.action === "ask" && (terminalDecision.approvers !== "self" || terminalDecision.matchedRules.includes("script.foreign-writer"))) {
        decision = { ...decision, approvers: "owners" };
      }
    }
    const durationMicros = Number((process.hrtime.bigint() - started) / 1_000n);
    if (recordAudit) audit.append({ timestamp: new Date().toISOString(), projectId: request.projectId, memberId: request.memberId, source: auditSource(request), sourceLevel: decision.sourceLevel, agentRunId: request.agentRunId, sessionScope: request.sessionScope, agentHandle: request.agentHandle, command: request.command, paths: request.paths, action: decision.action, matchedRules: decision.matchedRules, durationMicros, stage: "decision" });
    return { decision, member: stored, policy: currentPolicy };
  }

  async function submit(request: GuardRequest, input: { timeoutMs?: number | null } = {}) {
    const result = await submitDecision(request, input);
    if (result.approved && options.mode === "full") {
      const member = await options.members.getMember(options.project.id, request.memberId);
      if (member) await provenance.record(request, roleLevel(member.role) as Level);
    }
    if (result.approved && options.mode === "full" && options.agentProvenance !== false && request.source === "agent" && request.agentRunId) recordReadSources(request, request.agentRunId);
    return result;
  }

  function recordReadSources(request: GuardRequest, runId: string) {
    const paths = new Set<string>();
    if (request.kind === "read") for (const target of request.paths ?? []) paths.add(path.resolve(request.cwd, target));
    if (request.kind === "command" && request.command) {
      let cwd = request.cwd;
      for (const command of simpleCommands(request.command)) {
        const parsed = parseCommandPaths(command, cwd);
        if (parsed?.commandName === "cd" && /^cd\s+[^~$`*?]+$/i.test(command)) {
          cwd = parsed.targets[0]?.resolvedPath ?? cwd;
        }
        if (parsed?.action === "read") for (const target of parsed.targets) paths.add(target.resolvedPath);
      }
    }
    recordFileSources(runId, request.memberId, paths);
  }

  function recordFileSources(runId: string, memberId: string, paths: Iterable<string>) {
    for (const target of paths) {
      const writer = provenance.writerOf(target);
      const level = provenance.levelOf(target);
      if (writer && writer !== memberId && level) recordSource(runId, writer, level);
    }
  }

  function recordSource(runId: string, authorId: string, level: Level) {
    if (cancelledRunIds.has(runId)) return;
    const levels = runSourceLevels.get(runId) ?? new Map<string, Level>();
    levels.set(authorId, lowerLevel(level, levels.get(authorId)));
    runSourceLevels.set(runId, levels);
  }

  function auditSource(request: GuardRequest) {
    return request.source === "agent" && request.sessionScope === "team" ? "team" : request.source;
  }

  async function submitDecision(request: GuardRequest, input: { timeoutMs?: number | null } = {}) {
    if (request.agentRunId && cancelledRunIds.has(request.agentRunId)) {
      const cancelledDecision: GuardDecision = { action: "deny", segments: [], legacyRisk: "unknown", matchedRules: ["guard.run-cancelled"], unknown: false, autoEligible: false, approvers: null, outcome: "denied", command: request.command };
      return { request, decision: cancelledDecision, approved: false };
    }
    if (options.mode === "off" || options.mode === "native" && request.source === "terminal" || options.mode === "human-only" && request.source === "agent") {
      return { request, decision: { action: "allow", segments: [], legacyRisk: "unknown", matchedRules: [], unknown: false, autoEligible: false, approvers: null } satisfies GuardDecision, approved: true };
    }
    if (options.mode === "native") return submitNative(request, input);
    const membershipRevision = membershipRevisions.get(request.memberId);
    const initial = await makeDecision(request);
    let decision = initial.decision;
    if (decision.action === "ask" && decision.approvers === "self" && !decision.matchedRules.includes("script.foreign-writer")) {
      decision = {
        ...decision,
        action: decision.segments.some((segment) => segment.reversibility === "snapshot") ? "allow_snapshot" : "allow",
        approvers: null,
        matchedRules: [...decision.matchedRules, "owner.self-command"]
      };
      audit.append({ timestamp: new Date().toISOString(), projectId: request.projectId, memberId: request.memberId, source: auditSource(request), sourceLevel: decision.sourceLevel, agentRunId: request.agentRunId, sessionScope: request.sessionScope, agentHandle: request.agentHandle, command: request.command, paths: request.paths, action: decision.action, matchedRules: decision.matchedRules, durationMicros: 0, stage: "owner-self" });
    }
    const remembered = approvalMemory.recall(request, decision);
    if (remembered) {
      decision = {
        ...decision,
        action: decision.segments.some((segment) => segment.reversibility === "snapshot") ? "allow_snapshot" : "allow",
        approvers: null,
        matchedRules: [...decision.matchedRules, REMEMBERED_RULE],
        outcome: "approved",
        command: request.command
      };
      audit.append({ timestamp: new Date().toISOString(), projectId: request.projectId, memberId: request.memberId, source: auditSource(request), sourceLevel: decision.sourceLevel, agentRunId: request.agentRunId, sessionScope: request.sessionScope, agentHandle: request.agentHandle, command: request.command, paths: request.paths, action: decision.action, matchedRules: decision.matchedRules, approver: remembered.approverId, approverRole: remembered.approverRole, approvedAt: new Date(remembered.at).toISOString(), result: "approved", durationMicros: 0, stage: "remembered" });
      publishActivity({
        type: "guard_action",
        memberId: request.memberId,
        payload: { source: request.source, runId: request.agentRunId, command: request.command, paths: request.paths, action: decision.action, matchedRules: decision.matchedRules, remembered: true, commandClass: remembered.commandClass }
      });
      return { request, decision, approved: true };
    }
    const llmMode = effectiveGuardLlmMode(initial.policy.llmMode, Boolean(options.llm?.baseUrl && options.llm.apiKey));
    if (decision.action === "ask" && llmMode !== "off") {
      if (options.llm?.baseUrl && options.llm.apiKey) {
        publishActivity({
          type: "guard_llm_judging",
          memberId: request.memberId,
          payload: { source: request.source, runId: request.agentRunId, command: request.command, paths: request.paths, mode: llmMode }
        });
      }
      const llmStarted = Date.now();
      const model = await judgeGuardRequest({ request, decision, mode: llmMode, ...options.llm });
      const latencyMs = Date.now() - llmStarted;
      const judged = model ? applyLlmJudgment(decision, llmMode, request.source, model) : undefined;
      if (judged?.llm) judged.llm.latencyMs = latencyMs;
      audit.append({ timestamp: new Date().toISOString(), projectId: request.projectId, memberId: request.memberId, source: auditSource(request), sourceLevel: decision.sourceLevel, agentRunId: request.agentRunId, sessionScope: request.sessionScope, agentHandle: request.agentHandle, command: request.command, paths: request.paths, action: judged?.action ?? decision.action, matchedRules: decision.matchedRules, durationMicros: latencyMs * 1_000, stage: "llm", model: judged?.llm ?? { mode: llmMode, unavailable: true, applied: false, latencyMs } });
      if (judged) {
        decision = judged;
        publishActivity({
          type: "guard_llm_result",
          memberId: request.memberId,
          payload: {
            source: request.source,
            runId: request.agentRunId,
            command: request.command,
            paths: request.paths,
            action: decision.action,
            llm: decision.llm
          }
        });
      } else {
        decision = { ...decision, llmUnavailable: true };
        publishActivity({
          type: "guard_llm_unavailable",
          memberId: request.memberId,
          payload: {
            source: request.source,
            runId: request.agentRunId,
            command: request.command,
            paths: request.paths,
            mode: llmMode,
            reason: "The model did not return a valid judgment; human approval is still required"
          }
        });
      }
    }
    if (request.agentRunId && cancelledRunIds.has(request.agentRunId)) {
      const cancelledDecision = { ...decision, action: "deny" as const, outcome: "denied" as const, matchedRules: [...decision.matchedRules, "guard.run-cancelled"] };
      return { request, decision: cancelledDecision, approved: false };
    }
    if (decision.action !== "ask") {
      const outcome = decision.action === "deny"
        ? "denied"
        : decision.llm?.applied ? "approved" : "allowed";
      decision = { ...decision, command: request.command, outcome };
      if (decision.action !== "allow" || decision.llm?.applied || decision.matchedRules.includes("owner.self-command")) publishActivity({
        type: "guard_action",
        memberId: request.memberId,
        payload: { source: request.source, runId: request.agentRunId, command: request.command, paths: request.paths, action: decision.action, matchedRules: decision.matchedRules, llm: decision.llm }
      });
      return { request, decision, approved: decision.action !== "deny" };
    }
    if (request.agentRunId && cancelledRunIds.has(request.agentRunId)) {
      const cancelledDecision = { ...decision, action: "deny" as const, outcome: "denied" as const, matchedRules: [...decision.matchedRules, "guard.run-cancelled"] };
      return { request, decision: cancelledDecision, approved: false };
    }
    if (decision.approvers === "self") decision = { ...decision, approvers: "owners" };
    const approverIds = (await routeApprovers(request, decision)).map((candidate) => candidate.id);
    const noApprover = approverIds.length === 0;
    decision.noApprover = noApprover;
    if (request.agentRunId && cancelledRunIds.has(request.agentRunId)) {
      const cancelledDecision = { ...decision, action: "deny" as const, outcome: "denied" as const, matchedRules: [...decision.matchedRules, "guard.run-cancelled"] };
      return { request, decision: cancelledDecision, approved: false };
    }
    const pendingTimeout = approvalTimeoutForMode(initial.policy.llmMode, input.timeoutMs ?? undefined, options.approvalTimeoutMs ?? 120_000);
    const pending = approvals.enqueue(request, decision, approverIds, pendingTimeout, noApprover);
    const pendingItem = approvals.list().find((item) => item.id === pending.id);
    if (!pendingItem) throw new Error("Approval was not enqueued");
    for (const listener of pendingListeners) listener(pendingItem as Omit<PendingApproval, "resolve" | "resolveOutcome" | "resolveApprover" | "timer">);
    const approved = await pending.result;
    const resolution = await pending.outcome;
    const actor = await pending.approver;
    if (approved && actor?.role && membershipRevisions.get(request.memberId) === membershipRevision) {
      approvalMemory.remember(request, decision, actor.id, actor.role, actor.at);
    }
    const approverName = actor
      ? (await options.members.getMember(options.project.id, actor.id))?.displayName
      : undefined;
    audit.append({ timestamp: new Date().toISOString(), projectId: request.projectId, memberId: request.memberId, source: auditSource(request), sourceLevel: decision.sourceLevel, agentRunId: request.agentRunId, sessionScope: request.sessionScope, agentHandle: request.agentHandle, command: request.command, paths: request.paths, action: decision.action, matchedRules: decision.matchedRules, approver: actor?.id, approverRole: actor?.role, approvedAt: approved && actor ? new Date(actor.at).toISOString() : undefined, result: resolution, durationMicros: 0, stage: "approval", model: decision.llm });
    publishActivity({
      type: "guard_approval",
      memberId: request.memberId,
      payload: { source: request.source, runId: request.agentRunId, command: request.command, paths: request.paths, action: decision.action, approved, outcome: resolution, matchedRules: decision.matchedRules }
    });
    return { request, decision: { ...decision, outcome: resolution === "timeout" ? "timeout" : resolution === "withdrawn" ? "withdrawn" : approved ? "approved" : "rejected", approverName }, approved };
  }

  // Agent platform's native permissions: whatever OpenCode asks is confirmed by the Agent's initiator alone.
  async function submitNative(request: GuardRequest, input: { timeoutMs?: number | null }) {
    const decision: GuardDecision = { action: "ask", segments: [], legacyRisk: "unknown", matchedRules: ["native.platform-ask"], unknown: false, autoEligible: false, approvers: "initiator", command: request.command };
    audit.append({ timestamp: new Date().toISOString(), projectId: request.projectId, memberId: request.memberId, source: auditSource(request), agentRunId: request.agentRunId, sessionScope: request.sessionScope, agentHandle: request.agentHandle, command: request.command, paths: request.paths, action: decision.action, matchedRules: decision.matchedRules, durationMicros: 0, stage: "decision" });
    const pending = approvals.enqueue(request, decision, [request.memberId], approvalTimeoutForMode("off", input.timeoutMs, options.approvalTimeoutMs ?? 120_000));
    const pendingItem = approvals.list().find((item) => item.id === pending.id);
    if (pendingItem) for (const listener of pendingListeners) listener(pendingItem as Omit<PendingApproval, "resolve" | "resolveOutcome" | "resolveApprover" | "timer">);
    const approved = await pending.result;
    const resolution = await pending.outcome;
    const outcome = resolution === "timeout" ? "timeout" : resolution === "withdrawn" ? "withdrawn" : approved ? "approved" : "rejected";
    const actor = await pending.approver;
    audit.append({ timestamp: new Date().toISOString(), projectId: request.projectId, memberId: request.memberId, source: auditSource(request), agentRunId: request.agentRunId, sessionScope: request.sessionScope, agentHandle: request.agentHandle, command: request.command, paths: request.paths, action: decision.action, matchedRules: decision.matchedRules, approver: actor?.id, approverRole: actor?.role, approvedAt: approved && actor ? new Date(actor.at).toISOString() : undefined, result: resolution, durationMicros: 0, stage: "approval" });
    publishActivity({ type: "guard_approval", memberId: request.memberId, payload: { source: request.source, runId: request.agentRunId, command: request.command, paths: request.paths, action: decision.action, approved, outcome: resolution, matchedRules: decision.matchedRules } });
    return { request, decision: { ...decision, outcome: outcome as GuardDecision["outcome"] }, approved };
  }

  async function setControl(memberId: string | null, requesterId: string) {
    const room = options.rooms.getRoom(options.roomId);
    const requester = room?.members.find((member) => member.id === requesterId);
    const requesterRecord = await options.members.getMember(options.project.id, requesterId);
    if (!requester || !requesterRecord || roleLevel(requesterRecord.role) !== "owner") throw new Error("Owner permission is required");
    if (control) {
      clearTimeout(control.timer);
      publishActivity({ type: "terminal_control_revoked", memberId: control.memberId, payload: { by: requesterId } });
    }
    if (!memberId) { control = undefined; for (const listener of controlListeners) listener(null); return; }
    const target = room?.members.find((member) => member.id === memberId && member.online);
    if (!target) throw new Error("Control target must be online");
    const expiresAt = Date.now() + 600_000;
    const timer = setTimeout(() => {
      const expiredMemberId = control?.memberId;
      control = undefined;
      if (expiredMemberId) publishActivity({ type: "terminal_control_expired", memberId: expiredMemberId });
      for (const listener of controlListeners) listener(null);
    }, 600_000);
    control = { memberId, expiresAt, timer };
    publishActivity({ type: "terminal_control_granted", memberId, payload: { by: requesterId, expiresAt: new Date(expiresAt).toISOString() } });
    for (const listener of controlListeners) listener(memberId, new Date(expiresAt).toISOString());
  }

  async function currentRouting(item: ReturnType<typeof approvals.list>[number]) {
    if (options.mode === "native") return routeApprovers(item.request, item.decision);
    const member = await options.members.getMember(options.project.id, item.request.memberId);
    if (!member) return [];
    const { decision } = await makeDecision(item.request, false);
    if (decision.action === "deny") return [];
    const approvers = decision.approvers === "provenance" || decision.approvers === "initiator" && item.decision.approvers === "initiator" ? decision.approvers : "owners";
    return routeApprovers(item.request, { ...decision, action: "ask", approvers });
  }

  async function resolveApproval(id: string, memberId: string, approve: boolean) {
    const item = approvals.list().find((candidate) => candidate.id === id);
    if (!item) return false;
    const eligible = await currentRouting(item);
    const actor = eligible.find((candidate) => candidate.id === memberId);
    if (!actor) return false;
    approvals.updateRouting(id, eligible.map((candidate) => candidate.id));
    return approve ? approvals.approve(id, memberId, actor.role) : approvals.reject(id, memberId, actor.role);
  }

  return {
    mode: () => options.mode,
    approvalTimeoutMs: () => options.approvalTimeoutMs ?? 120_000,
    async isOwner(memberId: string) {
      return options.members.getMember(options.project.id, memberId).then((member) => Boolean(member && roleLevel(member.role) === "owner"));
    },
    isController(memberId: string) { return control?.memberId === memberId && control.expiresAt > Date.now(); },
    async decide(request: GuardRequest) { return (await makeDecision(request)).decision; },
    submit,
    async recordPromptSources(runId: string, memberId: string, files: string[], authors: { id: string; role?: string }[]) {
      if (options.mode !== "full" || options.agentProvenance === false) return;
      await provenance.load();
      recordFileSources(runId, memberId, files.map((file) => path.resolve(options.project.workspacePath, file)));
      const members = await options.members.listMembers(options.project.id);
      for (const author of authors) {
        if (author.id === memberId) continue;
        const current = members.find((member) => member.memberId === author.id);
        const level = author.role ? roleLevel(author.role) : roleLevel(current?.role);
        recordSource(runId, author.id, level);
      }
    },
    async recordWorkspaceWrite(memberId: string, filePath: string) {
      if (options.mode !== "full" || options.agentProvenance === false) return;
      const member = await options.members.getMember(options.project.id, memberId);
      if (!member) throw new Error("Project membership is required");
      await provenance.record({ projectId: options.project.id, memberId, source: "terminal", kind: "edit", paths: [filePath], cwd: options.project.workspacePath }, roleLevel(member.role));
    },
    approve: (id: string, memberId: string) => resolveApproval(id, memberId, true),
    reject: (id: string, memberId: string) => resolveApproval(id, memberId, false),
    async withdraw(id: string, memberId: string) {
      const item = approvals.list().find((candidate) => candidate.id === id);
      return Boolean(item && item.request.memberId === memberId && approvals.withdraw(id));
    },
    noteTerminalCommand(request: GuardRequest) {
      if (request.source !== "terminal" || request.kind !== "command" || !request.command) return;
      const parsed = parseCommandPaths(request.command, request.cwd);
      if (!parsed || !["delete", "write", "move"].includes(parsed.action)) return;
      const paths = parsed.targets
        .map((target) => path.relative(options.project.workspacePath, target.resolvedPath).split(path.sep).join("/"))
        .filter((relative) => relative && !relative.startsWith(".."));
      if (!paths.length) return;
      terminalChanges.push({ memberId: request.memberId, paths, at: Date.now() });
      if (terminalChanges.length > 200) terminalChanges.splice(0, terminalChanges.length - 200);
    },
    terminalChangedFiles(files: string[], since: number) {
      const recent = terminalChanges.filter((entry) => entry.at >= since).flatMap((entry) => entry.paths);
      return new Set(files.filter((file) => recent.some((target) => file === target || file.startsWith(`${target.replace(/\/+$/, "")}/`))));
    },
    cancelRun(runId: string) { cancelledRunIds.add(runId); approvals.cancelForRun(runId); runSourceLevels.delete(runId); },
    pending() { return approvals.list(); },
    routingChanged,
    onRoutingChanged(listener: () => void) { routingListeners.add(listener); return () => routingListeners.delete(listener); },
    async pendingFor(memberId: string) {
      const routed = await Promise.all(approvals.list().map(async (item) => ({
        ...item,
        approverIds: (await currentRouting(item)).map((candidate) => candidate.id)
      })));
      return routed.filter((item) => item.approverIds.includes(memberId) && approvals.list().some((active) => active.id === item.id))
        .map((item) => ({ ...item, noApprover: false }));
    },
    onPending(listener: (approval: Omit<PendingApproval, "resolve" | "resolveOutcome" | "resolveApprover" | "timer">) => void) { pendingListeners.add(listener); return () => pendingListeners.delete(listener); },
    onActivity(listener: (event: ReturnType<EventLog["append"]>) => void) { activityListeners.add(listener); return () => activityListeners.delete(listener); },
    publishActivity,
    onResolution(listener: (id: string, outcome: ApprovalOutcome) => void) { resolutionListeners.add(listener); return () => resolutionListeners.delete(listener); },
    onControl(listener: (holderMemberId: string | null, expiresAt?: string) => void) { controlListeners.add(listener); return () => controlListeners.delete(listener); },
    controlState() { return control ? { holderMemberId: control.memberId, expiresAt: new Date(control.expiresAt).toISOString() } : { holderMemberId: null }; },
    setControl,
    memberOffline(memberId: string) {
      if (control?.memberId !== memberId) return;
      clearTimeout(control.timer);
      control = undefined;
      publishActivity({ type: "terminal_control_revoked", memberId, payload: { reason: "member_offline" } });
      for (const listener of controlListeners) listener(null);
    },
    async createSnapshot(request: GuardRequest) {
      const parsed = request.kind === "command" && request.command ? parseCommandPaths(request.command, request.cwd) : undefined;
      const paths = request.paths ?? parsed?.targets.map((target) => target.resolvedPath);
      const manifest = await snapshots.create({ memberId: request.memberId, command: request.command, paths });
      publishActivity({
        type: "guard_snapshot",
        memberId: request.memberId,
        payload: { snapshotId: manifest.id, source: request.source, runId: request.agentRunId, command: request.command, paths: request.paths, fileCount: manifest.files.length }
      });
      return manifest;
    },
    sealSnapshot: (id: string) => snapshots.seal(id),
    async restoreSnapshot(id: string, memberId: string, options: { force?: boolean } = {}) {
      const current = await currentMember(memberId);
      const snapshot = (await snapshots.list()).find((candidate) => candidate.id === id);
      if (!snapshot) throw new Error("Snapshot not found");
      if (current.level !== "owner" && (snapshot.scope === "workspace" || snapshot.memberId !== memberId)) throw new Error("Snapshot belongs to another member");
      const result = await snapshots.restore(id, { memberId, force: options.force });
      publishActivity(result.restored
        ? { type: "guard_snapshot_restored", memberId, payload: { snapshotId: id, command: snapshot.command, fileCount: result.manifest.files.length, backupId: result.backupId, forced: Boolean(options.force && result.conflicts.length) } }
        : { type: "guard_snapshot_conflict", memberId, payload: { snapshotId: id, command: snapshot.command, conflicts: result.conflicts } });
      return result;
    },
    listSnapshots: () => snapshots.list(),
    async getPolicy() { return policy(); },
    getSettings: settings,
    async updatePolicy(input: Partial<GuardPolicy>) {
      const current = await policy();
      const next = { protectedPaths: input.protectedPaths ?? current.protectedPaths, llmMode: input.llmMode ?? current.llmMode };
      if (!(["off", "suggest", "auto"] as string[]).includes(next.llmMode)) throw new Error("Invalid guard judging mode");
      await writeJsonFileAtomically(policyPath, next);
      selectedLlmMode = next.llmMode;
      const updated = await settings();
      publishActivity({ type: "guard_settings_updated", payload: { ...updated } });
      return updated;
    },
    async awaitIdle() { await audit.awaitIdle(); },
    dispose() { stopMembershipChanges(); approvals.clear(); approvalMemory.clear(); cancelledRunIds.clear(); runSourceLevels.clear(); if (control) clearTimeout(control.timer); pendingListeners.clear(); controlListeners.clear(); activityListeners.clear(); resolutionListeners.clear(); routingListeners.clear(); }
  };
}

export type GuardService = ReturnType<typeof createGuardService>;
