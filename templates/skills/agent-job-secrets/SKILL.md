---
name: agent-job-secrets
description: List and retrieve agent secrets. Plain secrets are also available as env vars. OAuth credentials are auto-refreshed on every get call.
---

## Usage

```bash
# List available secret keys (fetches current list from server)
node skills/agent-job-secrets/agent-job-secrets.js

# Get a secret value (OAuth credentials are auto-refreshed)
node skills/agent-job-secrets/agent-job-secrets.js get MY_CREDENTIALS
```

## Notes

- `AGENT_JOB_TOKEN` and `APP_URL` are injected automatically — no setup required
- Plain (non-OAuth) secrets are also available directly as env vars (e.g. `echo $MY_KEY`)
- OAuth credentials must be fetched via `get` — they are not available as env vars
- `get` on an OAuth credential refreshes it server-side and returns a fresh access token
- If a fetched credential stops working (expired token, 401 error), call `get` again to obtain a fresh one
- `list` always fetches from the server, so it reflects secrets added after the container started
