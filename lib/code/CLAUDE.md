# lib/code/ — Code Workspaces

## Data Flow

Chat agent's synthetic `coding_agent` tool wrapper → `runInteractiveContainer()` in `lib/tools/docker.js` → Docker container runs `coding-agent-{agent}` image (interactive runtime) → ttyd on port 7681 fronts a tmux session that runs the agent CLI → browser navigates to `/code/{id}` → `TerminalView` (xterm.js) opens WebSocket → `ws-proxy.js` authenticates and proxies to container.

The interactive container's entrypoint launches a tmux session via the per-agent `docker/coding-agent/scripts/agents/<agent>/start-coding-session.sh` script. Multiple terminal tabs can attach to the same tmux session and survive WebSocket reconnects. Tab close + reopen reattaches; container restart re-creates the session with the prior agent session resumed (see "Session Continuity" below).

## WebSocket Auth

Middleware can't intercept WebSocket upgrades. `ws-proxy.js` authenticates directly:

1. Reads `authjs.session-token` cookie from the HTTP upgrade request headers
2. Decodes JWT using `next-auth/jwt` `decode()` with `AUTH_SECRET`
3. Rejects with 401 if no valid token, 403 if workspace not found
4. Proxies WebSocket bidirectionally to `ws://{containerName}:7681/ws`

## Container Recovery

`ensureCodeWorkspaceContainer(id)` in `actions.js` — inspects container state via Docker Engine API (Unix socket), restarts recoverable containers (stopped/exited/paused), recreates dead/missing ones. Returns `{ status: 'running' | 'started' | 'created' | 'no_container' | 'error' }`.

## Server Actions

All actions use `requireAuth()` with ownership checks: `getCodeWorkspaces()`, `createCodeWorkspace()`, `renameCodeWorkspace()`, `starCodeWorkspace()`, `deleteCodeWorkspace()`, `ensureCodeWorkspaceContainer()`.

## Multi-Agent Backends

Code workspaces support multiple coding agent backends. Selection is **per-workspace** via the `codingAgent` column on `code_workspaces`, falling back to the global `CODING_AGENT` config key, then to `claude-code`. The same fallback chain is used by `lib/ai/index.js` for chat-mode streaming.

**Supported agents**: `claude-code`, `pi-coding-agent`, `gemini-cli`, `codex-cli`, `opencode`, `kimi-cli`. Each uses a different Docker image variant (`docker/coding-agent/Dockerfile.*`) and agent-specific setup/auth scripts in `docker/coding-agent/scripts/`.

**Configuration**: Users configure agents via `/admin/event-handler/coding-agents` — enable/disable agents, set per-agent auth mode (OAuth vs API key), provider, and model. `setCodingAgentDefault()` sets the global default. `buildAgentAuthEnv()` in `lib/tools/docker.js` resolves credentials from the settings DB at container launch time.

**Container streaming**: `lib/containers/stream.js` provides an SSE endpoint (`/stream/containers`) that polls Docker for container stats every 3 seconds. Used by the Containers admin page for live monitoring.

**USER_ID env**: Interactive containers receive `USER_ID` (originator user id) so skills like `agent-job-dm` and `agent-job-background` resolve attribution without explicit flags.

**Backend API in messages**: When an agent produces output, the `backendApi` field in message chunks identifies which agent backend generated the response.

## Workspace Commands & Auto-Run

`launchWorkspaceCommand(id, command)` and `runWorkspaceCommand(id, command)` (deprecated) spin up an ephemeral `command/<cmd>` runtime container against the workspace volume. Supported commands: `commit`, `push`, `create-pr`, `pull`, `pull-push`. Prompts are sourced from `lib/git-commands.js` (`getCommandPrompt`) — single source of truth shared with the chat dropdown, the workspace toolbar dropup, the admin defaults select, and `maybeAutoRun()` in `lib/ai/index.js`.

Per-run container names are uniquely suffixed (`command-<cmd>-<shortId>-<rand8>`) so repeated invocations don't collide. The matching SSE log endpoint (`/stream/containers/logs?name=...&cleanup=true`) removes the container on every terminal path.

The interactive workspace toolbar's git command button (`terminal-view.jsx`) reads the workspace's `chatMode` from `/code/{id}/chat-data` and uses a per-mode `localStorage` key (`thepopebot-workspace-command:agent` / `:code`) plus a per-mode `FALLBACK_BY_MODE` (`agent`→`pull-push`, `code`→`create-pr`) so agent-mode workspaces don't inherit code-mode defaults.

## Session Continuity

Code workspaces, chat-mode (SDK adapter), and headless agent jobs share session continuity through `lib/ai/session-manager.js`. Session IDs are written to per-port files inside the workspace volume — `~/.{agent}-ttyd-sessions/${PORT}` (or scope-prefixed when `SCOPE` is set). The agent CLI captures its session ID via per-agent hooks (see `docker/coding-agent/CLAUDE.md` § Session Tracking for the 5 patterns). Capture is gated on `CONTINUE_SESSION=1` so one-shot command containers (commit/push/create-pr/pull/pull-push) sharing a workspace with a live chat don't overwrite the chat's session file. On the next launch the entrypoint reads the saved ID and passes the agent's resume flag (`--continue`, `--resume`, `--session`, depending on agent).

Headless `run.sh` always reads from port `7681` — so SDK chat, manual chat tools, and code workspaces all converge on the same conversation when they share a workspace.
