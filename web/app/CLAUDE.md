# web/app/ — Next.js App Router

Pages, layouts, and route handlers for the event handler's browser UI. Baked into the event-handler Docker image (not scaffolded to user projects).

## Layout

| Path | Contents |
|------|----------|
| `page.js` | Root chat page (`ChatPage` from `thepopebot/chat`) |
| `layout.js` | Root layout |
| `globals.css`, `icon.svg` | Tailwind globals + favicon |
| `login/`, `forbidden/` | Auth boundary pages |
| `chat/`, `chats/` | Chat detail (`/chat/[chatId]`), chat list (`/chats/list`), badge counts (`/chats/counts`), scopes, voice token, finalize-chat |
| `code/` | Code workspace pages and fetch routes — `[codeWorkspaceId]/`, `branches/`, `default-branch/`, `default-repo/`, `repositories/`, `repositories/create/`, `workspace-branch/`, `workspace-diff/` |
| `cluster/`, `clusters/` | Cluster detail + list (see `lib/cluster/CLAUDE.md`). Hidden from sidebar nav for now. |
| `containers/`, `crons/`, `triggers/` | Read-only admin views |
| `messages/` | Per-user inbox (renamed from `notifications/`). Backed by the unified `messages` table with `chat_id = NULL` for system DMs. |
| `pull-requests/` | User dashboard |
| `profile/` | Per-user pages: `profile/login/` (password change), `profile/telegram/` (per-user Telegram linking, see `lib/channels/CLAUDE.md`). The profile page itself splits into a Profile form (firstName/lastName/nickname, no password gate) and a Login & security form (email/password, current password required). |
| `admin/` | Admin pages — see below |
| `api/[...thepopebot]/` | Catch-all for external `/api/*` routes (re-exports from `thepopebot/api`, see `api/CLAUDE.md`) |
| `stream/` | SSE endpoints — see below |

## Thin Re-Export Pattern

Almost every `route.js` file is a one-line re-export of a handler implemented in `lib/chat/api.js`. Example (`web/app/chat/voice-token/route.js`):

```js
export { getVoiceTokenHandler as GET } from 'thepopebot/chat/api';
```

This keeps Next.js routing co-located with pages while implementations live in the package as importable modules. **Do not put handler logic in `route.js` files** — add it to `lib/chat/api.js` and re-export.

For the full fetch-route catalog (data endpoints by URL), see `lib/chat/CLAUDE.md`.

## Admin Sub-Tree (`web/app/admin/`)

Top-level admin pages, in tab order (`settings-layout.jsx`): **General → Event Handler → Crons → Triggers → Users → GitHub**. Plus utility pages not in the tab bar: `api-keys/`, `app-version/`, `chat/`.

`event-handler/` is itself tabbed (pill-style nav per `lib/chat/components/CLAUDE.md`):

- `coding-agents/` — per-agent enable, auth mode, provider, model + Default Coding Agent + per-mode Branch/Git action/Auto-run defaults
- `helper-llm/` — helper LLM config (auto-titles, summaries)
- `llms/` — LLM provider keys + custom providers
- `agent-secrets/` — agent-job secret env vars (the old `/admin/event-handler/jobs` path is gone)
- `telegram/` — bot token + webhook register
- `voice/` — AssemblyAI key
- `webhooks/` — webhook secrets

The old `/admin/github/secrets/` page has been removed; the only real secret it managed (`GH_WEBHOOK_SECRET`) is accessed elsewhere.

## Auth Boundary

| Surface | Auth | Source |
|---------|------|--------|
| Pages + page-colocated `route.js` | `auth()` session via `web/middleware.js` | NextAuth session cookie |
| `/api/[...thepopebot]/*` | `x-api-key` header or webhook secrets | See `api/CLAUDE.md` |
| `/stream/chat` | AI SDK transport (session cookie) | NextAuth |
| Other `/stream/*` | `auth()` session | NextAuth |

`/api/auth/[...nextauth]/route.js` is the NextAuth handler — separate from the catch-all `api/[...thepopebot]/`.

## SSE Endpoints

Four endpoints under `/stream/`:

| Endpoint | Purpose |
|----------|---------|
| `/stream/chat` | AI SDK chat streaming (text deltas, tool-call/tool-result chunks). See `lib/ai/CLAUDE.md`. |
| `/stream/containers` | Docker container status snapshots every 3s. See `lib/containers/CLAUDE.md`. |
| `/stream/containers/logs?name=<container>` | Live container log tail |
| `/stream/cluster/[clusterId]/logs` | Cluster worker log stream. See `lib/cluster/CLAUDE.md`. |

## Cross-References

- Route handler implementations: `lib/chat/api.js` (catalog in `lib/chat/CLAUDE.md`)
- Server actions for mutations: `lib/chat/actions.js`
- UI design system + shared components: `lib/chat/components/CLAUDE.md`
- External `/api/*` boundary: `api/CLAUDE.md`
- Auth flow: `lib/auth/CLAUDE.md`
