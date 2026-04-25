#!/bin/bash
# Claude Code setup — trust config, onboarding skip

# System prompt: /home/coding-agent/SYSTEM.md is written to the volume by the EH
# (interactive/headless) or read from agent-job.config.json by 5_build-prompt.sh (agent-job).
# run.sh/interactive.sh read it via --append-system-prompt-file.

WORKSPACE_DIR=$(pwd)

mkdir -p ~/.claude

cat > ~/.claude/settings.json << 'EOF'
{
  "theme": "dark",
  "hasTrustDialogAccepted": true,
  "skipDangerousModePermissionPrompt": true,
  "permissions": {
    "allow": [
      "WebSearch",
      "WebFetch"
    ]
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /home/coding-agent/.claude-ttyd-sessions-hook.sh"
          }
        ]
      }
    ]
  }
}
EOF

# Write the session tracking hook script (run on every SessionStart)
# Writes Claude Code session_id to .claude-ttyd-sessions/${PORT:-7681} on first boot only
cat > /home/coding-agent/.claude-ttyd-sessions-hook.sh << 'EOF'
#!/bin/bash
[ "$CONTINUE_SESSION" = "1" ] || exit 0
SESSION_ID=$(cat | jq -r .session_id 2>/dev/null)
[ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ] && exit 0
DIR=/home/coding-agent/.claude-ttyd-sessions
mkdir -p "$DIR"
FILE="$DIR/${PORT:-7681}"
echo "$SESSION_ID" > "$FILE"
exit 0
EOF
chmod +x /home/coding-agent/.claude-ttyd-sessions-hook.sh

cat > ~/.claude.json << ENDJSON
{
  "hasCompletedOnboarding": true,
  "projects": {
    "${WORKSPACE_DIR}": {
      "allowedTools": ["WebSearch"],
      "hasTrustDialogAccepted": true,
      "hasTrustDialogHooksAccepted": true
    }
  }
}
ENDJSON
