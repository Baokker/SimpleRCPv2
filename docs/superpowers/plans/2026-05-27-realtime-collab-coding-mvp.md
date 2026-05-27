# Realtime Collaborative Coding MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first vertical MVP of SimpleRCPv2: a local web collaboration IDE where two browser users can join one project room, browse/edit real workspace files, see presence, create an agent task, let a mock agent edit an authorized file, run an authorized command, and verify the flow with automated collaboration tests.

**Architecture:** Use a TypeScript monorepo with a Vite React client and an Express/WebSocket Node server. Keep collaboration, workspace, runner, task authorization, event log, and agent runtime as separate server modules, with a deterministic mock agent provider for tests and future OpenAI-compatible providers behind the same interface.

**Tech Stack:** TypeScript, pnpm workspaces, React, Vite, Monaco Editor, Express, ws, chokidar-free filesystem APIs, Vitest, Playwright, child_process runner.

---

## File Structure

Create this repository structure:

```text
.
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
├── apps
│   ├── client
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   └── src
│   │       ├── App.tsx
│   │       ├── main.tsx
│   │       ├── styles.css
│   │       ├── api.ts
│   │       ├── socket.ts
│   │       ├── types.ts
│   │       └── components
│   │           ├── WorkspaceExplorer.tsx
│   │           ├── EditorArea.tsx
│   │           ├── CollaborationPanel.tsx
│   │           └── TerminalPanel.tsx
│   └── server
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src
│           ├── index.ts
│           ├── createApp.ts
│           ├── config.ts
│           ├── types.ts
│           ├── eventLog.ts
│           ├── rooms.ts
│           ├── realtime.ts
│           ├── workspace.ts
│           ├── runner.ts
│           ├── tasks.ts
│           ├── agents
│           │   ├── types.ts
│           │   ├── mockAgent.ts
│           │   └── runtime.ts
│           └── __tests__
│               ├── workspace.test.ts
│               ├── runner.test.ts
│               ├── tasks.test.ts
│               └── mockAgent.test.ts
├── tests
│   ├── fixtures
│   │   └── sample-workspace
│   │       ├── package.json
│   │       ├── src
│   │       │   └── hello.ts
│   │       └── tests
│   │           └── hello.test.ts
│   ├── e2e
│   │   ├── collaboration.spec.ts
│   │   └── helpers.ts
│   └── playwright.config.ts
└── docs
    └── superpowers
        ├── specs
        │   └── 2026-05-27-realtime-collab-coding-design.md
        └── plans
            └── 2026-05-27-realtime-collab-coding-mvp.md
```

Responsibilities:

- `apps/server/src/workspace.ts`: safe file tree, read, and write under a workspace root.
- `apps/server/src/eventLog.ts`: append-only structured in-memory event log for tests and UI.
- `apps/server/src/rooms.ts`: room/member/presence/task/run state.
- `apps/server/src/realtime.ts`: WebSocket message parsing, broadcasting, and event routing.
- `apps/server/src/runner.ts`: whitelisted local command execution with streaming events.
- `apps/server/src/tasks.ts`: task creation, authorization checks, approval requests.
- `apps/server/src/agents/runtime.ts`: provider-neutral agent execution entry point.
- `apps/server/src/agents/mockAgent.ts`: deterministic mock agent that edits `src/hello.ts`, runs `npm test`, and reports.
- `apps/client/src/App.tsx`: main four-pane UI shell.
- `apps/client/src/api.ts`: REST calls for workspace/task/event endpoints.
- `apps/client/src/socket.ts`: WebSocket client wrapper.
- `tests/e2e/collaboration.spec.ts`: Playwright multi-context collaboration simulation.

---

### Task 1: Scaffold The TypeScript Monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `apps/client/package.json`
- Create: `apps/client/tsconfig.json`
- Create: `apps/client/vite.config.ts`
- Create: `apps/client/index.html`
- Create: `apps/client/src/main.tsx`
- Create: `apps/client/src/App.tsx`
- Create: `apps/client/src/styles.css`
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/vitest.config.ts`
- Create: `apps/server/src/index.ts`
- Create: `apps/server/src/createApp.ts`
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/__tests__/config.test.ts`

- [ ] **Step 1: Create root package configuration**

Create `package.json`:

```json
{
  "name": "simple-rcp-v2",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm --parallel --filter @simplercp/server --filter @simplercp/client dev",
    "dev:server": "pnpm --filter @simplercp/server dev",
    "dev:client": "pnpm --filter @simplercp/client dev",
    "build": "pnpm -r build",
    "test": "pnpm --filter @simplercp/server test",
    "test:e2e": "playwright test --config tests/playwright.config.ts",
    "test:collab": "playwright test --config tests/playwright.config.ts tests/e2e/collaboration.spec.ts"
  },
  "devDependencies": {
    "@playwright/test": "^1.44.0",
    "typescript": "^5.4.0"
  },
  "packageManager": "pnpm@9.0.0"
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true
  }
}
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
playwright-report/
test-results/
.env
.DS_Store
.superpowers/
```

- [ ] **Step 2: Create client package shell**

Create `apps/client/package.json`:

```json
{
  "name": "@simplercp/client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5173",
    "build": "tsc -p tsconfig.json && vite build",
    "preview": "vite preview --host 127.0.0.1 --port 5173"
  },
  "dependencies": {
    "@monaco-editor/react": "^4.6.0",
    "@vitejs/plugin-react": "^4.2.0",
    "lucide-react": "^0.468.0",
    "monaco-editor": "^0.49.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "vite": "^5.2.0"
  }
}
```

Create `apps/client/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src", "vite.config.ts"]
}
```

Create `apps/client/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4000",
      "/ws": {
        target: "ws://127.0.0.1:4000",
        ws: true
      }
    }
  }
});
```

Create `apps/client/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SimpleRCPv2</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `apps/client/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `apps/client/src/App.tsx`:

```tsx
export function App() {
  return (
    <main className="app-shell">
      <aside className="workspace-pane">Workspace</aside>
      <section className="editor-pane">Editor</section>
      <aside className="collab-pane">Collaboration</aside>
      <section className="terminal-pane">Terminal</section>
    </main>
  );
}
```

Create `apps/client/src/styles.css`:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
  background: #10131a;
  color: #edf1f7;
}

.app-shell {
  display: grid;
  grid-template-columns: 280px minmax(420px, 1fr) 340px;
  grid-template-rows: minmax(0, 1fr) 220px;
  height: 100vh;
}

.workspace-pane,
.editor-pane,
.collab-pane,
.terminal-pane {
  min-width: 0;
  min-height: 0;
  border-color: #2b3240;
  border-style: solid;
}

.workspace-pane {
  grid-row: 1 / 3;
  border-width: 0 1px 0 0;
}

.editor-pane {
  border-width: 0 1px 1px 0;
}

.collab-pane {
  grid-row: 1 / 3;
  border-width: 0;
}

.terminal-pane {
  border-width: 0 1px 0 0;
}
```

- [ ] **Step 3: Create server package shell**

Create `apps/server/package.json`:

```json
{
  "name": "@simplercp/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.3",
    "nanoid": "^5.0.0",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "@types/ws": "^8.5.10",
    "tsx": "^4.7.0",
    "vitest": "^1.4.0"
  }
}
```

Create `apps/server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "outDir": "dist",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src"]
}
```

Create `apps/server/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
```

Create `apps/server/src/config.ts`:

```ts
import path from "node:path";

export interface ServerConfig {
  port: number;
  workspaceRoot: string;
  commandWhitelist: string[];
}

export function loadConfig(env = process.env): ServerConfig {
  const workspaceRoot = path.resolve(
    env.SIMPLERCP_WORKSPACE ?? process.cwd()
  );

  return {
    port: Number(env.PORT ?? 4000),
    workspaceRoot,
    commandWhitelist: (env.SIMPLERCP_COMMANDS ?? "npm test,npm run build")
      .split(",")
      .map((command) => command.trim())
      .filter(Boolean)
  };
}
```

Create `apps/server/src/createApp.ts`:

```ts
import cors from "cors";
import express from "express";
import type { ServerConfig } from "./config.js";

export function createApp(config: ServerConfig) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      workspaceRoot: config.workspaceRoot
    });
  });

  return app;
}
```

Create `apps/server/src/index.ts`:

```ts
import http from "node:http";
import { createApp } from "./createApp.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp(config);
const server = http.createServer(app);

server.listen(config.port, "127.0.0.1", () => {
  console.log(
    `SimpleRCPv2 server listening on http://127.0.0.1:${config.port}`
  );
  console.log(`Workspace root: ${config.workspaceRoot}`);
});
```

- [ ] **Step 4: Add an initial server smoke test**

Create `apps/server/src/__tests__/config.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("server config", () => {
  it("loads workspace, port, and command whitelist from environment", () => {
    const config = loadConfig({
      PORT: "4500",
      SIMPLERCP_WORKSPACE: "tests/fixtures/sample-workspace",
      SIMPLERCP_COMMANDS: "npm test,pnpm test"
    });

    expect(config).toEqual({
      port: 4500,
      workspaceRoot: path.resolve("tests/fixtures/sample-workspace"),
      commandWhitelist: ["npm test", "pnpm test"]
    });
  });
});
```

- [ ] **Step 5: Install dependencies**

Run:

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` is created and install exits successfully.

- [ ] **Step 6: Verify the scaffold builds**

Run:

```bash
pnpm build
pnpm test
```

