# Observable Collaboration Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-05-28-observable-collaboration-loop-design.md` so collaboration is visible as people, chat, agent status, terminal runs, scenarios, and timeline replay.

**Architecture:** Keep the local in-memory Express/WebSocket architecture. Add focused stores for identity, chat, agent runs, and timeline, then project them into the React right panel and terminal. Preserve deterministic MockAgent for tests and use unrestricted command mode only when explicitly configured.

**Tech Stack:** TypeScript, React, Vite, Monaco, Express, ws, Vitest, Playwright, Node filesystem/process APIs.

---

## File Structure

- Modify `apps/server/src/types.ts` for person, connection, chat, agent run, timeline, runtime config, and WebSocket message types.
- Modify `apps/server/src/config.ts` for `SIMPLERCP_COMMAND_MODE`.
- Modify `apps/server/src/rooms.ts` or split to `apps/server/src/identity.ts` for person/connection grouping. Keep `rooms.ts` as the room-facing store.
- Create `apps/server/src/chat.ts` for chat messages and mention parsing.
- Create `apps/server/src/agentRuns.ts` for visible agent run state.
- Create `apps/server/src/timeline.ts` for readable timeline items.
- Create `apps/server/src/scenarios.ts` for the deterministic built-in collaboration scenario.
- Modify `apps/server/src/runner.ts` to support restricted and unrestricted modes.
- Modify `apps/server/src/createApp.ts` to wire new stores and endpoints.
- Modify `apps/server/src/realtime.ts` to track connections and broadcast new visible message types.
- Modify `apps/client/src/types.ts`, `apps/client/src/api.ts`, `apps/client/src/socket.ts`, and `apps/client/src/App.tsx`.
- Modify `apps/client/src/components/CollaborationPanel.tsx` and `apps/client/src/components/TerminalPanel.tsx`.
- Modify `apps/client/src/styles.css`.
- Modify server tests under `apps/server/src/__tests__`.
- Modify `tests/e2e/collaboration.spec.ts` and possibly add `tests/e2e/observable.spec.ts`.
- Modify `README.md`.

---

### Task 1: Person And Connection Identity

**Files:**
- Modify: `apps/server/src/types.ts`
- Modify: `apps/server/src/rooms.ts`
- Modify: `apps/server/src/realtime.ts`
- Modify: `apps/server/src/createApp.ts`
- Test: `apps/server/src/__tests__/rooms.test.ts`
- Test: `apps/server/src/__tests__/realtime.test.ts`

- [ ] **Step 1: Write failing identity tests**

Add tests to `rooms.test.ts`:

```ts
it("groups multiple connections under one person", () => {
  const events = createEventLog();
  const rooms = createRoomStore(events);
  const room = rooms.createRoom("sample-workspace");

  rooms.joinRoom(room.id, {
    name: "bob",
    kind: "human",
    userId: "user-bob",
    connectionId: "tab-1"
  });
  rooms.joinRoom(room.id, {
    name: "bob",
    kind: "human",
    userId: "user-bob",
    connectionId: "tab-2"
  });

  expect(rooms.getRoom(room.id)?.members).toMatchObject([
    {
      name: "bob",
      userId: "user-bob",
      connectionCount: 2,
      online: true
    }
  ]);
});

it("disambiguates different users with the same display name", () => {
  const events = createEventLog();
  const rooms = createRoomStore(events);
  const room = rooms.createRoom("sample-workspace");

  rooms.joinRoom(room.id, {
    name: "bob",
    kind: "human",
    userId: "user-a",
    connectionId: "tab-a"
  });
  rooms.joinRoom(room.id, {
    name: "bob",
    kind: "human",
    userId: "user-b",
    connectionId: "tab-b"
  });

  expect(rooms.getRoom(room.id)?.members.map((member) => member.displayName)).toEqual([
    "bob",
    "bob #2"
  ]);
});

it("marks one connection offline without duplicating the person row", () => {
  const events = createEventLog();
  const rooms = createRoomStore(events);
  const room = rooms.createRoom("sample-workspace");
  const bob = rooms.joinRoom(room.id, {
    name: "bob",
    kind: "human",
    userId: "user-bob",
    connectionId: "tab-1"
  });
  rooms.joinRoom(room.id, {
    name: "bob",
    kind: "human",
    userId: "user-bob",
    connectionId: "tab-2"
  });

  rooms.markConnectionOffline(room.id, "tab-1", new Date("2026-05-28T00:00:00Z"));

  expect(rooms.getRoom(room.id)?.members).toMatchObject([
    {
      id: bob.id,
      connectionCount: 1,
      online: true
    }
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @simplercp/server test -- rooms.test.ts realtime.test.ts`

