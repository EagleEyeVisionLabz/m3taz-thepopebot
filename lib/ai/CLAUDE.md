# lib/ai/ — LLM Integration

## Architecture

Every chat message flows through `chatStream()` in `index.js`. After workspace setup, it forks on whether a registered SDK adapter exists for the active coding agent:

- **SDK path** (`streamViaSdk`) — in-process `@anthropic-ai/claude-agent-sdk` via `sdk-adapters/claude-code.js`. Used only when `CODING_AGENT=claude-code`.
- **Direct path** (`streamViaContainer`) — spawns the configured coding agent in an ephemeral headless Docker container via `runHeadlessContainer()`. Streams output through `parseHeadlessStream()`. Used for every agent without an SDK adapter (pi, codex, gemini, opencode, kimi).

Both paths yield the same normalized chunk shape and use the same DB persistence pattern. There is no LangGraph React agent and no intermediate LLM between the user's message and the agent.

## Multi-Turn Memory

Neither path persists conversation context at the LangChain/LangGraph layer — that layer is gone. Memory lives where the coding agent naturally keeps it:

- **SDK path** — session ID captured from the SDK's `meta` chunk and written via `session-manager.js` (`{workspaceBaseDir}/.claude-ttyd-sessions/7681`). Passed back into the SDK on the next turn.
- **Direct path** — `runHeadlessContainer()` passes `CONTINUE_SESSION=1` into the container. Each agent's `run.sh` reads its own port-keyed session file and resumes natively (see `docker/coding-agent/CLAUDE.md` § Session Tracking).

## Chat Modes

`chats.chatMode` is either `'agent'` or `'code'`:

- **Agent mode** (`chatMode: 'agent'`) — repo/branch defaulted from `GH_OWNER`/`GH_REPO`, `main` branch, agent job secrets injected, system prompt built from `event-handler/agent-chat/SYSTEM.md` with scope-resolved skills.
- **Code mode** (`chatMode: 'code'`) — user-selected repo/branch, no secret injection, system prompt from `event-handler/code-chat/SYSTEM.md`.

Per-chat sub-mode via `codeModeType`:
- **plan** — `PERMISSION=plan` (read-only).
- **code** — `PERMISSION=code` (write/dangerous).

The "job" sub-mode is no longer wired — a skill will replace autonomous job dispatch.

## Chunk Shape

`chatStream()` yields normalized chunks consumed by `lib/chat/api.js`:

- `{ type: 'text', text }`
- `{ type: 'tool-call', toolCallId, toolName, args }`
- `{ type: 'tool-result', toolCallId, result }`
- `{ type: 'error', message }` — surfaced to the UI as a red message and persisted for refresh
- `{ type: 'auto-run', command }` — emitted at stream end when the active mode's `*_AUTO_RUN` flag is on, the workspace has uncommitted changes, and the configured git command (`pull`/`commit`/`push`/`pull-push`/`create-pr`) launched in a workspace command container. `lib/chat/api.js` surfaces it as a `data-auto-run` UI part; the chat page forwards it to WorkspaceBar so the spinner attaches without opening the dialog.
- `{ type: 'meta', ... }`, `{ type: 'result', ... }` — internal, not emitted to client
- `{ type: 'thinking-start' | 'thinking' | 'thinking-end' }` — SDK path only

`chatStream()` requires `options.userId` and throws if missing — there are no `'unknown'` / `'telegram'` fallbacks anywhere in chat creation. Both paths set `USER_ID` on the spawned container so skills resolve the originator consistently.

## Workspace Setup

`ensureWorkspaceRepo()` (workspace-setup.js) is called before either path runs. It clones the repo, sets git identity, and checks out/creates the feature branch on the host — agent-agnostic. The container's `2_clone.sh` is a no-op when `.git` already exists.

On the first message in a new chat, `chatStream` yields a visible `tool-call`/`tool-result` pair with `toolName: 'workspace'` so the setup appears in the UI.

## Helper LLM (`helper-llm.js`)

Small one-shot completions used by the event handler itself. Independent of the coding agent — it has its own provider/model selection at `/admin/event-handler/helper-llm`.