Expected: client and server TypeScript builds pass; the config smoke test passes.

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json apps
git commit -m "chore: scaffold realtime collaboration monorepo"
```

---

### Task 2: Add Workspace Service With Safe File Operations

**Files:**
- Create: `apps/server/src/types.ts`
- Create: `apps/server/src/workspace.ts`
- Create: `apps/server/src/__tests__/workspace.test.ts`
- Modify: `apps/server/src/createApp.ts`

- [ ] **Step 1: Write failing workspace service tests**

Create `apps/server/src/__tests__/workspace.test.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listWorkspaceTree,
  readWorkspaceFile,
  resolveWorkspacePath,
  writeWorkspaceFile
} from "../workspace.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "simplercp-workspace-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "hello.ts"), "export const hello = 'world';\n");
  await fs.writeFile(path.join(root, "README.md"), "# Sample\n");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("workspace service", () => {
  it("resolves paths inside the workspace root", () => {
    expect(resolveWorkspacePath(root, "src/hello.ts")).toBe(
      path.join(root, "src", "hello.ts")
    );
  });

  it("rejects path traversal outside the workspace root", () => {
    expect(() => resolveWorkspacePath(root, "../secret.txt")).toThrow(
      "Path escapes workspace root"
    );
  });

  it("lists nested files and directories", async () => {
    await expect(listWorkspaceTree(root)).resolves.toEqual([
      {
        name: "README.md",
        path: "README.md",
        type: "file"
      },
      {
        name: "src",
        path: "src",
        type: "directory",
        children: [
          {
            name: "hello.ts",
            path: "src/hello.ts",
            type: "file"
          }
        ]
      }
    ]);
  });

  it("reads and writes files under the root", async () => {
    await expect(readWorkspaceFile(root, "src/hello.ts")).resolves.toBe(
      "export const hello = 'world';\n"
    );

    await writeWorkspaceFile(root, "src/hello.ts", "export const hello = 'team';\n");

    await expect(readWorkspaceFile(root, "src/hello.ts")).resolves.toBe(
      "export const hello = 'team';\n"
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @simplercp/server test -- workspace
```

Expected: FAIL because `apps/server/src/workspace.ts` does not exist.

- [ ] **Step 3: Implement workspace types and service**

Create `apps/server/src/types.ts`:

```ts
export interface WorkspaceFileNode {
  name: string;
  path: string;
  type: "file";
}

export interface WorkspaceDirectoryNode {
  name: string;
  path: string;
  type: "directory";
  children: WorkspaceNode[];
}

export type WorkspaceNode = WorkspaceFileNode | WorkspaceDirectoryNode;
```

Create `apps/server/src/workspace.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceNode } from "./types.js";

const IGNORED_NAMES = new Set([".git", "node_modules", "dist", "coverage"]);

export function resolveWorkspacePath(root: string, relativePath: string) {
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, candidate);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes workspace root");
  }

  return candidate;
}

export async function listWorkspaceTree(root: string): Promise<WorkspaceNode[]> {
  return listDirectory(root, "");
}

async function listDirectory(root: string, relativeDir: string): Promise<WorkspaceNode[]> {
  const absoluteDir = resolveWorkspacePath(root, relativeDir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const nodes = await Promise.all(
    entries
      .filter((entry) => !IGNORED_NAMES.has(entry.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) {
          return a.isDirectory() ? 1 : -1;
        }
        return a.name.localeCompare(b.name);
      })
      .map(async (entry): Promise<WorkspaceNode> => {
        const childRelativePath = relativeDir
          ? path.posix.join(relativeDir, entry.name)
          : entry.name;

        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: childRelativePath,
            type: "directory",
            children: await listDirectory(root, childRelativePath)
          };
        }

        return {
          name: entry.name,
          path: childRelativePath,
          type: "file"
        };
      })
  );

  return nodes;
}

export async function readWorkspaceFile(root: string, relativePath: string) {
  return fs.readFile(resolveWorkspacePath(root, relativePath), "utf8");
}

