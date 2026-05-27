# Iteration 2 IDE And Agent Loop Design

## Context

The current SimpleRCPv2 MVP proves a realtime collaboration chain: a local workspace, file tree, Monaco editor, room presence, chat, MockAgent task execution, command running, and Playwright collaboration simulation.

The next iteration should turn that proof into a more natural collaborative IDE prototype. The focus is not to build a full VS Code clone. The focus is to make the existing browser workspace feel credible enough for human-human and human-agent collaboration research, while also improving the automated development and test loop so AI can validate changes with less manual checking.

## Problems To Fix

### Member Lifecycle

Refreshing or re-entering the same room currently creates a new user every time. Room membership should represent active collaborators, not every page load. The system needs a stable browser client identity, idempotent join behavior, online/offline status, and stale member cleanup.

### IDE Layout And Visual Density

The current screen arrangement is not natural for coding. The next layout should use a compact IDE structure:

- Left: workspace explorer.
- Center: editor tabs and Monaco editor.
- Right: agent and collaboration panel.
- Bottom: terminal and run output.
- Top or bottom status bar: room id, current user, connection state, and workspace name.

The floating room badge should be removed. Font sizes, spacing, and panel headers should become denser and closer to an IDE.

### Collaboration Panel

Activity currently grows in a way that competes with chat. The right panel should keep chat usable at all times. Activity should be a bounded scroll area, while the chat composer stays fixed at the bottom of the panel.

### Workspace Operations

The file tree currently opens existing files only. A collaborative coding workspace needs basic project editing:

- Create file.
- Rename file.
- Delete file.
- Create folder.
- Rename folder.
- Delete folder.

All operations must stay inside the configured workspace root and refresh the tree for all clients.

### Terminal Run UI

The backend already supports task-level whitelisted command execution, but the client does not expose a practical terminal runner. The UI should let a user choose from allowed commands, run one, see status and output, and keep the output panel stable.

### Real Agent Provider

MockAgent is useful for deterministic tests, but it is not enough for realistic human-agent collaboration. This iteration should add a real OpenAI-compatible provider path that can connect to DeepSeek through environment configuration.

The implementation should not write API keys into code, tests, README, event logs, browser state, or commits.

## Goals

- Stop duplicate human users when a browser refreshes or rejoins the room.
- Redesign the app into a compact IDE-like workbench.
- Keep chat fixed and activity bounded in the right panel.
- Add file and folder create, rename, and delete operations.
- Add a visible terminal command runner backed by the whitelist.
- Add a DeepSeek-capable OpenAI-compatible agent provider.
- Keep MockAgent as the deterministic test provider.
- Expand automated tests so AI developers can verify this iteration without manual UI inspection.

## Non-Goals

- Full VS Code parity.
- Complete CRDT conflict resolution.
- Production authentication or team permissions.
- Remote sandbox infrastructure or Docker isolation.
- Persisted cloud rooms.
- Full Git UI.
- Long-running autonomous agent watch mode.
- Streaming LLM token display in the first DeepSeek integration.
- Allowing arbitrary shell commands from the browser.

## Recommended Approach

Build one vertical usability slice: fix room lifecycle, reshape the UI into an IDE workbench, add workspace mutations, expose terminal runs, and add a real provider interface that can call DeepSeek through an OpenAI-compatible API.

The slice should remain testable without a live API key. MockAgent remains the default for automated tests. DeepSeek support is activated only when `DEEPSEEK_API_KEY` or a generic OpenAI-compatible provider configuration is present.

## User Experience Design

### Workbench Layout

The app shell should use a four-zone workbench:

- A left explorer panel with the workspace name, file tree, and compact action buttons.
- A center editor panel with tabs and the Monaco editor.
- A right collaboration panel with tabs or compact stacked sections for members, agent/task controls, activity, and chat.
- A bottom terminal panel under the editor area for command selection, run status, and output.

The right panel may span the full height. The terminal should not cover the chat composer. The chat composer should remain visible at the bottom of the right panel.

### Status Bar

The floating room badge should be replaced by a compact status bar. It should show:

- Room id.
- Current user name.
- Connection state.
- Workspace name.

This makes the room information discoverable without placing a floating badge over the work area.

### Workspace Explorer

The explorer should support actions through compact controls:

- New file.
- New folder.
- Rename.
- Delete.

For this iteration, browser prompts or lightweight inline dialogs are acceptable. A polished command palette can come later. Destructive delete operations should ask for confirmation.

### Collaboration And Agent Panel

The right panel should separate concerns:

- Members: current online/offline members, kind, and current file.
- Agent: provider status, task creation, assignment, and run actions.
- Activity: the latest structured events in a bounded scroll box.
- Chat: message history if available, plus a fixed composer at the bottom.

Activity should show enough context to debug collaboration without becoming the main interface.

### Terminal Panel

The terminal panel should provide:

- A command selector populated from the server whitelist.
- A run button.
- Running, succeeded, and failed states.
- Scrollable output.

For now, command output can continue to come from command completion events rather than live streaming. Live streaming can be a later iteration.

## Member Lifecycle Design

The browser should create a stable `clientId` and store it in `sessionStorage`. A tab refresh keeps the same `clientId`. A separate tab gets its own `clientId`, which is useful for simulating two collaborators.

The room store should upsert human members by `clientId`:

