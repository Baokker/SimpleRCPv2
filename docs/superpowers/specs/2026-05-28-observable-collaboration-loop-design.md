# Iteration 3 Observable Collaboration Loop Design

## Context

Iteration 2 made SimpleRCPv2 feel much closer to a lightweight collaborative IDE: real workspace operations, a compact editor layout, a bottom terminal, member presence, MockAgent flow, and a basic OpenAI-compatible provider path.

The next problem is observability. A researcher or product user should be able to see the collaboration process, not only know that tests passed in a terminal. Human-human chat, human-agent chat, file operations, terminal runs, and agent actions should form a visible story that can be watched live and replayed later.

This iteration should therefore move the system from "collaboration exists" to "collaboration is understandable."

## Problems To Fix

### Duplicate-Looking Users

The current member identity uses a tab-scoped `clientId` from `sessionStorage`. This prevents duplicate members on refresh, but closing a tab and later opening the same name creates another member because the old tab identity is gone.

This is technically explainable but confusing in the UI. Users think in people, while the system currently mostly thinks in browser connections.

### Chat Is Not A Real Conversation

The chat composer sends `chat_message` events, but there is no durable chat message list. Users cannot read the conversation, cannot tell who said what, and cannot see whether an `@Agent` mention caused any response or work.

Activity logs and chat messages are different product concepts and should not be collapsed into the same list.

### Agent Work Is Opaque

MockAgent and the configured provider can perform work, but the user sees only sparse activity event names and terminal output. There is no obvious state like "Agent is thinking", "Agent is editing a file", "Agent is running tests", or "Agent is blocked."

### Terminal Is Too Static For Local Research

The current terminal uses startup-configured command whitelist values. This is safer, but too rigid for a local research prototype. Users often need to try commands during a session without restarting the app.

### Automated Collaboration Tests Are Not Watchable

Playwright tests can verify the collaboration path, but from the user's perspective they are a black box. The user wants to see an AI or scripted scenario enter a workspace, talk, edit files, run commands, and reach a result, almost like watching a video.

## Goals

- Represent people separately from browser tabs/connections.
- Show a clear member list without confusing duplicate names.
- Add a real chat transcript for human-human and human-agent messages.
- Let `@MockAgent` and future `@DeepSeek` mentions create visible agent work.
- Show agent status and action progress in the UI.
- Add a local unrestricted terminal mode for research use.
- Introduce a scenario runner that can play a scripted collaboration flow in the UI.
- Introduce a timeline/replay view that makes automated collaboration tests watchable.
- Keep existing deterministic tests and add coverage for the new observable flow.

## Non-Goals

- Production authentication.
- Cloud accounts or cross-device identity sync.
- Secure multi-tenant command execution.
- A full video recorder or binary video editor.
- Full Git workflow UI.
- Fully autonomous long-running agents.
- Complex branching scenario authoring UI.
- Replacing Playwright. Playwright remains the verification driver.

## Recommended Approach

Build a visible collaboration layer on top of the existing event log.

The event log remains the source of truth for research and testing, but the product UI should project it into clearer concepts:

- Members and connections.
- Chat messages.
- Agent runs and statuses.
- Terminal runs.
- Timeline steps.

This avoids building a second unrelated history system while making the existing log understandable for humans.

## User Experience Design

### Member List

The member list should group by person:

- A person has a stable `userId`, display name, kind, online state, and active connection count.
- A connection has a `connectionId`, tab/session identity, current file, online state, and last seen time.
- The UI shows one row per person by default.
- If one person has multiple tabs, show a compact indicator such as `2 tabs`.
- If a person is offline, show the row as offline and optionally hide it after a short grace period.

Same-name handling:

- If the same browser/person reconnects as `bob`, it should update the existing `bob` row.
- If two different people both choose `bob`, show disambiguation such as `bob` and `bob #2`.
- The UI should avoid showing two identical `bob` rows with no explanation.

### Chat Transcript

The right panel should contain a true chat transcript:

- Message author.
- Timestamp.
- Message body.
- Author kind: human or agent.
- Optional linked task/run id.
- System-delivered agent status messages where useful.

The chat composer sends messages into the transcript. It should no longer feel like an input box detached from visible history.

Activity should remain a bounded developer/research log. Chat should be a conversation surface.

### Agent Mention Flow

When a chat message mentions an agent, the system should create a visible agent interaction.

For this iteration:

