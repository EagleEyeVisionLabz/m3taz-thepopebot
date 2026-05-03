# thepopebot

Your personal agent, coding environment, and communication platform — all in
one app. Works with any LLM or coding agent. Designed to be simple, unified,
secure, and easy.

- 💬 **Smart chat integrations** — Telegram today; Slack and Discord coming soon. Plus the built-in web chat.
- 🧠 **Any LLM** — Anthropic, OpenAI, Google, DeepSeek, MiniMax, Mistral, xAI, Kimi, OpenRouter, NVIDIA, or any OpenAI-compatible endpoint.
- 🤖 **Any coding agent** — Claude Code, Codex, Gemini, OpenCode, Pi, or Kimi.
- 💻 **Live coding workspaces** — open a terminal in your browser, attach to a running container, share the same session as your chat.
- 🔧 **Real work, not just chat** — agent writes code, opens a PR, auto-merges, DMs you when it's done.
- 🔐 **Yours, fully** — runs on your hardware, your repo, your tokens.

<a href="https://www.skool.com/ai-architects"><img src="docs/hero.png" width="100" alt="thepopebot" /></a>

[Get priority support HERE](https://www.skool.com/ai-architects)

---

## How it works

Three doors, one brain:

```
      ┌── Browser chat ──┐                  ┌── Telegram (verified per-user)
      │                  ▼                  ▼
      │            ┌──────────────────────────────────┐
      │  attach    │           The Brain              │
      │  a live    │     (your event handler)         │
      │  terminal  │                                  │
      │            │   • picks the coding agent       │
      │            │   • picks the coding agent       │
      │            │   • remembers the session        │
      │            │   • runs Docker for you          │
      └── Code ────┤                                  │
        workspace  └──────────────┬───────────────────┘
                                  │
                         ┌────────┴────────┐
                         ▼                 ▼
                  ┌─────────────┐   ┌─────────────────┐
                  │  Live chat  │   │   Agent job     │
                  │ (right now) │   │  (background)   │
                  │             │   │                 │
                  │ same coding │   │ same coding     │
                  │ agent runs  │   │ agent runs in   │
                  │ in-process  │   │ a fresh Docker  │
                  │ or in a     │   │ container,      │
                  │ headless    │   │ opens a PR,     │
                  │ container   │   │ DMs you back    │
                  └─────────────┘   └─────────────────┘
```

### Live chat vs. agent job

| Path           | When                          | What happens                                       |
|----------------|-------------------------------|----------------------------------------------------|
| **Live chat**  | Quick questions, small edits  | Coding agent runs now, streams to your screen      |
| **Agent job**  | "Build it. DM me when done."  | Background worker opens a PR, auto-merges, DMs you |

### Two flavors of chat (`chatMode`)

| `chatMode` | Repo & branch              | Use it for                                  |
|------------|----------------------------|---------------------------------------------|
| `agent`    | Your bot's own repo        | Talking *to* your bot — config, skills, ops |
| `code`     | Any repo + branch you pick | Real coding sessions on a project           |

### Live coding workspaces

Open a workspace from any code-mode chat and the browser attaches a terminal
to a persistent container running your coding agent of choice. Workspace and
chat share the same session — fire a question in chat, hop into the terminal,
the agent already knows what you were just talking about.

### When you ask for a job

```
  you ──► chat ──► event handler ──► creates `agent-job/<id>` branch
                                              │
                                              ▼
                                    launches a Docker container
                                    locally (your chosen agent)
                                              │
                                              ▼
                                    agent commits, pushes,
                                    opens a PR
                                              │
                                              ▼
                                    auto-merge.yml ──► merged
                                              │
                                              ▼
                                    notify-pr-complete.yml ──► DM to you
```

---

## Install

### Prerequisites

| Requirement | Install |
|-------------|---------|
| **Node.js 18+** | [nodejs.org](https://nodejs.org) |
| **Git** | [git-scm.com](https://git-scm.com) |
| **GitHub CLI** | [cli.github.com](https://cli.github.com) |
| **Docker + Docker Compose** | [docker.com](https://docs.docker.com/get-docker/) |
| **ngrok*** | [ngrok.com](https://ngrok.com/download) (free account + authtoken) |

*\*ngrok is only needed for local installs without port forwarding. VPS/cloud deployments don't need it.*

### Two steps

```bash
mkdir my-agent && cd my-agent
npx thepopebot@latest init   # scaffold project
npm run setup                 # interactive wizard
```

The wizard checks prerequisites, creates a GitHub repo, generates a PAT, configures your URL, and starts Docker. Visit your APP_URL when it finishes.

> **Local installs**: your server needs to be reachable from the internet for GitHub webhooks and Telegram. Use [ngrok](https://ngrok.com) (`ngrok http 80`). If your ngrok URL changes, run `npx thepopebot set-var APP_URL <new-url>` and re-register the Telegram webhook from `/admin/event-handler/telegram`.

---

## Upgrade

```bash
npx thepopebot upgrade          # latest stable
npx thepopebot upgrade @beta    # latest beta
npx thepopebot upgrade 1.2.72   # specific version
```

Installs the new package, syncs managed files, rebuilds, restarts Docker.

### What's protected, what gets updated

Two kinds of files behave differently — by design, so an upgrade never blows
away your customizations.

```
   ┌─ Managed files ──────────────┐   ┌─ Your files ─────────────────┐
   │  .github/workflows/          │   │  agent-job/SYSTEM.md         │
   │  docker-compose.yml          │   │  agent-job/CRONS.json        │
   │  .gitignore                  │   │  event-handler/TRIGGERS.json │
   │                              │   │  agents/                     │
   │  Always replaced with the    │   │  skills-library/, skills/    │
   │  latest version on every     │   │  .env, secrets               │
   │  init / upgrade.             │   │  Never touched by upgrade.   │
   └──────────────────────────────┘   └──────────────────────────────┘
```

So you never lose your work — but you might miss a useful template change.
Three commands let you pull updates in deliberately:

```bash
npx thepopebot audit          # show what's drifted from the templates
npx thepopebot diff <file>    # show the diff for one file
npx thepopebot reset <file>   # replace one file with the latest template
npx thepopebot reset-all      # ⚠ nuclear: wipe local edits, restore everything
```

Use them when release notes mention a SYSTEM.md or workflow improvement you want.

> **Upgrade failed?** See [Recovering from a Failed Upgrade](docs/UPGRADE.md#recovering-from-a-failed-upgrade).

---

## How LLMs are wired

Two slots, you pick whether they share a model.

- **Coding agent** — drives **everything you actually talk to**: live chat in the browser/Telegram, code workspaces, and background agent jobs. One agent, one model. For Claude Code the chat runs in-process via the Claude Agent SDK; for any other agent (Pi, Codex, Gemini, OpenCode, Kimi) it runs in an ephemeral headless container — same chunk shape either way. Configured at `/admin/event-handler/coding-agents`.
- **Helper LLM** — small one-shot calls only: chat auto-titles, agent-job titles, PR-merge summaries. Independent provider/model from the coding agent. Configured at `/admin/event-handler/helper-llm`.

A coding-agent task can override its model per-run via `agent_backend` + `llm_model` on a cron, trigger, or chained agent job.

### Using a Claude subscription

If you have Claude Pro or Max, you can power Claude Code with your subscription instead of API billing. Generate a token:

```bash
npm install -g @anthropic-ai/claude-code
claude setup-token
```

Paste it (starts with `sk-ant-oat01-`) into Admin > Event Handler > Coding Agents > Claude Code (auth mode: OAuth). The same token drives live chat *and* background agent jobs — no separate API key needed for chat. Add multiple tokens and they rotate LRU on each container launch.

See [Coding Agents](docs/CODING_AGENTS.md) for details on all six agent backends.

---

## Connect Telegram (optional)

Talk to your bot from your phone. Two steps:

1. **Wire up the bot** — at `/admin/event-handler/telegram`, paste the bot token from [@BotFather](https://t.me/BotFather) and click **Register webhook**.
2. **Verify your account** — at `/profile/telegram`, generate a one-time code and send `/verify <code>` to your bot. The bot only responds to verified users; unbound chats are silently dropped.

Once verified: `/session` lists your active threads, `/session <id>` switches the thread your messages route to. Voice notes are transcribed when an `ASSEMBLYAI_API_KEY` is set in `/admin/event-handler/voice`.

See [Chat Integrations](docs/CHAT_INTEGRATIONS.md) for the channel adapter pattern and how to add new channels (Slack, Discord coming soon).

---

## Security

thepopebot includes API key authentication, webhook secret validation (fail-closed), session encryption (AES-256-GCM keyed off `AUTH_SECRET`), per-job API keys with maintenance-cron expiry, and auto-merge path restrictions. All software carries risk — thepopebot is provided as-is, and you are responsible for securing your own infrastructure. If you're running locally with a tunnel, your dev server endpoints are publicly accessible with no rate limiting and no TLS on the local hop.

See [Security](docs/SECURITY.md) for full details.

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=stephengpope/thepopebot&type=date&legend=top-left)](https://www.star-history.com/#stephengpope/thepopebot&type=date&legend=top-left)

---

## Known Issues

### Windows: `SQLITE_IOERR_SHMOPEN`

SQLite can't create or open its shared-memory (`.shm`) file. Common causes:

- **Antivirus** locking the database — add your project folder to the exclusion list
- **Cloud-synced folders** (OneDrive, Dropbox, Google Drive) — move your project to a non-synced directory

---

## Docs

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | Two-layer design, file structure, API endpoints, GitHub Actions, Docker agent |
| [CLI Reference](docs/CLI.md) | `init`, managed vs user files, template conventions, all CLI commands |
| [Configuration](docs/CONFIGURATION.md) | Admin UI, DB-backed config, infrastructure variables, Docker Compose |
| [Customization](docs/CUSTOMIZATION.md) | Personality, skills, operating system files, using your bot |
| [Chat Integrations](docs/CHAT_INTEGRATIONS.md) | Web chat, Telegram, adding new channels |
| [Different Models](docs/RUNNING_DIFFERENT_MODELS.md) | 10 built-in LLM providers, helper LLM vs coding agent split, per-job overrides, custom providers |
| [Auto-Merge](docs/AUTO_MERGE.md) | Auto-merge controls, ALLOWED_PATHS configuration |
| [Deployment](docs/DEPLOYMENT.md) | VPS setup, Docker Compose, HTTPS with Let's Encrypt |
| [Coding Agents](docs/CODING_AGENTS.md) | 6 coding agent backends, OAuth tokens, LiteLLM proxy, per-agent config |
| [How to Build Skills](docs/HOW_TO_BUILD_SKILLS.md) | Guide to building and activating agent skills |
| [Pre-Release](docs/PRE_RELEASE.md) | Installing beta/alpha builds |
| [Code Workspaces](docs/CODE_WORKSPACES.md) | Interactive Docker containers with in-browser terminal |
| [Clusters](docs/CLUSTERS.md) | Agent clusters — groups of Docker containers spawned from role definitions |
| [Hacks](docs/HACKS.md) | Tips, tricks, and workarounds |
| [Mobile Testing](docs/MOBILE_TESTING.md) | Testing on mobile devices |
| [Security](docs/SECURITY.md) | Security disclaimer, local development risks |
| [Upgrading](docs/UPGRADE.md) | Automated upgrades, recovering from failed upgrades |

### Maintainer

| Document | Description |
|----------|-------------|
| [NPM](docs/NPM.md) | Updating skills, versioning, and publishing releases |
