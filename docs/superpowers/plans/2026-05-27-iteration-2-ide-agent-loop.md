# Iteration 2 IDE And Agent Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the second iteration described in `docs/superpowers/specs/2026-05-27-iteration-2-ide-agent-loop-design.md`: compact IDE workbench, stable member lifecycle, workspace mutations, terminal runner UI, and a DeepSeek-capable OpenAI-compatible agent provider.

**Architecture:** Keep the existing React/Vite client and Express/WebSocket server. Add narrowly scoped server services for lifecycle, workspace mutations, quick runner execution, and OpenAI-compatible agent actions; then surface them through compact IDE panels. Preserve MockAgent as the deterministic automated-test path while making the configured real provider optional through environment variables.

**Tech Stack:** TypeScript, React, Vite, Monaco, Express, ws, Vitest, Playwright, Node `fetch`, Node filesystem/process APIs.

---

## File Structure

- Modify `apps/server/src/types.ts` for member lifecycle fields and generic agent/provider types.
- Modify `apps/server/src/config.ts` to load command and agent provider configuration.
- Modify `apps/server/src/rooms.ts` for client-id upsert, online/offline state, stale cleanup, and agent dedupe.
- Modify `apps/server/src/realtime.ts` to mark members online/offline and broadcast tree refresh events.
- Modify `apps/server/src/workspace.ts` for create, rename, delete operations with root-safe path checks.
- Modify `apps/server/src/runner.ts` so quick commands and task commands share the same execution path.
- Modify `apps/server/src/createApp.ts` to expose config, runner, workspace mutation, and generic agent endpoints.
- Create `apps/server/src/agents/openaiCompatible.ts` for the DeepSeek/OpenAI-compatible provider.
- Modify `apps/server/src/agents/runtime.ts` and `apps/server/src/agents/types.ts` to select mock or OpenAI-compatible providers.
- Modify server tests under `apps/server/src/__tests__`.
- Modify `apps/client/src/types.ts`, `apps/client/src/api.ts`, `apps/client/src/socket.ts`, `apps/client/src/App.tsx`, and client components under `apps/client/src/components`.
- Modify `apps/client/src/styles.css` for the compact IDE layout.
- Modify `tests/e2e/collaboration.spec.ts` and `tests/e2e/helpers.ts`.
- Modify `README.md` after behavior is implemented.

---

### Task 1: Server Member Lifecycle

**Files:**
- Modify: `apps/server/src/types.ts`
- Modify: `apps/server/src/rooms.ts`
- Modify: `apps/server/src/realtime.ts`
- Modify: `apps/server/src/createApp.ts`
- Test: `apps/server/src/__tests__/rooms.test.ts`
- Test: `apps/server/src/__tests__/realtime.test.ts`

- [ ] **Step 1: Write failing room lifecycle tests**

Add tests that express these behaviors:

```ts
it("upserts human members by client id", () => {
  const events = createEventLog();
  const rooms = createRoomStore(events);
  const room = rooms.createRoom("sample-workspace");

  const first = rooms.joinRoom(room.id, {
    name: "Ada",
    kind: "human",
    clientId: "client-a"
  });
  const second = rooms.joinRoom(room.id, {
    name: "Ada Lovelace",
    kind: "human",
    clientId: "client-a"
  });

  expect(second.id).toBe(first.id);
  expect(rooms.getRoom(room.id)?.members).toHaveLength(1);
  expect(second).toMatchObject({
    name: "Ada Lovelace",
    kind: "human",
    clientId: "client-a",
    online: true
  });
});

it("deduplicates agent members by provider", () => {
  const events = createEventLog();
  const rooms = createRoomStore(events);
  const room = rooms.createRoom("sample-workspace");

  const first = rooms.joinRoom(room.id, {
    name: "MockAgent",
    kind: "agent",
    clientId: "agent-mock",
    provider: "mock"
  });
  const second = rooms.joinRoom(room.id, {
    name: "MockAgent",
    kind: "agent",
    clientId: "agent-mock-2",
    provider: "mock"
  });

  expect(second.id).toBe(first.id);
  expect(rooms.getRoom(room.id)?.members).toHaveLength(1);
});

it("marks members offline and removes stale offline members", () => {
  const events = createEventLog();
  const rooms = createRoomStore(events);
  const room = rooms.createRoom("sample-workspace");
  const member = rooms.joinRoom(room.id, {
    name: "Ada",
    kind: "human",
    clientId: "client-a"
  });

  rooms.markOffline(room.id, member.id, new Date("2026-05-27T00:00:00Z"));
  rooms.cleanupStaleMembers(room.id, new Date("2026-05-27T00:02:01Z"), 120_000);

  expect(rooms.getRoom(room.id)?.members).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @simplercp/server test -- rooms.test.ts realtime.test.ts`

