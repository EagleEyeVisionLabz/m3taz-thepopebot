# Customization

## The Operating System

Two directories define who the agent is and how it behaves:

**`agent-job/`** — Docker agent job configuration:

| File | Purpose |
|------|---------|
| `SYSTEM.md` | Agent system prompt (identity + runtime environment) |
| `HEARTBEAT.md` | Self-monitoring behavior |
| `CRONS.json` | Scheduled job definitions |

**`event-handler/`** — Event handler configuration:

| File | Purpose |
|------|---------|
| `agent-chat/SYSTEM.md` | Agent chat system prompt |
| `code-chat/SYSTEM.md` | Code workspace planning system prompt |
| `SUMMARY.md` | Prompt for summarizing completed jobs |
| `clusters/SYSTEM.md` | System prompt for cluster worker agents |
| `clusters/ROLE.md` | Per-role prompt template for cluster workers |
| `TRIGGERS.json` | Webhook trigger definitions |

Each agent job automatically gets its own `logs/<AGENT_JOB_ID>/agent-job.config.json` file created by the event handler. Jobs are created via Telegram chat, webhooks, or cron schedules.

---

## Using Your Bot

There are several ways to interact with your agent — web chat, Telegram, webhooks, and scheduled jobs. See [Chat Integrations](CHAT_INTEGRATIONS.md) for details on adding other channels.

### Web Chat

Visit your APP_URL to access the built-in web chat interface. Features include:

- **Streaming responses** — AI responses stream in real-time
- **File uploads** — Send images, PDFs, and text files
- **Chat history** — Browse and resume past conversations
- **Voice input** — Record and send voice messages directly from the browser
- **Code workspaces** — Launch interactive coding environments with in-browser terminals
- **Job management** — Create and monitor agent jobs from the Runners page
- **Notifications** — Get notified when jobs complete or require attention

The web chat is available out of the box after setup — no additional configuration needed.

### Telegram Chat (Optional)

Connect a Telegram bot to chat with your agent on the go. Set up at `/admin/event-handler/telegram` — paste your bot token, click **Register webhook**, then verify your personal chat at `/profile/telegram`.

The bot uses your LLM to understand requests and can:

- **Chat** — Have a conversation, ask questions, get information
- **Create jobs** — Say "create a job to..." and the bot will spawn an autonomous agent

**Security:** Per-user verification — each user links their own Telegram chat with a one-time code. The bot only responds to verified users.

#### Voice Messages

Send voice notes to your bot and they'll be transcribed using AssemblyAI.

**Requirements:**
- `ASSEMBLYAI_API_KEY` — configure at Admin > Event Handler > Voice

The bot automatically detects voice messages and transcribes them before processing. The voice button in the web chat input uses the same key for real-time transcription.

### Webhooks

Create jobs programmatically via HTTP:

```bash
curl -X POST https://your-app-url/api/create-agent-job \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"agent_job": "Update the README with installation instructions"}'
```

API keys are managed at Admin > Event Handler > Webhooks.

### Scheduled Jobs

Define recurring jobs in `agent-job/CRONS.json`:

```json
[
  {
    "name": "daily-check",
    "schedule": "0 9 * * *",
    "type": "agent",
    "job": "Check for dependency updates",
    "enabled": true
  },
  {
    "name": "cleanup-logs",
    "schedule": "0 0 * * 0",
    "type": "command",
    "command": "ls -la logs/",
    "enabled": false
  },
  {
    "name": "daily-check-codex",
    "schedule": "0 9 * * *",
    "type": "agent",
    "job": "Check for dependency updates",
    "agent_backend": "codex-cli",
    "llm_model": "gpt-5.4",
    "enabled": false
  }
]
```

Each cron entry requires a `type` field — one of `agent` (spawns a Docker agent job), `command` (runs a shell command), or `webhook` (sends an HTTP request). Agent jobs can pick a specific coding agent with `agent_backend` and override its model with `llm_model`. Set `"enabled": true` to activate a scheduled job.

---

## Skills

