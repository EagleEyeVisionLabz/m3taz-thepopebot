# docker/ — Docker Images & Compose

## Image hierarchy

All tagged `stephengpope/thepopebot:{tag}-{version}`. Two-layer base structure so the event-handler and coding-agent containers share the same Linux + Node + Chromium toolchain. The in-process Claude SDK in event-handler shells out to the same binaries that interactive coding-agent containers do.

```
thepopebot-base                           ← Ubuntu 24.04 + Node 22 + locale + Chromium + playwright + coding-agent user
  ├── coding-agent-base                   ← + tmux, ttyd, agent-job scripts, entrypoint
  │     ├── coding-agent-claude-code      ← + per-agent CLI binary
  │     ├── coding-agent-pi-coding-agent
  │     ├── coding-agent-codex-cli
  │     ├── coding-agent-gemini-cli
  │     ├── coding-agent-opencode
  │     └── coding-agent-kimi-cli
  └── event-handler                       ← + pm2, gosu, Next.js runtime, server.js
```

| Image | Lifecycle | Purpose |
|-------|-----------|---------|
| `thepopebot-base` | Build-only | Shared base. Ubuntu + Node + locale + Chromium + playwright + coding-agent UID 1001 |
| `coding-agent-base` | Build-only | Coding-agent specifics on top of base. Per-agent images extend this |
| `event-handler` | Long-lived | Next.js server. Volume-mounts `/app`, runs PM2 |
| `coding-agent-claude-code` | Ephemeral/Long-lived | Unified coding agent: agent-job, headless, interactive, cluster-worker, command runtimes |
| `coding-agent-pi-coding-agent` | Ephemeral/Long-lived | Pi coding agent variant |
| `coding-agent-codex-cli` | Ephemeral/Long-lived | OpenAI Codex CLI variant |
| `coding-agent-gemini-cli` | Ephemeral/Long-lived | Google Gemini CLI variant |
| `coding-agent-opencode` | Ephemeral/Long-lived | OpenCode variant |
| `coding-agent-kimi-cli` | Ephemeral/Long-lived | Kimi CLI variant |

Build order (enforced by `bin/docker-build.js` and `.github/workflows/publish-npm.yml`):

1. `thepopebot-base`
2. `coding-agent-base` + `event-handler` in parallel (both extend thepopebot-base)
3. All `coding-agent-*` variants in parallel (extend coding-agent-base)

Per-agent script structure (auth, setup, run, interactive, start-coding-session, merge-back) is documented in `docker/coding-agent/CLAUDE.md`.

The event-handler Dockerfile is multi-stage: Stages 1+2 stay on `node:22-bookworm-slim` (lean throwaway environments for `npm install` + `next build`); Stage 3 (the deployed runtime) extends `thepopebot-base`. node_modules and `.next` are built on bookworm and copied into the Ubuntu runtime stage — better-sqlite3 / sharp prebuilds are glibc-forward-compatible so this works.

Stage 3 also installs the same agent runtime extras the coding-agent base provides (jq, procps, locales, fonts, Chromium dependencies, playwright-cli + Chromium under `/opt/pw-browsers`, default `cli.config.json` at `/etc/playwright/`). The in-process Claude SDK in event-handler shells out to these tools, so without the parity install the chat-mode agent hits "command not found" for tools its system prompt advertises.

## Docker Compose

`docker-compose.yml` runs: Traefik (reverse proxy), event-handler. Agent-job containers are NOT in compose — created on-demand by the event handler via Docker API.

Optional overlay compose files (in the project root, scaffolded to user projects):

- `docker-compose.litellm.yml` — adds a LiteLLM proxy sidecar at `http://litellm:4000`. The event handler syncs the user's custom-provider settings to `event-handler/litellm/main.yaml`, and `buildAgentAuthEnv()` routes Anthropic-only agents (Claude Code) through this proxy when targeting non-Anthropic providers.
- `docker-compose.port-forwards.yml` — exposes interactive code-workspace ports for local dev.
- `docker-compose.custom.yml` — user-owned overrides merged with the main compose file.

## Internal Only

This directory is build infrastructure — NOT published to npm, NOT scaffolded to user projects. CI/CD (`publish-npm.yml`) and local dev (`npm run docker:build`, `thepopebot sync`) use these files to build Docker images. Users pull pre-built images from Docker Hub.

## Secrets Flow

Agent-job containers receive auth env vars directly from the event handler via `buildAgentAuthEnv()` in `lib/tools/docker.js`. No GitHub Actions secrets flow — containers are launched locally.