- `@MockAgent` should create or reuse a task and run the deterministic MockAgent path.
- `@DeepSeek` or `@Agent` should run the configured provider if available.
- If no provider key is configured, the agent should respond in chat with a clear unavailable message.
- The user should see an agent message immediately acknowledging the mention.
- Agent progress should be reflected as status messages or timeline steps.

The mention flow should remain bounded. One mention triggers one finite run, not an endless watch mode.

### Agent Status

Agent runs should have statuses:

- `queued`
- `thinking`
- `editing`
- `running_command`
- `reporting`
- `completed`
- `failed`
- `blocked`

The Agent section should show the latest status per active agent run. The chat transcript can also include short status messages, but the status widget should be the fastest way to see whether an agent is working.

### Terminal Modes

The terminal should support two modes:

- `restricted`: use the configured command whitelist. This remains the default safe mode.
- `unrestricted`: allow arbitrary command input for local research use.

Configuration:

- `SIMPLERCP_COMMAND_MODE=restricted` by default.
- `SIMPLERCP_COMMAND_MODE=unrestricted` enables arbitrary command input.

UI:

- In restricted mode, show the current selector or command suggestions.
- In unrestricted mode, show a command input with history.
- Always run commands inside `SIMPLERCP_WORKSPACE`.
- Always keep timeout and output-size limits.
- Always record command, initiator, output summary, exit code, and timestamps.
- Clearly label unrestricted mode in the UI.

### Scenario Runner

Add a scenario runner for visible, scripted collaboration demos.

A scenario should be a deterministic script that can:

- Spawn named participants.
- Send chat messages.
- Open files.
- Edit files.
- Create/rename/delete files and folders.
- Trigger MockAgent or configured provider runs.
- Run terminal commands.
- Wait for expected outcomes.

The first built-in scenario should demonstrate:

1. Bob and Linus enter the room.
2. Bob asks for a small feature in chat.
3. MockAgent acknowledges the request.
4. MockAgent edits a file.
5. Linus opens the edited file.
6. A terminal test command runs.
7. The scenario reports success or failure.

The scenario runner is allowed to use deterministic MockAgent by default so it works without live API keys.

### Timeline And Replay

Add a Timeline panel or mode that displays a human-readable sequence of collaboration steps.

Each timeline item should include:

- Timestamp or relative time.
- Actor.
- Action label.
- Target path or command when relevant.
- Outcome status.
- Link or affordance to inspect details.

Replay controls for this iteration can be simple:

- Start scenario.
- Pause.
- Step next.
- Reset.
- Speed selector is optional.

Replay does not need to be a true video file. It should make events watchable in the app.

## Data Model

### Person

Add a person-level concept:

- `userId`
- `name`
- `kind`
- `online`
- `connectionIds`
- `lastSeenAt`

### Connection

Connections represent tabs/sessions:

- `connectionId`
- `userId`
- `roomId`
- `currentFile`
- `online`
- `lastSeenAt`

### Chat Message

Add chat messages as first-class records:

- `id`
- `roomId`
- `authorId`
- `authorName`
- `authorKind`
- `text`
- `mentions`
- `timestamp`
- optional `taskId`
- optional `runId`

Chat messages should also append structured events, but the transcript should not be reconstructed from raw event names only.

### Agent Run

Add agent run records:

- `id`
- `roomId`
- `agentId`
- `triggerMessageId`
- `taskId`
- `status`
- `startedAt`
- `endedAt`
- `summary`
- `error`

### Timeline Item

Timeline items can be derived from events and scenario steps:

- `id`
- `roomId`
- `actorName`
- `actorKind`
- `type`
- `label`
- `target`
- `status`
- `timestamp`
- `payload`

## API Design

New or changed endpoints:

- `POST /api/rooms/:roomId/members` accepts `userId` and `connectionId`.
- `GET /api/rooms/:roomId/chat` lists chat messages.
- `POST /api/rooms/:roomId/chat` creates a chat message and triggers mention handling.
- `GET /api/rooms/:roomId/agent-runs` lists active and recent agent runs.
- `GET /api/rooms/:roomId/timeline` returns timeline items.
- `POST /api/scenarios/:scenarioId/run` starts a built-in scenario.
- `GET /api/scenarios` lists built-in scenarios.
- `POST /api/runner/run` accepts arbitrary command text only when unrestricted mode is enabled.
- `GET /api/config/runtime` returns command mode and provider availability without secrets.

WebSocket messages:

- Broadcast `chat_message_created`.
- Broadcast `agent_run_updated`.
- Broadcast `timeline_item_created`.
- Broadcast `presence` with person-grouped member data.

## Backend Components

### Identity Service

Responsible for:

- Upserting people by stable `userId`.
- Tracking connections by `connectionId`.
- Grouping member display rows.
- Handling same-name disambiguation.
- Marking connections offline on socket close.
- Cleaning stale offline people and connections.

### Chat Service

Responsible for:

- Storing chat messages in memory for the local prototype.
- Parsing mentions.
- Appending chat events.
- Calling mention handlers.
- Broadcasting new messages.

### Agent Run Service

Responsible for:

- Creating agent run records.
- Updating status.
- Bridging chat mentions to MockAgent or configured provider execution.
- Emitting chat/status/timeline updates.
- Handling missing API key and provider errors clearly.

### Scenario Service

Responsible for:

- Listing built-in scenarios.
- Running deterministic scenario steps.
- Writing chat, workspace, terminal, agent, and timeline events.
- Producing a final scenario result.

### Timeline Service

Responsible for:

- Converting important events and scenario steps into readable timeline items.
- Serving the timeline to the UI.
- Supporting basic replay state on the client.

## Frontend Components

### People Panel

Replace raw member rows with grouped people rows:

- Name.
- Kind.
- Online/offline.
- Current file summary.
- Tab count.

### Chat Panel

Add transcript above composer:

- Message bubbles or compact rows.
- Human and agent visual distinction.
- Mentions rendered visibly.
- Empty state that explains nothing only when transcript is empty.

### Agent Status Panel

Show active runs:

- Agent name.
- Status.
- Linked task/message.
- Last action.
- Error if failed.

### Terminal Panel

Update command input based on command mode:

- Restricted selector.
- Unrestricted text input and command history.
- Visible command mode label.

### Scenario And Timeline Panel

Add a scenario area:

- Scenario selector.
- Run button.
- Timeline list.
- Playback controls.

The panel can live in the right sidebar as a tab or in a bottom/secondary panel. It should not hide chat.

## Error Handling

- Duplicate names should never render as indistinguishable rows.
- A missing agent provider key should produce a chat-visible message and a failed/blocked agent run status.
- Unsupported command in restricted mode should show an inline terminal error.
- Unrestricted command execution should still enforce workspace root, timeout, and output limits.
- Scenario failure should create a final timeline item with failure details.
- Timeline should tolerate unknown event types by showing a generic readable item.

## Testing Strategy

### Unit Tests

Add tests for:

- Person upsert by `userId`.
- Multiple tabs under one person.
- Same-name disambiguation for different users.
- Offline connection cleanup.
- Chat message creation and listing.
- Mention parsing.
- `@MockAgent` mention creates an agent run.
- Missing configured provider creates visible failure state.
- Restricted command mode rejects unknown commands.
- Unrestricted command mode accepts arbitrary commands.
- Scenario service writes expected timeline items.

### E2E Tests

Extend Playwright collaboration tests:

- Closing/reopening the same named user does not create two indistinguishable rows.
- Two tabs for the same user show one person with `2 tabs`.
- Human chat message appears in both browsers.
- `@MockAgent` message appears in transcript and triggers visible agent status.
- Terminal unrestricted mode can run an ad hoc command when configured.
- Built-in scenario can be started from UI and produces a visible timeline.
- Timeline shows chat, file edit, command run, and final success.

### Visual / Watchability Check

Add a Playwright test or artifact-producing script that runs the built-in scenario and saves:

- Trace.
- Screenshot at final timeline state.
- JSON event log.
- JSON timeline.

This gives AI developers and human reviewers evidence of the visible process, not only command success.

## Documentation Updates

README should explain:

- Person vs tab identity behavior.
- Chat transcript usage.
- Agent mention usage.
- Restricted vs unrestricted terminal mode.
- Built-in scenario runner.
- Timeline/replay purpose.
- Security warning for unrestricted command mode.

## Success Criteria

- Reopening the same browser/person as `bob` does not show two indistinguishable `bob` rows.
- Two tabs for the same person are understandable as one person with multiple connections.
- Human chat messages are visible to all room participants.
- `@MockAgent` visibly acknowledges and performs a bounded run.
- Agent status is visible while it works.
- Unrestricted terminal mode allows ad hoc local commands when explicitly enabled.
- A built-in scenario can be launched from the UI and watched through a timeline.
- Automated tests verify the observable collaboration loop without requiring a live API key.
