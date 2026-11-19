# ComPACT Phase B Report

Branch: `paper/compact`, based on `0465bae3`.

## B0: Approval memory and owner commands

Paper sections IV-A, IV-C, and IV-D cover approval state, owner terminal commands, and approval reuse.

Files: `apps/server/src/guard/approvalMemory.ts`, `apps/server/src/guard/service.ts`, `apps/server/src/guard/approvals.ts`, and related guard tests.

`decide()` does not read approval memory. The service consults memory only after an `ask` decision. Its in-memory key binds member, source, personal/team scope, working directory, command class, and sorted matched rules. The default TTL is 30 minutes and `SIMPLERCP_GUARD_APPROVAL_MEMORY_TTL_MS` configures it. Memory clears on role or membership changes and service disposal; it is not persisted. Terminal and Agent approvals are separate, as are personal and team runs.

Reuse excludes irreversible actions, paths outside the workspace, the `NOT_REUSABLE_RULE` set, compound or substitution commands, and foreign-writer scripts. Snapshot actions still create a snapshot before execution. Owner self-approval bypass applies to terminal requests only. A script last written by someone else remains subject to review, denials remain unchanged, and snapshot actions still snapshot before execution. Audit records keep `remembered` and `owner-self` stages; remembered records include the original approver role and approval time.

## B1: Four permission levels

Paper sections IV-A and IV-C define the level order and Table IV.

Files: `apps/server/src/guard/roles.ts`, `apps/server/src/guard/rules.ts`, `apps/server/src/guard/scriptInspection.ts`, member APIs, shared types, client role text, and guard tests.

The matrix uses `viewer < contributor < maintainer < owner`. The test checks capability action monotonicity across all levels. The maintainer write action is `allow_snapshot`; privilege escalation is `ask`. Uninspectable execution is `deny` for viewer and at least `ask` for contributor and maintainer.

Stored legacy levels map as follows: `observer` to `viewer`, `student` to `contributor`, `collaborator` and `trusted` to `maintainer`. Normalized records are written with current role names.

Scenario mapping:

- Teaching: teacher = owner, teaching assistant = maintainer, student = contributor, auditor = viewer.
- Team development: lead = owner, maintainer and developer = maintainer, newcomer = contributor, viewer = viewer.
- Technical interview: interviewer = owner, candidate = contributor.
- Open contribution: host = owner, mentor = maintainer, external contributor = contributor, visitor = viewer.
- Incident response: commander = owner, on-call and responder = maintainer, stakeholder = viewer.

Only an owner can raise another member's level. A member can keep or lower their own level.

## B2: Reversibility classification

The final paragraph of paper section IV-B defines the R6 classification.

Files: `apps/server/src/guard/characterize.ts` and guard tests.

Dependency installation and unknown commands are `irreversible`, so model auto-approval excludes them. Workspace writes, deletes, commits, and rebases retain snapshot classification where the command is otherwise recoverable. In `guard.test.ts`, the unknown-command case expects `autoEligible: false` and irreversible classification. The install classification case asserts irreversible classification, `hard.nonowner.irreversible`, and `autoEligible: false`.

## B3: Delegate routing and timeouts

Paper sections IV-A and IV-D define the routing function and approval lifecycle.

Files: `apps/server/src/auth/identity.ts`, `apps/server/src/rooms.ts`, `apps/server/src/projectRuntime.ts`, `apps/server/src/projectRuntimeManager.ts`, `apps/server/src/realtime.ts`, `apps/server/src/routes/collaborationRoutes.ts`, client member controls, and approval tests.

Owner-selected delegates are stored with project membership. Owner authorization applies to delegate changes and member removal. Routing prefers other online owners, then online delegates whose level is above the requester. The server returns cards only to eligible members and recalculates eligibility at approval time. A ceiling-only request routes to its online human trigger. Ordinary requests require a different human approver. An empty route leaves the request pending until timeout. `SIMPLERCP_GUARD_APPROVAL_TIMEOUT_MS` defaults to 120,000 ms and Agent calls can use a shorter deadline within their run budget. The audit outcome is `timeout`.

Tests cover owner and delegate routes, offline members, lower-level delegates, self-approval attempts, timeout, a delegate joining before timeout, a delegate level change while pending, trigger approval, and an agent identity attempting approval.

## B4: Agent source tracking

Paper section VII identifies indirect prompt injection through files and team discussion. The implementation extends the decision and routing rules in sections IV-A and IV-D.

Files include `apps/server/src/guard/service.ts`, `apps/server/src/guard/decide.ts`, `apps/server/src/guard/legacy/parser.ts`, `apps/server/src/agent/agentRunManager.ts`, `apps/server/src/agent/chatAgentBridge.ts`, and `apps/server/src/realtime.ts`.

The service records authors of prompt attachments, approved file reads, statically recognized shell reads such as `cat`, `head`, and literal `sed -n` print commands, and the discussion messages supplied in each team prompt. A retry retains the authors supplied with that discussion. File authors come from write provenance, including authenticated collaborative editor events and guarded writes. Unattributed files have the owner baseline. Each run tracks the minimum of observed author levels and current levels, excluding the trigger. Using the lower of observed and current levels keeps an author's promotion from raising the authority of content already included in the run.

The source-level terminal decision adds `agent.provenance.<level>` and a human approval requirement when that level would receive `ask` or `deny`. Existing denials stay in force. Provenance-triggered approval routes to the owner trigger when provenance introduces the human review requirement or changes a ceiling-only approval. An independently required owner approval retains its route. Provenance approvals are excluded from reuse and model auto-approval. The feature applies to Agent requests and defaults to enabled. `SIMPLERCP_GUARD_AGENT_PROVENANCE=false` disables it.

