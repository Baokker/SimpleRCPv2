# Realtime Collaborative Coding Prototype Design

## Context

SimpleRCPv2 starts as a greenfield repository. The first version should prove a realtime collaborative coding experience where human collaborators and AI agents work in the same project-level room against a real local workspace.

The prototype must avoid becoming a single-file editor demo. It should feel closer to a lightweight LiveShare-style environment: a real project tree, multiple files, shared editor state, member presence, task discussion, agent participation, command execution, and automated verification.

## Goals

- Open a real local project folder as the workspace.
- Let multiple browser users join a project room through an invite link.
- Present a multi-file coding environment with a file tree and Monaco editor tabs.
- Let AI agents join as room members through OpenAI-compatible configuration.
- Support semi-active agents that observe collaboration events, suggest actions, and execute only inside task-level authorization.
- Run local, whitelisted commands from the workspace and stream results back to the UI.
- Make the project itself highly testable by AI during development through unit tests, Playwright E2E tests, collaboration simulations, mock agents, and event-log assertions.

## Non-Goals For The MVP

- Account systems, long-term identities, teams, billing, or cloud auth.
- Public internet relay, cloud deployment, or multi-tenant hosting.
- Docker sandboxing or remote runner infrastructure.
- VS Code extension integration.
- Complete Git UI for branch, diff, commit, or PR flows.
- Full offline CRDT recovery and advanced conflict resolution.
- Production-grade audit, compliance, or secrets management.
- Complex multi-agent role scheduling or autonomous swarm behavior.
- Voice, video, or screen sharing.

## Recommended Approach

Use a layered local collaboration platform. The browser provides the collaborative IDE experience, while a local Node backend owns real workspace access, room events, command execution, and agent runtime integration.

This keeps the first version fast to build while preserving clean module boundaries for later sandboxed runners, remote collaboration, and richer agent orchestration.

## System Architecture

### Web Client

The web client is a React application that provides the main collaborative coding UI:

- Workspace explorer for the real local file tree.
- Monaco editor with multiple tabs.
- Presence indicators for online members, current file, cursor, and activity.
- Collaboration panel for members, agents, chat, tasks, approvals, and agent reports.
- Terminal and test panel for command output, run records, and verification summaries.

### Collaboration Server

The collaboration server manages realtime room state over WebSocket:

- Project room creation and invite links.
- Member join, leave, presence, and current file state.
- Chat and task events.
- File-open and editor-change events.
- Agent activity events.
- Runner and command lifecycle events.

The first version can use one local server process. Internal boundaries should still keep collaboration, workspace, runner, agent runtime, tasks, and events as separate modules.

### Workspace Service

The workspace service maps the browser UI to a real local directory:

- Start the server with a configured workspace root.
- List directories and files under the root.
- Read and write files inside the root.
- Create files and directories for basic project editing.
- Reject path traversal and any operation outside the workspace root.

The MVP should support nested folders and multiple files. It should not degrade into a single shared document model.

### Editor Collaboration

The MVP should support realtime synchronization for at least one shared text document at a time, with a path to expand to multiple open documents. Yjs or a similar CRDT-based layer is appropriate for editor content and cursor awareness.

Required collaboration signals:

- Online members.
- Current file per member.
- Cursor or selection awareness when editing the same file.
- File-open events.
- File-change events.
- Save/write events back to the real workspace.

### Runner Service

The runner service executes whitelisted commands in the workspace root:

- Commands run under the configured workspace root.
- Commands are selected from a whitelist such as `npm test`, `npm run build`, `pnpm test`, `pytest`, or project-specific configured entries.
- stdout and stderr stream to the client.
- Each command produces a run record with command, initiator, task id, start time, end time, exit code, and output summary.
- Commands have timeout and output-size limits.

The MVP uses local execution. The runner interface should be replaceable so a Docker or remote runner can be added later without rewriting the UI or agent runtime.

## Core UI And Workflow

The main UI has four areas:

- Left: workspace explorer for nested folders and files.
- Center: Monaco multi-tab editor.
- Right: collaboration panel with members, agents, chat, tasks, approvals, and reports.
- Bottom: terminal/test panel with streaming output and run records.

Typical workflow:

1. A user starts the local server with a workspace root.
2. The system creates a room id and invite URL.
3. Human collaborators open the URL and choose display names.
4. Users browse the project tree, open files, and edit code.
5. Presence shows who is online and which file each person is viewing.
6. A user creates a task with an optional natural-language acceptance target.
7. The user assigns an agent and grants task-level authorization for editable paths and runnable commands.
8. The agent observes room context, proposes a plan or next action, edits authorized files, and runs authorized commands.
9. The UI shows agent actions, command output, failures, retries, and final verification report.

## Agent Model

Agents are special room members, not invisible backend tools. Each agent has:

- `name`
- `baseURL`
- `apiKey`
- `model`
- `temperature`
- `systemPrompt`
- `capabilities`

The first provider implementation should support OpenAI-compatible APIs through `baseURL`, `apiKey`, and `model`, so DeepSeek, GLM, and similar services can be configured without separate first-class integrations.

The agent runtime should expose a provider interface so mock agents and future provider-specific adapters share the same execution path.

### Agent Behavior

Agents can:

