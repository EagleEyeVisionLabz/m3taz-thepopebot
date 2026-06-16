# ThePopeBot MCP bridge

Exposes ThePopeBot's external `/api` surface as [Model Context Protocol](https://modelcontextprotocol.io) tools so the M3ta-OS wurld (Qu3bii, AionUi, Claude Code, and any MCP client) can drive ThePopeBot as a first-class tool. Speaks MCP over **stdio**; talks to ThePopeBot over HTTP with the `x-api-key` header.

## Tools

| Tool | popebot route | Purpose |
|------|---------------|---------|
| `popebot_ping` | `GET /api/ping` | Health check |
| `popebot_create_agent_job` | `POST /api/create-agent-job` | Launch an autonomous agent job (branch → Docker agent → PR → auto-merge → notify) |
| `popebot_get_agent_job_status` | `GET /api/agent-jobs/status` | Poll a job by id |
| `popebot_list_users` | `GET /api/users` | List users + verified DM channels |
| `popebot_send_dm` | `POST /api/send-dm` | DM a user, or broadcast to subscribed admins |
| `popebot_trigger_cluster_role` | `POST /api/cluster/:id/role/:id/webhook` | Fire a worker-cluster role |

## Setup

```bash
cd mcp
npm install
cp .env.example .env      # then fill in POPEBOT_API_KEY (create it in the popebot admin UI)
npm run smoke             # verifies the server starts and lists tools (no API call)
```

## Config

The bridge resolves config in this order (first hit wins, per key):

1. `process.env.POPEBOT_API_URL` / `POPEBOT_API_KEY`
2. the file at `POPEBOT_ENV_FILE` (KEY=VALUE lines)
3. a `.env` next to `server.mjs`

| Var | Default | Notes |
|-----|---------|-------|
| `POPEBOT_API_URL` | `http://localhost:3000` | ThePopeBot event-handler base URL, no trailing slash |
| `POPEBOT_API_KEY` | — | User-owned API key from the admin UI. **Secret.** |
| `POPEBOT_ENV_FILE` | `<this dir>/.env` | Optional path to an env file |
| `POPEBOT_TIMEOUT_MS` | `30000` | Per-request timeout |

> The API key is **never** hardcoded in MCP client config. Keep it in env or the gitignored `.env`, so `.mcp.json` can be committed safely.

## Wiring into the M3ta-OS wurld

Add to the platform `.mcp.json` (this is done by the platform-side wiring):

```json
"popebot": {
  "type": "stdio",
  "command": "node",
  "args": ["/absolute/path/to/m3taz-thepopebot/mcp/server.mjs"],
  "env": {
    "POPEBOT_API_URL": "http://localhost:3000",
    "POPEBOT_ENV_FILE": "/absolute/path/to/m3taz-thepopebot/mcp/.env"
  }
}
```
