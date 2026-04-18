#!/bin/bash
# Called by ttyd on each connection — uses tmux to keep OpenCode alive between disconnects

SESSION_NAME="opencode-${PORT}"

# Already running — just reattach
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    exec tmux attach -t "$SESSION_NAME"
fi

# Build OpenCode args
SESSION_FILE="/home/coding-agent/.opencode-ttyd-sessions/${PORT}"
OPENCODE_ARGS="opencode"
if [ -n "$LLM_MODEL" ]; then
    OPENCODE_ARGS="$OPENCODE_ARGS --model $LLM_MODEL"
fi

if [ -f "$SESSION_FILE" ]; then
    SESSION_ID=$(cat "$SESSION_FILE")
    if [ -n "$SESSION_ID" ] && opencode session list --format json 2>/dev/null | grep -qF "$SESSION_ID"; then
        OPENCODE_ARGS="$OPENCODE_ARGS --session $SESSION_ID"
    fi
fi

# Start tmux session with OpenCode, then attach
WORK_DIR="/home/coding-agent/workspace${SCOPE:+/$SCOPE}"
tmux -u new-session -d -s "$SESSION_NAME" -e PORT="${PORT}" -c "$WORK_DIR" $OPENCODE_ARGS
exec tmux attach -t "$SESSION_NAME"
