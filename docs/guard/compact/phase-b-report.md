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

Owner-selected delegates are stored with project membership. Owner authorization applies to delegate changes and member removal. A ceiling-only request routes to its online human trigger. For ordinary requests, routing prefers online owners, including an online owner who triggered a personal or team Agent request. The delegate route requires an online human member other than the requester whose level is higher than the requester's. The server returns cards only to eligible members and recalculates eligibility at approval time. An empty route leaves the request pending until timeout. `SIMPLERCP_GUARD_APPROVAL_TIMEOUT_MS` defaults to 120,000 ms and Agent calls can use a shorter deadline within their run budget. The audit outcome is `timeout`.

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

Of the 33,712 pairs with different features, 33,144 contain a newline, 312 contain `cd` on a single line, and 256 fall in the other category, with download-to-shell pipelines as examples. All 11,725 pairs with a less strict Agent action matched `hard.control-character`, `hard.cwd`, or both on the terminal side. Taking the strictest terminal action across individual lines leaves 1,358 pairs with a less strict Agent action among 32,794 comparisons, after excluding 32 heredoc pairs and 318 pairs where a final standalone `cd` alone made the terminal result stricter.

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

- `pnpm build` builds all 3 workspace packages.
- `pnpm test` passes 244 server, 7 client, and 2 demo tests. The server configuration skips 9 integration tests. The client and demo suites skip none.
- `pnpm test:e2e` passes 28 tests and skips 9 tests under its default configuration. `pnpm test:collab` passes 7 tests and skips none. The separate English capture passes its single live-model test.

## Phase B fixes

### F1 Owner approval of Agent requests

`apps/server/src/guard/service.ts` evaluates the human trigger route for ceiling-only requests and owner provenance requests first. The ordinary owner route includes every eligible online owner, including the trigger for personal and team Agent requests. When that route is empty, an online designated delegate must be a different human member and have a higher level than the requester. Empty routes resolve through the approval timeout. The server rechecks membership, level, and presence at approval time. The owner terminal self-command path still resolves before routing when its conditions apply. The audit records `owner` for an owner approving through the ordinary owner route and `trigger` for approval through the human trigger route.

Seven cases in `apps/server/src/__tests__/memberIdentityApi.test.ts` pass for personal and team requests, timeout after the sole owner goes offline, either of two owners approving, contributor self-approval rejection, and owner demotion while pending. The personal and team cases also verify rejection of Agent identity approval and the audit role. `apps/client/tests/guardApproval.test.ts` confirms that an eligible owner sees the confirmation controls.

### F2 Approval-memory terminal test

`apps/server/src/__tests__/memberIdentityApi.test.ts` starts the demo runtime and its PTY with `/bin/sh` and places the directory containing `process.execPath` first on `PATH`. The zsh reproduction showed user startup output and a missing `result.txt`. The test waits for the shell prompt and checks the rule decision, approval reuse, snapshot ID, and workspace file contents. The isolated case passed three consecutive runs with `SHELL=/bin/zsh`.

### F3 Screenshot member layout

`apps/client/src/components/CollaborationPanel.tsx` renders direct permission levels once and moves the delegate control onto its own row. `apps/client/src/styles.css` styles the second row. `tests/e2e/compact-screenshots.spec.ts` checks Alice's single owner label and Bob's full name above the checkbox. The English live-model capture passed and regenerated both PNGs and both PDFs in `docs/guard/compact/screenshots/`. PDF text extraction confirmed the member labels, the two blocked commands and pending review in Bob's view, and the approval card in Alice's view.

### F4 Property 1 report

`apps/server/src/__tests__/compactPathConsistency.test.ts` classifies feature differences and compares the whole Agent command with the strictest terminal action across its nonblank lines. It reuses the compound-command and heredoc handling in `apps/server/src/guard/characterize.ts`. The test passed and regenerated `docs/guard/compact/path-consistency.json` with the B6 totals, rule counts, exclusions, and representative cases. The 1,358 less strict Agent actions in the multiline comparison and the zero violations among pairs with equal features are reported separately.