Expected: FAIL because `joinRoom` still accepts positional arguments and lifecycle methods do not exist.

- [ ] **Step 3: Implement member lifecycle**

Update the `RoomMember` type to include `clientId`, `online`, `lastSeenAt`, and optional `provider`. Change `rooms.joinRoom` to accept an object:

```ts
rooms.joinRoom(roomId, {
  name,
  kind,
  clientId,
  provider
});
```

For humans, match existing members by `clientId`. For agents, match by `provider` when present, otherwise by `clientId`. Add `markOnline`, `markOffline`, and `cleanupStaleMembers`. Emit `member_joined`, `member_rejoined`, `member_offline`, and `member_removed` events as appropriate.

- [ ] **Step 4: Wire lifecycle through HTTP and WebSocket**

`POST /api/rooms/:roomId/members` must require or create a client id, pass it to `rooms.joinRoom`, and return the stable member. WebSocket messages should continue to identify the member by `memberId`; on socket close, call `rooms.markOffline` and broadcast presence.

- [ ] **Step 5: Run lifecycle tests**

Run: `pnpm --filter @simplercp/server test -- rooms.test.ts realtime.test.ts`

Expected: PASS.

---

### Task 2: Workspace Mutations

**Files:**
- Modify: `apps/server/src/workspace.ts`
- Modify: `apps/server/src/createApp.ts`
- Test: `apps/server/src/__tests__/workspace.test.ts`

- [ ] **Step 1: Write failing workspace mutation tests**

Add tests for:

```ts
await createWorkspaceFile(root, "src/new.ts", "export const value = 1;\n");
await expect(readWorkspaceFile(root, "src/new.ts")).resolves.toContain("value");

await createWorkspaceDirectory(root, "src/features");
await expect(fs.stat(path.join(root, "src", "features"))).resolves.toMatchObject({
  isDirectory: expect.any(Function)
});

await renameWorkspacePath(root, "src/hello.ts", "src/greeting.ts");
await expect(readWorkspaceFile(root, "src/greeting.ts")).resolves.toContain("world");

await deleteWorkspacePath(root, "src/greeting.ts");
await expect(readWorkspaceFile(root, "src/greeting.ts")).rejects.toThrow();

await expect(deleteWorkspacePath(root, "")).rejects.toThrow("Cannot delete workspace root");
await expect(renameWorkspacePath(root, "src/hello.ts", "../escape.ts")).rejects.toThrow(
  "Path escapes workspace root"
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @simplercp/server test -- workspace.test.ts`

Expected: FAIL because mutation functions do not exist.

- [ ] **Step 3: Implement workspace mutation functions**

Add `createWorkspaceFile`, `createWorkspaceDirectory`, `renameWorkspacePath`, `deleteWorkspacePath`, and `pathExists`. Ensure create and rename reject existing targets, delete rejects the root path, and all functions call `resolveWorkspacePath`.

- [ ] **Step 4: Add HTTP endpoints and event logging**

Expose:

```text
POST /api/workspace/file
POST /api/workspace/directory
PATCH /api/workspace/path
DELETE /api/workspace/path
```

Log `workspace_file_created`, `workspace_directory_created`, `workspace_path_renamed`, and `workspace_path_deleted`. Return the refreshed tree where useful.

- [ ] **Step 5: Run workspace tests**

Run: `pnpm --filter @simplercp/server test -- workspace.test.ts`

Expected: PASS.

---

### Task 3: Runner And Agent Provider Backend

