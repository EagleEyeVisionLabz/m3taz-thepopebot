# lib/ai/sdk-adapters/ — SDK Adapter System

In-process SDK adapters that run a coding agent's SDK directly (no container) and yield a unified chunk stream consumed by `chatStream()` in `lib/ai/index.js`. Used when the active coding agent has a registered adapter; otherwise `chatStream()` uses the direct headless-container path.

## Architecture

```
Browser → POST /stream/chat (api.js)
  → chatStream() (index.js)
    → workspace setup (ensureWorkspaceRepo)
    → getSdkAdapter() returns adapter function or null
    → if adapter: streamViaSdk — in-process SDK call, yields normalized chunks
    → if null:    streamViaContainer — headless Docker container, parseHeadlessStream yields chunks
```

The adapter is a pure stream translator — it receives a prompt and options, calls the SDK, and yields normalized chunks. Everything else (workspace setup, DB persistence, session continuity, system prompts) is handled by `chatStream()` in `index.js`.

## Existing Adapter

| File | Agent | SDK |
|------|-------|-----|
| `claude-code.js` | `claude-code` | `@anthropic-ai/claude-agent-sdk` |

## Adding a New SDK Adapter

### 1. Create the adapter file

Create `{agent-name}.js` in this directory. Export a single async generator function:

```js
export async function* myAgentStream({ prompt, workspaceDir, systemPrompt, sessionId, permissionMode, attachments }) {
  // ... call the SDK, yield chunks
}
```

### 2. Required chunk types to yield

The adapter MUST yield these chunk types for `chatStream()` and `api.js` to work correctly:

| Chunk | Shape | When | Purpose |
|-------|-------|------|---------|
| `meta` | `{ type: 'meta', sessionId: string }` | First event | Session ID for continuity across messages. `chatStream()` writes this to disk via `writeSessionId()` so subsequent messages resume the session. |
| `text` | `{ type: 'text', text: string }` | Text output | Streamed to UI as deltas. Accumulated by `chatStream()` and flushed to DB as assistant messages at tool boundaries and stream end. |
| `tool-call` | `{ type: 'tool-call', toolCallId: string, toolName: string, args: object }` | Tool invocation starts | Triggers tool UI in the browser. May be yielded twice: once at start with `args: {}`, once at `content_block_stop` with complete args. `chatStream()` tracks these in `pendingToolCalls` for pairing with results. |
| `tool-result` | `{ type: 'tool-result', toolCallId: string, result: string }` | Tool completes | Paired with the matching `tool-call` by `toolCallId`. `chatStream()` persists the pair as a `tool-invocation` JSON message in the DB. |
| `result` | `{ type: 'result', text: string, cost?: number, duration?: number, subtype?: string }` | Stream ends | Final summary. Logged by `chatStream()`, not persisted or sent to UI. |

Optional:
| `unknown` | `{ type: 'unknown', raw: any }` | Unrecognized events | `api.js` renders these as collapsible boxes in the UI. Use for debugging unhandled SDK events. |

### 3. Register in index.js

Add the import and mapping in `getSdkAdapter()`:

```js
import { myAgentStream } from './my-agent.js';

export function getSdkAdapter(agentType) {
  if (agentType === 'claude-code') return claudeCodeStream;
  if (agentType === 'my-agent') return myAgentStream;
  return null;
}
```

The `agentType` string comes from the `CODING_AGENT` config value set in the admin UI.

### 4. Auth resolution

Use `buildAgentAuthEnv(agentType)` from `lib/tools/docker.js` to get credentials from the settings DB. This returns `{ env: string[], backendApi: string }` where `env` is an array of `KEY=value` strings. Parse them into an env object:

```js
import { buildAgentAuthEnv } from '../../tools/docker.js';

const env = { ...process.env };
const { env: authEnvPairs } = buildAgentAuthEnv('my-agent');
for (const pair of authEnvPairs) {
  const eqIdx = pair.indexOf('=');
  if (eqIdx > 0) env[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
}
```

The agent's auth config (API keys, OAuth tokens, provider selection) is managed in the admin UI at `/admin/event-handler/coding-agents` and stored in the settings DB. `buildAgentAuthEnv()` reads it — you don't need to access the settings DB directly.

### 5. Function parameters

| Param | Type | Description |
|-------|------|-------------|
| `prompt` | `string` | User message text |
| `workspaceDir` | `string` | Absolute path to git repo root (the SDK should execute here) |
| `systemPrompt` | `string\|null` | System prompt for agent mode (null in code mode) |
| `sessionId` | `string\|null` | Previous session ID to resume (null on first message) |
| `permissionMode` | `string` | `'plan'` (read-only) or `'code'` (read-write). Map to the SDK's equivalent permission concept. |
| `attachments` | `Array` | Image attachments: `{ category: 'image', mimeType, dataUrl }` |

### 6. Session continuity contract

Multi-turn conversation works via session IDs:

1. First message: `sessionId` param is `null`. Adapter yields `{ type: 'meta', sessionId: '<new-id>' }`.
2. `chatStream()` writes the session ID to `{workspaceBaseDir}/.claude-ttyd-sessions/7681`.
3. Next message: `sessionId` param contains the saved ID. Adapter passes it to the SDK's resume mechanism.

If the SDK doesn't support session resume, the adapter can ignore `sessionId` — but multi-turn context will be lost between messages.

## What the adapter does NOT handle

These are managed by `chatStream()` in `index.js` — adapters should not duplicate them:

- **Workspace git setup** — `ensureWorkspaceRepo()` clones/checkouts before the adapter is called
- **DB persistence** — `chatStream()` saves user messages, assistant text, and tool invocations
- **Chat creation** — `chatStream()` creates the chat and workspace DB records
- **Auto-titling** — `chatStream()` generates a title after the first message
- **System prompt loading** — `chatStream()` calls `buildCodingAgentSystemPrompt()` and passes the result as `systemPrompt`
- **Skill activation** — `ensureSkills()` runs before the adapter is called
