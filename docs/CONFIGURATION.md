# Configuration

## Overview

Configuration is database-backed. Most settings are stored in SQLite (encrypted for secrets, plaintext for config values). The admin UI is the primary way to manage settings.

`.env` is only for infrastructure variables that must exist before the database is available.

**Config resolution order**: cache -> OAuth tokens (LRU) -> custom provider API key -> DB secret -> DB plain config -> env vars (infrastructure only) -> defaults

---

## Admin UI Reference

| Path | What it configures |
|------|--------------------|
| `/admin/event-handler/coding-agents` | 6 coding agent backends — default agent, per-agent enable / auth / provider / model, plus per-mode Branch / Git action / Auto-run defaults |
| `/admin/event-handler/helper-llm` | Helper LLM (auto-titles, agent-job titles, PR-merge summaries) |
| `/admin/event-handler/llms` | LLM provider API keys + custom OpenAI-compatible providers |
| `/admin/event-handler/agent-secrets` | Agent-job custom secrets (encrypted in SQLite, injected as env vars into agent containers) |
| `/admin/event-handler/telegram` | Bot token, webhook secret, register webhook (per-user chat verification lives at `/profile/telegram`) |
| `/admin/event-handler/voice` | AssemblyAI API key |
| `/admin/event-handler/webhooks` | Webhook secrets |
| `/admin/api-keys` | API keys for `/api/*` endpoint auth |
| `/admin/crons` | Read-only listing of `agent-job/CRONS.json` |
| `/admin/triggers` | Read-only listing of `event-handler/TRIGGERS.json` |
| `/admin/github/tokens` | GitHub PAT |
| `/admin/github/variables` | GitHub repository variables |
| `/admin/users` | User accounts (role + subscribedToSystemMessages) |
| `/admin/general` | Auto-upgrade, beta channel, email updates |

---

## Infrastructure Variables (.env)

These must be set in `.env` because they are needed before the database is available:

| Variable | Description |
|----------|-------------|
| `GH_OWNER` | GitHub repository owner |
| `GH_REPO` | GitHub repository name |
| `APP_URL` | Public HTTPS URL for webhooks |
| `APP_HOSTNAME` | Hostname extracted from APP_URL |
| `AUTH_SECRET` | Required. Encryption key for sessions and DB secrets |
| `AUTH_TRUST_HOST` | Set to `true` for production |
| `DATABASE_PATH` | SQLite path (default: `data/db/thepopebot.sqlite`) |
| `LETSENCRYPT_EMAIL` | Email for Let's Encrypt HTTPS certificates |
| `THEPOPEBOT_VERSION` | Package version (set automatically) |

---

## DB-Backed Secrets

Stored encrypted (AES-256-GCM, key derived from `AUTH_SECRET`) in SQLite, managed via the admin UI:

`GH_TOKEN`, `GH_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `DEEPSEEK_API_KEY`, `MINIMAX_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY`, `KIMI_API_KEY` / `MOONSHOT_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `CUSTOM_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_OAUTH_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ASSEMBLYAI_API_KEY`.

OAuth tokens (`CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_OAUTH_TOKEN`) support multi-token LRU rotation — add multiple tokens at the same key and the event handler picks the least-recently-used on each container launch. Custom OpenAI-compatible providers (added via Admin > Event Handler > LLMs) store their own `baseUrl` + `apiKey` as a `llm_provider` row in `settings`. Agent-job custom secrets are `agent_job_secret` rows.

---

## DB-Backed Config

Stored as plaintext in SQLite, managed via the admin UI:

`LLM_PROVIDER` (default: `anthropic`), `LLM_MODEL` (auto from provider), `LLM_MAX_TOKENS` (default: `4096`), `AGENT_BACKEND`, `CUSTOM_OPENAI_BASE_URL`, `UPGRADE_INCLUDE_BETA` (default: `false`), `CODING_AGENT` (default: `claude-code`), plus `CODING_AGENT_*` keys for the 6 agent backends.

---

## GitHub Personal Access Token

Create a fine-grained PAT scoped to your repository only. Required permissions:

| Permission | Access | Why |
|------------|--------|-----|
| Actions | Read and write | Trigger and monitor workflows |
| Administration | Read and write | Required for self-hosted runners |
| Contents | Read and write | Create branches, commit files |
| Metadata | Read-only | Required (auto-selected) |
| Pull requests | Read and write | Create and manage PRs |
| Secrets | Read and write | Manage agent secrets from the web UI |
| Workflows | Read and write | Create and update workflow files |

Manage your PAT at Admin > GitHub > Tokens.

---

## Agent Job Secrets

Managed at Admin > Event Handler > Agent Secrets (`/admin/event-handler/agent-secrets`). Stored encrypted in SQLite, injected as env vars into agent containers at runtime. Supports manual text entry or an OAuth flow (the running agent can also call the `agent-job-secrets` skill from inside a container; OAuth credentials auto-refresh under a per-key lock and rotated refresh tokens are persisted back).

---

## GitHub Repository Variables

Set via `npx thepopebot set-var` or at Admin > GitHub > Variables. The list is intentionally minimal — the runtime config (LLM provider/model, coding agent, secrets) lives in the SQLite `settings` table, not here. GitHub variables are only read by the bundled CI workflows.

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_URL` | Public URL for the event handler | -- |
| `AUTO_MERGE` | Set to `false` to disable auto-merge of job PRs | enabled |
| `ALLOWED_PATHS` | Comma-separated path prefixes for auto-merge | `/logs` |
| `EVENT_HANDLER_IMAGE_URL` | Docker image for event handler | `stephengpope/thepopebot:event-handler-${THEPOPEBOT_VERSION}` |
| `RUNS_ON` | GitHub Actions runner label (workflows that need it use `self-hosted`) | `ubuntu-latest` |

`LLM_PROVIDER`, `LLM_MODEL`, `CUSTOM_OPENAI_BASE_URL`, and `AGENT_BACKEND` used to mirror to GitHub variables but were removed in 1.2.76 — agent-job containers run locally and read all runtime config straight from the DB, so the GitHub mirrors had no consumers. Coding-agent images are selected per-agent at container launch (`coding-agent-{agent}-${THEPOPEBOT_VERSION}`); there is no longer a single `AGENT_JOB_IMAGE_URL` variable.

---

## Custom LLM Providers

Add OpenAI-compatible providers via Admin > Event Handler > LLMs. Each custom provider has: name, base URL, API key (optional), and model list. Stored encrypted in the database.

---

## Docker Compose

For self-hosted deployment:

```bash
docker compose up -d
```

This starts three services:

- **Traefik** -- Reverse proxy with automatic SSL (Let's Encrypt if `LETSENCRYPT_EMAIL` is set)
- **Event Handler** -- Next.js + PM2, serves the app on port 80
- **Runner** -- Self-hosted GitHub Actions runner for executing jobs

Set `RUNS_ON=self-hosted` as a GitHub repository variable to route workflows to your runner.

See the [Architecture docs](ARCHITECTURE.md) for more details.

---

## Changing APP_URL

If your public URL changes:

1. Update `APP_URL` and `APP_HOSTNAME` in `.env`
2. Update the GitHub repository variable: `npx thepopebot set-var APP_URL <url>`
3. Restart Docker: `docker compose up -d`
4. If Telegram is configured, click **Re-register webhook** at `/admin/event-handler/telegram`