- Observe room events, tasks, chat messages, file tree state, authorized file contents, and runner results.
- Suggest plans, risks, next steps, and possible fixes.
- Request edits or command runs.
- Execute edits or command runs when the current task authorization permits them.
- Produce a final report with changes, commands run, test results, and remaining risks.

Agents should not:

- Modify files without an authorized task.
- Run commands outside the task whitelist.
- Access paths outside the workspace root.
- Read or expose API keys in the UI or event log.
- Continue autonomous work forever without a user-visible task context.

### Semi-Active Triggers

An agent may speak or act when:

- A human mentions it in chat.
- A task is assigned to it.
- A test fails in a task it is watching.
- A human asks it to continue or review.
- A task explicitly enables watch mode.

This gives agents a visible collaborator role without making them uncontrolled autonomous processes.

## Task And Approval Model

A task records:

- Title and description.
- Creator.
- Assigned human or agent.
- Editable path patterns such as `src/**` and `tests/**`.
- Runnable command whitelist.
- Optional acceptance target.
- Approval state.
- Linked agent actions and run records.

Task-level authorization is the default MVP permission model. If an agent tries to edit a path or run a command outside its current authorization, the system creates an approval request instead of executing the action.

Approvals should be visible in the collaboration panel and should be written to the event log.

## Event Log

The event log is a first-class part of the design because this project is about studying realtime human and agent collaboration.

The MVP should log structured events for:

- Room creation.
- Member join and leave.
- Presence changes.
- File tree reads.
- File opens.
- File edits and saves.
- Chat messages.
- Task creation and assignment.
- Authorization changes.
- Agent observations, proposals, actions, and reports.
- Approval requests and decisions.
- Command start, output chunks, completion, and failure.

The event log supports debugging, automated tests, collaboration analysis, and future research tooling.

## Testing And AI Development Harness

Testing is not only a product feature. The project must be built so AI developers can verify the system while developing it, reducing manual validation work.

### Standard Commands

The repository should provide:

- `npm run dev` to start the local development environment.
- `npm test` to run unit and service-level tests.
- `npm run test:e2e` to run browser E2E tests.
- `npm run test:collab` to run collaboration simulation tests.

### Mock Agent Provider

The MVP should include a mock agent provider that uses the same agent runtime interface as real providers. It should support deterministic scripted behavior for tests:

- Observe a task.
- Send a plan.
- Request or perform an authorized file edit.
- Request or run an authorized command.
- Send a final verification report.

This allows collaboration and agent workflows to be tested without DeepSeek, GLM, OpenAI, or any live API key.

### Collaboration Simulation

Playwright tests should use multiple browser contexts to simulate collaborators:

- User A and User B join the same room.
- Both users see each other in presence.
- User A opens a file and User B sees current-file activity.
- User A edits a file and User B sees synchronized content.
- A task is created and assigned to the mock agent.
- The mock agent produces a plan, edits an authorized file, and runs an authorized command.
- The UI shows command output and the final report.
- Event log assertions confirm the expected sequence of structured events.

### Runner Tests

Runner tests should use fixture workspaces instead of the user's real project:

- Authorized commands execute and return output.
- Unauthorized commands are rejected or require approval.
- Path traversal is rejected.
- stdout and stderr are streamed.
- Timeout and output-size limits are enforced.
- Run records include initiator, task id, command, exit code, and summary.

### Product Capability Tests

The system should also test product-level behavior:

- Workspace explorer renders nested directories.
- Monaco tabs open multiple files.
- File writes persist to the workspace.
- Chat messages appear for all room members.
- Task authorization gates agent edits and command runs.
- Agent reports are visible and linked to tasks.

## Security And Local Execution Boundaries

The MVP accepts local execution as a prototype tradeoff, but it must keep clear boundaries:

- All workspace file access stays under the configured root.
- API keys stay on the server side.
- API keys are not written to event logs.
- Agent execution is bound to task authorization.
- Commands are whitelisted, not arbitrary shell strings.
- Runner output has timeout and size limits.
- Test fixtures are isolated from user workspaces.

The design intentionally leaves room for a later sandbox runner. Runner calls should pass through one service interface rather than being embedded directly in UI or agent code.

## MVP Success Criteria

The MVP is successful when:

- Two browser users can join the same project room through an invite URL.
- Both users see each other online and can see current-file activity.
- The workspace explorer shows a real nested local project.
- A file opened and edited by one user synchronizes to another user.
- A task can be created, assigned to a mock or configured agent, and given task-level authorization.
- The agent can edit authorized files and run authorized commands through the same system real agents would use.
- Unauthorized agent actions produce approval requests instead of executing.
- Command output streams to the UI and creates a structured run record.
- The agent produces a final report that includes changes, commands, results, and risks.
- `npm run test:collab` can automatically verify the core human-human and human-agent collaboration flow.

## Open Implementation Choices

The implementation plan should decide exact packages and file layout, but the likely stack is:

- TypeScript.
- React for the web client.
- Monaco Editor for editing.
- Yjs or equivalent CRDT support for shared text and awareness.
- WebSocket transport for room events.
- Node.js server for workspace, runner, room, task, event, and agent services.
- Playwright for E2E and collaboration simulation.
- Vitest or Jest for unit tests.
- node-pty or child-process based runner for local command execution.

The final choice should favor a small, inspectable prototype over production framework complexity.
