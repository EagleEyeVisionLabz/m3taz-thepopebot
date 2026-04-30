# lib/auth/ — Authentication (NextAuth v5)

## Edge-Safe Config Split

**This is the most important pattern.** NextAuth runs in two contexts:

- **Route handler** (full Node.js) — can import DB, do async operations
- **Middleware** (Edge Runtime) — no filesystem, no native modules, no DB

Two config files enforce this boundary:

| File | Safe for Edge? | Contains | Imported by |
|------|---------------|----------|-------------|
| `edge-config.js` | Yes | JWT strategy, callbacks, pages config | `middleware.js` |
| `config.js` | No | Credentials provider, DB imports | Route handler only |

**Never import `config.js` from middleware.** Always import `edge-config.js` there. Importing the wrong one will break edge middleware with "module not found" errors for DB/native dependencies.

## Stale Cookie Cleanup (middleware.js)

When `AUTH_SECRET` rotates or the container restarts, old session JWTs can't be decrypted. Auth.js clears these in route handlers via `sessionStore.clean()`, but **not in middleware** — causing infinite redirect loops. The middleware manually deletes session-token cookies (including chunked variants like `authjs.session-token.0`, `authjs.session-token.1`) while leaving `csrf-token` and `callback-url` intact.

## setupAdmin() — Atomic First-User Creation

`setupAdmin()` server action → `createFirstUser()` in `lib/db/users.js`. The DB call wraps count-check + insert in a single SQLite transaction (SERIALIZABLE isolation), preventing race conditions where two requests both see zero users. Returns `null` if a user already exists.

**No implicit login**: After setup, the user is redirected to `/login?created=1` and must authenticate normally. This ensures proper JWT session establishment.

## Role Model + requireAuth / requireAdmin

The `users.role` column defaults to `'user'`. Only `createFirstUser()` writes `'admin'` — every subsequent `addUser()` / `createUser()` row is a regular user unless explicitly promoted via the admin UI. The role lives in the JWT and is surfaced as `session.user.role`.

`lib/auth/index.js` exports two helpers (regular functions, not `'use server'`):

- `requireAuth()` — any logged-in user; throws redirect to `/login` otherwise.
- `requireAdmin()` — requires `role === 'admin'`; throws redirect to `/forbidden` otherwise.

Mutation server actions in `lib/chat/actions.js` use `requireAdmin()` for settings/config writes (LLM keys, coding-agent config, telegram, voice, webhooks, agent secrets, etc.) and `requireAuth()` for chat/workspace CRUD on user-owned rows. Reads stay open to any logged-in user. The Upgrade sidebar item is gated on `user.role === 'admin'`.

JWT role staleness on demotion is a known limitation — a demoted user keeps `'admin'` in their token until next sign-in.

## getPageAuthState()

Combines `auth()` + `getUserCount()` in a single `Promise.all()` call. Returns `{ session, needsSetup }`. The login page uses `needsSetup` to show either `<SetupForm>` or `<LoginForm>`.

Uses lazy `await import('../db/users.js')` to avoid pulling DB at module level — prevents failures if called before `initDatabase()`.

## Components

- `login-form.jsx` — Client component, calls `signIn('credentials')`, shows success message if `?created=1`
- `setup-form.jsx` — Client component, calls `setupAdmin()` server action, validates password length (min 8)
- `ascii-logo.jsx` — Static branding
- `ui/` — Primitives (button, input, label, card) used by the forms

## OAuth Token Integration

Coding agent backends (Claude Code, Codex) can authenticate via OAuth tokens instead of API keys. Token management is handled by `lib/db/oauth-tokens.js` (not this directory), which stores encrypted tokens in the `settings` table. The auth flow:

1. User adds OAuth tokens via the Coding Agents admin page (`/admin/event-handler/coding-agents`)
2. Tokens are encrypted with `lib/db/crypto.js` (AES-256-GCM, key derived from `AUTH_SECRET`)
3. Agent containers receive tokens at launch — `getNextOAuthToken()` uses LRU rotation to distribute load across multiple tokens
