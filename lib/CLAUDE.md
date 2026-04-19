# lib/ — Action Dispatch System

Both cron jobs and webhook triggers use the same shared dispatch system (`lib/actions.js`). Every action has a `type` field — `"agent"` (default), `"command"`, or `"webhook"`.

| | `agent` | `command` | `webhook` |
|---|---------|-----------|-----------|
| **Uses LLM** | Yes — Docker agent container | No — shell command | No — HTTP request |
| **Runtime** | Minutes to hours | Milliseconds to seconds | Milliseconds to seconds |
| **Cost** | LLM API calls + GitHub Actions | Free (runs on event handler) | Free (runs on event handler) |

If the task needs to *think*, use `agent`. If it just needs to *do*, use `command`. If it needs to *call an external service*, use `webhook`.

**Agent**: Creates a Docker Agent job via `createAgentJob()`. Pushes an `agent-job/*` branch and launches a local Docker container. The `job` string is the LLM task prompt. Agent backend selected via `agent_backend` in `agent-job.config.json`.

**Command**: Runs a shell command on the event handler. Working directory: project root.

**Webhook**: Makes an HTTP request. `GET` skips the body; `POST` (default) sends `{ ...vars }` or `{ ...vars, data: <payload> }`.

## Cron Jobs

Defined in `agent-job/CRONS.json`, loaded by `lib/cron.js` at startup via `node-cron`. Each entry has `name`, `schedule` (cron expression), `type` (`agent`/`command`/`webhook`), and the corresponding action fields (`job`, `command`, or `url`/`method`/`headers`/`vars`). Set `enabled: false` to disable. Agent-type entries support optional `llm_provider`, `llm_model`, and `scope` fields. `scope` sets the agent's working directory to a subdirectory (e.g., `"scope": "agents/gary-vee"`) — the system prompt and skills resolve from that scope.

## Webhook Triggers

Defined in `event-handler/TRIGGERS.json`, loaded by `lib/triggers.js`. Each trigger watches an endpoint path (`watch_path`) and fires an array of actions (fire-and-forget, after auth, before route handler). Actions use the same `type`/`job`/`command`/`url` fields as cron jobs, including optional `llm_provider`/`llm_model`/`scope` overrides.

Template tokens in `job` and `command` strings: `{{body}}`, `{{body.field}}`, `{{query}}`, `{{query.field}}`, `{{headers}}`, `{{headers.field}}`.
