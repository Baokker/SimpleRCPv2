# ComPACT Phase B Report

The `paper/compact` branch is based on `0465bae3`.

## B0 Approval memory and owner commands

Paper sections IV-A, IV-C, and IV-D cover approval state, owner terminal commands, and approval reuse.

The changes cover `apps/server/src/guard/approvalMemory.ts`, `apps/server/src/guard/service.ts`, `apps/server/src/guard/approvals.ts`, and related guard tests.

The service consults approval memory after `decide()` returns `ask`. Its in-memory key binds member, source, personal/team scope, working directory, command class, and sorted matched rules. The default TTL is 30 minutes and `SIMPLERCP_GUARD_APPROVAL_MEMORY_TTL_MS` configures it. Role or membership changes clear the member's entries. A service restart starts with empty memory. Terminal and Agent approvals are separate, as are personal and team runs.

Reuse excludes irreversible actions, paths outside the workspace, the `NOT_REUSABLE_RULE` set, compound or substitution commands, and foreign-writer scripts. Owner self-approval bypass applies only to terminal requests. Scripts last written by another member go to human review. Denied requests stay blocked, and snapshot actions create a snapshot before execution. Audit records retain the `remembered` and `owner-self` stages. A `remembered` record identifies the original approver, their role, and the approval time.

## B1 Four permission levels

Paper sections IV-A and IV-C define the level order and Table IV.

The changes cover `apps/server/src/guard/roles.ts`, `apps/server/src/guard/rules.ts`, `apps/server/src/guard/scriptInspection.ts`, member APIs, shared types, client role text, and guard tests.

The matrix uses `viewer < contributor < maintainer < owner`. The test checks capability action monotonicity across all levels. For maintainers, writes get `allow_snapshot` and privilege escalation gets `ask`. Uninspectable execution is `deny` for viewer and at least `ask` for contributor and maintainer.

Stored legacy levels map from `observer` to `viewer`, from `student` to `contributor`, and from `collaborator` or `trusted` to `maintainer`. Normalized records are written with current role names.

- Teaching assigns owner to the teacher, maintainer to the teaching assistant, contributor to the student, and viewer to the auditor.
- Team development assigns owner to the lead, maintainer to the maintainer and developer, contributor to the newcomer, and viewer to the viewer.
- Technical interviews assign owner to the interviewer and contributor to the candidate.
- Open contribution assigns owner to the project lead, maintainer to core members, contributor to external contributors, and viewer to visitors.
- Incident response assigns owner to the commander, maintainer to the on-call and responder roles, and viewer to the stakeholder.

Only an owner can raise another member's level. With another owner present in the membership records, a member can keep or lower their own level. Projects without an owner retain the existing role selection for initial setup and ownership recovery.

## B2 Reversibility classification

The final paragraph of paper section IV-B defines the R6 classification.

The changes cover `apps/server/src/guard/characterize.ts` and guard tests.

Dependency installation and unknown commands are `irreversible`, so model auto-approval excludes them. Workspace writes, deletes, commits, and rebases retain snapshot classification where the command is otherwise recoverable. In `guard.test.ts`, the unknown-command case expects `autoEligible: false`. The install classification case asserts irreversible classification, `hard.nonowner.irreversible`, and `autoEligible: false`.

## B3 Delegate routing and timeouts

Paper sections IV-A and IV-D define the routing function and approval lifecycle.

The changes cover `apps/server/src/auth/identity.ts`, `apps/server/src/rooms.ts`, `apps/server/src/projectRuntime.ts`, `apps/server/src/projectRuntimeManager.ts`, `apps/server/src/realtime.ts`, `apps/server/src/routes/collaborationRoutes.ts`, client member controls, and approval tests.

Owner-selected delegates are stored with project membership. Owner authorization applies to delegate changes and member removal. Routing prefers other online owners, then online delegates whose level is above the requester. The server returns cards only to eligible members and recalculates eligibility at approval time. A ceiling-only request routes to its online human trigger. Ordinary requests require a different human approver. An empty route leaves the request pending until timeout. `SIMPLERCP_GUARD_APPROVAL_TIMEOUT_MS` defaults to 120,000 ms and Agent calls can use a shorter deadline within their run budget. The audit outcome is `timeout`.

Tests cover owner and delegate routes, offline members, lower-level delegates, self-approval attempts, timeout, a delegate joining before timeout, a delegate level change while pending, trigger approval, and an agent identity attempting approval. The browser suite assigns a delegate through the member panel and verifies approval after the owner disconnects.

## B4 Agent source tracking

Paper section VII identifies indirect prompt injection through files and team discussion. The implementation extends the decision and routing rules in sections IV-A and IV-D.

Files include `apps/server/src/guard/service.ts`, `apps/server/src/guard/decide.ts`, `apps/server/src/guard/legacy/parser.ts`, `apps/server/src/agent/agentRunManager.ts`, `apps/server/src/agent/chatAgentBridge.ts`, and `apps/server/src/realtime.ts`.

The service records authors of prompt attachments, approved file reads, statically recognized shell reads such as `cat`, `head`, and literal `sed -n` print commands, and the discussion messages supplied in each team prompt. A retry retains the authors supplied with that discussion. File authors come from write provenance, including authenticated collaborative editor events and guarded writes. Unattributed files have the owner baseline. Each run tracks the minimum of observed author levels and current levels, excluding the trigger. Using the lower of observed and current levels keeps an author's promotion from raising the authority of content already included in the run.