The tracking boundary is a single run. Tool reads and writes are observed at permission time, and editor attribution comes from member-bound `file_edited` events. The hook covers statically known paths and discussion included by SimpleRCP. Runtime conversation history, dynamically chosen paths, and direct filesystem changes outside these channels are outside the attribution boundary.

## B5: Audit records

Paper section IV-D specifies unified audit.

Files: `apps/server/src/guard/audit.ts`, `apps/server/src/guard/service.ts`, and audit assertions in guard service tests.

Records include member, terminal/agent/team source, run ID, matched rules, action, approver ID and role, approval result and time, model mode/risk/confidence/applied state, and provenance source level. Approval and model stages are separate records. Timeout results are retained. Remembered approvals retain the source approval's identity and time.

## B6: Property 1 differential test

Paper section IV-A defines Property 1. The recorded counts are available for the phase D RQ1 evaluation.

Files: `apps/server/src/__tests__/compactPathConsistency.test.ts`, copied D1-D6 and v2 D1-D6 command fixtures under `apps/server/src/__tests__/fixtures/guard/compact/`, and `docs/guard/compact/path-consistency.json`.

The test covers 361 existing fixture commands, 1,682 archived dataset commands, and 10,000 deterministic compound commands. Each command runs at all four levels and with the trigger online and offline, for 96,344 terminal/Agent pairs. Among 62,632 pairs with equal characterized segments, there are zero cases where the Agent action is less strict. The remaining 33,712 pairs have different characterized segments and are excluded from Property 1 comparison. The JSON report includes totals and per-level results.

Agent requests with a run ID and matching terminal features also enforce the terminal directory-change and control-character restrictions. This includes a leading `cd` in a compound command when both sources produce the same features. The comparison operates on capability, path zone, and reversibility per segment. The JSON also counts lower Agent decisions among pairs that differ in features. Those counts describe source-specific characterization and sit outside the property's stated condition.

## B7: English UI and screenshots

Paper section V, Fig. 5, describes the contributor view.

Files: `apps/client/vite.config.ts`, `apps/client/src/guardText.ts`, `apps/client/src/components/SharedTerminal.tsx`, `apps/client/src/components/CollaborationPanel.tsx`, `apps/client/src/components/GuardApprovalActions.tsx`, and `tests/e2e/compact-screenshots.spec.ts`.

The build reads `SIMPLERCP_LOCALE=en` and exposes the selected language to the client. Chinese remains the default. Guard terminal messages, approval controls, role labels, and Guard activity text have English wording.

The figure files are `bob-contributor.png`, `bob-contributor.pdf`, `alice-owner-approval.png`, and `alice-owner-approval.pdf` in `docs/guard/compact/screenshots/`. The browser capture shows `src/hello.ts`, the terminal, project members, and the activity log. Bob's view records the blocked `sudo ls`, blocked platform metadata read, and his network request during model review. Alice's view records the resulting approval card with the model recommendation and confidence.

Run the capture with a configured model provider from the worktree root.

```sh
SIMPLERCP_LOCALE=en SIMPLERCP_CAPTURE_COMPACT=1 SIMPLERCP_GUARD_MODE=full \
  SIMPLERCP_GUARD_LLM_MODE=suggest SIMPLERCP_FAKE_AGENT_RUNTIME=false \
  pnpm test:e2e tests/e2e/compact-screenshots.spec.ts
```

## Paper consistency review

- Section IV-A: `D_rule` does not read approval memory. Memory binds member, source, command class, and matched rules for 30 minutes. The additional personal/team scope and working-directory fields further restrict matching.
- Property 2: changed matched rules prevent reuse after a level change. Membership and level changes also clear that member's entries.
- Section IV-C: an owner's terminal request is handled without asking that owner again, except for a script with another last writer. Denials and required snapshots retain their effects.
- Section IV-D: compound commands, irreversible operations, outside-workspace paths, and delete/network/history/process/privilege/install rules do not reuse approvals. Team agents use the authors of context messages; personal agents have no shared discussion context.
- Section IV-D routing: owner/delegate eligibility is recalculated at approval. Requests with no eligible approver remain pending until the configured timeout and then resolve as `timeout`.
- Section VII: the discussion of file and team-message injection can describe the implemented review mechanism and its input boundary.

## Manuscript updates and phase D

- Sections I and VII can describe run-level attenuation for annotated sources and the remaining input channels. Sections IV-A and IV-D can include source authors in project state, describe the owner review exception for provenance-induced approvals, and document the provenance switch and audit fields. Section IV-D can also state the working-directory match, configurable in-memory TTL, personal/team separation, and original approver identity on reuse.
- Section IV-A defines characterized segments by capability, zone, and reversibility. Its dependency statement for `D_rule` should also account for command syntax checks and script analysis that read the command text and workspace scripts.
- Section V can use the new Bob figure and optionally include the Alice approval view as a second panel.
- Phase D still needs the paper evaluation rerun with the four-level matrix and R6 classification, updated result tables and research questions, and migration of archived experiment scripts.

## Verification

- `pnpm build` succeeds.
- `pnpm test` passes 237 server, 7 client, and 2 demo tests. The server configuration skips 9 integration tests.
- `pnpm test:e2e` passes 27 tests and skips 9 tests under its default configuration. `pnpm test:collab` passes all 6 collaboration tests. The English capture runs separately and passes with live model review.