export async function writeWorkspaceFile(
  root: string,
  relativePath: string,
  content: string
) {
  const absolutePath = resolveWorkspacePath(root, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
}
```

- [ ] **Step 4: Add workspace REST endpoints**

Modify `apps/server/src/createApp.ts`:

```ts
import cors from "cors";
import express from "express";
import type { ServerConfig } from "./config.js";
import {
  listWorkspaceTree,
  readWorkspaceFile,
  writeWorkspaceFile
} from "./workspace.js";

export function createApp(config: ServerConfig) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      workspaceRoot: config.workspaceRoot
    });
  });

  app.get("/api/workspace/tree", async (_req, res, next) => {
    try {
      res.json({ tree: await listWorkspaceTree(config.workspaceRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/workspace/file", async (req, res, next) => {
    try {
      const filePath = String(req.query.path ?? "");
      res.json({ path: filePath, content: await readWorkspaceFile(config.workspaceRoot, filePath) });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/workspace/file", async (req, res, next) => {
    try {
      const { path, content } = req.body as { path?: string; content?: string };
      if (!path || typeof content !== "string") {
        res.status(400).json({ error: "path and content are required" });
        return;
      }

      await writeWorkspaceFile(config.workspaceRoot, path, content);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: error.message });
  });

  return app;
}
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
pnpm --filter @simplercp/server test -- workspace
pnpm build
```

Expected: workspace tests pass and TypeScript builds.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src
git commit -m "feat: add safe workspace file service"
```

---

### Task 3: Add Event Log And Room State

**Files:**
- Create: `apps/server/src/eventLog.ts`
- Create: `apps/server/src/rooms.ts`
- Create: `apps/server/src/__tests__/rooms.test.ts`
- Modify: `apps/server/src/types.ts`
- Modify: `apps/server/src/createApp.ts`

- [ ] **Step 1: Write failing room/event tests**

Create `apps/server/src/__tests__/rooms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createEventLog } from "../eventLog.js";
import { createRoomStore } from "../rooms.js";

describe("room store", () => {
  it("creates a room and logs room creation", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);

    const room = rooms.createRoom("sample-workspace");

    expect(room.workspaceName).toBe("sample-workspace");
    expect(events.list()).toMatchObject([
      {
        type: "room_created",
        roomId: room.id
      }
    ]);
  });

  it("joins members and updates presence", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("sample-workspace");
    const member = rooms.joinRoom(room.id, "Ada", "human");

    rooms.updatePresence(room.id, member.id, { currentFile: "src/hello.ts" });

    expect(rooms.getRoom(room.id)?.members[0]).toMatchObject({
      id: member.id,
      name: "Ada",
      kind: "human",
      currentFile: "src/hello.ts"
    });
    expect(events.list().map((event) => event.type)).toEqual([
      "room_created",
      "member_joined",
      "presence_updated"
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @simplercp/server test -- rooms
```

Expected: FAIL because `eventLog.ts` and `rooms.ts` do not exist.

- [ ] **Step 3: Add event and room types**

Modify `apps/server/src/types.ts`:

```ts
export interface WorkspaceFileNode {
  name: string;
  path: string;
  type: "file";
}

export interface WorkspaceDirectoryNode {
  name: string;
  path: string;
  type: "directory";
  children: WorkspaceNode[];
}

export type WorkspaceNode = WorkspaceFileNode | WorkspaceDirectoryNode;

export type MemberKind = "human" | "agent";

export interface RoomMember {
  id: string;
  name: string;
  kind: MemberKind;
  currentFile?: string;
}

export interface RoomState {
  id: string;
  workspaceName: string;
  members: RoomMember[];
}

export interface EventRecord {
  id: string;
  type: string;
  roomId?: string;
  memberId?: string;
  taskId?: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}
```

- [ ] **Step 4: Implement event log**

Create `apps/server/src/eventLog.ts`:

```ts
import { nanoid } from "nanoid";
import type { EventRecord } from "./types.js";

export interface EventInput {
  type: string;
  roomId?: string;
  memberId?: string;
  taskId?: string;
  payload?: Record<string, unknown>;
}

export function createEventLog() {
  const events: EventRecord[] = [];

  return {
    append(input: EventInput) {
      const event: EventRecord = {
        id: nanoid(),
        timestamp: new Date().toISOString(),
        ...input
      };
      events.push(event);
      return event;
    },
    list() {
      return [...events];
    }
  };
}

export type EventLog = ReturnType<typeof createEventLog>;
```

- [ ] **Step 5: Implement room store**

Create `apps/server/src/rooms.ts`:

```ts
import path from "node:path";
import { nanoid } from "nanoid";
import type { EventLog } from "./eventLog.js";
import type { MemberKind, RoomMember, RoomState } from "./types.js";

export function createRoomStore(events: EventLog) {
  const rooms = new Map<string, RoomState>();

  return {
    createRoom(workspaceRoot: string) {
      const room: RoomState = {
        id: nanoid(10),
        workspaceName: path.basename(workspaceRoot),
        members: []
      };
      rooms.set(room.id, room);
      events.append({
        type: "room_created",
        roomId: room.id,
        payload: { workspaceName: room.workspaceName }
      });
      return room;
    },
    getRoom(roomId: string) {
      return rooms.get(roomId);
    },
    joinRoom(roomId: string, name: string, kind: MemberKind) {
      const room = rooms.get(roomId);
      if (!room) {
        throw new Error("Room not found");
      }

      const member: RoomMember = {
        id: nanoid(10),
        name,
        kind
      };
      room.members.push(member);
      events.append({
        type: "member_joined",
        roomId,
        memberId: member.id,
        payload: { name, kind }
      });
      return member;
    },
    updatePresence(roomId: string, memberId: string, patch: Pick<RoomMember, "currentFile">) {
      const room = rooms.get(roomId);
      if (!room) {
        throw new Error("Room not found");
      }
      const member = room.members.find((candidate) => candidate.id === memberId);
      if (!member) {
        throw new Error("Member not found");
      }

      Object.assign(member, patch);
      events.append({
        type: "presence_updated",
        roomId,
        memberId,
        payload: patch
      });
      return member;
    },
    listRooms() {
      return [...rooms.values()];
    }
  };
}

export type RoomStore = ReturnType<typeof createRoomStore>;
```

- [ ] **Step 6: Expose room and event endpoints**

Modify `apps/server/src/createApp.ts` to create shared stores and add endpoints:

```ts
import cors from "cors";
import express from "express";
import type { ServerConfig } from "./config.js";
import { createEventLog } from "./eventLog.js";
import { createRoomStore } from "./rooms.js";
import {
  listWorkspaceTree,
  readWorkspaceFile,
  writeWorkspaceFile
} from "./workspace.js";

export function createApp(config: ServerConfig) {
  const app = express();
  const events = createEventLog();
  const rooms = createRoomStore(events);
  const defaultRoom = rooms.createRoom(config.workspaceRoot);

  app.locals.events = events;
  app.locals.rooms = rooms;
  app.locals.defaultRoom = defaultRoom;

  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      workspaceRoot: config.workspaceRoot,
      roomId: defaultRoom.id
    });
  });

  app.get("/api/rooms/:roomId", (req, res, next) => {
    try {
      const room = rooms.getRoom(req.params.roomId);
      if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
      }
      res.json({ room });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rooms/:roomId/members", (req, res, next) => {
    try {
      const { name, kind } = req.body as { name?: string; kind?: "human" | "agent" };
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      res.json({ member: rooms.joinRoom(req.params.roomId, name, kind ?? "human") });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/events", (_req, res) => {
    res.json({ events: events.list() });
  });

  app.get("/api/workspace/tree", async (_req, res, next) => {
    try {
      res.json({ tree: await listWorkspaceTree(config.workspaceRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/workspace/file", async (req, res, next) => {
    try {
      const filePath = String(req.query.path ?? "");
      res.json({ path: filePath, content: await readWorkspaceFile(config.workspaceRoot, filePath) });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/workspace/file", async (req, res, next) => {
    try {
      const { path, content } = req.body as { path?: string; content?: string };
      if (!path || typeof content !== "string") {
        res.status(400).json({ error: "path and content are required" });
        return;
      }

      await writeWorkspaceFile(config.workspaceRoot, path, content);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: error.message });
  });

  return app;
}
```

- [ ] **Step 7: Run tests and build**

Run:

```bash
pnpm --filter @simplercp/server test -- rooms
pnpm --filter @simplercp/server test
pnpm build
```

Expected: all server tests pass and TypeScript builds.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src
git commit -m "feat: add room state and event log"
```

---

### Task 4: Add WebSocket Realtime Channel

**Files:**
- Create: `apps/server/src/realtime.ts`
- Create: `apps/server/src/__tests__/realtime.test.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/types.ts`
- Modify: `apps/server/src/createApp.ts`

- [ ] **Step 1: Write failing message reducer tests**

Create `apps/server/src/__tests__/realtime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createEventLog } from "../eventLog.js";
import { createRoomStore } from "../rooms.js";
import { handleRealtimeMessage } from "../realtime.js";

describe("realtime message handling", () => {
  it("updates presence on open_file messages", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("workspace");
    const member = rooms.joinRoom(room.id, "Ada", "human");

    const result = handleRealtimeMessage({
      events,
      rooms,
      message: {
        type: "open_file",
        roomId: room.id,
        memberId: member.id,
        path: "src/hello.ts"
      }
    });

    expect(result.broadcast).toMatchObject({
      type: "presence",
      roomId: room.id,
      members: [{ currentFile: "src/hello.ts" }]
    });
    expect(events.list().map((event) => event.type)).toContain("file_opened");
  });

  it("records file change events", () => {
    const events = createEventLog();
    const rooms = createRoomStore(events);
    const room = rooms.createRoom("workspace");
    const member = rooms.joinRoom(room.id, "Ada", "human");

    const result = handleRealtimeMessage({
      events,
      rooms,
      message: {
        type: "file_change",
        roomId: room.id,
        memberId: member.id,
        path: "src/hello.ts",
        content: "updated"
      }
    });

    expect(result.broadcast).toMatchObject({
      type: "file_change",
      path: "src/hello.ts",
      content: "updated"
    });
    expect(events.list().map((event) => event.type)).toContain("file_changed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @simplercp/server test -- realtime
```

Expected: FAIL because `realtime.ts` does not exist.

- [ ] **Step 3: Add realtime message types**

Modify `apps/server/src/types.ts` by appending:

```ts
export type ClientMessage =
  | {
      type: "open_file";
      roomId: string;
      memberId: string;
      path: string;
    }
  | {
      type: "file_change";
      roomId: string;
      memberId: string;
      path: string;
      content: string;
    }
  | {
      type: "chat_message";
      roomId: string;
      memberId: string;
      text: string;
    };

export type ServerMessage =
  | {
      type: "presence";
      roomId: string;
      members: RoomMember[];
    }
  | {
      type: "file_change";
      roomId: string;
      memberId: string;
      path: string;
      content: string;
    }
  | {
      type: "chat_message";
      roomId: string;
      memberId: string;
      text: string;
    }
  | {
      type: "event";
      event: EventRecord;
    };
```

- [ ] **Step 4: Implement realtime reducer and WebSocket server**

Create `apps/server/src/realtime.ts`:

```ts
import type http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { EventLog } from "./eventLog.js";
import type { RoomStore } from "./rooms.js";
import type { ClientMessage, ServerMessage } from "./types.js";

export interface RealtimeContext {
  events: EventLog;
  rooms: RoomStore;
}

export function handleRealtimeMessage({
  events,
  rooms,
  message
}: RealtimeContext & { message: ClientMessage }): { broadcast: ServerMessage } {
  if (message.type === "open_file") {
    rooms.updatePresence(message.roomId, message.memberId, {
      currentFile: message.path
    });
    events.append({
      type: "file_opened",
      roomId: message.roomId,
      memberId: message.memberId,
      payload: { path: message.path }
    });
    return {
      broadcast: {
        type: "presence",
        roomId: message.roomId,
        members: rooms.getRoom(message.roomId)?.members ?? []
      }
    };
  }

  if (message.type === "file_change") {
    events.append({
      type: "file_changed",
      roomId: message.roomId,
      memberId: message.memberId,
      payload: { path: message.path }
    });
    return {
      broadcast: {
        type: "file_change",
        roomId: message.roomId,
        memberId: message.memberId,
        path: message.path,
        content: message.content
      }
    };
  }

  events.append({
    type: "chat_message",
    roomId: message.roomId,
    memberId: message.memberId,
    payload: { text: message.text }
  });

  return {
    broadcast: {
      type: "chat_message",
      roomId: message.roomId,
      memberId: message.memberId,
      text: message.text
    }
  };
}

export function attachRealtimeServer(
  server: http.Server,
  context: RealtimeContext
) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const sockets = new Set<WebSocket>();

  wss.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", (data) => {
      const parsed = JSON.parse(data.toString()) as ClientMessage;
      const { broadcast } = handleRealtimeMessage({
        ...context,
        message: parsed
      });
      broadcastToAll(sockets, broadcast);
    });
  });

  return wss;
}

function broadcastToAll(sockets: Set<WebSocket>, message: ServerMessage) {
  const payload = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}
```

- [ ] **Step 5: Expose shared stores from the app for WebSocket attachment**

Modify `apps/server/src/createApp.ts` so after creating `events` and `rooms`, it assigns:

```ts
  app.locals.events = events;
  app.locals.rooms = rooms;
```

Keep the rest of the file from Task 3 unchanged.

Modify `apps/server/src/index.ts`:

```ts
import http from "node:http";
import { createApp } from "./createApp.js";
import { loadConfig } from "./config.js";
import { attachRealtimeServer } from "./realtime.js";

const config = loadConfig();
const app = createApp(config);
const server = http.createServer(app);

attachRealtimeServer(server, {
  events: app.locals.events,
  rooms: app.locals.rooms
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(
    `SimpleRCPv2 server listening on http://127.0.0.1:${config.port}`
  );
  console.log(`Workspace root: ${config.workspaceRoot}`);
});
```

- [ ] **Step 6: Run tests and build**

Run:

```bash
pnpm --filter @simplercp/server test -- realtime
pnpm --filter @simplercp/server test
pnpm build
```

Expected: realtime tests pass, all server tests pass, and build passes.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src
git commit -m "feat: add realtime room websocket channel"
```

---

### Task 5: Build Client Workspace, Presence, And Editor UI

**Files:**
- Create: `apps/client/src/types.ts`
- Create: `apps/client/src/api.ts`
- Create: `apps/client/src/socket.ts`
- Create: `apps/client/src/components/WorkspaceExplorer.tsx`
- Create: `apps/client/src/components/EditorArea.tsx`
- Create: `apps/client/src/components/CollaborationPanel.tsx`
- Create: `apps/client/src/components/TerminalPanel.tsx`
- Modify: `apps/client/src/App.tsx`
- Modify: `apps/client/src/styles.css`

- [ ] **Step 1: Add shared client types**

Create `apps/client/src/types.ts`:

```ts
export interface WorkspaceFileNode {
  name: string;
  path: string;
  type: "file";
}

export interface WorkspaceDirectoryNode {
  name: string;
  path: string;
  type: "directory";
  children: WorkspaceNode[];
}

export type WorkspaceNode = WorkspaceFileNode | WorkspaceDirectoryNode;

export interface RoomMember {
  id: string;
  name: string;
  kind: "human" | "agent";
  currentFile?: string;
}

export interface RoomState {
  id: string;
  workspaceName: string;
  members: RoomMember[];
}

export interface EventRecord {
  id: string;
  type: string;
  roomId?: string;
  memberId?: string;
  taskId?: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export type ServerMessage =
  | {
      type: "presence";
      roomId: string;
      members: RoomMember[];
    }
  | {
      type: "file_change";
      roomId: string;
      memberId: string;
      path: string;
      content: string;
    }
  | {
      type: "chat_message";
      roomId: string;
      memberId: string;
      text: string;
    };
```

- [ ] **Step 2: Add API client helpers**

Create `apps/client/src/api.ts`:

```ts
import type { EventRecord, RoomMember, RoomState, WorkspaceNode } from "./types";

export async function getHealth(): Promise<{ ok: true; workspaceRoot: string; roomId: string }> {
  return request("/api/health");
}

export async function getRoom(roomId: string): Promise<RoomState> {
  const response = await request<{ room: RoomState }>(`/api/rooms/${roomId}`);
  return response.room;
}

export async function joinRoom(
  roomId: string,
  name: string,
  kind: "human" | "agent" = "human"
): Promise<RoomMember> {
  const response = await request<{ member: RoomMember }>(`/api/rooms/${roomId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, kind })
  });
  return response.member;
}

