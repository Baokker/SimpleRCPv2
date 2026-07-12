# Configured Agent Mention Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make configured OpenAI-compatible agents invokable from chat mentions with visible room membership, transcript messages, AgentRun status, and timeline output.

**Architecture:** Extend the existing single-provider `AgentConfig` rather than adding a registry. Keep mention orchestration in the server app boundary, use existing task, chat, room, AgentRun, timeline, and OpenAI-compatible agent services, and inject provider fetch for deterministic tests.

**Tech Stack:** TypeScript, Express, Vitest, React/Vite, existing in-memory stores.

---

## File Structure

- Modify `apps/server/src/config.ts` for configured agent display name, mention aliases, and default editable paths.
- Modify `apps/server/src/types.ts` for runtime metadata types if needed.
- Modify `apps/server/src/createApp.ts` to detect configured aliases, run the configured provider, and expose runtime metadata.
- Modify `apps/server/src/agents/runtime.ts` and `apps/server/src/agents/openaiCompatible.ts` only if fetch injection is needed.
- Modify `apps/server/src/__tests__/config.test.ts` and `apps/server/src/__tests__/chat.test.ts` first.
- Modify `apps/client/src/types.ts`, `apps/client/src/App.tsx`, and `apps/client/src/components/CollaborationPanel.tsx` for runtime mention hints.
- Modify `README.md` to document `@DeepSeek` style chat invocation.

## Task 1: Configured Agent Runtime Metadata

- [ ] **Step 1: Write failing config tests**

Add tests proving `loadConfig` returns `agent.name`, `agent.mentionAliases`, and `agent.editablePaths`, with DeepSeek aliases by default.

- [ ] **Step 2: Run config tests and verify failure**

Run `pnpm --filter @simplercp/server test -- config.test.ts`.

- [ ] **Step 3: Implement config fields**

Add the fields to `AgentConfig` and parse `AGENT_NAME`, `AGENT_MENTION_ALIASES`, and `AGENT_EDITABLE_PATHS`.

- [ ] **Step 4: Run config tests and verify pass**

Run `pnpm --filter @simplercp/server test -- config.test.ts`.

## Task 2: Chat Mention Bridge For Configured Agent

- [ ] **Step 1: Write failing chat integration tests**

Add one test for `@DeepSeek` with fake provider fetch completing a run, and one test for missing API key producing a blocked run.

- [ ] **Step 2: Run chat tests and verify failure**

Run `pnpm --filter @simplercp/server test -- chat.test.ts`.

- [ ] **Step 3: Implement provider fetch injection**

Let `createApp` accept optional `agentFetch` for tests and pass it to `runAgentTask` / OpenAI-compatible runtime.

- [ ] **Step 4: Implement configured mention orchestration**

In chat POST, after MockAgent handling, match configured aliases case-insensitively. Join/upsert the configured agent, create task and AgentRun, write acknowledgement, handle missing key as `blocked`, run provider when configured, and write final chat messages.

- [ ] **Step 5: Run chat tests and verify pass**

Run `pnpm --filter @simplercp/server test -- chat.test.ts openaiCompatibleAgent.test.ts`.

## Task 3: UI And Documentation

- [ ] **Step 1: Add runtime fields to client types and API projection**

Include `agentName`, `agentMentionAliases`, and `agentConfigured` in the existing runtime config type.

- [ ] **Step 2: Render configured mention hint**

Update chat placeholder / small runtime note so users know they can type `@DeepSeek` or the configured alias.

- [ ] **Step 3: Update README**

Document `AGENT_NAME`, `AGENT_MENTION_ALIASES`, `AGENT_EDITABLE_PATHS`, and chat invocation.

- [ ] **Step 4: Run client build**

Run `pnpm --filter @simplercp/client build`.

## Task 4: Verification

- [ ] **Step 1: Run focused server tests**

Run `pnpm --filter @simplercp/server test -- config.test.ts chat.test.ts openaiCompatibleAgent.test.ts`.

- [ ] **Step 2: Run full verification**

Run `pnpm test && pnpm run test:collab && pnpm build`.

- [ ] **Step 3: Inspect for secrets**

Run `rg -n "sk-[A-Za-z0-9]{20,}|AGENT_API_KEY=.*[A-Za-z0-9]{20,}|DEEPSEEK_API_KEY=.*[A-Za-z0-9]{20,}" README.md apps docs tests` and confirm no real key is present.