Expected: FAIL because `userId`, `connectionId`, grouped members, and `markConnectionOffline` do not exist.

- [ ] **Step 3: Implement person/connection model**

Update server types:

```ts
export interface RoomConnection {
  id: string;
  userId: string;
  roomId: string;
  currentFile?: string;
  online: boolean;
  lastSeenAt: string;
}

export interface RoomMember {
  id: string;
  userId: string;
  name: string;
  displayName: string;
  kind: MemberKind;
  online: boolean;
  lastSeenAt: string;
  connectionCount: number;
  currentFile?: string;
  provider?: string;
}
```

Keep backward-compatible `clientId` handling by mapping old `clientId` to both `userId` and `connectionId` when the new fields are missing.

- [ ] **Step 4: Update realtime connection tracking**

Track socket identity by `connectionId`. On close, call `rooms.markConnectionOffline(roomId, connectionId)` and broadcast grouped presence. `open_file` should update the connection current file and then update the person's current file summary.

- [ ] **Step 5: Run identity tests**

Run: `pnpm --filter @simplercp/server test -- rooms.test.ts realtime.test.ts`

Expected: PASS.

---

### Task 2: Chat Transcript And Mention Parsing

**Files:**
- Modify: `apps/server/src/types.ts`
- Create: `apps/server/src/chat.ts`
- Modify: `apps/server/src/createApp.ts`
- Modify: `apps/server/src/realtime.ts`
- Test: `apps/server/src/__tests__/chat.test.ts`

- [ ] **Step 1: Write failing chat tests**

Create `chat.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createChatStore, parseMentions } from "../chat.js";
import { createEventLog } from "../eventLog.js";

describe("chat store", () => {
  it("creates and lists chat messages", () => {
    const events = createEventLog();
    const chat = createChatStore(events);

    const message = chat.createMessage({
      roomId: "room-1",
      authorId: "user-bob",
      authorName: "bob",
      authorKind: "human",
      text: "hello @MockAgent"
    });

    expect(message.mentions).toEqual(["MockAgent"]);
    expect(chat.listMessages("room-1")).toEqual([message]);
    expect(events.list().map((event) => event.type)).toContain("chat_message_created");
  });

  it("parses mentions from message text", () => {
    expect(parseMentions("@MockAgent please ask @DeepSeek")).toEqual([
      "MockAgent",
      "DeepSeek"
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @simplercp/server test -- chat.test.ts`

Expected: FAIL because `chat.ts` does not exist.

- [ ] **Step 3: Implement chat store**

Create in-memory chat store with `createMessage`, `listMessages`, and `parseMentions`. Add `ChatMessage` type to `types.ts`.

- [ ] **Step 4: Add chat HTTP endpoints**

Wire:

```text
GET /api/rooms/:roomId/chat
POST /api/rooms/:roomId/chat
```

`POST` should create a message and return it. Mention-triggered agent execution is added in Task 3.

- [ ] **Step 5: Run chat tests**

Run: `pnpm --filter @simplercp/server test -- chat.test.ts`

Expected: PASS.

---

### Task 3: Agent Runs And Mention-Triggered MockAgent

**Files:**
- Modify: `apps/server/src/types.ts`
- Create: `apps/server/src/agentRuns.ts`
- Modify: `apps/server/src/chat.ts`
- Modify: `apps/server/src/createApp.ts`
- Modify: `apps/server/src/agents/mockAgent.ts`
- Test: `apps/server/src/__tests__/agentRuns.test.ts`
- Test: `apps/server/src/__tests__/chat.test.ts`

- [ ] **Step 1: Write failing agent run tests**

Create `agentRuns.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAgentRunStore } from "../agentRuns.js";
import { createEventLog } from "../eventLog.js";

describe("agent run store", () => {
  it("creates and updates visible agent runs", () => {
    const events = createEventLog();
    const runs = createAgentRunStore(events);

    const run = runs.createRun({
      roomId: "room-1",
      agentId: "agent-mock",
      agentName: "MockAgent",
      triggerMessageId: "message-1",
      taskId: "task-1"
    });

    runs.updateStatus(run.id, "thinking", "Reading task context");
    runs.updateStatus(run.id, "completed", "MockAgent finished");

    expect(runs.listRuns("room-1")[0]).toMatchObject({
      status: "completed",
      lastAction: "MockAgent finished"
    });
    expect(events.list().map((event) => event.type)).toContain("agent_run_updated");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @simplercp/server test -- agentRuns.test.ts`

Expected: FAIL because `agentRuns.ts` does not exist.

- [ ] **Step 3: Implement agent run store**

Add statuses from the spec: `queued`, `thinking`, `editing`, `running_command`, `reporting`, `completed`, `failed`, `blocked`. Store recent runs by room.

