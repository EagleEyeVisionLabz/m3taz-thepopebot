# lib/chat/ — Chat System

## Files

| File | Purpose |
|------|---------|
| `api.js` | Route handlers for all browser-to-server fetch calls (chat streaming + data endpoints) |
| `actions.js` | Server actions for mutations (rename, delete, star, coding agent config, container management) |
| `utils.js` | `cn()` — Tailwind class merging via `clsx` + `twMerge` |
| `components/` | React UI components (see `components/CLAUDE.md` for standards) |

## Route Handler Architecture

`api.js` contains all handler implementations. Route files in `web/app/` are thin re-exports:

```js
// web/app/code/repositories/route.js
export { getRepositoriesHandler as GET } from 'thepopebot/chat/api';
```

**Streaming** (stays in `/stream/`):
- `POST /stream/chat` — AI SDK streaming via `createUIMessageStream`. Handles file attachments (images/PDFs as visual, text files inlined), workspace context, and code mode settings.

**Data fetch routes** (colocated with pages):
- `/code/repositories` (GET), `/code/repositories/create` (POST) — list / create GitHub repos
- `/code/branches`, `/code/default-branch`, `/code/default-repo` — GitHub branch listing + defaults
- `/code/workspace-branch` (POST) — update workspace branch
- `/code/workspace-diff/[workspaceId]` — diff stats
- `/code/workspace-diff/[workspaceId]/full` — full unified diff
- `/chats/list` — chat list with workspace join
- `/chats/counts` — sidebar badge counts (`messages`, `pull_requests`, etc.) — `messages` is per-user unread count from the `messages` table
- `/chat/[chatId]/data` — chat + workspace data
- `/chat/[chatId]/messages` — chat message history
- `/code/[codeWorkspaceId]/chat-data` — chat data + chatMode by workspace (used by terminal-view + code-mode-toggle to pick per-mode storage keys)
- `/chat/voice-token` — AssemblyAI temporary token
- `/chat/scopes` — list of available agent scopes
- `/admin/app-version` (GET/POST) — current version + update check
- `/chat/finalize-chat` (POST) — auto-title after first message

## Chat Streaming Flow

1. Client sends message via AI SDK `DefaultChatTransport` → `POST /stream/chat`
2. Handler validates session, extracts text + file attachments from message parts. Images and PDFs pass through as vision content; text files are inlined into the prompt.
3. Calls `chatStream()` from `lib/ai/` which handles DB persistence and LLM invocation. Two paths: SDK adapter (in-process, e.g. Claude Agent SDK) or direct headless container (other agents).
4. Streams response chunks (text deltas, tool calls, tool results, thinking blocks, errors) via `createUIMessageStream`. Tool call/tool result pairs and `{ type: 'error' }` chunks are persisted as JSON message parts.
5. After the stream ends successfully, if the active mode's `*_AUTO_RUN` flag is on and the workspace has uncommitted changes, `chatStream()` launches the configured workspace command (`pull`/`commit`/`push`/`pull-push`/`create-pr`) in a fresh container and yields a final `{ type: 'auto-run', command }` chunk. `api.js` writes it as a `data-auto-run` part; `chat.jsx` forwards it to WorkspaceBar so the spinner attaches.
6. After the first user message streams, the client calls `/chat/finalize-chat` to generate the auto-title (helper LLM with truncated-description fallback).

## Server Actions (actions.js)

Used for mutations that don't need streaming responses, **and for settings/admin page data reads** (e.g. `getCodingAgentSettings()`, `getApiKeySettings()`, `getGitHubConfig()`, `getAgentJobSecrets()`, `getGeneralSettings()`, `getTelegramStatus()`, `getRunnersStatus()`). Reading settings data through server actions is an accepted, intentional convention — the page-refresh issue that pushes chat/data-stream surfaces toward route handlers does not affect these auth-gated settings reads, and migrating them to route handlers is not required.

Auth gating: privileged reads of secrets/credentials and all config writes go through `requireAdmin()` (e.g. `getAgentJobSecrets()`, `getOAuthSecretCredentials()`, `updateAgentJobSecret()`); non-sensitive settings reads use `requireAuth()`; chat/workspace CRUD uses `requireAuth()` plus user-id ownership checks. Key groups:

- **Chat CRUD**: `renameChat()`, `deleteChat()`, `starChat()`
- **Coding agents**: `getCodingAgentSettings()`, `updateCodingAgentConfig()`, `setCodingAgentDefault()`
- **Mode defaults**: `getModeGitActionDefault()`, `setModeDefault()` — git-action/auto-run defaults per chat mode (agent vs code); branch defaults are read via `getCodingAgentSettings().modeDefaults`. `setModeDefault()` validates against `GIT_COMMAND_SET` from `lib/git-commands.js`.
- **Agent job secrets**: `getAgentJobSecrets()`, `updateAgentJobSecret()`, `deleteAgentJobSecretAction()`
- **Container management**: `getRunnersStatus()`, `stopDockerContainer()`, `startDockerContainer()`, `removeDockerContainer()`
