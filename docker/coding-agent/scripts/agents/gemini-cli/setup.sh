#!/bin/bash
# Gemini CLI setup — trust, auth config, session tracking hook, system prompt

# System prompt: read from /home/coding-agent/SYSTEM.md (written by EH or 5_build-prompt.sh)
SYSTEM_PROMPT=""
if [ -f /home/coding-agent/SYSTEM.md ]; then
    SYSTEM_PROMPT=$(cat /home/coding-agent/SYSTEM.md)
fi

WORKSPACE_DIR=$(pwd)

mkdir -p ~/.gemini

# ── Trust the workspace folder so Gemini CLI skips the interactive prompt ──
cat > ~/.gemini/trustedFolders.json <<TRUST
{
  "$WORKSPACE_DIR": "TRUST_FOLDER"
}
TRUST

# ── Write the session tracking hook script ──
# Extracts session UUID from the most recent session file, then resolves the full
# UUID via --list-sessions and writes it to a port-keyed file.
cat > /home/coding-agent/.gemini-ttyd-sessions-hook.sh << 'EOF'
#!/bin/bash
if [ "$CONTINUE_SESSION" != "1" ]; then echo '{}' >&1; exit 0; fi
SFILE=$(find /home/coding-agent/.gemini/tmp/workspace/chats -name "session-*.json" -type f 2>/dev/null | sort -r | head -1)
if [ -n "$SFILE" ]; then
  SHORT=$(basename "$SFILE" .json | rev | cut -d'-' -f1 | rev)
  if [ -n "$SHORT" ]; then
    FULL_UUID=$(gemini --list-sessions 2>/dev/null | grep -o "[0-9a-f-]\{36\}" | grep "^$SHORT" | head -1)
    if [ -n "$FULL_UUID" ]; then
      DIR=/home/coding-agent/.gemini-ttyd-sessions
      mkdir -p "$DIR"
      echo "$FULL_UUID" > "$DIR/${PORT:-7681}"
    fi
  fi
fi
echo '{}' >&1
exit 0
EOF
chmod +x /home/coding-agent/.gemini-ttyd-sessions-hook.sh

# ── Configure settings.json: auth + session tracking hook ──
if [ -n "$GOOGLE_API_KEY" ]; then
    cat > ~/.gemini/settings.json <<SETTINGS
{
  "security": {
    "auth": {
      "selectedType": "gemini-api-key"
    }
  },
  "hooks": {
    "AfterAgent": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /home/coding-agent/.gemini-ttyd-sessions-hook.sh",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
SETTINGS
else
    cat > ~/.gemini/settings.json <<SETTINGS
{
  "hooks": {
    "AfterAgent": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /home/coding-agent/.gemini-ttyd-sessions-hook.sh",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
SETTINGS
fi

# ── Write system prompt if provided ──
if [ -n "$SYSTEM_PROMPT" ]; then
    echo "$SYSTEM_PROMPT" > ~/.gemini/SYSTEM.md
    export GEMINI_SYSTEM_MD=~/.gemini/SYSTEM.md
else
    rm -f ~/.gemini/SYSTEM.md
fi