The source-level terminal decision adds `agent.provenance.<level>` and a human approval requirement when that level would receive `ask` or `deny`. Existing denials stay in force. Provenance-triggered approval routes to the owner trigger when provenance introduces the human review requirement or changes a ceiling-only approval. An independently required owner approval retains its route. Provenance approvals are excluded from reuse and model auto-approval. The feature applies to Agent requests and defaults to enabled. `SIMPLERCP_GUARD_AGENT_PROVENANCE=false` disables it.

The tracking boundary is a single run. Tool reads and writes are observed at permission time, and editor attribution comes from member-bound `file_edited` events. The hook covers statically known paths and discussion included by SimpleRCP. Runtime conversation history, dynamically chosen paths, and direct filesystem changes outside these channels are outside the attribution boundary.

## B5 Audit records

Paper section IV-D specifies unified audit.

The changes cover `apps/server/src/guard/audit.ts`, `apps/server/src/guard/service.ts`, and audit assertions in guard service tests.

Records include member, terminal/agent/team source, run ID, matched rules, action, approver ID and role, approval result and time, model mode/risk/confidence/applied state, and provenance source level. Approval and model stages are separate records. Timeout results are retained. Remembered approvals retain the source approval's identity and time.

## B6 Property 1 differential test

Paper section IV-A defines Property 1. The recorded counts are available for the phase D RQ1 evaluation.

The changes cover `apps/server/src/__tests__/compactPathConsistency.test.ts`, the original and v2 D1-D6 command fixtures under `apps/server/src/__tests__/fixtures/guard/compact/`, and `docs/guard/compact/path-consistency.json`.

The test covers 361 existing fixture commands, 1,682 archived dataset commands, and 10,000 deterministic compound commands. Each command runs at all four levels and with the trigger online and offline, for 96,344 terminal/Agent pairs. Among 62,632 pairs with equal characterized segments, there are zero cases where the Agent action is less strict. The remaining 33,712 pairs have different characterized segments and are excluded from Property 1 comparison. The JSON report includes totals and per-level results.

Agent requests with a run ID and matching terminal features also enforce the terminal directory-change and control-character restrictions. This includes a leading `cd` in a compound command when both sources produce the same features. The comparison operates on capability, path zone, and reversibility per segment. The JSON also counts lower Agent decisions among pairs that differ in features. Those counts describe source-specific characterization and sit outside the property's stated condition.

## B7 English UI and screenshots

Paper section V, Fig. 5, describes the contributor view.

The changes cover `apps/client/vite.config.ts`, `apps/client/src/guardText.ts`, `apps/client/src/components/SharedTerminal.tsx`, `apps/client/src/components/CollaborationPanel.tsx`, `apps/client/src/components/GuardApprovalActions.tsx`, and `tests/e2e/compact-screenshots.spec.ts`.

The build reads `SIMPLERCP_LOCALE=en` and exposes the selected language to the client. Chinese remains the default. Guard terminal messages, approval controls, role labels, and Guard activity text have English wording.

The figure files are `bob-contributor.png`, `bob-contributor.pdf`, `alice-owner-approval.png`, and `alice-owner-approval.pdf` in `docs/guard/compact/screenshots/`. The browser capture shows `src/hello.ts`, the terminal, project members, and the activity log. Bob's view records the blocked `sudo ls`, blocked platform metadata read, and his network request during model review. Alice's view records the resulting approval card with the model recommendation and confidence.

Run the capture with a configured model provider from the worktree root.

```sh
SIMPLERCP_LOCALE=en SIMPLERCP_CAPTURE_COMPACT=1 SIMPLERCP_GUARD_MODE=full \
  SIMPLERCP_GUARD_LLM_MODE=suggest SIMPLERCP_FAKE_AGENT_RUNTIME=false \
  pnpm test:e2e tests/e2e/compact-screenshots.spec.ts
```

## Paper consistency review

- The section IV-A decision `D_rule` runs independently of approval memory. Memory binds member, source, command class, and matched rules for 30 minutes. The additional personal/team scope and working-directory fields further restrict matching.
- Property 2 holds for memory reuse because the key includes matched rules and role or membership changes clear that member's entries.
- Under section IV-C, a terminal owner bypasses the approval prompt for an `ask` unless the request runs a script last written by another member. Denials and required snapshots retain their effects.
- Section IV-D excludes compound commands, irreversible operations, paths outside the workspace, and delete/network/history/process/privilege/install rules from reuse.
- Section IV-D approval routing recalculates owner and delegate eligibility at approval time. Requests with an empty route stay pending until the configured timeout, then resolve as `timeout`.

## Manuscript updates and phase D

- Sections I and VII can describe run-level attenuation for annotated sources and the remaining input channels. Sections IV-A and IV-D can include source authors in project state, describe the owner review exception for provenance-induced approvals, and document the provenance switch and audit fields. Section IV-D can also state the working-directory match, configurable in-memory TTL, personal/team separation, and original approver identity on reuse.
- Section IV-A defines characterized segments by capability, zone, and reversibility. Its dependency statement for `D_rule` should also account for command syntax checks and script analysis that read the command text and workspace scripts.
- Section V can use the new Bob figure and optionally include the Alice approval view as a second panel.
- Phase D still needs the paper evaluation rerun with the four-level matrix and R6 classification, updated result tables and research questions, and migration of archived experiment scripts.

## Verification

- `pnpm build` succeeds.
- `pnpm test` passes 237 server, 7 client, and 2 demo tests. The server configuration skips 9 integration tests.
- `pnpm test:e2e` passes 28 tests and skips 9 tests under its default configuration. `pnpm test:collab` passes all 7 collaboration tests. The English capture runs separately and passes with live model review.
