#!/bin/bash
# Kimi CLI setup — session tracking hook, system prompt, Playwright MCP

# Prefer pre-rendered system prompt from event handler (written to volume)
if [ -f /home/coding-agent/SYSTEM.md ]; then
    SYSTEM_PROMPT=$(cat /home/coding-agent/SYSTEM.md)
    export SYSTEM_PROMPT
else
    source /scripts/common/build-system-prompt.sh
fi

WORKSPACE_DIR=$(pwd)

# Write system prompt to AGENTS.md (Kimi reads this automatically)
if [ -n "$SYSTEM_PROMPT" ]; then
    echo "$SYSTEM_PROMPT" > "${WORKSPACE_DIR}/AGENTS.md"
else
    rm -f "${WORKSPACE_DIR}/AGENTS.md"
fi

# Write the session tracking hook script (run on every SessionStart)
# Writes Kimi session_id to .kimi-ttyd-sessions/${PORT:-7681}
cat > /home/coding-agent/.kimi-ttyd-sessions-hook.sh << 'EOF'
#!/bin/bash
SESSION_ID=$(cat | grep -o '"session_id": *"[^"]*"' | cut -d'"' -f4)
[ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ] && exit 0
DIR=/home/coding-agent/.kimi-ttyd-sessions
mkdir -p "$DIR"
FILE="$DIR/${PORT:-7681}"
echo "$SESSION_ID" > "$FILE"
echo '{}' >&1
exit 0
EOF
chmod +x /home/coding-agent/.kimi-ttyd-sessions-hook.sh

# Detect provider from env vars
KIMI_PROVIDER=""
KIMI_PROVIDER_TYPE=""
KIMI_BASE_URL=""
KIMI_API_KEY_ENV=""
if [ -n "$ANTHROPIC_API_KEY" ]; then
    KIMI_PROVIDER="anthropic"
    KIMI_PROVIDER_TYPE="anthropic"
    KIMI_BASE_URL="https://api.anthropic.com"
    KIMI_API_KEY_ENV="ANTHROPIC_API_KEY"
elif [ -n "$OPENAI_API_KEY" ]; then
    KIMI_PROVIDER="openai"
    KIMI_PROVIDER_TYPE="openai"
    KIMI_BASE_URL="https://api.openai.com/v1"
    KIMI_API_KEY_ENV="OPENAI_API_KEY"
elif [ -n "$GOOGLE_API_KEY" ]; then
    KIMI_PROVIDER="google"
    KIMI_PROVIDER_TYPE="google"
    KIMI_BASE_URL="https://generativelanguage.googleapis.com"
    KIMI_API_KEY_ENV="GOOGLE_API_KEY"
elif [ -n "$DEEPSEEK_API_KEY" ]; then
    KIMI_PROVIDER="deepseek"
    KIMI_PROVIDER_TYPE="openai"
    KIMI_BASE_URL="https://api.deepseek.com"
    KIMI_API_KEY_ENV="DEEPSEEK_API_KEY"
elif [ -n "$CUSTOM_OPENAI_BASE_URL" ]; then
    KIMI_PROVIDER="custom"
    KIMI_PROVIDER_TYPE="openai"
    KIMI_BASE_URL="$CUSTOM_OPENAI_BASE_URL"
    KIMI_API_KEY_ENV="CUSTOM_API_KEY"
fi

# Configure Kimi: provider, model, yolo mode, session tracking hook
mkdir -p ~/.kimi
cat > ~/.kimi/config.toml << TOML
default_yolo = true
$([ -n "$LLM_MODEL" ] && echo "default_model = \"$LLM_MODEL\"")

$(if [ -n "$KIMI_PROVIDER" ]; then
KIMI_API_KEY_VAL=$(eval echo \$$KIMI_API_KEY_ENV)
cat << PROVIDER
[providers.$KIMI_PROVIDER]
type = "$KIMI_PROVIDER_TYPE"
base_url = "$KIMI_BASE_URL"
api_key = "$KIMI_API_KEY_VAL"
PROVIDER
fi)

$(if [ -n "$LLM_MODEL" ] && [ -n "$KIMI_PROVIDER" ]; then
cat << MODEL
[models.$LLM_MODEL]
provider = "$KIMI_PROVIDER"
model = "$LLM_MODEL"
max_context_size = 200000
MODEL
fi)

[[hooks]]
event = "SessionStart"
command = "bash /home/coding-agent/.kimi-ttyd-sessions-hook.sh"
timeout = 5
TOML

# Register Playwright MCP server for browser automation
kimi mcp add --transport stdio -e PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers playwright -- npx -y @playwright/mcp@0.0.70 --headless --browser chromium --output-dir /home/coding-agent/workspace/.tmp 2>/dev/null || true
