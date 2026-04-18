#!/bin/bash
# Codex CLI setup — config, system prompt, session tracking hook, Playwright MCP

# Prefer pre-rendered system prompt from event handler (written to volume)
if [ -f /home/coding-agent/SYSTEM.md ]; then
    SYSTEM_PROMPT=$(cat /home/coding-agent/SYSTEM.md)
    export SYSTEM_PROMPT
else
    source /scripts/common/build-system-prompt.sh
fi

WORKSPACE_DIR=$(pwd)

# Write system prompt to AGENTS.md (Codex reads this automatically)
if [ -n "$SYSTEM_PROMPT" ]; then
    echo "$SYSTEM_PROMPT" > "${WORKSPACE_DIR}/AGENTS.md"
else
    rm -f "${WORKSPACE_DIR}/AGENTS.md"
fi

# Pre-configure trust, model, hooks, and MCP to skip interactive prompts
mkdir -p ~/.codex

cat > ~/.codex/config.toml << EOF
$([ -n "$LLM_MODEL" ] && echo "model = \"${LLM_MODEL}\"")

[features]
codex_hooks = true

[projects."${WORKSPACE_DIR}"]
trust_level = "trusted"

[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@0.0.70", "--headless", "--browser", "chromium", "--output-dir", "/home/coding-agent/workspace/.tmp"]
env = { PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers" }
EOF

# Write the session tracking hook script (run on every SessionStart)
# Writes Codex session_id to .codex-ttyd-sessions/${PORT:-7681} on first boot only
cat > /home/coding-agent/.codex-ttyd-sessions-hook.sh << 'EOF'
#!/bin/bash
SESSION_ID=$(cat | jq -r .session_id 2>/dev/null)
[ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ] && exit 0
DIR=/home/coding-agent/.codex-ttyd-sessions
mkdir -p "$DIR"
FILE="$DIR/${PORT:-7681}"
echo "$SESSION_ID" > "$FILE"
exit 0
EOF
chmod +x /home/coding-agent/.codex-ttyd-sessions-hook.sh

# Register SessionStart hook
cat > ~/.codex/hooks.json << 'EOF'
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash /home/coding-agent/.codex-ttyd-sessions-hook.sh"
          }
        ]
      }
    ]
  }
}
EOF
