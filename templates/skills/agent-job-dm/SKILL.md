---
name: agent-job-dm
description: Use to look up the project's users and send a direct message to one of them via their default channel (currently Telegram). Trigger when the user says "send X to <name>", "DM <name>", "message <name>", "tell <name> that…", or asks "who are the users?", "list users", "who can I message?". Returns user id, email, first/last name, nickname, and available DM channels.
---

## Usage

```bash
# List users (id, email, first/last name, nickname, role, available DM channels)
node skills/agent-job-dm/agent-job-dm.js list

# Send a DM to a user via their default channel (currently Telegram)
node skills/agent-job-dm/agent-job-dm.js send <user_id> "Hello from the agent"

# Force a specific channel
node skills/agent-job-dm/agent-job-dm.js send <user_id> "Hi" --channel telegram
```

## Sending DMs to a user

When the user asks to "message", "DM", or "send X to <name>":

1. Run `list` to get the directory.
2. Match the requested name against `nickname`, `first_name`, `last_name`, or `email` — pick the user the request most likely refers to. If multiple match, ask for disambiguation.
3. Make sure the target user has at least one entry in `channels` (e.g. `["telegram"]`) — if not, tell the requester the user has no DM channel linked.
4. Call `send <user_id> "<message>"` (omit `--channel` to use the default — currently Telegram).

The `<message>` arg is sent verbatim. Pass it through unchanged unless the requester asked you to rewrite it.

## Notes

- `AGENT_JOB_TOKEN` and `APP_URL` are injected automatically — no setup required.
- Users link their DM channel themselves in `/profile/telegram`. If `channels` is empty for a user, they cannot be DM'd.