- [ ] **Step 4: Wire `@MockAgent` mention**

When `POST /api/rooms/:roomId/chat` sees `MockAgent` in mentions:

1. Upsert a MockAgent member.
2. Create a task using the message text as description.
3. Create an agent run with status `queued`.
4. Add an agent chat acknowledgement.
5. Run MockAgent in a bounded async flow.
6. Update statuses around plan/edit/command/report.
7. Add final agent chat message.

The first implementation may run the async flow during the request, as long as the UI sees the transcript and status after the response.

- [ ] **Step 5: Add agent run endpoint**

Wire:

```text
GET /api/rooms/:roomId/agent-runs
```

- [ ] **Step 6: Run agent/chat tests**

Run: `pnpm --filter @simplercp/server test -- chat.test.ts agentRuns.test.ts mockAgent.test.ts`

Expected: PASS.

---

### Task 4: Runtime Config And Unrestricted Terminal Mode

**Files:**
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/runner.ts`
- Modify: `apps/server/src/createApp.ts`
- Test: `apps/server/src/__tests__/config.test.ts`
- Test: `apps/server/src/__tests__/runner.test.ts`

- [ ] **Step 1: Write failing config and runner tests**

Extend `config.test.ts`:

```ts
it("loads restricted command mode by default", () => {
  const config = loadConfig({ SIMPLERCP_WORKSPACE: "." });
  expect(config.commandMode).toBe("restricted");
});

it("loads unrestricted command mode when explicitly configured", () => {
  const config = loadConfig({
    SIMPLERCP_WORKSPACE: ".",
    SIMPLERCP_COMMAND_MODE: "unrestricted"
  });
  expect(config.commandMode).toBe("unrestricted");
});
```

Extend `runner.test.ts`:

```ts
await expect(runWorkspaceCommand({
  workspaceRoot: root,
  command: "node -e \"console.log('adhoc-ok')\"",
  whitelist: ["npm test"],
  commandMode: "restricted",
  events,
  roomId: "room-1",
  initiatorId: "human-1",
  timeoutMs: 10_000
})).rejects.toThrow("Command is not authorized");

const result = await runWorkspaceCommand({
  workspaceRoot: root,
  command: "node -e \"console.log('adhoc-ok')\"",
  whitelist: ["npm test"],
  commandMode: "unrestricted",
  events,
  roomId: "room-1",
  initiatorId: "human-1",
  timeoutMs: 10_000
});
expect(result.output).toContain("adhoc-ok");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @simplercp/server test -- config.test.ts runner.test.ts`

Expected: FAIL because `commandMode` does not exist.

- [ ] **Step 3: Implement command mode**

Add `commandMode: "restricted" | "unrestricted"` to `ServerConfig`. Update `runWorkspaceCommand` to bypass whitelist only in unrestricted mode. Preserve timeout and workspace cwd.

- [ ] **Step 4: Add runtime config endpoint**

Wire:

```text
GET /api/config/runtime
```

Return:

```ts
{
  commandMode,
  commands,
  agentProvider,
  agentConfigured: Boolean(config.agent.apiKey) || config.agent.provider === "mock"
}
```

Do not return secrets.

- [ ] **Step 5: Run config/runner tests**

Run: `pnpm --filter @simplercp/server test -- config.test.ts runner.test.ts`

Expected: PASS.

---

### Task 5: Timeline And Built-In Scenario

**Files:**
- Modify: `apps/server/src/types.ts`
- Create: `apps/server/src/timeline.ts`
- Create: `apps/server/src/scenarios.ts`
- Modify: `apps/server/src/createApp.ts`
- Test: `apps/server/src/__tests__/timeline.test.ts`
- Test: `apps/server/src/__tests__/scenarios.test.ts`

- [ ] **Step 1: Write failing timeline tests**

Create `timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTimelineStore } from "../timeline.js";

describe("timeline store", () => {
  it("records readable timeline items", () => {
    const timeline = createTimelineStore();
    const item = timeline.append({
      roomId: "room-1",
      actorName: "bob",
      actorKind: "human",
      type: "chat",
      label: "bob asked MockAgent for help",
      status: "completed"
    });

    expect(timeline.list("room-1")).toEqual([item]);
  });
});
```

- [ ] **Step 2: Write failing scenario tests**

Create `scenarios.test.ts` with fixture workspace and assert running `observable-demo` creates timeline items containing chat, edit, command, and final success.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @simplercp/server test -- timeline.test.ts scenarios.test.ts`

Expected: FAIL because stores do not exist.

- [ ] **Step 4: Implement timeline store**

Add `append`, `list`, and optional `clearRoom`. Keep timeline in memory.

