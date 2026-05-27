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