export async function getWorkspaceTree(): Promise<WorkspaceNode[]> {
  const response = await request<{ tree: WorkspaceNode[] }>("/api/workspace/tree");
  return response.tree;
}

export async function readWorkspaceFile(path: string): Promise<string> {
  const response = await request<{ content: string }>(
    `/api/workspace/file?path=${encodeURIComponent(path)}`
  );
  return response.content;
}

export async function writeWorkspaceFile(path: string, content: string) {
  await request("/api/workspace/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content })
  });
}

export async function getEvents(): Promise<EventRecord[]> {
  const response = await request<{ events: EventRecord[] }>("/api/events");
  return response.events;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}
```

- [ ] **Step 3: Add WebSocket client helper**

Create `apps/client/src/socket.ts`:

```ts
import type { ServerMessage } from "./types";

export interface ClientSocket {
  sendOpenFile(path: string): void;
  sendFileChange(path: string, content: string): void;
  sendChat(text: string): void;
  close(): void;
}

export function connectRoomSocket({
  roomId,
  memberId,
  onMessage
}: {
  roomId: string;
  memberId: string;
  onMessage(message: ServerMessage): void;
}): ClientSocket {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
  socket.addEventListener("message", (event) => {
    onMessage(JSON.parse(event.data) as ServerMessage);
  });

  function send(message: Record<string, unknown>) {
    const payload = JSON.stringify({ roomId, memberId, ...message });
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    } else {
      socket.addEventListener("open", () => socket.send(payload), { once: true });
    }
  }

  return {
    sendOpenFile(path) {
      send({ type: "open_file", path });
    },
    sendFileChange(path, content) {
      send({ type: "file_change", path, content });
    },
    sendChat(text) {
      send({ type: "chat_message", text });
    },
    close() {
      socket.close();
    }
  };
}
```

- [ ] **Step 4: Add workspace explorer component**

Create `apps/client/src/components/WorkspaceExplorer.tsx`:

```tsx
import type { WorkspaceNode } from "../types";

export function WorkspaceExplorer({
  tree,
  activePath,
  onOpenFile
}: {
  tree: WorkspaceNode[];
  activePath?: string;
  onOpenFile(path: string): void;
}) {
  return (
    <div className="panel">
      <div className="panel-header">Workspace</div>
      <div className="tree" data-testid="workspace-tree">
        {tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            activePath={activePath}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  activePath,
  onOpenFile
}: {
  node: WorkspaceNode;
  activePath?: string;
  onOpenFile(path: string): void;
}) {
  if (node.type === "directory") {
    return (
      <details open className="tree-directory">
        <summary>{node.name}</summary>
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              activePath={activePath}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      </details>
    );
  }

  return (
    <button
      className={node.path === activePath ? "tree-file active" : "tree-file"}
      onClick={() => onOpenFile(node.path)}
      data-testid={`file-${node.path}`}
    >
      {node.name}
    </button>
  );
}
```

- [ ] **Step 5: Add editor component**

Create `apps/client/src/components/EditorArea.tsx`:

```tsx
import Editor from "@monaco-editor/react";

export interface OpenFile {
  path: string;
  content: string;
}

export function EditorArea({
  openFiles,
  activePath,
  onSelectFile,
  onChangeFile
}: {
  openFiles: OpenFile[];
  activePath?: string;
  onSelectFile(path: string): void;
  onChangeFile(path: string, content: string): void;
}) {
  const activeFile = openFiles.find((file) => file.path === activePath);

  return (
    <div className="editor-area">
      <div className="tabs" data-testid="editor-tabs">
        {openFiles.map((file) => (
          <button
            key={file.path}
            className={file.path === activePath ? "tab active" : "tab"}
            onClick={() => onSelectFile(file.path)}
          >
            {file.path}
          </button>
        ))}
      </div>
      <div className="editor-frame" data-testid="editor-frame">
        {activeFile ? (
          <Editor
            path={activeFile.path}
            value={activeFile.content}
            language={languageForPath(activeFile.path)}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              wordWrap: "on",
              scrollBeyondLastLine: false
            }}
            onChange={(value) => onChangeFile(activeFile.path, value ?? "")}
          />
        ) : (
          <div className="empty-state">Open a file to start collaborating.</div>
        )}
      </div>
    </div>
  );
}

function languageForPath(path: string) {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  return "plaintext";
}
```

- [ ] **Step 6: Add collaboration and terminal panels**

Create `apps/client/src/components/CollaborationPanel.tsx`:

```tsx
import type { EventRecord, RoomMember } from "../types";

