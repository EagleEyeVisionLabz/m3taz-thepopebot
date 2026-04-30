# /api — External API Routes

This directory contains the route handlers for all `/api/*` endpoints. These routes are for **external callers only** — GitHub Actions, Telegram, cURL, third-party webhooks.

## Auth

Most routes require a valid API key passed via the `x-api-key` header. API keys are stored in the SQLite database and managed through the admin UI — they are NOT environment variables.

**Public routes** (no API key needed): `/ping`, `/telegram/webhook` (Telegram webhook secret), `/github/webhook` (GitHub webhook secret), `/oauth/callback` (validated via short-lived `state` token).

Auth flow: `x-api-key` header → `verifyApiKey()` → DB lookup (hashed, timing-safe comparison). Two key types exist:

- **User-owned API keys** — long-lived, created via the admin UI, used by external callers (cURL, GitHub Actions, Telegram register).
- **Per-job agent API keys** (`agent_job_api_key`) — short-lived, auto-created when an agent-job container launches (`createAgentJobApiKey()` in `lib/db/api-keys.js`), tied to the container name, and cleaned up by the maintenance cron after expiry. Routes that read agent-job secrets (`/api/get-agent-job-secret`, `/api/agent-job-list-secrets`) reject any other key type.

## Do NOT use these routes for browser UI

Browser-facing data fetching uses **fetch route handlers** colocated with pages (`route.js` files in `web/app/`). These check `auth()` session — never use `/api` routes from the browser. Server actions (`'use server'`) are used only for **mutations** (rename, delete, star, config updates) — never for data fetching (causes page refresh issues). Handler implementations live in `lib/chat/api.js`; route files are thin re-exports.

Mutation server actions in `lib/chat/actions.js` use `requireAdmin()` for settings/config writes and `requireAuth()` for chat CRUD on user-owned rows. Reads stay open to any logged-in user. Sidebar items like Upgrade are gated on `user.role === 'admin'`.

| Caller | Mechanism | Auth |
|--------|-----------|------|
| External (cURL, GitHub Actions, Telegram) | `/api` route | `x-api-key` header |
| Browser UI (data fetching) | Fetch route handler colocated with page | `auth()` session |
| Browser UI (mutations) | Server action | `requireAuth()` / `requireAdmin()` |
| Browser UI (streaming) | `/stream/chat`, `/stream/containers`, `/stream/containers/logs`, `/stream/cluster/*/logs` | `auth()` session |

## Routes

| Method | Path | Auth | Handler |
|--------|------|------|---------|
| GET | `/api/ping` | None | Health check |
| POST | `/api/create-agent-job` | `x-api-key` | Create agent job. Body: `{ agent_job, llm_model?, agent_backend?, scope?, user_id? }`. `user_id` attributes the job to that user — the PR-merge webhook reads it back to DM the originator instead of broadcasting. |
| GET | `/api/get-agent-job-secret` | `agent_job_api_key` only | Get an agent job secret. `key` query param is upper-cased before lookup (admin form already saves uppercase). `oauth2` credentials return only the access_token (auto-refreshed under a per-key lock; rotated refresh tokens are persisted back). Other secret types return the raw value. |
| GET | `/api/agent-job-list-secrets` | `agent_job_api_key` only | List agent job secret keys (no values); returns `{secrets: [{key, isSet, updatedAt, secretType}]}` |
| GET | `/api/agent-jobs/status` | `x-api-key` | Agent job status (query: `?agent_job_id=`) |
| GET | `/api/users` | `x-api-key` | List users with verified DM channels: `{users: [{id, email, first_name, last_name, nickname, role, channels: ['telegram', ...]}]}`. Used by the `agent-job-dm` skill. |
| POST | `/api/send-dm` | `x-api-key` | Dispatch a system message. Body: `{ user_id?, message, payload? }`. With `user_id`: write 1 row + push to that user's default channel. Without: fan out 1 row per admin where `subscribedToSystemMessages=1`, each pushed to their default channel. Returns `{ok, recipients}`. |
| POST | `/api/telegram/webhook` | Telegram webhook secret | Telegram message handler (per-user routing via `user_channels`; verifies via `/verify <code>`, dispatches `/session` commands) |
| POST | `/api/github/webhook` | GitHub webhook secret | GitHub event handler. PR-merge events read `user_id` from `agent-job.config.json` and dispatch the completion message via `dispatchSystemMessage` (per-user when set; broadcast to subscribed admins when absent). |
| POST | `/api/cluster/:clusterId/role/:roleId/webhook` | `x-api-key` | Trigger cluster role execution |
| GET/POST | `/api/oauth/callback` | `state` token | OAuth provider redirect target. Exchanges `code` for tokens, persists via `setAgentJobSecret(name, stored, 'oauth')`. |

Telegram bot configuration (token + webhook registration) is done from the admin UI at `/admin/event-handler/telegram`, not via an API route.
