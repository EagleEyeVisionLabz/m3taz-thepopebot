# CLI Reference

## Understanding `init`

### How your project is structured

When you ran `thepopebot init` the first time, it scaffolded a project folder with two kinds of files:

**Your files** — These are yours to customize. `init` will never overwrite them:

| Files | What they do |
|-------|-------------|
| `agent-job/SYSTEM.md`, `CRONS.json`, etc. | Your agent's behavior, prompts, and scheduled jobs |
| `event-handler/TRIGGERS.json`, `SUMMARY.md`, etc. | Your webhook triggers and event handler prompts |

**Managed files** — These are infrastructure files that need to stay in sync with the package version. `init` auto-updates them for you:

| Files | What they do |
|-------|-------------|
| `.github/workflows/` | GitHub Actions that run jobs, auto-merge PRs, rebuild on deploy |
| `docker-compose.yml` | Defines how your containers run together (Traefik, event handler, runner) |
| `.dockerignore` | Keeps unnecessary files out of Docker builds |
| `.gitignore` | Git ignore rules |
| `CLAUDE.md` | AI assistant context for your project |

### What happens when you run `init`

1. **Managed files** are updated automatically to match the new package version
2. **Your files** are left alone — but if the package ships new defaults (e.g., a new field in `CRONS.json`), `init` lets you know:

```
Updated templates available:
These files differ from the current package templates.

  agent-job/CRONS.json

To view differences:  npx thepopebot diff <file>
To reset to default:  npx thepopebot reset <file>
```

You can review at your own pace:

```bash
npx thepopebot diff agent-job/CRONS.json    # see what changed
npx thepopebot reset agent-job/CRONS.json   # accept the new template
```

### If you've modified managed files

If you've made custom changes to managed files (e.g., added extra steps to a GitHub Actions workflow), use `--no-managed` so `init` doesn't overwrite your changes:

```bash
npx thepopebot init --no-managed
```

### Template file conventions

The `templates/` directory contains files scaffolded into user projects by `thepopebot init`. Two naming conventions handle files that npm or AI tools would otherwise misinterpret:

**`.template` suffix** — Files ending in `.template` are scaffolded with the suffix stripped. This is used for files that npm mangles (`.gitignore`) or that AI tools would pick up as real project docs (`CLAUDE.md`).

| In `templates/` | Scaffolded as |
|-----------------|---------------|
| `.gitignore.template` | `.gitignore` |
| `CLAUDE.md.template` | `CLAUDE.md` |
| `api/CLAUDE.md.template` | `api/CLAUDE.md` |

**`CLAUDE.md` exclusion** — The scaffolding walker skips any file named `CLAUDE.md` (without the `.template` suffix). This is a safety net so a bare `CLAUDE.md` accidentally added to `templates/` never gets copied into user projects where AI tools would confuse it with real project instructions.

---

## CLI Commands

All commands are run via `npx thepopebot <command>` (or the `npm run` shortcuts where noted).

**Project setup:**

| Command | Description |
|---------|-------------|
| `init` | Scaffold a new project, or update templates in an existing one |
| `setup` | Run the full interactive setup wizard (`npm run setup`) |
| `reset-auth` | Regenerate AUTH_SECRET, invalidating all sessions |

**Templates:**

| Command | Description |
|---------|-------------|
| `diff [file]` | List files that differ from package templates, or diff a specific file |
| `reset [file]` | List all template files, or restore a specific one to package default |
| `upgrade` / `update` | Upgrade thepopebot (install, init, build, commit, push, restart Docker) |
| `sync <path>` | Sync local package to a test install (build, pack, Docker) |
| `user:password <email>` | Change a user's password |

**Secrets & variables:**

These commands set individual GitHub repository secrets/variables using the `gh` CLI. They read `GH_OWNER` and `GH_REPO` from your `.env`. If VALUE is omitted, you'll be prompted with masked input (keeps secrets out of shell history).

| Command | Description |
|---------|-------------|
| `set-var KEY [VALUE]` | Set a GitHub repository variable |

Agent job secrets are managed at Admin > Event Handler > Agent Secrets (`/admin/event-handler/agent-secrets`), stored encrypted in SQLite, and injected directly into Docker containers.
