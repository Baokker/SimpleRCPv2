import path from "node:path";
import type { GuardLlmMode, GuardSettings } from "@simplercp/shared";
import type { ProjectRecord } from "../projects.js";
import type { MemberStore } from "../auth/identity.js";
import type { EventLog } from "../eventLog.js";
import type { RoomStore } from "../rooms.js";
import { readJsonFile, writeJsonFileAtomically } from "../jsonFile.js";
import { createApprovalQueue, type ApprovalOutcome, type PendingApproval } from "./approvals.js";
import { createGuardAudit } from "./audit.js";
import { decide } from "./decide.js";
import { judgeGuardRequest, type JudgeResult } from "./llmJudge.js";
import { roleLevel } from "./roles.js";
import { createSnapshotStore } from "./snapshots.js";
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
  mode: "full" | "human-only" | "off";
  llmMode?: GuardLlmMode;
  llm?: { baseUrl?: string; apiKey?: string; model?: string };
  approvalTimeoutMs?: number;
  otherWorkspaceRoots?: (currentProjectId: string) => string[];
}) {
  const policyPath = path.join(options.metadataRoot, "guard-policy.json");
  const audit = createGuardAudit(path.join(options.metadataRoot, "guard-audit.jsonl"), options.llm?.apiKey ? [options.llm.apiKey] : []);
  const approvals = createApprovalQueue(options.approvalTimeoutMs ?? 120_000);
  const snapshots = createSnapshotStore(options.metadataRoot, options.project.workspacePath);
  const pendingListeners = new Set<(approval: Omit<PendingApproval, "resolve" | "resolveOutcome" | "resolveApprover" | "timer">) => void>();
  const activityListeners = new Set<(event: ReturnType<EventLog["append"]>) => void>();
  const resolutionListeners = new Set<(id: string, outcome: ApprovalOutcome) => void>();
  const controlListeners = new Set<(holderMemberId: string | null, expiresAt?: string) => void>();
  let control: { memberId: string; expiresAt: number; timer: ReturnType<typeof setTimeout> } | undefined;
  let selectedLlmMode = options.llmMode;
  const cancelledRunIds = new Set<string>();

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

  async function makeDecision(request: GuardRequest) {
    const started = process.hrtime.bigint();
    const stored = await currentMember(request.memberId);
    const currentPolicy = await policy();
    const decision = decide(request, {
      memberLevel: stored.level,
      initiatorOnline: stored.online,
      workspaceRoot: options.project.workspacePath,
      platformDataRoot: options.platformDataRoot,
      otherWorkspaceRoots: options.otherWorkspaceRoots?.(options.project.id),
      protectedPaths: currentPolicy.protectedPaths
    });
    const durationMicros = Number((process.hrtime.bigint() - started) / 1_000n);
    audit.append({ timestamp: new Date().toISOString(), projectId: request.projectId, memberId: request.memberId, source: request.source, agentRunId: request.agentRunId, sessionScope: request.sessionScope, agentHandle: request.agentHandle, command: request.command, paths: request.paths, action: decision.action, matchedRules: decision.matchedRules, durationMicros });
    return { decision, member: stored, policy: currentPolicy };
  }

  async function submit(request: GuardRequest, input: { timeoutMs?: number | null } = {}) {
    if (request.agentRunId && cancelledRunIds.has(request.agentRunId)) {
      const cancelledDecision: GuardDecision = { action: "deny", segments: [], legacyRisk: "unknown", matchedRules: ["guard.run-cancelled"], unknown: false, autoEligible: false, approvers: null, outcome: "denied", command: request.command };
      return { request, decision: cancelledDecision, approved: false };
    }
    if (options.mode === "off" || options.mode === "human-only" && request.source === "agent") {
      return { request, decision: { action: "allow", segments: [], legacyRisk: "unknown", matchedRules: [], unknown: false, autoEligible: false, approvers: null } satisfies GuardDecision, approved: true };
    }
    const initial = await makeDecision(request);
    let decision = initial.decision;
    const llmMode = effectiveGuardLlmMode(initial.policy.llmMode, Boolean(options.llm?.baseUrl && options.llm.apiKey));
    if (decision.action === "ask" && llmMode !== "off") {
      if (options.llm?.baseUrl && options.llm.apiKey) {
        publishActivity({
          type: "guard_llm_judging",
          memberId: request.memberId,
          payload: { source: request.source, runId: request.agentRunId, command: request.command, paths: request.paths, mode: llmMode }
        });
      }
      const model = await judgeGuardRequest({ request, decision, mode: llmMode, ...options.llm });
      if (model) {
        decision = applyLlmJudgment(decision, llmMode, request.source, model);
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
      if (decision.action !== "allow" || decision.llm?.applied) publishActivity({
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
    const room = options.rooms.getRoom(options.roomId);
    const onlineOwners = await Promise.all((room?.members ?? []).filter((member) => member.online).map(async (member) => {
      const record = await options.members.getMember(options.project.id, member.id);
      return record && roleLevel(record.role) === "owner" ? { id: member.id, name: record.displayName } : undefined;
    }));
    const owners = onlineOwners.filter((member): member is { id: string; name: string } => Boolean(member));
    const approverIds = decision.approvers === "initiator" || decision.approvers === "self" ? [request.memberId] : owners.map((member) => member.id);
    const noApprover = decision.approvers === "owners" && owners.length === 0;
    decision.noApprover = noApprover;
    if (request.agentRunId && cancelledRunIds.has(request.agentRunId)) {
      const cancelledDecision = { ...decision, action: "deny" as const, outcome: "denied" as const, matchedRules: [...decision.matchedRules, "guard.run-cancelled"] };
      return { request, decision: cancelledDecision, approved: false };
    }
    const pendingTimeout = approvalTimeoutForMode(initial.policy.llmMode, input.timeoutMs, options.approvalTimeoutMs ?? 120_000);
    const pending = approvals.enqueue(request, decision, approverIds, pendingTimeout, noApprover);
    const pendingItem = approvals.list().find((item) => item.id === pending.id);
    if (!pendingItem) throw new Error("Approval was not enqueued");
    for (const listener of pendingListeners) listener(pendingItem as Omit<PendingApproval, "resolve" | "resolveOutcome" | "resolveApprover" | "timer">);
    const approved = await pending.result;
    const resolution = await pending.outcome;
    const approverId = await pending.approver;
    const approverName = approverId
      ? (await options.members.getMember(options.project.id, approverId))?.displayName
      : undefined;
    audit.append({ timestamp: new Date().toISOString(), projectId: request.projectId, memberId: request.memberId, source: request.source, agentRunId: request.agentRunId, sessionScope: request.sessionScope, agentHandle: request.agentHandle, command: request.command, paths: request.paths, action: decision.action, matchedRules: decision.matchedRules, approver: approverIds.join(","), result: resolution === "timeout" ? "timeout" : approved ? "approved" : "rejected", durationMicros: 0, model: decision.llm });
    publishActivity({
      type: "guard_approval",
      memberId: request.memberId,
      payload: { source: request.source, runId: request.agentRunId, command: request.command, paths: request.paths, action: decision.action, approved, outcome: resolution, matchedRules: decision.matchedRules }
    });
    return { request, decision: { ...decision, outcome: resolution === "timeout" ? "timeout" : approved ? "approved" : "rejected", approverName }, approved };
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

  return {
    mode: () => options.mode,
    approvalTimeoutMs: () => options.approvalTimeoutMs ?? 120_000,
    async isOwner(memberId: string) {
      return options.members.getMember(options.project.id, memberId).then((member) => Boolean(member && roleLevel(member.role) === "owner"));
    },
    isController(memberId: string) { return control?.memberId === memberId && control.expiresAt > Date.now(); },
    async decide(request: GuardRequest) { return (await makeDecision(request)).decision; },
    submit,
    async approve(id: string, memberId: string) {
      const item = approvals.list().find((candidate) => candidate.id === id);
      if (!item) return false;
      const current = await currentMember(memberId);
      const authorized = item.decision.approvers === "initiator" || item.decision.approvers === "self"
        ? item.request.memberId === memberId && current.online
        : current.online && current.level === "owner";
      return authorized && approvals.approve(id, memberId);
    },
    async reject(id: string, memberId: string) {
      const item = approvals.list().find((candidate) => candidate.id === id);
      if (!item) return false;
      const current = await currentMember(memberId);
      const authorized = item.decision.approvers === "initiator" || item.decision.approvers === "self"
        ? item.request.memberId === memberId && current.online
        : current.online && current.level === "owner";
      return authorized && approvals.reject(id, memberId);
    },
    cancelRun(runId: string) { cancelledRunIds.add(runId); approvals.cancelForRun(runId); },
    pending() { return approvals.list(); },
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
      return snapshots.create({ memberId: request.memberId, command: request.command, paths });
    },
    async restoreSnapshot(id: string, memberId: string) {
      const current = await currentMember(memberId);
      const snapshot = (await snapshots.list()).find((candidate) => candidate.id === id);
      if (!snapshot) throw new Error("Snapshot not found");
      if (current.level !== "owner" && (snapshot.scope === "workspace" || snapshot.memberId !== memberId)) throw new Error("Snapshot belongs to another member");
      return snapshots.restore(id);
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
    dispose() { approvals.clear(); cancelledRunIds.clear(); if (control) clearTimeout(control.timer); pendingListeners.clear(); controlListeners.clear(); activityListeners.clear(); resolutionListeners.clear(); }
  };
}

export type GuardService = ReturnType<typeof createGuardService>;
