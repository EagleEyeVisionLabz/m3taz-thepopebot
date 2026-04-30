# setup/ — Interactive Setup Wizard

Entry point: `setup.mjs` (invoked via `thepopebot setup`).

## Wizard Steps

1. **Load `.env`** — `dotenv.config()` runs first so existing values are available to subsequent steps.
2. **Prerequisites** — Checks Node.js (>=18), git, gh CLI (authenticated), Docker. Initializes git repo and GitHub remote if needed.
3. **GitHub PAT** — Validates fine-grained token with required scopes (Actions, Admin, Contents, PRs, Secrets, Workflows).
4. **App URL** — Prompts for public HTTPS URL (ngrok, VPS, PaaS). Generates webhook secret.
5. **Sync Config** — Writes secrets/variables to GitHub and local DB via `syncConfig()`.
6. **Start Server** — Starts Docker containers, polls `/api/ping` to confirm.

The setup wizard does NOT run `npm run build` — `.next` is baked into the event-handler Docker image at publish time.

## Database

Settings DB defaults to `data/db/thepopebot.sqlite` (relative to project root). Override via `DATABASE_PATH` in `.env`. Schema migrations run automatically on server start (`lib/db/index.js`).

## Sync Target Types

Config values are synced to different targets via `lib/sync.mjs`. The mapping lives in `lib/targets.mjs` (`CONFIG_TARGETS`):

| Flag | Storage | Example |
|------|---------|---------|
| `env: true` | `.env` file | `APP_URL`, `GH_OWNER`, `GH_REPO`, `APP_HOSTNAME` |
| `db: true` | `settings` table (plaintext) | `LLM_PROVIDER`, `LLM_MODEL`, `CUSTOM_OPENAI_BASE_URL`, `AGENT_BACKEND` |
| `dbSecret: true` | `settings` table (AES-256-GCM encrypted) | All API keys, OAuth tokens, Telegram bot token, `GH_WEBHOOK_SECRET` |
| `variable: true` | GitHub repo variable | `APP_URL`, `AUTO_MERGE`, `ALLOWED_PATHS`, `RUNS_ON` |
| `secret: true` / `secret: 'NAME'` | GitHub repo secret | `GH_TOKEN`, `GH_WEBHOOK_SECRET` |
| `firstRunOnly: true` | Only written on first setup | `AUTO_MERGE`, `ALLOWED_PATHS` |

A single field can carry multiple flags (e.g., `GH_TOKEN` → `env` + `dbSecret`; `GH_WEBHOOK_SECRET` → `dbSecret` + `secret`).

GitHub-side state is intentionally minimal: only `GH_TOKEN` and `GH_WEBHOOK_SECRET` are mirrored to GitHub Secrets (consumed by CI workflows). Earlier `AGENT_*` mirrors and the `LLM_PROVIDER` / `LLM_MODEL` / `CUSTOM_OPENAI_BASE_URL` / `AGENT_BACKEND` GitHub variables were removed — agent-job containers run locally and read everything from the DB, so those mirrors had no consumers.

The fine-grained PAT must include the **Variables: Read** scope, otherwise `/admin/github/variables` shows every variable as "Not set" and surfaces the underlying API error.

## Adding New Config Fields

1. Add the field to `setup/lib/targets.mjs` `CONFIG_TARGETS` with its flags.
2. If it needs user input, add a prompt step in `setup.mjs`.
3. Run `syncConfig()` to write to all targets.
