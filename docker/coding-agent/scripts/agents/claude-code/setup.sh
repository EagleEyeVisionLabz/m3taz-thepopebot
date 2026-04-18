#!/bin/bash
# Claude Code setup — trust config, onboarding skip, Playwright MCP

# Prefer pre-rendered system prompt from event handler (written to volume)
if [ -f /home/coding-agent/SYSTEM.md ]; then
    SYSTEM_PROMPT=$(cat /home/coding-agent/SYSTEM.md)
    export SYSTEM_PROMPT
else
    source /scripts/common/build-system-prompt.sh
fi

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

# Register Playwright MCP server for browser automation
claude mcp add --transport stdio playwright -- npx -y @playwright/mcp@0.0.70 --headless --browser chromium --output-dir /home/coding-agent/workspace/.tmp