- [ ] **Step 5: Implement deterministic scenario service**

Add `listScenarios` and `runScenario`. The first scenario id is `observable-demo`. It should create participants, chat messages, timeline items, edit `src/hello.ts`, run `npm test`, and append final success/failure.

- [ ] **Step 6: Wire scenario/timeline endpoints**

Add:

```text
GET /api/scenarios
POST /api/scenarios/:scenarioId/run
GET /api/rooms/:roomId/timeline
```

- [ ] **Step 7: Run timeline/scenario tests**

Run: `pnpm --filter @simplercp/server test -- timeline.test.ts scenarios.test.ts`

Expected: PASS.

---

### Task 6: Client API And UI Projection

**Files:**
- Modify: `apps/client/src/types.ts`
- Modify: `apps/client/src/api.ts`
- Modify: `apps/client/src/socket.ts`
- Modify: `apps/client/src/App.tsx`
- Modify: `apps/client/src/components/CollaborationPanel.tsx`
- Modify: `apps/client/src/components/TerminalPanel.tsx`
- Modify: `apps/client/src/styles.css`

- [ ] **Step 1: Add client types and APIs**

Add types and API functions:

```ts
getRuntimeConfig()
getChatMessages(roomId)
sendChatMessage(roomId, input)
getAgentRuns(roomId)
getTimeline(roomId)
getScenarios()
runScenario(scenarioId)
```

- [ ] **Step 2: Use stable user id and connection id**

Use `localStorage` for `simplercp.userId` and `sessionStorage` for `simplercp.connectionId`. Pass both to `joinRoom`.

- [ ] **Step 3: Render people rows**

Update member rendering to use `displayName`, `connectionCount`, and status. Show `2 tabs` when applicable.

- [ ] **Step 4: Render chat transcript**

Add `data-testid="chat-transcript"` and show messages above the composer. Sending chat should call the HTTP endpoint, not only WebSocket `sendChat`.

- [ ] **Step 5: Render agent runs**

Add `data-testid="agent-runs"` and show status/last action.

- [ ] **Step 6: Render terminal modes**

Restricted mode keeps command selector. Unrestricted mode shows command input with `data-testid="command-input"`. Always show `data-testid="command-mode"`.

- [ ] **Step 7: Render scenario and timeline controls**

Add:

```text
data-testid="scenario-select"
data-testid="run-scenario"
data-testid="timeline-list"
data-testid="timeline-reset"
```

The timeline can be a compact list in the right panel below activity or in a new section.

- [ ] **Step 8: Run client build**

Run: `pnpm --filter @simplercp/client build`

Expected: PASS.

---

### Task 7: E2E, Watchability Artifact, README

**Files:**
- Modify: `tests/playwright.config.ts` if needed for command mode env.
- Modify: `tests/e2e/collaboration.spec.ts`
- Create: `tests/e2e/observable.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Add E2E tests for observable loop**

Create `observable.spec.ts` covering:

- Same browser/person reopens as `bob` without indistinguishable duplicate rows.
- Two tabs for same user show one person with `2 tabs`.
- Human chat message appears in both browsers.
- `@MockAgent` message appears in transcript and triggers visible agent status.
- Built-in scenario can be started and produces timeline entries for chat, edit, command, and final success.

- [ ] **Step 2: Add unrestricted terminal E2E**

If Playwright config cannot easily run two server modes in one file, create a separate test project or a test that uses server runtime config. The assertion should prove `SIMPLERCP_COMMAND_MODE=unrestricted` allows an ad hoc command from the UI.

- [ ] **Step 3: Save watchability artifacts**

At the end of the scenario E2E, write:

```ts
await page.screenshot({ path: "artifacts/observable-final.png", fullPage: true });
const timeline = await page.evaluate(async () => (await fetch("/api/rooms/<roomId>/timeline")).json());
```

Use the actual room id from health/config in the test. Save timeline JSON to `artifacts/observable-timeline.json`.

- [ ] **Step 4: Update README**

Document:

- Person vs tab identity.
- Chat transcript.
- Agent mentions.
- Agent status.
- Terminal command modes.
- Scenario runner.
- Timeline/replay.
- Unrestricted mode warning.

- [ ] **Step 5: Run full verification**

Run:

```bash
pnpm test && pnpm run test:collab && pnpm build
```

Expected: PASS.

---

## Self-Review Checklist

- Every success criterion from the Iteration 3 spec maps to a task above.
- The plan preserves MockAgent as the no-key deterministic path.
- Unrestricted command execution is opt-in and documented.
- Chat is a transcript, not just event names.
- Timeline makes scenario execution visible in the UI.
- E2E verifies the visible collaboration loop and produces artifacts.