**Callers:**
- `autoTitle()` (chat title — 2-5 word title for "New Chat")
- `summarizeAgentJob()` (webhook-triggered PR merge summary)
- `generateAgentJobTitle()` (~10 word title for an agent job)

**API:**
- `callHelperLlm({system, user, maxTokens})` → returns trimmed text (uses AI SDK `generateText`)
- `callHelperLlmStructured({system, user, schema, maxTokens})` → returns parsed object (uses AI SDK `generateObject`); throws on schema/parse failure (callers catch and fall back)

**Provider resolution.** Reads `LLM_PROVIDER` and `LLM_MODEL` from config and builds the right AI SDK adapter:

| Provider slug | AI SDK adapter |
|---|---|
| `anthropic` | `@ai-sdk/anthropic` |
| `openai` | `@ai-sdk/openai` |
| `google` | `@ai-sdk/google` |
| built-in OpenAI-compatible (`deepseek`, `mistral`, `xai`, `kimi`, `openrouter`, `nvidia`) | `@ai-sdk/openai-compatible` with each provider's `baseUrl` from `BUILTIN_PROVIDERS` |
| custom user-added | `@ai-sdk/openai-compatible` with the custom provider's `baseUrl` and `apiKey` |

The AI SDK handles per-provider quirks (max-token param naming, thinking/reasoning block stripping, structured output via the right native mechanism per provider). Helper LLM has no LangChain dependency.

### LLM Providers

Source of truth: `lib/llm-providers.js` (`BUILTIN_PROVIDERS`).

| Provider | `LLM_PROVIDER` | Default Model | Required Key |
|----------|----------------|---------------|-------------|
| Anthropic | `anthropic` (default) | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai` | `gpt-5.4` | `OPENAI_API_KEY` |
| Google | `google` | `gemini-2.5-flash` | `GOOGLE_API_KEY` |
| DeepSeek | `deepseek` | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| MiniMax | `minimax` | `MiniMax-M2.7` | `MINIMAX_API_KEY` |
| Mistral | `mistral` | `mistral-large-latest` | `MISTRAL_API_KEY` |
| xAI | `xai` | `grok-4.20-0309-non-reasoning` | `XAI_API_KEY` |
| Kimi | `kimi` | `kimi-k2.5` | `MOONSHOT_API_KEY` |
| OpenRouter | `openrouter` | (user-specified) | `OPENROUTER_API_KEY` |

All credentials are stored in the settings DB (encrypted). `LLM_MAX_TOKENS` defaults to 4096.

**Custom providers**: users can add OpenAI-compatible providers via `/admin/event-handler/llms`. Stored as `type: 'llm_provider'` in the settings table. Resolved at call time via `getCustomProvider()` in `helper-llm.js`.

## Headless Stream Parser (headless-stream.js)

Three-layer parser consumed by the direct path:

1. **Docker frame decoder** — parses 8-byte multiplexed stream headers (type + size), extracts stdout frames, discards stderr.
2. **NDJSON splitter** — accumulates decoded UTF-8 and splits on newlines.
3. **Event mapper** (`mapLine()`) — converts each line to chat events:
   - `assistant` messages: `text` blocks → `{ type: 'text' }`, `tool_use` blocks → `{ type: 'tool-call' }`
   - `user` messages: `tool_result` blocks → `{ type: 'tool-result' }` (priority: stdout > string > array)
   - `result` messages: → `{ type: 'text' }` (final summary)
   - Non-JSON lines (e.g. `NO_CHANGES`, `AGENT_FAILED`): wrapped as plain text events

`mapLine()` is also reused by `lib/cluster/stream.js` for worker log parsing.

### Adding a New Agent Mapper (line-mappers.js)

Each coding agent CLI has its own mapper (`mapClaudeCodeLine`, `mapPiLine`, `mapGeminiLine`, `mapCodexLine`, `mapOpenCodeLine`, `mapKimiLine`). To add one:

1. Create `mapXxxLine(parsed)` in `line-mappers.js` that returns an array of `{ type, ... }` events.
2. Register it in `headless-stream.js`: imports, re-exports, and the `mapperMap` object.
3. Map the agent's JSON output to the chunk shape above.
4. Return `[{ type: 'skip' }]` for noise events to suppress them without triggering the unknown fallback.