- If a member with the same `clientId` exists, update its name, kind, `online` status, and `lastSeenAt`.
- If no member exists, create one.
- WebSocket connection should mark the member online.
- WebSocket close should mark the member offline and update `lastSeenAt`.
- Stale offline human members should be removed after a short TTL.

Agent members should be upserted by a stable provider or configured agent id, not by every task run. A room should not accumulate duplicate `MockAgent` or `DeepSeek` members.

## Workspace Operations Design

The workspace service should expose safe operations:

- `createFile(path, content = "")`
- `createDirectory(path)`
- `renamePath(fromPath, toPath)`
- `deletePath(path)`

Every operation must call the existing workspace path resolver. Rename and delete must reject root deletion, path traversal, and overwriting existing paths unless a later explicit overwrite mode is added.

The server should append structured events:

- `workspace_file_created`
- `workspace_directory_created`
- `workspace_path_renamed`
- `workspace_path_deleted`

After mutations, connected clients should refresh the file tree. A simple event-driven refresh is enough for this iteration.

## Runner Design

The server should expose configured allowed commands to the client without requiring the client to guess them.

The client can run a command in one of two modes:

- Task command: linked to an existing task and constrained by that task's whitelist.
- Quick command: linked to the current human member and constrained by the global server whitelist.

This iteration should add quick command execution because users need a visible terminal entry point even before creating an agent task. Quick commands still use the server whitelist and workspace root.

## Agent Provider Design

Add a provider interface that supports:

- Mock provider for deterministic tests.
- OpenAI-compatible provider for DeepSeek and future GLM/OpenAI-compatible services.

The provider should be configured by environment variables:

- `AGENT_PROVIDER=mock | openai-compatible`
- `AGENT_BASE_URL=https://api.deepseek.com`
- `AGENT_API_KEY`
- `AGENT_MODEL=deepseek-v4-flash`

For DeepSeek specifically, a convenience alias may read:

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com`
- `DEEPSEEK_MODEL=deepseek-v4-flash`

The real provider should start with a controlled task loop:

1. Read task description, acceptance target, allowed files, allowed commands, recent events, and relevant file contents.
2. Ask the model for a structured JSON action plan.
3. Accept only known actions: `message`, `edit_file`, `run_command`, and `final_report`.
4. Validate each action against task authorization before execution.
5. Append model-visible actions and results to the event log without logging secrets.

The first version should support one bounded provider run per user click, with a small maximum number of actions. It should not run indefinitely.

## Data And API Changes

### Room Member

Members should gain:

- `clientId`
- `online`
- `lastSeenAt`
- optional `provider`

Existing tests should be updated so member identity is stable.

### Server Endpoints

New or changed endpoints:

- `POST /api/rooms/:roomId/members` accepts `clientId`.
- `GET /api/config/commands` returns allowed command labels.
- `POST /api/runner/run` runs a quick whitelisted command.
- `POST /api/workspace/file` creates a file.
- `POST /api/workspace/directory` creates a directory.
- `PATCH /api/workspace/path` renames a file or directory.
- `DELETE /api/workspace/path` deletes a file or directory.
- `POST /api/tasks/:taskId/agent/run` runs the configured provider.

Existing MockAgent endpoint can remain temporarily for compatibility, but the UI should move toward the generic agent run endpoint.

## Error Handling

- Duplicate create should return a clear conflict error.
- Rename over existing path should be rejected.
- Delete should reject empty path and workspace root.
- Path traversal should return a clear error and log no mutation event.
- Missing API key should show provider unavailable, not crash the server.
- Invalid model JSON should produce an agent error event and user-visible message.
- Unauthorized model actions should create an authorization error event instead of executing.

## Testing Strategy

### Unit Tests

Add tests for:

- Room join upsert by `clientId`.
- Offline marking on disconnect.
- Stale member cleanup.
- Agent member deduplication.
- Workspace create file and directory.
- Workspace rename file and directory.
- Workspace delete file and directory.
- Workspace path traversal rejection.
- Quick command whitelist enforcement.
- OpenAI-compatible provider request construction with a fake fetch.
- Provider action validation.

### E2E Collaboration Tests

Extend Playwright tests to cover:

- Refreshing the same page does not add duplicate members.
- Two separate browser contexts still appear as two collaborators.
- File create, rename, and delete update the explorer.
- Folder create, rename, and delete update the explorer.
- Activity remains bounded and chat input remains visible.
- Terminal command selector can run an allowed fixture command.
- MockAgent still completes the deterministic task flow.

### Optional Live Provider Test

Add a skipped-by-default live provider smoke test that runs only when an API key environment variable is present. It should verify connectivity with a tiny prompt and should not modify user files.

## Documentation Updates

README should be updated after implementation to explain:

- New IDE layout.
- File and folder operations.
- Terminal runner usage.
- MockAgent testing path.
- DeepSeek/OpenAI-compatible configuration through environment variables.
- Secret handling expectations.

The README must use placeholder API key examples only.

## Success Criteria

- Refreshing a page does not create duplicate human members.
- The screen reads as a compact IDE workbench.
- Chat remains usable regardless of event volume.
- Users can create, rename, and delete files and folders.
- Users can run an allowed command from the terminal UI.
- MockAgent deterministic tests still pass.
- DeepSeek can be configured without code changes or committed secrets.
- Automated tests cover the new behavior enough that AI developers can iterate without repeatedly manual-testing the browser.
