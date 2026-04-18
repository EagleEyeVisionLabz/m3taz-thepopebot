#!/bin/bash
# Pi setup — write system prompt + generate models.json for custom providers

# Prefer pre-rendered system prompt from event handler (written to volume)
if [ -f /home/coding-agent/SYSTEM.md ]; then
    SYSTEM_PROMPT=$(cat /home/coding-agent/SYSTEM.md)
    export SYSTEM_PROMPT
else
    source /scripts/common/build-system-prompt.sh
fi

WORKSPACE_DIR=$(pwd)


# Always write system prompt (clears previous if SYSTEM_PROMPT is empty)
mkdir -p "${WORKSPACE_DIR}/.pi"
if [ -n "$SYSTEM_PROMPT" ]; then
    echo "$SYSTEM_PROMPT" > "${WORKSPACE_DIR}/.pi/SYSTEM.md"
else
    rm -f "${WORKSPACE_DIR}/.pi/SYSTEM.md"
fi

# Generate models.json for custom OpenAI-compatible providers
# CUSTOM_OPENAI_BASE_URL being set is the trigger — if you have a custom endpoint, you need models.json
if [ -n "$CUSTOM_OPENAI_BASE_URL" ]; then
    if [ -z "$CUSTOM_API_KEY" ]; then
        export CUSTOM_API_KEY="not-needed"
    fi
    mkdir -p ~/.pi/agent
    cat > ~/.pi/agent/models.json << MODELS
{
  "providers": {
    "custom": {
      "baseUrl": "$CUSTOM_OPENAI_BASE_URL",
      "api": "openai-completions",
      "apiKey": "CUSTOM_API_KEY",
      "models": [{ "id": "${LLM_MODEL:-default}" }]
    }
  }
}
MODELS
fi

# If the repo has its own models.json, use it (overrides generated one)
if [ -f "${WORKSPACE_DIR}/.pi/agent/models.json" ]; then
    mkdir -p ~/.pi/agent
    cp "${WORKSPACE_DIR}/.pi/agent/models.json" ~/.pi/agent/models.json
fi