**Files:**
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/types.ts`
- Modify: `apps/server/src/runner.ts`
- Modify: `apps/server/src/createApp.ts`
- Modify: `apps/server/src/agents/types.ts`
- Modify: `apps/server/src/agents/runtime.ts`
- Create: `apps/server/src/agents/openaiCompatible.ts`
- Test: `apps/server/src/__tests__/config.test.ts`
- Test: `apps/server/src/__tests__/runner.test.ts`
- Test: `apps/server/src/__tests__/openaiCompatibleAgent.test.ts`

- [ ] **Step 1: Write failing config and runner tests**

Extend config expectations:

```ts
expect(loadConfig({
  PORT: "4500",
  SIMPLERCP_WORKSPACE: "tests/fixtures/sample-workspace",
  SIMPLERCP_COMMANDS: "npm test,pnpm test",
  AGENT_PROVIDER: "openai-compatible",
  AGENT_BASE_URL: "https://api.deepseek.com",
  AGENT_API_KEY: "test-key",
  AGENT_MODEL: "deepseek-v4-flash"
})).toMatchObject({
  agent: {
    provider: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    apiKey: "test-key",
    model: "deepseek-v4-flash"
  }
});
```

Add a quick-run test that calls `runWorkspaceCommand` with `taskId: undefined` and verifies a whitelisted command still runs and records `command_completed`.

- [ ] **Step 2: Write failing OpenAI-compatible provider tests**

Create a fake fetch test:

```ts
const calls: unknown[] = [];
const fakeFetch = async (url: string, init?: RequestInit) => {
  calls.push({ url, init });
  return new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          actions: [
            { type: "message", text: "I will inspect the task." },
            { type: "final_report", summary: "No file change needed.", commands: [], risks: [] }
          ]
        })
      }
    }]
  }), { status: 200 });
};
```

Assert the request URL is `https://api.deepseek.com/chat/completions`, the bearer token is present, the configured model is used, and the returned report is appended as `agent_reported`.

- [ ] **Step 3: Run backend tests to verify they fail**

Run: `pnpm --filter @simplercp/server test -- config.test.ts runner.test.ts openaiCompatibleAgent.test.ts`

Expected: FAIL because config and provider support do not exist.

- [ ] **Step 4: Implement config and quick runner**

Add `agent` to `ServerConfig`, reading generic `AGENT_*` variables and DeepSeek aliases. Add `GET /api/config/commands` and `POST /api/runner/run`. Quick runs must use `config.commandWhitelist`, `defaultRoom.id`, the initiating member id, and no task-specific auth.

- [ ] **Step 5: Implement OpenAI-compatible provider**

Create `runOpenAICompatibleAgentTask`. It should:

- Require an API key before calling the provider.
- Build a chat-completions request to `${baseUrl}/chat/completions`.
- Ask for JSON actions.
- Parse `message.content`.
- Support `message`, `edit_file`, `run_command`, and `final_report`.
- Validate edits through `tasks.canEdit`.
- Validate commands through `tasks.canRunCommand`.
- Log `agent_message`, `agent_edited_file`, `approval_requested`, `command_*`, `agent_reported`, and `agent_error` as appropriate.
- Cap action processing to a small fixed number such as 6.

- [ ] **Step 6: Run provider tests**

Run: `pnpm --filter @simplercp/server test -- config.test.ts runner.test.ts openaiCompatibleAgent.test.ts`

Expected: PASS.

---

### Task 4: Client API, Socket, And State Integration

**Files:**
- Modify: `apps/client/src/types.ts`
- Modify: `apps/client/src/api.ts`
- Modify: `apps/client/src/socket.ts`
- Modify: `apps/client/src/App.tsx`

- [ ] **Step 1: Add client types and API functions**

Add types for command config and run records. Add API functions:

```ts
getAllowedCommands()
createWorkspaceFile(path, content)
createWorkspaceDirectory(path)
renameWorkspacePath(fromPath, toPath)
deleteWorkspacePath(path)
runQuickCommand(command, initiatorId)
runConfiguredAgent(taskId, agentId)
```

- [ ] **Step 2: Add stable client id**

