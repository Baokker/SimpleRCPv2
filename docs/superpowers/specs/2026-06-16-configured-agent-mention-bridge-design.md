# Configured Agent Mention Bridge Design

## Goal

Let a configured OpenAI-compatible coding agent join the same observable collaboration loop as humans and `MockAgent`. A user should be able to type `@DeepSeek`, `@GLM`, or another configured alias in chat and see the agent appear as a participant, create a task, update AgentRun status, write transcript messages, and report success or a visible blocked/failure state.

## Scope

This iteration supports one configured provider at a time, matching the existing `AgentConfig` model. It does not add a multi-agent registry, accounts, approvals UI, model marketplace, or provider-specific SDKs. Provider calls remain OpenAI-compatible chat completions, with fake fetch tests for deterministic verification.

## Configuration

The server extends `AgentConfig` with:

- `name`: display name used for room membership and chat, defaulting to `DeepSeek` when DeepSeek env vars or base URL are used, otherwise `ConfiguredAgent`.
- `mentionAliases`: case-insensitive chat handles that can trigger the configured provider, including `name` and optional `AGENT_MENTION_ALIASES` values.
- `editablePaths`: task edit authorization used for chat-triggered configured-agent work, from `AGENT_EDITABLE_PATHS`, defaulting to `src/**,tests/**,package.json,README.md`.

Secrets stay server-side. Runtime config may expose agent name, provider, aliases, and whether an API key is present, but never the key.

## Chat Trigger Behavior

When `POST /api/rooms/:roomId/chat` creates a human message:

1. If the message mentions `MockAgent`, keep the existing deterministic MockAgent path.
2. Otherwise, if it mentions one configured alias, join/upsert the configured agent as an agent member.
3. Create a task using the chat text as the description.
4. Create an AgentRun and write an acknowledgement chat message.
5. If the configured provider needs an API key and none is present, mark the run `blocked`, write a chat explanation, and append timeline items.
6. If configured, call the existing `runAgentTask` OpenAI-compatible path with injectable fetch support for tests.
7. Update AgentRun status through `thinking`, `running_command` or `reporting`, then `completed` or `failed`.
8. Write final transcript and timeline entries.

## UI Projection

The existing right panel already polls chat, AgentRun, and timeline. This iteration adds enough runtime metadata for the UI to show the configured mention handle and make the chat placeholder accurate. The core visible proof remains the transcript, Agent Runs list, and Timeline list.

## Testing

Server tests prove:

- Config loads configured agent name, aliases, and editable paths.
- Chat `@DeepSeek` with a fake OpenAI-compatible provider returns a completed AgentRun and transcript messages.
- Chat `@DeepSeek` without an API key returns a blocked AgentRun and visible chat explanation.
- Existing `@MockAgent` behavior continues to pass.

Client/build checks prove the UI can render new runtime metadata. Existing collaboration and observable E2E tests continue to protect the realtime IDE baseline.
