#!/bin/bash
# Called by ttyd on each connection — uses tmux to keep Codex alive between disconnects

SESSION_NAME="codex-${PORT}"

# Already running — just reattach
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    exec tmux attach -t "$SESSION_NAME"
fi

# Build Codex args
SESSION_FILE="/home/coding-agent/.codex-ttyd-sessions/${PORT}"
CODEX_ARGS="codex"
if [ -n "$LLM_MODEL" ]; then
    CODEX_ARGS="$CODEX_ARGS --model $LLM_MODEL"
fi

if [ -f "$SESSION_FILE" ]; then
    SESSION_ID=$(cat "$SESSION_FILE")
    if [ -n "$SESSION_ID" ] && find /home/coding-agent/.codex/sessions -name "*${SESSION_ID}*" 2>/dev/null | grep -q .; then
        CODEX_ARGS="$CODEX_ARGS resume $SESSION_ID"
    fi
fi

# Start tmux session with Codex, then attach
WORK_DIR="/home/coding-agent/workspace${SCOPE:+/$SCOPE}"
tmux -u new-session -d -s "$SESSION_NAME" -e PORT="${PORT}" -c "$WORK_DIR" $CODEX_ARGS
exec tmux attach -t "$SESSION_NAME"
