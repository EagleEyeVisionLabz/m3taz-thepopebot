# lib/db/ — Database (SQLite + Drizzle ORM)

## Column Naming Convention

Drizzle schema uses camelCase JS property names mapped to snake_case SQL columns.
Example: `createdAt: integer('created_at')` — use `createdAt` in JS code, SQL column is `created_at`.

## Migration Workflow

Edit `lib/db/schema.js` → `npm run db:generate` → review generated SQL in `drizzle/` → commit both schema change and migration file. Migrations auto-apply on startup via `migrate()` in `initDatabase()`.

Key files: `schema.js` (source of truth), `drizzle/` (generated migrations), `drizzle.config.js` (Drizzle Kit config), `index.js` (`initDatabase()` calls `migrate()`).

## CRUD Patterns

- Import `getDb()` from `./index.js`
- Functions are synchronous (better-sqlite3 driver)
- Primary keys: `crypto.randomUUID()`
- Timestamps: `Date.now()` (epoch milliseconds)

## Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts (email, bcrypt password hash, role, first_name/last_name/nickname, subscribed_to_system_messages). `role` defaults to `'user'`; only `createFirstUser()` writes `'admin'`. |
| `chats` | Chat sessions (user_id, title, starred, chat_mode, code_workspace_id, timestamps) |
| `messages` | Unified per-user inbox + chat history. `chat_id` nullable (system DMs have none); `user_id` NOT NULL; `payload`, `read`, `delivered_at` columns. Index `messages_inbox_lookup` on `(user_id, read, created_at)` drives the inbox query. |
| `code_workspaces` | Code workspace containers (user_id, container_name, repo, branch, feature_branch, title, last_interactive_commit, coding_agent, scope, starred, has_changes) |
| `user_channels` | Per-user channel linking (user_id, channel, channel_chat_id, code, code_expires_at, verified_at, active_thread_id, system_messages_enabled) — Telegram verification + active thread. `getVerifiedChannels()` orders by `verified_at ASC`; the first verified row is the user's default channel. `system_messages_enabled` (default 1) gates whether `/api/send-dm` calls with `system_message: true` push to this channel — the inbox row is always written regardless. |
| `clusters` | Worker clusters (user_id, name, system_prompt, folders, enabled, starred) |
| `cluster_roles` | Role definitions scoped to a cluster (cluster_id, role_name, role, trigger_config, max_concurrency, plan_mode, cleanup_worker_dir, folders) |
| `settings` | Key-value configuration store (also stores API keys, OAuth tokens, custom LLM providers, and agent job secrets via type/key/value) |

The legacy `notifications` and `subscriptions` tables were dropped in migration 0025. System DMs (job completion, etc.) are now rows in the `messages` table with `chat_id = NULL`.

## System Messages (`lib/db/messages.js`)

Per-user inbox API:

- `createSystemMessage(userId, content, payload)` — write a row with `chat_id = NULL`, `read = 0`, returns the row.
- `getSubscribedAdminIds()` — admin user_ids where `subscribed_to_system_messages = 1`. Used for broadcast fan-out when no `user_id` is supplied to `/api/send-dm` or the GitHub PR-merge webhook.
- `markDelivered(id)` — stamp `delivered_at` after the channel push lands.
- `getMessagesForUser(userId, {scope})`, `getUnreadCountForUser(userId)`, `markMessageRead(userId, id)`, `markAllReadForUser(userId)` — UI inbox helpers.

`saveMessage(chatId, userId, role, content)` in `lib/db/chats.js` is the chat-history writer; it requires `userId` and logs+throws on missing rows.

## OAuth Token Storage

`lib/db/oauth-tokens.js` manages encrypted OAuth tokens for coding agent backends. Tokens are stored in the `settings` table with `type: 'config_secret'`.

**Token types** (`TOKEN_KEYS` map):
- `claudeCode` → `CLAUDE_CODE_OAUTH_TOKEN`
- `codex` → `CODEX_OAUTH_TOKEN`

**Key functions**: `createOAuthToken(tokenType, name, rawToken, userId)`, `listOAuthTokens(tokenType)`, `getNextOAuthToken(tokenType)` (LRU rotation — picks least-recently-used, updates `lastUsedAt`), `deleteOAuthTokenById(id)`, `getOAuthTokenCount(tokenType)`.

**Encryption**: `lib/db/crypto.js` provides AES-256-GCM encryption using `AUTH_SECRET` as the key derivation source (PBKDF2, 100k iterations). Token values are stored as JSON `{name, token}` where `token` is the encrypted ciphertext.

## Settings Table Types

The `settings` table stores all application config (not just key-value pairs). Four `type` values:

| Type | Storage | Purpose |
|------|---------|---------|
| `config` | Plaintext | LLM preferences, agent config, feature flags |
| `config_secret` | AES-256-GCM encrypted | API keys, tokens, GitHub secrets |
| `llm_provider` | Encrypted JSON | Custom OpenAI-compatible provider configs (baseUrl, apiKey, model) |
| `agent_job_secret` | Encrypted | Custom env vars injected into agent containers |

Key functions in `lib/db/config.js`: `getConfigValue()`, `setConfigValue()`, `getConfigSecret()`, `setConfigSecret()`, `getCustomProvider()`, `getAllAgentJobSecrets()`.

OAuth tokens for coding agent backends are stored as `config_secret` with LRU rotation via `lib/db/oauth-tokens.js`.

## Notable Columns

- `chats.chatMode` — `'agent'` (default) or `'code'`. Determines which agent singleton and tools are used.
- `codeWorkspaces.featureBranch` — tracks the git feature branch for the workspace session.
- `codeWorkspaces.hasChanges` — flag set when workspace has uncommitted changes.
- `codeWorkspaces.codingAgent` — per-workspace coding-agent override. Falls back to global `CODING_AGENT` config, then `claude-code` (`lib/code/actions.js:410`).
- `codeWorkspaces.scope` — subdirectory scope within the repo (e.g., `agents/gary-vee`). Resolves the agent's working directory and skills (`lib/ai/scope.js`).