Skill source files live in `skills-library/<name>/` (canonical store). The `skills/` directory is the **activation surface** — each entry is a symlink to `../skills-library/<name>`, and only symlinked skills are visible to coding agents. All agents read from the same `skills/` directory via symlink bridges (`.claude/skills`, `.pi/skills`, etc.).

Each skill has a `SKILL.md` with YAML frontmatter (`name`, `description`) that the agent reads to understand when and how to use it.

### Default Skills

These ship with the package and are auto-activated on first install:

| Skill | Description |
|-------|-------------|
| `agent-job-secrets` | List and retrieve agent-job secrets (OAuth credentials auto-refresh) |
| `agent-job-dm` | List users + send a DM (or broadcast) via the recipient's default channel |
| `agent-job-background` | Spawn a new agent job in the background and check its status |
| `playwright-cli` | Browser automation via Playwright CLI |

The `agent-job-dm` and `agent-job-background` skills both default `--user-id` to the running container's `USER_ID` env var, so chat-spawned jobs naturally attribute back to the originator (their completion DM lands in the right inbox).

### Adding & Removing

```bash
# Add a custom skill: source goes in skills-library/, then symlink to activate
mkdir -p skills-library/my-skill
# ... add SKILL.md and any scripts ...
ln -s ../skills-library/my-skill skills/my-skill

# Deactivate without losing source
rm skills/my-skill

# Permanently delete
rm skills/my-skill && rm -rf skills-library/my-skill
```

On `npx thepopebot upgrade`, new bundled skills land in `skills-library/` un-activated — symlink them into `skills/` to opt in.

---

## Security

| What the AI tries | What happens |
|-------------------|--------------|
| `echo $ANTHROPIC_API_KEY` | Empty |
| `echo $GH_TOKEN` | Empty |
| `cat /proc/self/environ` | Secrets missing |
| Claude API calls | Work normally |
| GitHub CLI commands | Work normally |

### How Secret Protection Works

1. The event handler collects credentials from the config database and passes them as env vars to the Docker container
2. The entrypoint decodes the JSON and exports each key as an env var
3. The coding agent starts — SDKs read their env vars (ANTHROPIC_API_KEY, gh CLI uses GH_TOKEN)
4. The `env-sanitizer` extension (Pi agent) or equivalent mechanism filters secret keys from bash subprocess env
5. The LLM can't `echo $ANYTHING` - subprocess env is filtered
6. Other extensions still have full `process.env` access

**What's Protected:**

Any key in the `SECRETS` JSON is automatically filtered from the LLM's bash environment. The `SECRETS` variable itself is also filtered.

```bash
# If your SECRETS contains:
{"GH_TOKEN": "...", "ANTHROPIC_API_KEY": "...", "MY_CUSTOM_KEY": "..."}

# Then all of these return empty:
echo $GH_TOKEN           # empty
echo $ANTHROPIC_API_KEY  # empty
echo $MY_CUSTOM_KEY      # empty
```

### Agent Job Secrets

Agent job secrets are managed at Admin > Event Handler > Agent Jobs. They are stored encrypted in SQLite and injected as environment variables into Docker containers.

The agent can discover available secrets by running the `get-secret` skill, then access values via `echo $KEY_NAME`.

### Implementation

The `env-sanitizer` extension in `.pi/extensions/` dynamically filters secrets:

```typescript
const bashTool = createBashTool(process.cwd(), {
  spawnHook: ({ command, cwd, env }) => {
    const filteredEnv = { ...env };
    if (process.env.SECRETS) {
      try {
        for (const key of Object.keys(JSON.parse(process.env.SECRETS))) {
          delete filteredEnv[key];
        }
      } catch {}
    }
    delete filteredEnv.SECRETS;
    return { command, cwd, env: filteredEnv };
  },
});
```

No special Docker flags required. Works on any host.

### Custom Extensions

The env-sanitizer protects against the **AI agent** accessing secrets through bash. Extension code itself can access `process.env` directly - this is by design.

**Best practices:**
- Don't create tools that echo environment variables to the agent
- Review extension code before adding to your agent
