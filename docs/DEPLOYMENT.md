# Production Deployment

## Local Development

```bash
npm run dev    # Next.js dev server
```

## Production (Docker Compose)

```bash
npx thepopebot init   # Scaffold project
npm run setup          # Configure .env, database, GitHub secrets
docker-compose up      # Start Traefik + event handler + runner
```

## Event Handler Docker Image

The event handler Dockerfile (`docker/event-handler/Dockerfile`) is a 3-stage build:

1. **builder** (Debian / `node:22-bookworm-slim`) — installs build tools (python3, make, g++) and runs `npm install` to compile native addons (`better-sqlite3`, `sharp`).
2. **next-builder** (same Debian image) — runs `next build`, producing `.next/` output.
3. **runtime** (extends `thepopebot-base`, Ubuntu 24.04 + Node 22 + Chromium + playwright) — copies the pre-built `node_modules` and `.next/` from stages 1+2, plus PM2, gosu, and the agent runtime parity (jq, fonts, libnss, etc.) so the in-process Claude SDK can shell out to the same tools the interactive containers use.

`better-sqlite3` and `sharp` prebuilds are glibc-forward-compatible, so building native modules on Debian and running them on Ubuntu works in practice (verified by smoke tests).

The `.next/` output and `node_modules` are **baked into the image** — there is no in-container `npm install` or `next build` at deploy time.

### What the user project mounts

The user's project directory only volume-mounts user-editable subdirectories into `/app` (e.g. `agent-job/`, `event-handler/`, `skills/`, `agents/`, `data/`, `.env`, `logs/`). The full project is also mounted at `/project` for git access. The image's own `/app/node_modules` and `/app/.next` are never overlaid because those paths aren't bind-mounted.

### Rebuilds after code changes

When the upgrade PR for a new `thepopebot` version merges, `rebuild-event-handler.yml` pulls the new image (which already contains the rebuilt `.next` + `node_modules`), stops the old container, and `docker compose up -d` the new one. There is no in-container `next build` step. See [Upgrading](UPGRADE.md).

## docker-compose.yml Services

| Service | Image | Purpose |
|---------|-------|---------|
| **traefik** | `traefik:v3` | Reverse proxy with automatic HTTPS (Let's Encrypt) |
| **event-handler** | `stephengpope/thepopebot:event-handler-${THEPOPEBOT_VERSION}` | Next.js runtime + PM2 (port 80). Spawns coding-agent containers locally via the Docker socket. |
| **runner** | `myoung34/github-runner:latest` | Self-hosted GitHub Actions runner — used **only** for the upgrade and rebuild workflows |

The runner has a read-only volume mount (`.:/project:ro`) so `upgrade-event-handler.yml` can `docker compose` against the project's compose file. **Agent-job containers run locally**, launched by the event handler via the Docker API — they don't go through this runner or GitHub Actions.

## Deploy to a VPS

Deploy your agent to a cloud VPS with HTTPS.

### 1. Server prerequisites

You need a VPS (any provider — Hetzner, DigitalOcean, AWS, etc.) with:

- Docker + Docker Compose
- Node.js 18+
- Git
- GitHub CLI (`gh`)

Point a domain (e.g., `mybot.example.com`) to your server's IP address with a DNS A record.

### 2. Scaffold and configure

SSH into your server and scaffold the project:

```bash
mkdir my-agent && cd my-agent
npx thepopebot@latest init
npm run setup
```

When the setup wizard asks for `APP_URL`, enter your production URL with `https://` (e.g., `https://mybot.example.com`).

Set the `RUNS_ON` GitHub variable so workflows use your server's self-hosted runner instead of GitHub-hosted runners:

```bash
gh variable set RUNS_ON --body "self-hosted" --repo OWNER/REPO
```

### 3. Enable HTTPS (Let's Encrypt)

The `docker-compose.yml` has Let's Encrypt support built in but commented out. Three edits to enable it:

**a) Add your email to `.env`:**

```
LETSENCRYPT_EMAIL=you@example.com
```

**b) In `docker-compose.yml`, remove the `#` from the TLS lines in the traefik service command:**

```yaml
# Before (commented out):
# - --entrypoints.web.http.redirections.entrypoint.to=websecure
# ...

# After (uncommented):
- --entrypoints.web.http.redirections.entrypoint.to=websecure
- --entrypoints.web.http.redirections.entrypoint.scheme=https
- --certificatesresolvers.letsencrypt.acme.email=${LETSENCRYPT_EMAIL}
- --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
- --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
```

**c) In the event-handler labels, switch from HTTP to HTTPS:**

Add a `#` to comment out the HTTP entrypoint, and remove the `#` from the two HTTPS lines:

```yaml
# Before:
- traefik.http.routers.event-handler.entrypoints=web
# - traefik.http.routers.event-handler.entrypoints=websecure
# - traefik.http.routers.event-handler.tls.certresolver=letsencrypt

# After:
# - traefik.http.routers.event-handler.entrypoints=web
- traefik.http.routers.event-handler.entrypoints=websecure
- traefik.http.routers.event-handler.tls.certresolver=letsencrypt
```

### 4. Launch

```bash
docker compose up -d
```

Ports 80 and 443 must be open on your server. Port 80 is required even with HTTPS — Let's Encrypt uses it for the ACME HTTP challenge to verify domain ownership.