export function CollaborationPanel({
  members,
  events,
  chatText,
  onChatTextChange,
  onSendChat
}: {
  members: RoomMember[];
  events: EventRecord[];
  chatText: string;
  onChatTextChange(value: string): void;
  onSendChat(): void;
}) {
  return (
    <div className="panel collab-panel">
      <div className="panel-header">Collaboration</div>
      <section>
        <h2>Members</h2>
        <ul className="member-list" data-testid="member-list">
          {members.map((member) => (
            <li key={member.id}>
              <span>{member.name}</span>
              <small>{member.currentFile ?? "Browsing"}</small>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Activity</h2>
        <ol className="event-list" data-testid="event-list">
          {events.slice(-12).map((event) => (
            <li key={event.id}>{event.type}</li>
          ))}
        </ol>
      </section>
      <section className="chat-box">
        <h2>Chat</h2>
        <textarea
          value={chatText}
          onChange={(event) => onChatTextChange(event.target.value)}
          placeholder="@MockAgent help with this task"
          data-testid="chat-input"
        />
        <button onClick={onSendChat} data-testid="send-chat">
          Send
        </button>
      </section>
    </div>
  );
}
```

Create `apps/client/src/components/TerminalPanel.tsx`:

```tsx
export function TerminalPanel({ lines }: { lines: string[] }) {
  return (
    <div className="panel terminal-panel">
      <div className="panel-header">Terminal / Tests</div>
      <pre data-testid="terminal-output">
        {lines.length > 0 ? lines.join("\n") : "No command output yet."}
      </pre>
    </div>
  );
}
```

- [ ] **Step 7: Wire the app state**

Modify `apps/client/src/App.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import {
  getEvents,
  getHealth,
  getRoom,
  getWorkspaceTree,
  joinRoom,
  readWorkspaceFile,
  writeWorkspaceFile
} from "./api";
import { CollaborationPanel } from "./components/CollaborationPanel";
import { EditorArea, type OpenFile } from "./components/EditorArea";
import { TerminalPanel } from "./components/TerminalPanel";
import { WorkspaceExplorer } from "./components/WorkspaceExplorer";
import { connectRoomSocket, type ClientSocket } from "./socket";
import type { EventRecord, RoomMember, WorkspaceNode } from "./types";

export function App() {
  const [roomId, setRoomId] = useState("");
  const [member, setMember] = useState<RoomMember | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [tree, setTree] = useState<WorkspaceNode[]>([]);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string>();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [chatText, setChatText] = useState("");
  const [terminalLines] = useState<string[]>([]);
  const [socket, setSocket] = useState<ClientSocket | null>(null);

  const displayName = useMemo(
    () => new URLSearchParams(window.location.search).get("name") ?? `User-${Math.floor(Math.random() * 1000)}`,
    []
  );

  useEffect(() => {
    let mounted = true;
    async function boot() {
      const health = await getHealth();
      const joined = await joinRoom(health.roomId, displayName);
      const [room, workspaceTree, eventRecords] = await Promise.all([
        getRoom(health.roomId),
        getWorkspaceTree(),
        getEvents()
      ]);

      if (!mounted) return;
      setRoomId(health.roomId);
      setMember(joined);
      setMembers(room.members);
      setTree(workspaceTree);
      setEvents(eventRecords);

      const connected = connectRoomSocket({
        roomId: health.roomId,
        memberId: joined.id,
        onMessage(message) {
          if (message.type === "presence") {
            setMembers(message.members);
          }
          if (message.type === "file_change" && message.memberId !== joined.id) {
            setOpenFiles((files) =>
              files.map((file) =>
                file.path === message.path ? { ...file, content: message.content } : file
              )
            );
          }
          if (message.type === "chat_message") {
            refreshEvents();
          }
        }
      });
      setSocket(connected);
    }

    void boot();
    return () => {
      mounted = false;
    };
  }, [displayName]);

  useEffect(() => {
    return () => socket?.close();
  }, [socket]);

  useEffect(() => {
    if (!roomId) return;
    const timer = window.setInterval(() => {
      void refreshTasksAndEvents();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [roomId]);

  async function refreshEvents() {
    setEvents(await getEvents());
  }

  async function openFile(path: string) {
    const existing = openFiles.find((file) => file.path === path);
    if (!existing) {
      const content = await readWorkspaceFile(path);
      setOpenFiles((files) => [...files, { path, content }]);
    }
    setActivePath(path);
    socket?.sendOpenFile(path);
    await refreshEvents();
  }

  function selectFile(path: string) {
    setActivePath(path);
    socket?.sendOpenFile(path);
  }

  async function changeFile(path: string, content: string) {
    setOpenFiles((files) =>
      files.map((file) => (file.path === path ? { ...file, content } : file))
    );
    socket?.sendFileChange(path, content);
    await writeWorkspaceFile(path, content);
  }

  async function sendChat() {
    const text = chatText.trim();
    if (!text) return;
    socket?.sendChat(text);
    setChatText("");
    await refreshEvents();
  }

  return (
    <main className="app-shell">
      <aside className="workspace-pane">
        <WorkspaceExplorer tree={tree} activePath={activePath} onOpenFile={openFile} />
      </aside>
      <section className="editor-pane">
        <EditorArea
          openFiles={openFiles}
          activePath={activePath}
          onSelectFile={selectFile}
          onChangeFile={changeFile}
        />
      </section>
      <aside className="collab-pane">
        <CollaborationPanel
          members={members}
          events={events}
          chatText={chatText}
          onChatTextChange={setChatText}
          onSendChat={sendChat}
        />
      </aside>
      <section className="terminal-pane">
        <TerminalPanel lines={terminalLines} />
      </section>
      <div className="room-badge" data-testid="room-badge">
        Room {roomId} · {member?.name ?? "Joining"}
      </div>
    </main>
  );
}
```

- [ ] **Step 8: Replace styles with functional IDE layout**

Modify `apps/client/src/styles.css`:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
  background: #10131a;
  color: #edf1f7;
}

button,
textarea {
  font: inherit;
}

.app-shell {
  display: grid;
  grid-template-columns: 280px minmax(420px, 1fr) 340px;
  grid-template-rows: minmax(0, 1fr) 220px;
  height: 100vh;
  overflow: hidden;
}

.workspace-pane,
.editor-pane,
.collab-pane,
.terminal-pane {
  min-width: 0;
  min-height: 0;
  border-color: #2b3240;
  border-style: solid;
  background: #141924;
}

.workspace-pane {
  grid-row: 1 / 3;
  border-width: 0 1px 0 0;
}

.editor-pane {
  border-width: 0 1px 1px 0;
}

.collab-pane {
  grid-row: 1 / 3;
  border-width: 0;
}

.terminal-pane {
  border-width: 0 1px 0 0;
}

.panel {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}

.panel-header {
  height: 42px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border-bottom: 1px solid #2b3240;
  font-weight: 700;
  color: #f6f8fb;
}

.tree,
.collab-panel section,
.terminal-panel pre {
  padding: 12px;
}

.tree {
  overflow: auto;
}

.tree-directory summary {
  cursor: pointer;
  color: #c6d1e3;
  padding: 5px 0;
}

.tree-children {
  padding-left: 12px;
}

.tree-file {
  width: 100%;
  display: block;
  border: 0;
  border-radius: 6px;
  padding: 6px 8px;
  background: transparent;
  color: #e5ecf6;
  text-align: left;
  cursor: pointer;
}

.tree-file:hover,
.tree-file.active {
  background: #263148;
}

.editor-area {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.tabs {
  display: flex;
  min-height: 42px;
  overflow-x: auto;
  border-bottom: 1px solid #2b3240;
}

.tab {
  border: 0;
  border-right: 1px solid #2b3240;
  padding: 0 12px;
  background: #181f2d;
  color: #b9c5d8;
  cursor: pointer;
}

.tab.active {
  background: #222b3c;
  color: #ffffff;
}

.editor-frame {
  flex: 1;
  min-height: 0;
}

.empty-state {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: #8c9ab0;
}

.collab-panel {
  overflow: auto;
}

.collab-panel h2 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #9fb2d0;
  text-transform: uppercase;
}

.member-list,
.event-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.member-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 0;
  border-bottom: 1px solid #242d3d;
}

.member-list small,
.event-list li {
  color: #91a0b7;
}

.event-list li {
  padding: 4px 0;
}

.chat-box textarea {
  width: 100%;
  min-height: 80px;
  resize: vertical;
  border: 1px solid #344057;
  border-radius: 6px;
  padding: 8px;
  background: #101722;
  color: #edf1f7;
}

.chat-box button {
  margin-top: 8px;
  border: 0;
  border-radius: 6px;
  padding: 8px 12px;
  background: #4b7bec;
  color: white;
  cursor: pointer;
}

.terminal-panel pre {
  flex: 1;
  min-height: 0;
  margin: 0;
  overflow: auto;
  color: #c9d5e8;
  white-space: pre-wrap;
}

.room-badge {
  position: fixed;
  right: 352px;
  bottom: 232px;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid #344057;
  border-radius: 6px;
  padding: 6px 8px;
  background: #101722;
  color: #9fb2d0;
  font-size: 12px;
}
```

- [ ] **Step 9: Run build**

Run:

```bash
pnpm --filter @simplercp/client build
pnpm build
```

Expected: client and full repo build pass.

- [ ] **Step 10: Commit**

```bash
git add apps/client
git commit -m "feat: add collaborative workspace client shell"
```

---

### Task 6: Add Task Authorization And Runner Service

**Files:**
- Create: `apps/server/src/tasks.ts`
- Create: `apps/server/src/runner.ts`
- Create: `apps/server/src/__tests__/tasks.test.ts`
- Create: `apps/server/src/__tests__/runner.test.ts`
- Modify: `apps/server/src/types.ts`
- Modify: `apps/server/src/createApp.ts`

- [ ] **Step 1: Write failing task authorization tests**

Create `apps/server/src/__tests__/tasks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createEventLog } from "../eventLog.js";
import { createTaskStore } from "../tasks.js";

describe("task authorization", () => {
  it("allows authorized file paths and commands", () => {
    const events = createEventLog();
    const tasks = createTaskStore(events);
    const task = tasks.createTask({
      roomId: "room-1",
      title: "Update greeting",
      description: "Change hello text",
      creatorId: "human-1",
      assigneeId: "agent-1",
      editablePaths: ["src/**", "tests/**"],
      commandWhitelist: ["npm test"],
      acceptanceTarget: "Tests pass"
    });

    expect(tasks.canEdit(task.id, "src/hello.ts")).toBe(true);
    expect(tasks.canRunCommand(task.id, "npm test")).toBe(true);
    expect(tasks.canEdit(task.id, "package.json")).toBe(false);
    expect(tasks.canRunCommand(task.id, "rm -rf .")).toBe(false);
  });
});
```

- [ ] **Step 2: Write failing runner tests**

Create `apps/server/src/__tests__/runner.test.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog } from "../eventLog.js";
import { runWorkspaceCommand } from "../runner.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "simplercp-runner-"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        test: "node -e \"console.log('runner-ok')\""
      }
    })
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("runner", () => {
  it("runs whitelisted commands and records output", async () => {
    const events = createEventLog();
    const result = await runWorkspaceCommand({
      workspaceRoot: root,
      command: "npm test",
      whitelist: ["npm test"],
      events,
      roomId: "room-1",
      taskId: "task-1",
      initiatorId: "agent-1",
      timeoutMs: 10_000
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("runner-ok");
    expect(events.list().map((event) => event.type)).toEqual([
      "command_started",
      "command_output",
      "command_completed"
    ]);
  });

  it("rejects commands outside the whitelist", async () => {
    const events = createEventLog();
    await expect(
      runWorkspaceCommand({
        workspaceRoot: root,
        command: "rm -rf .",
        whitelist: ["npm test"],
        events,
        roomId: "room-1",
        taskId: "task-1",
        initiatorId: "agent-1",
        timeoutMs: 10_000
      })
    ).rejects.toThrow("Command is not authorized");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm --filter @simplercp/server test -- tasks runner
```

Expected: FAIL because `tasks.ts` and `runner.ts` do not exist.

- [ ] **Step 4: Add task and run types**

Modify `apps/server/src/types.ts` by appending:

```ts
export interface TaskRecord {
  id: string;
  roomId: string;
  title: string;
  description: string;
  creatorId: string;
  assigneeId: string;
  editablePaths: string[];
  commandWhitelist: string[];
  acceptanceTarget?: string;
  status: "open" | "running" | "completed" | "blocked";
}

export interface RunRecord {
  id: string;
  roomId: string;
  taskId: string;
  initiatorId: string;
  command: string;
  exitCode: number | null;
  output: string;
}
```

- [ ] **Step 5: Implement task store**

Create `apps/server/src/tasks.ts`:

```ts
import { nanoid } from "nanoid";
import type { EventLog } from "./eventLog.js";
import type { TaskRecord } from "./types.js";

export interface CreateTaskInput {
  roomId: string;
  title: string;
  description: string;
  creatorId: string;
  assigneeId: string;
  editablePaths: string[];
  commandWhitelist: string[];
  acceptanceTarget?: string;
}

export function createTaskStore(events: EventLog) {
  const tasks = new Map<string, TaskRecord>();

  return {
    createTask(input: CreateTaskInput) {
      const task: TaskRecord = {
        id: nanoid(10),
        status: "open",
        ...input
      };
      tasks.set(task.id, task);
      events.append({
        type: "task_created",
        roomId: task.roomId,
        taskId: task.id,
        memberId: task.creatorId,
        payload: {
          title: task.title,
          assigneeId: task.assigneeId,
          editablePaths: task.editablePaths,
          commandWhitelist: task.commandWhitelist
        }
      });
      return task;
    },
    getTask(taskId: string) {
      return tasks.get(taskId);
    },
    listTasks(roomId?: string) {
      const allTasks = [...tasks.values()];
      return roomId ? allTasks.filter((task) => task.roomId === roomId) : allTasks;
    },
    canEdit(taskId: string, filePath: string) {
      const task = tasks.get(taskId);
      if (!task) return false;
      return task.editablePaths.some((pattern) => matchesGlob(pattern, filePath));
    },
    canRunCommand(taskId: string, command: string) {
      const task = tasks.get(taskId);
      return task?.commandWhitelist.includes(command) ?? false;
    },
    markRunning(taskId: string) {
      const task = tasks.get(taskId);
      if (!task) throw new Error("Task not found");
      task.status = "running";
      events.append({ type: "task_started", roomId: task.roomId, taskId });
      return task;
    },
    markCompleted(taskId: string, summary: string) {
      const task = tasks.get(taskId);
      if (!task) throw new Error("Task not found");
      task.status = "completed";
      events.append({
        type: "task_completed",
        roomId: task.roomId,
        taskId,
        payload: { summary }
      });
      return task;
    }
  };
}

function matchesGlob(pattern: string, filePath: string) {
  if (pattern.endsWith("/**")) {
    return filePath.startsWith(pattern.slice(0, -3));
  }
  return pattern === filePath;
}

export type TaskStore = ReturnType<typeof createTaskStore>;
```

- [ ] **Step 6: Implement runner**

Create `apps/server/src/runner.ts`:

```ts
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import type { EventLog } from "./eventLog.js";
import type { RunRecord } from "./types.js";

export interface RunWorkspaceCommandInput {
  workspaceRoot: string;
  command: string;
  whitelist: string[];
  events: EventLog;
  roomId: string;
  taskId: string;
  initiatorId: string;
  timeoutMs: number;
}

export async function runWorkspaceCommand({
  workspaceRoot,
  command,
  whitelist,
  events,
  roomId,
  taskId,
  initiatorId,
  timeoutMs
}: RunWorkspaceCommandInput): Promise<RunRecord> {
  if (!whitelist.includes(command)) {
    events.append({
      type: "approval_requested",
      roomId,
      taskId,
      memberId: initiatorId,
      payload: { reason: "command_not_authorized", command }
    });
    throw new Error("Command is not authorized");
  }

  const run: RunRecord = {
    id: nanoid(10),
    roomId,
    taskId,
    initiatorId,
    command,
    exitCode: null,
    output: ""
  };

  events.append({
    type: "command_started",
    roomId,
    taskId,
    memberId: initiatorId,
    payload: { runId: run.id, command }
  });

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: workspaceRoot,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Command timed out"));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      appendOutput(chunk.toString());
    });
    child.stderr.on("data", (chunk: Buffer) => {
      appendOutput(chunk.toString());
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      run.exitCode = code ?? 1;
      events.append({
        type: "command_completed",
        roomId,
        taskId,
        memberId: initiatorId,
        payload: {
          runId: run.id,
          command,
          exitCode: run.exitCode,
          output: summarize(run.output)
        }
      });
      resolve(run);
    });

    function appendOutput(output: string) {
      run.output += output;
      events.append({
        type: "command_output",
        roomId,
        taskId,
        memberId: initiatorId,
        payload: {
          runId: run.id,
          output
        }
      });
    }
  });
}

function summarize(output: string) {
  return output.length > 2000 ? `${output.slice(0, 2000)}\n...` : output;
}
```

- [ ] **Step 7: Add task and runner REST endpoints**

Modify `apps/server/src/createApp.ts`:

```ts
import cors from "cors";
import express from "express";
import type { ServerConfig } from "./config.js";
import { createEventLog } from "./eventLog.js";
import { createRoomStore } from "./rooms.js";
import { runWorkspaceCommand } from "./runner.js";
import { createTaskStore } from "./tasks.js";
import {
  listWorkspaceTree,
  readWorkspaceFile,
  writeWorkspaceFile
} from "./workspace.js";

export function createApp(config: ServerConfig) {
  const app = express();
  const events = createEventLog();
  const rooms = createRoomStore(events);
  const tasks = createTaskStore(events);
  const defaultRoom = rooms.createRoom(config.workspaceRoot);

  app.locals.events = events;
  app.locals.rooms = rooms;
  app.locals.tasks = tasks;
  app.locals.defaultRoom = defaultRoom;

  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      workspaceRoot: config.workspaceRoot,
      roomId: defaultRoom.id
    });
  });

  app.get("/api/rooms/:roomId", (req, res, next) => {
    try {
      const room = rooms.getRoom(req.params.roomId);
      if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
      }
      res.json({ room });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rooms/:roomId/members", (req, res, next) => {
    try {
      const { name, kind } = req.body as { name?: string; kind?: "human" | "agent" };
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      res.json({ member: rooms.joinRoom(req.params.roomId, name, kind ?? "human") });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/events", (_req, res) => {
    res.json({ events: events.list() });
  });

  app.post("/api/tasks", (req, res, next) => {
    try {
      const task = tasks.createTask(req.body);
      res.json({ task });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/tasks", (req, res) => {
    const roomId = typeof req.query.roomId === "string" ? req.query.roomId : undefined;
    res.json({ tasks: tasks.listTasks(roomId) });
  });

  app.post("/api/tasks/:taskId/run", async (req, res, next) => {
    try {
      const task = tasks.getTask(req.params.taskId);
      const { command, initiatorId } = req.body as { command?: string; initiatorId?: string };
      if (!task || !command || !initiatorId) {
        res.status(400).json({ error: "task, command, and initiatorId are required" });
        return;
      }
      const run = await runWorkspaceCommand({
        workspaceRoot: config.workspaceRoot,
        command,
        whitelist: task.commandWhitelist,
        events,
        roomId: task.roomId,
        taskId: task.id,
        initiatorId,
        timeoutMs: 30_000
      });
      res.json({ run });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/workspace/tree", async (_req, res, next) => {
    try {
      res.json({ tree: await listWorkspaceTree(config.workspaceRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/workspace/file", async (req, res, next) => {
    try {
      const filePath = String(req.query.path ?? "");
      res.json({ path: filePath, content: await readWorkspaceFile(config.workspaceRoot, filePath) });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/workspace/file", async (req, res, next) => {
    try {
      const { path, content } = req.body as { path?: string; content?: string };
      if (!path || typeof content !== "string") {
        res.status(400).json({ error: "path and content are required" });
        return;
      }

      await writeWorkspaceFile(config.workspaceRoot, path, content);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: error.message });
  });

  return app;
}
```

- [ ] **Step 8: Run tests and build**

Run:

```bash
pnpm --filter @simplercp/server test -- tasks runner
pnpm --filter @simplercp/server test
pnpm build
```

Expected: task and runner tests pass, all server tests pass, and build passes.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src
git commit -m "feat: add task authorization and local runner"
```

---

### Task 7: Add Mock Agent Runtime

**Files:**
- Create: `apps/server/src/agents/types.ts`
- Create: `apps/server/src/agents/mockAgent.ts`
- Create: `apps/server/src/agents/runtime.ts`
- Create: `apps/server/src/__tests__/mockAgent.test.ts`
- Modify: `apps/server/src/createApp.ts`
- Modify: `apps/server/src/types.ts`

- [ ] **Step 1: Write failing mock agent test**

Create `apps/server/src/__tests__/mockAgent.test.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMockAgentTask } from "../agents/mockAgent.js";
import { createEventLog } from "../eventLog.js";
import { createTaskStore } from "../tasks.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "simplercp-agent-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "hello.ts"), "export const hello = 'world';\n");
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        test: "node -e \"console.log('agent-test-ok')\""
      }
    })
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("mock agent", () => {
  it("edits authorized file, runs authorized command, and reports", async () => {
    const events = createEventLog();
    const tasks = createTaskStore(events);
    const task = tasks.createTask({
      roomId: "room-1",
      title: "Update greeting",
      description: "Change greeting text",
      creatorId: "human-1",
      assigneeId: "agent-1",
      editablePaths: ["src/**"],
      commandWhitelist: ["npm test"],
      acceptanceTarget: "Tests pass"
    });

    const report = await runMockAgentTask({
      workspaceRoot: root,
      events,
      tasks,
      taskId: task.id,
      agentId: "agent-1"
    });

    await expect(fs.readFile(path.join(root, "src", "hello.ts"), "utf8")).resolves.toContain(
      "collaboration"
    );
    expect(report.summary).toContain("MockAgent updated src/hello.ts");
    expect(events.list().map((event) => event.type)).toContain("agent_reported");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @simplercp/server test -- mockAgent
```

Expected: FAIL because agent files do not exist.

- [ ] **Step 3: Add agent types**

Create `apps/server/src/agents/types.ts`:

```ts
import type { EventLog } from "../eventLog.js";
import type { TaskStore } from "../tasks.js";

export interface AgentTaskInput {
  workspaceRoot: string;
  events: EventLog;
  tasks: TaskStore;
  taskId: string;
  agentId: string;
}

export interface AgentReport {
  taskId: string;
  agentId: string;
  summary: string;
  commands: string[];
  risks: string[];
}
```

- [ ] **Step 4: Implement mock agent**

Create `apps/server/src/agents/mockAgent.ts`:

```ts
import { runWorkspaceCommand } from "../runner.js";
import { readWorkspaceFile, writeWorkspaceFile } from "../workspace.js";
import type { AgentReport, AgentTaskInput } from "./types.js";

export async function runMockAgentTask({
  workspaceRoot,
  events,
  tasks,
  taskId,
  agentId
}: AgentTaskInput): Promise<AgentReport> {
  const task = tasks.getTask(taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  tasks.markRunning(taskId);
  events.append({
    type: "agent_plan",
    roomId: task.roomId,
    taskId,
    memberId: agentId,
    payload: {
      plan: [
        "Read src/hello.ts",
        "Update the greeting inside the authorized path",
        "Run npm test",
        "Report the result"
      ]
    }
  });

  const targetPath = "src/hello.ts";
  if (!tasks.canEdit(taskId, targetPath)) {
    events.append({
      type: "approval_requested",
      roomId: task.roomId,
      taskId,
      memberId: agentId,
      payload: { reason: "file_not_authorized", path: targetPath }
    });
    throw new Error("File edit is not authorized");
  }

  const original = await readWorkspaceFile(workspaceRoot, targetPath);
  const updated = original.includes("collaboration")
    ? original
    : `${original.trimEnd()}\nexport const collaboration = 'human-agent';\n`;
  await writeWorkspaceFile(workspaceRoot, targetPath, updated);
  events.append({
    type: "agent_edited_file",
    roomId: task.roomId,
    taskId,
    memberId: agentId,
    payload: { path: targetPath }
  });

  const command = "npm test";
  const run = await runWorkspaceCommand({
    workspaceRoot,
    command,
    whitelist: task.commandWhitelist,
    events,
    roomId: task.roomId,
    taskId,
    initiatorId: agentId,
    timeoutMs: 30_000
  });

  const report: AgentReport = {
    taskId,
    agentId,
    summary: `MockAgent updated ${targetPath} and ran ${command} with exit code ${run.exitCode}.`,
    commands: [command],
    risks: run.exitCode === 0 ? [] : ["Command failed; inspect output for details."]
  };

  events.append({
    type: "agent_reported",
    roomId: task.roomId,
    taskId,
    memberId: agentId,
    payload: report
  });
  tasks.markCompleted(taskId, report.summary);

  return report;
}
```

- [ ] **Step 5: Add runtime wrapper**

Create `apps/server/src/agents/runtime.ts`:

```ts
import { runMockAgentTask } from "./mockAgent.js";
import type { AgentReport, AgentTaskInput } from "./types.js";

export type AgentProviderName = "mock";

export async function runAgentTask(
  provider: AgentProviderName,
  input: AgentTaskInput
): Promise<AgentReport> {
  if (provider === "mock") {
    return runMockAgentTask(input);
  }

  throw new Error("Unsupported agent provider");
}
```

- [ ] **Step 6: Add mock agent endpoint**

Modify `apps/server/src/createApp.ts`:

```ts
import { runAgentTask } from "./agents/runtime.js";
```

Add this endpoint after task endpoints:

```ts
  app.post("/api/tasks/:taskId/agent/mock/run", async (req, res, next) => {
    try {
      const { agentId } = req.body as { agentId?: string };
      if (!agentId) {
        res.status(400).json({ error: "agentId is required" });
        return;
      }
      const report = await runAgentTask("mock", {
        workspaceRoot: config.workspaceRoot,
        events,
        tasks,
        taskId: req.params.taskId,
        agentId
      });
      res.json({ report });
    } catch (error) {
      next(error);
    }
  });
```

- [ ] **Step 7: Run tests and build**

Run:

```bash
pnpm --filter @simplercp/server test -- mockAgent
pnpm --filter @simplercp/server test
pnpm build
```

Expected: mock agent test passes, all server tests pass, and TypeScript builds.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src
git commit -m "feat: add deterministic mock agent runtime"
```

---

### Task 8: Surface Tasks, Mock Agent, And Runner Output In The Client

**Files:**
- Modify: `apps/client/src/types.ts`
- Modify: `apps/client/src/api.ts`
- Modify: `apps/client/src/components/CollaborationPanel.tsx`
- Modify: `apps/client/src/components/TerminalPanel.tsx`
- Modify: `apps/client/src/App.tsx`

- [ ] **Step 1: Extend client types**

Modify `apps/client/src/types.ts` by appending:

```ts
export interface TaskRecord {
  id: string;
  roomId: string;
  title: string;
  description: string;
  creatorId: string;
  assigneeId: string;
  editablePaths: string[];
  commandWhitelist: string[];
  acceptanceTarget?: string;
  status: "open" | "running" | "completed" | "blocked";
}

export interface AgentReport {
  taskId: string;
  agentId: string;
  summary: string;
  commands: string[];
  risks: string[];
}
```

- [ ] **Step 2: Extend API helpers**

Modify `apps/client/src/api.ts` imports:

```ts
import type {
  AgentReport,
  EventRecord,
  RoomMember,
  RoomState,
  TaskRecord,
  WorkspaceNode
} from "./types";
```

Append these functions:

```ts
export async function createTask(input: {
  roomId: string;
  title: string;
  description: string;
  creatorId: string;
  assigneeId: string;
  editablePaths: string[];
  commandWhitelist: string[];
  acceptanceTarget?: string;
}): Promise<TaskRecord> {
  const response = await request<{ task: TaskRecord }>("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return response.task;
}

export async function getTasks(roomId: string): Promise<TaskRecord[]> {
  const response = await request<{ tasks: TaskRecord[] }>(
    `/api/tasks?roomId=${encodeURIComponent(roomId)}`
  );
  return response.tasks;
}

export async function runMockAgent(taskId: string, agentId: string): Promise<AgentReport> {
  const response = await request<{ report: AgentReport }>(
    `/api/tasks/${taskId}/agent/mock/run`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId })
    }
  );
  return response.report;
}
```

- [ ] **Step 3: Update collaboration panel with task controls**

Modify `apps/client/src/components/CollaborationPanel.tsx`:

```tsx
import type { EventRecord, RoomMember, TaskRecord } from "../types";

export function CollaborationPanel({
  members,
  events,
  tasks,
  chatText,
  onChatTextChange,
  onSendChat,
  onCreateMockAgentTask,
  onRunMockAgent
}: {
  members: RoomMember[];
  events: EventRecord[];
  tasks: TaskRecord[];
  chatText: string;
  onChatTextChange(value: string): void;
  onSendChat(): void;
  onCreateMockAgentTask(): void;
  onRunMockAgent(taskId: string): void;
}) {
  return (
    <div className="panel collab-panel">
      <div className="panel-header">Collaboration</div>
      <section>
        <h2>Members</h2>
        <ul className="member-list" data-testid="member-list">
          {members.map((member) => (
            <li key={member.id}>
              <span>{member.name}</span>
              <small>{member.kind} · {member.currentFile ?? "Browsing"}</small>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Agent Task</h2>
        <button onClick={onCreateMockAgentTask} data-testid="create-agent-task">
          Create MockAgent Task
        </button>
        <ul className="task-list" data-testid="task-list">
          {tasks.map((task) => (
            <li key={task.id}>
              <strong>{task.title}</strong>
              <small>{task.status}</small>
              <button onClick={() => onRunMockAgent(task.id)} data-testid={`run-agent-${task.id}`}>
                Run MockAgent
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Activity</h2>
        <ol className="event-list" data-testid="event-list">
          {events.slice(-20).map((event) => (
            <li key={event.id}>{event.type}</li>
          ))}
        </ol>
      </section>
      <section className="chat-box">
        <h2>Chat</h2>
        <textarea
          value={chatText}
          onChange={(event) => onChatTextChange(event.target.value)}
          placeholder="@MockAgent help with this task"
          data-testid="chat-input"
        />
        <button onClick={onSendChat} data-testid="send-chat">
          Send
        </button>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Update App to create and run mock agent tasks**

Modify `apps/client/src/App.tsx` imports:

```tsx
import {
  createTask,
  getEvents,
  getHealth,
  getRoom,
  getTasks,
  getWorkspaceTree,
  joinRoom,
  readWorkspaceFile,
  runMockAgent,
  writeWorkspaceFile
} from "./api";
import type { EventRecord, RoomMember, TaskRecord, WorkspaceNode } from "./types";
```

Add state:

```tsx
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
```

Remove the old `const [terminalLines] = useState<string[]>([]);`.

In `boot`, load tasks:

```tsx
      const [room, workspaceTree, eventRecords, taskRecords] = await Promise.all([
        getRoom(health.roomId),
        getWorkspaceTree(),
        getEvents(),
        getTasks(health.roomId)
      ]);
```

Then set:

```tsx
      setTasks(taskRecords);
```

Add helper:

```tsx
  async function refreshTasksAndEvents() {
    if (!roomId) return;
    const [taskRecords, eventRecords] = await Promise.all([
      getTasks(roomId),
      getEvents()
    ]);
    setTasks(taskRecords);
    setEvents(eventRecords);
    const commandLines = eventRecords
      .filter((event) => event.type === "command_output")
      .map((event) => String(event.payload?.output ?? ""));
    setTerminalLines(commandLines);
  }
```

Add task actions:

```tsx
  async function createMockAgentTask() {
    if (!member || !roomId) return;
    const agentName = "MockAgent";
    const agentMember =
      members.find((candidate) => candidate.name === agentName) ??
      (await joinRoom(roomId, agentName, "agent"));

    await createTask({
      roomId,
      title: "MockAgent update greeting",
      description: "Update src/hello.ts and run npm test.",
      creatorId: member.id,
      assigneeId: agentMember.id,
      editablePaths: ["src/**"],
      commandWhitelist: ["npm test"],
      acceptanceTarget: "npm test passes"
    });
    const room = await getRoom(roomId);
    setMembers(room.members);
    await refreshTasksAndEvents();
  }

  async function runMockAgentForTask(taskId: string) {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    const report = await runMockAgent(taskId, task.assigneeId);
    setTerminalLines((lines) => [...lines, report.summary]);
    await refreshTasksAndEvents();
    const workspaceTree = await getWorkspaceTree();
    setTree(workspaceTree);
    if (activePath) {
      const content = await readWorkspaceFile(activePath);
      setOpenFiles((files) =>
        files.map((file) => (file.path === activePath ? { ...file, content } : file))
      );
    }
  }
```

Update `CollaborationPanel` usage:

```tsx
        <CollaborationPanel
          members={members}
          events={events}
          tasks={tasks}
          chatText={chatText}
          onChatTextChange={setChatText}
          onSendChat={sendChat}
          onCreateMockAgentTask={createMockAgentTask}
          onRunMockAgent={runMockAgentForTask}
        />
```

- [ ] **Step 5: Add task styles**

Append to `apps/client/src/styles.css`:

```css
.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.task-list li {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
  border: 1px solid #2b3240;
  border-radius: 6px;
  padding: 8px;
  background: #101722;
}

.task-list small {
  grid-column: 1 / 2;
  color: #91a0b7;
}

.task-list button,
.collab-panel section > button {
  border: 0;
  border-radius: 6px;
  padding: 7px 10px;
  background: #3d8b74;
  color: white;
  cursor: pointer;
}
```

- [ ] **Step 6: Run build**

Run:

```bash
pnpm --filter @simplercp/client build
pnpm build
```

Expected: client and full repo builds pass.

- [ ] **Step 7: Commit**

```bash
git add apps/client
git commit -m "feat: surface mock agent tasks in client"
```

---

### Task 9: Add Playwright Collaboration Harness

**Files:**
- Create: `tests/fixtures/sample-workspace/package.json`
- Create: `tests/fixtures/sample-workspace/src/hello.ts`
- Create: `tests/fixtures/sample-workspace/tests/hello.test.ts`
- Create: `tests/e2e/globalSetup.ts`
- Create: `tests/playwright.config.ts`
- Create: `tests/e2e/helpers.ts`
- Create: `tests/e2e/collaboration.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Create fixture workspace**

Create `tests/fixtures/sample-workspace/package.json`:

```json
{
  "name": "simplercp-sample-workspace",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node tests/hello.test.ts"
  }
}
```

Create `tests/fixtures/sample-workspace/src/hello.ts`:

```ts
export const hello = "world";
```

Create `tests/fixtures/sample-workspace/tests/hello.test.ts`:

```ts
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/hello.ts", import.meta.url), "utf8");

if (!source.includes("hello")) {
  throw new Error("hello export is missing");
}

console.log("sample-workspace-test-ok");
```

- [ ] **Step 2: Add Playwright global setup**

Create `tests/e2e/globalSetup.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export default async function globalSetup() {
  const source = path.resolve("tests/fixtures/sample-workspace");
  const target = path.join(os.tmpdir(), "simplercp-e2e-workspace");

  await fs.rm(target, { recursive: true, force: true });
  await fs.cp(source, target, { recursive: true });
  process.env.SIMPLERCP_E2E_WORKSPACE = target;
}
```

- [ ] **Step 3: Add Playwright config**

Create `tests/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";
import path from "node:path";

const workspaceRoot =
  process.env.SIMPLERCP_E2E_WORKSPACE ??
  path.resolve("tests/fixtures/sample-workspace");

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/globalSetup.ts",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: `SIMPLERCP_WORKSPACE=${workspaceRoot} SIMPLERCP_COMMANDS="npm test" pnpm --filter @simplercp/server dev`,
      url: "http://127.0.0.1:4000/api/health",
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: "pnpm --filter @simplercp/client dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 30_000
    }
  ]
});
```

- [ ] **Step 4: Add E2E helpers**

Create `tests/e2e/helpers.ts`:

```ts
import type { Page } from "@playwright/test";

export async function openAs(page: Page, name: string) {
  await page.goto(`/?name=${encodeURIComponent(name)}`);
  await page.getByTestId("room-badge").waitFor();
}

export async function fetchEvents(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/events");
    return response.json() as Promise<{
      events: Array<{ type: string; payload?: Record<string, unknown> }>;
    }>;
  });
}
```

- [ ] **Step 5: Write collaboration simulation**

Create `tests/e2e/collaboration.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { fetchEvents, openAs } from "./helpers";

test("human collaborators and mock agent complete a vertical collaboration flow", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const userA = await contextA.newPage();
  const userB = await contextB.newPage();

  await openAs(userA, "Ada");
  await openAs(userB, "Linus");

  await expect(userA.getByTestId("member-list")).toContainText("Ada");
  await expect(userA.getByTestId("member-list")).toContainText("Linus");
  await expect(userB.getByTestId("workspace-tree")).toContainText("src");
  await expect(userB.getByTestId("workspace-tree")).toContainText("hello.ts");

  await userA.getByTestId("file-src/hello.ts").click();
  await expect(userA.getByTestId("editor-tabs")).toContainText("src/hello.ts");
  await expect(userB.getByTestId("member-list")).toContainText("src/hello.ts");

  await userA.getByTestId("create-agent-task").click();
  await expect(userA.getByTestId("task-list")).toContainText("MockAgent update greeting");
  await userA.getByRole("button", { name: "Run MockAgent" }).click();

  await expect(userA.getByTestId("terminal-output")).toContainText("MockAgent updated src/hello.ts");
  await expect(userA.getByTestId("event-list")).toContainText("agent_reported");

  const { events } = await fetchEvents(userA);
  expect(events.map((event) => event.type)).toEqual(
    expect.arrayContaining([
      "room_created",
      "member_joined",
      "file_opened",
      "task_created",
      "agent_plan",
      "agent_edited_file",
      "command_started",
      "command_completed",
      "agent_reported",
      "task_completed"
    ])
  );

  await contextA.close();
  await contextB.close();
});
```

- [ ] **Step 6: Run collaboration test to verify behavior**

Run:

```bash
pnpm run test:collab
```

Expected: Playwright starts the server and client, opens two browser contexts, completes the mock-agent collaboration flow, and passes.

- [ ] **Step 7: Run full verification**

Run:

```bash
pnpm test
pnpm run test:collab
pnpm build
```

Expected: all unit tests pass, collaboration E2E passes, and build passes.

- [ ] **Step 8: Commit**

```bash
git add package.json tests
git commit -m "test: add collaboration simulation harness"
```

---

### Task 10: Add README And Developer Operating Notes

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-05-27-realtime-collab-coding-design.md`

- [ ] **Step 1: Add README**

Create `README.md`:

```md
# SimpleRCPv2

SimpleRCPv2 is a realtime collaborative coding prototype for human and AI-agent collaboration.

The MVP runs as a local web app. The browser provides a lightweight LiveShare-style interface, and the local Node server owns real workspace access, room events, task authorization, mock agent execution, and local command running.

## Current MVP Scope

- Real local workspace tree.
- Project room and invite URL.
- Multi-user browser collaboration.
- Monaco editor tabs.
- Presence and current-file activity.
- Task-level agent authorization.
- Deterministic mock agent provider.
- Whitelisted local command runner.
- Event log for collaboration analysis and tests.
- Playwright collaboration simulation for AI development verification.

## Getting Started

Install dependencies:

```bash
pnpm install
```

Start against the current repository:

```bash
SIMPLERCP_WORKSPACE="$PWD" SIMPLERCP_COMMANDS="npm test,npm run build" pnpm run dev
```

Open:

```text
http://127.0.0.1:5173
```

To simulate another collaborator, open the same URL in another browser or tab with a different name:

```text
http://127.0.0.1:5173/?name=Linus
```

## Verification

Run server tests:

```bash
pnpm test
```

Run the collaboration simulation:

```bash
pnpm run test:collab
```

Run a full build:

```bash
pnpm build
```

## Safety Boundaries

The MVP runs commands locally. Keep command whitelists narrow and use fixture workspaces for automated tests.

API keys for future real agents should stay server-side and should never be written to the event log.
```

- [ ] **Step 2: Add implementation-plan link to spec**

Append to `docs/superpowers/specs/2026-05-27-realtime-collab-coding-design.md`:

```md

## Implementation Plan

The first vertical MVP implementation plan is documented in `docs/superpowers/plans/2026-05-27-realtime-collab-coding-mvp.md`.
```

- [ ] **Step 3: Run verification**

Run:

```bash
pnpm test
pnpm run test:collab
pnpm build
```

Expected: all unit tests pass, collaboration E2E passes, and build passes.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-05-27-realtime-collab-coding-design.md
git commit -m "docs: add mvp operating notes"
```

---

## Plan Self-Review

Spec coverage:

- Real local workspace: Tasks 2, 5, 9.
- Project room and invite URL foundation: Tasks 3, 4, 5. The first URL is the local app URL with room discovered from `/api/health`; richer copyable invite links can be added after the MVP slice.
- Multi-file UI: Task 5.
- Realtime human-human sync: Tasks 4, 5, 9.
- Agent as member: Tasks 3, 7, 8.
- Task-level authorization: Tasks 6, 7, 8.
- Runner: Task 6.
- Event log: Tasks 3, 4, 6, 7, 9.
- AI development harness: Task 9.
- README and operating notes: Task 10.

Known deliberate MVP simplifications:

- Editor synchronization uses WebSocket `file_change` messages rather than a full Yjs CRDT in the first vertical slice. The server/client boundaries leave room to replace this with Yjs after the flow is proven.
- The first invite flow discovers the room through `/api/health`; the URL can later include explicit `roomId` once multiple concurrent local rooms are added.
- The first mock agent is deterministic and intentionally narrow so automated tests are stable.
