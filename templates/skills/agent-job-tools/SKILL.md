---
name: agent-job-tools
description: Use when you need to access agent secrets, API keys, or create and manage background jobs. Supports listing keys and retrieving values, with OAuth credentials auto-refreshed. Also handles requests to "create a background job," "spawn a job," or "kick off an agent job."
---

## Usage

```bash
# List available secret keys (fetches current list from server)
node skills/agent-job-tools/agent-job-tools.js secrets list

# Get a secret value (OAuth credentials are auto-refreshed)
node skills/agent-job-tools/agent-job-tools.js secrets get MY_CREDENTIALS

# Run an agent job in the background
node skills/agent-job-tools/agent-job-tools.js jobs create "Update the README with installation instructions"

# With overrides
node skills/agent-job-tools/agent-job-tools.js jobs create "Refactor the auth module" \
  --llm-model claude-opus-4-7 \
  --agent-backend claude-code \
  --scope agents/refactor

# Status of running jobs (all, or one by id)
node skills/agent-job-tools/agent-job-tools.js jobs status
node skills/agent-job-tools/agent-job-tools.js jobs status <agent_job_id>
```

## Important: pass-through behavior for `jobs create`

The `<description>` arg becomes the new job's prompt verbatim. **Pass it through unchanged — do not summarize, condense, or rewrite the user's request before calling.** The new job's agent reads this description directly as its task. If the user gave you a multi-paragraph spec, pass the multi-paragraph spec.

## Scope inheritance

If the calling agent is running with a `SCOPE` env var set, `jobs create` defaults the new job to that same scope. Pass `--scope <value>` to override, or `--scope ""` to clear scope on the new job.

## Notes

- `AGENT_JOB_TOKEN` and `APP_URL` are injected automatically — no setup required.
- Plain (non-OAuth) secrets are also available directly as env vars (e.g. `echo $MY_KEY`).
- OAuth credentials must be fetched via `secrets get` — they are not available as env vars.
- `secrets get` on an OAuth credential refreshes it server-side and returns a fresh access token.
- If a fetched credential stops working (expired token, 401 error), call `secrets get` again to obtain a fresh one.
- `secrets list` always fetches from the server, so it reflects secrets added after the container started.
