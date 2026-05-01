# Architecture

thepopebot is a self-hosted personal agent platform. One Next.js process — the
**event handler** — runs on your host and orchestrates everything: chat across
channels, scheduled jobs, webhook triggers, the database, and the Docker
containers that the coding agents run inside.

```
┌──────────────────────────── one host ─────────────────────────────────┐
│                                                                       │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │                        Event handler                         │    │
│   │           (Next.js + better-sqlite3 + node-cron)             │    │
│   │                                                              │    │
│   │   • web chat UI + admin                                      │    │
│   │   • /api routes (Telegram, GitHub, OAuth, agent jobs)        │    │
│   │   • cron + trigger runtime (hot-reloaded from JSON files)    │    │
│   │   • SDK chat path (Claude Code) + headless-container path    │    │
│   │   • workspaces, clusters, message inbox, secret store        │    │
│   └────┬─────────────────────────────────────────────────────────┘    │
│        │ Docker socket                                                │
│        ▼                                                              │
│   ┌─────────────────────────────────────────────────────────────┐     │
│   │                  Coding agent containers                    │     │
│   │       (one image per agent: claude-code, pi, codex,         │     │
│   │        gemini, opencode, kimi)                              │     │
│   │                                                             │     │
│   │   agent-job   — ephemeral, opens a PR                       │     │
│   │   headless    — ephemeral, streams output to a chat         │     │
│   │   interactive — long-lived ttyd, attached to a workspace    │     │
│   │   command/*   — ephemeral, runs a git command (commit,      │     │
│   │                push, pull, pull-push, create-pr)            │     │
│   │   cluster-worker — long-lived, executes a role              │     │
│   └─────────────────────────────────────────────────────────────┘     │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

The event handler talks to GitHub for repo I/O (cloning, branches, PRs) and
optionally to Telegram for chat. **Agent-job containers run locally**, not on
GitHub Actions — GitHub Actions only run the auto-merge / notify / rebuild
workflows on the event handler's repo.

---

## File Structure

After `npx thepopebot init`, the user project looks like:

```
/
├── .github/workflows/             # Managed — overwritten on every init/upgrade
│   ├── auto-merge.yml             #   Auto-merges agent-job PRs
│   ├── notify-pr-complete.yml     #   Forwards user_id + PR data back to /api/github/webhook
│   ├── rebuild-event-handler.yml  #   Pulls new image + restarts on push to main
│   └── upgrade-event-handler.yml  #   Manual workflow_dispatch upgrade
├── agent-job/                     # Yours — never overwritten
│   ├── SYSTEM.md                  #   Agent-job system prompt
│   ├── HEARTBEAT.md
│   └── CRONS.json                 #   Hot-reloaded by lib/cron.js
├── event-handler/                 # Yours — never overwritten
│   ├── agent-chat/SYSTEM.md       #   Live chat, agent mode
│   ├── code-chat/SYSTEM.md        #   Live chat, code mode
│   ├── clusters/{SYSTEM,ROLE}.md
│   ├── litellm/main.yaml          #   Synced from custom-provider settings
│   ├── SUMMARY.md
│   └── TRIGGERS.json              #   Hot-reloaded by lib/triggers.js
├── agents/                        # Yours — scoped agents (own SYSTEM.md, own skills/)
├── skills/                        # Yours — every agent sees these
├── data/db/thepopebot.sqlite      # SQLite + Drizzle migrations
├── logs/<AGENT_JOB_ID>/           # Per-job config + session logs
├── docker-compose.yml             # Managed
├── .env                           # Yours — bootstrap (AUTH_SECRET, DATABASE_PATH, GH_OWNER/REPO, APP_URL)
├── next.config.mjs                # Yours — re-exports from thepopebot/config
├── instrumentation.js             # Yours — re-exports thepopebot's register()
└── package.json
```

All real logic lives in the `thepopebot` npm package; the user project is
configuration + thin wiring. See [Upgrading](UPGRADE.md) for how managed paths
stay in sync without overwriting your customizations.

---

## API Endpoints

`/api/*` is for **external callers** — Telegram, GitHub webhooks, cURL, cron
scripts. Browser UI uses session-authenticated fetch routes colocated with
pages, not `/api`.

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/ping` | GET | none | Health check |
| `/api/create-agent-job` | POST | `x-api-key` | Spawn a background agent job. Body: `{ agent_job, llm_model?, agent_backend?, scope?, user_id? }`. `user_id` attributes the job back to the originator. |
| `/api/agent-jobs/status` | GET | `x-api-key` | Status of a running job |
| `/api/users` | GET | `x-api-key` | List users + their verified channels (used by `agent-job-dm` skill) |
| `/api/send-dm` | POST | `x-api-key` | Dispatch a system message — to one user, or broadcast to subscribed admins |
| `/api/get-agent-job-secret` | GET | `agent_job_api_key` only | Read a secret from inside a running agent job. OAuth tokens auto-refresh under a per-key lock. |
| `/api/agent-job-list-secrets` | GET | `agent_job_api_key` only | List secret keys (no values) |
| `/api/telegram/webhook` | POST | Telegram secret | Inbound Telegram messages — per-user verified, dispatches `/verify` and `/session` slash commands |
| `/api/github/webhook` | POST | GitHub secret | PR-merge events trigger a completion DM (per-user when `user_id` is on the job, broadcast otherwise) |
| `/api/oauth/callback` | GET/POST | short-lived `state` token | Generic OAuth provider redirect target |
| `/api/cluster/:id/role/:id/webhook` | POST | `x-api-key` | Fire a cluster role |

Two API key types live in the database: long-lived **user-owned keys** for
external callers, and short-lived **per-job keys** auto-issued when an
agent-job container launches and cleaned up by the maintenance cron after
expiry.

---

## Live Chat Flow

Every chat message — browser or Telegram — funnels into `chatStream()` in
`lib/ai/`. From there:

```
                user message (browser fetch /stream/chat OR Telegram webhook)
                                       │
                                       ▼
                       ┌─────────────────────────────┐
                       │      chatStream()           │
                       │  • requires userId          │
                       │  • picks chat row's chatMode│
                       │  • builds system prompt     │
                       │  • ensures workspace clone  │
                       └──────────────┬──────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              │                                               │
       SDK adapter exists?                              no adapter
              │                                               │
       streamViaSdk()                                streamViaContainer()
       in-process                                     ephemeral headless
       @anthropic-ai/                                 Docker container
       claude-agent-sdk                              (any other agent)
              │                                               │
              └────────────────────────┬──────────────────────┘
                                       ▼
            normalized chunks {text, tool-call, tool-result,
                               error, auto-run, meta, …}
```

**`chatMode`** on the chat row is either `agent` or `code`. Agent mode chats
about the bot's own repo (config, skills, ops); code mode runs against any
repo + branch the user picks. Within code mode, a `codeModeType` sub-mode
toggles `PERMISSION=plan` (read-only) vs `code` (write).

**Auto-run on chat finish.** When the active mode's `*_AUTO_RUN` flag is set
and the workspace has uncommitted changes, the configured git command (`pull`,
`commit`, `push`, `pull-push`, `create-pr`) launches in a one-shot command
container at stream end. `chatStream()` yields a final `auto-run` chunk; the
UI attaches a spinner without opening the dialog.

**One session, three surfaces.** Live chat (SDK or container), the live
coding workspace, and headless agent jobs all converge on the same per-port
session file (`~/.{agent}-ttyd-sessions/<port>`) inside the workspace volume.
Whoever talks last writes the next session id; whoever talks next reads it
and resumes. Command containers explicitly skip session capture
(`CONTINUE_SESSION` gate) so they can't clobber a chat session running on the
same volume.

---

## Background Agent Jobs

Agent jobs are the fire-and-forget path. The event handler creates an
`agent-job/<id>` branch via the GitHub Git Data API (single tree commit
containing `logs/<id>/agent-job.config.json` — the source of truth for the
job's metadata), then launches a Docker container locally:

```
   user / cron / trigger / chat-spawned skill
                  │
                  ▼
        createAgentJob(description, { scope?, agent_backend?, llm_model?, user_id? })
                  │
                  ▼
        push agent-job/<id> branch          ─►  GitHub
                  │
                  ▼
        runAgentJobContainer()
        • image: coding-agent-{agent}
        • named volume for workspace
        • env: AGENT_JOB_TOKEN, USER_ID, SCOPE, LLM_MODEL, AGENT_JOB_SECRETS, …
                  │
                  ▼
        agent runs, commits, pushes, opens PR
                  │
                  ▼
        auto-merge.yml ──► merged
                  │
                  ▼
        notify-pr-complete.yml ──► POST /api/github/webhook
                                   (forwards user_id from agent-job.config.json)
                  │
                  ▼
        dispatchSystemMessage(): write a row in `messages`,
        push to the originator's default channel (Telegram today)
        — or broadcast to subscribed admins if no user_id
```

`USER_ID` is set on **every** container that carries `AGENT_JOB_TOKEN`
(interactive, headless, agent-job, SDK adapter), so skills like
`agent-job-dm` and `agent-job-background` resolve attribution by default —
spawned child jobs inherit the originator without explicit flags.

---

## Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `auto-merge.yml` | PR opened from `agent-job/*` | Checks `AUTO_MERGE` + `ALLOWED_PATHS`, squash-merges if allowed |
| `notify-pr-complete.yml` | After `auto-merge.yml` succeeds | Reads `agent-job.config.json` and POSTs `user_id` + PR data to `/api/github/webhook` |
| `rebuild-event-handler.yml` | Push to `main` | Detects version change, runs `thepopebot init`, pulls new image, restarts container |
| `upgrade-event-handler.yml` | Manual `workflow_dispatch` | Bumps `thepopebot` in `package.json` and opens an upgrade PR |

See [Upgrading](UPGRADE.md) for the full upgrade flow and recovery.

---

## Database

SQLite via Drizzle ORM at `data/db/thepopebot.sqlite`. Migrations auto-apply
on boot via `initDatabase()`. Key tables:

| Table | Purpose |
|-------|---------|
| `users` | Accounts. First user is `admin`; everyone else defaults to `user`. Profile fields: `firstName`, `lastName`, `nickname`, `subscribedToSystemMessages`. |
| `chats` / `messages` | Chat history + the per-user inbox. `messages.chatId` is nullable so system DMs (job completion, etc.) can live in the same table. Indexed by `(userId, read, createdAt)`. The legacy `notifications` and `subscriptions` tables were dropped — the inbox is just `messages` rows with `chatId = NULL`. |
| `code_workspaces` | Persistent workspace containers (repo, branch, codingAgent, scope, hasChanges) |
| `user_channels` | Per-user channel verification (Telegram today). `verifiedAt ASC` ordering picks the user's default channel. |
| `clusters` / `cluster_roles` | Cluster definitions + role triggers |
| `settings` | All runtime config (`config`, `config_secret`, `llm_provider`, `agent_job_secret`). Encrypted entries use AES-256-GCM keyed off `AUTH_SECRET`. |

The DB is the runtime config store. `.env` only carries bootstrap variables
(`AUTH_SECRET`, `DATABASE_PATH`, `APP_URL`, `GH_OWNER`/`GH_REPO`,
`THEPOPEBOT_VERSION`).

---

## Coding Agent Containers

A two-tier image hierarchy keeps the Linux + Node + Chromium + playwright
toolchain identical across the event handler and the agent containers:

```
thepopebot-base                   Ubuntu 24.04 + Node 22 + locale + Chromium + playwright + UID 1001
  ├── coding-agent-base           + tmux, ttyd, scripts/, entrypoint
  │     ├── coding-agent-claude-code
  │     ├── coding-agent-pi-coding-agent
  │     ├── coding-agent-codex-cli
  │     ├── coding-agent-gemini-cli
  │     ├── coding-agent-opencode
  │     └── coding-agent-kimi-cli
  └── event-handler               + pm2, gosu, Next.js + .next baked in
```

Six coding agents are supported: Claude Code (default), Pi, Codex CLI, Gemini
CLI, OpenCode, Kimi CLI. Each has its own `Dockerfile.<agent>` that adds the
CLI binary, plus matching scripts under `docker/coding-agent/scripts/agents/<agent>/`
implementing the agent-specific contract (auth, setup, run, interactive,
start-coding-session, merge-back). See [Coding Agents](CODING_AGENTS.md) for
auth modes and per-agent config keys.

Five **runtimes** select which workflow scripts run inside the container:

| Runtime | Lifecycle | Used for |
|---------|-----------|----------|
| `agent-job` | ephemeral | Background agent jobs — clone, run, commit, push, open PR |
| `headless` | ephemeral | Live-chat container path for non-SDK agents |
| `interactive` | long-lived | Browser-attached terminal session via ttyd |
| `cluster-worker` | long-lived | Cluster role execution |
| `command/<commit\|push\|create-pr\|pull\|pull-push>` | ephemeral | One-shot git workflows on a workspace volume |

---

## Code Workspaces

A code workspace is a persistent `interactive` container the browser attaches
to via WebSocket (`lib/code/ws-proxy.js`, cookie-authenticated). Each
workspace owns a row in `code_workspaces` (repo, branch, `codingAgent` per-
workspace override, `scope` for scoped agents). The container's tmux session
survives WebSocket reconnects; if the container itself dies, the volume
persists and `ensureCodeWorkspaceContainer()` recreates it. See
[Code Workspaces](CODE_WORKSPACES.md).

---

## Clusters

Groups of containers spawned from `cluster_roles`. Each role can carry up to
four trigger types (manual, webhook, cron, file-watch); all funnel through
`acquireAndRunRole()`, the atomic gate that checks `maxConcurrency` against
`listContainers()` before launching. Plan-mode roles run with
`PERMISSION=plan` so they can't mutate. See [Clusters](CLUSTERS.md).

---

## Session Logs

Each agent job gets `logs/<AGENT_JOB_ID>/` containing
`agent-job.config.json` (job metadata, including `user_id` and `scope`) plus
session JSONL files. Logs are committed to the branch, then removed in a
follow-up commit so they don't merge into `main`. The PR body links to the
log commit's permalink.