In the client, add:

```ts
function getClientId() {
  const existing = window.sessionStorage.getItem("simplercp.clientId");
  if (existing) return existing;
  const next = window.crypto.randomUUID();
  window.sessionStorage.setItem("simplercp.clientId", next);
  return next;
}
```

Pass `clientId` into `joinRoom`.

- [ ] **Step 3: Handle tree-refresh events**

Extend `ServerMessage` with `workspace_tree_changed`. When received, refresh the tree and reload any active file that was modified by an external agent action.

- [ ] **Step 4: Integrate app state handlers**

Add App handlers for file/folder create, rename, delete, quick command run, and configured agent run. Ensure delete closes affected open tabs and clears `activePath` if needed.

- [ ] **Step 5: Run client build**

Run: `pnpm --filter @simplercp/client build`

Expected: PASS.

---

### Task 5: Compact IDE UI

**Files:**
- Modify: `apps/client/src/components/WorkspaceExplorer.tsx`
- Modify: `apps/client/src/components/CollaborationPanel.tsx`
- Modify: `apps/client/src/components/TerminalPanel.tsx`
- Modify: `apps/client/src/components/EditorArea.tsx`
- Modify: `apps/client/src/styles.css`
- Modify: `apps/client/src/App.tsx`

- [ ] **Step 1: Update workspace explorer controls**

Add compact action buttons with accessible labels and test ids:

```text
new-file
new-folder
rename-path
delete-path
```

Use browser prompts for path entry in this iteration. Delete should confirm before calling the handler.

- [ ] **Step 2: Update collaboration panel**

Make members, agent/tasks, activity, and chat fixed sections. Activity must render inside `data-testid="activity-feed"` and chat input must remain in a footer area with `data-testid="chat-composer"`.

- [ ] **Step 3: Update terminal panel**

Add a command selector with `data-testid="command-select"`, a run button with `data-testid="run-command"`, and a scrollable output area with `data-testid="terminal-output"`.

- [ ] **Step 4: Replace floating badge with status bar**

Remove `.room-badge` and add `data-testid="status-bar"` showing room id, member name, workspace name, and connection text.

- [ ] **Step 5: Apply IDE-density CSS**

Use a grid with left explorer, center editor, right collaboration panel, bottom terminal, and status bar. Reduce base font sizes to 12-14px. Keep all panels height-bounded with `min-height: 0` and internal scroll containers.

- [ ] **Step 6: Run client build**

Run: `pnpm --filter @simplercp/client build`

Expected: PASS.

---

### Task 6: E2E Tests And README

**Files:**
- Modify: `tests/e2e/collaboration.spec.ts`
- Modify: `tests/e2e/helpers.ts`
- Modify: `README.md`

- [ ] **Step 1: Write E2E tests**

Cover:

- Refreshing the same page does not duplicate a human member.
- Two browser contexts still show two collaborators.
- Creating, renaming, and deleting a file updates the explorer.
- Creating, renaming, and deleting a folder updates the explorer.
- The activity feed is bounded and the chat composer remains visible.
- The terminal command selector runs `npm test`.
- MockAgent still completes the deterministic task flow.

- [ ] **Step 2: Run E2E to verify failures or current gaps**

Run: `pnpm run test:collab`

Expected before all UI wiring is complete: FAIL on selectors or missing behaviors. After Tasks 4 and 5 are complete, this command should pass.

- [ ] **Step 3: Update README in Chinese**

Document:

- The IDE layout.
- File and folder operations.
- Terminal runner usage.
- MockAgent path.
- DeepSeek/OpenAI-compatible environment variables using placeholder values only.
- Secret handling expectations.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm test && pnpm run test:collab && pnpm build
```

Expected: PASS.

---

## Self-Review Checklist

- The plan covers each success criterion in the Iteration 2 spec.
- DeepSeek integration is optional and uses environment variables only.
- MockAgent remains deterministic for automated tests.
- File operations are root-safe and tested.
- Quick command execution remains whitelist-constrained.
- The UI removes the floating room badge and keeps chat visible.
- The final verification command covers unit tests, collaboration E2E tests, and production build.
