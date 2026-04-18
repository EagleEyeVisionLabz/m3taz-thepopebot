#!/bin/bash
# Called by ttyd on each connection — uses tmux to keep Gemini alive between disconnects

SESSION_NAME="gemini-${PORT}"

# Already running — just reattach
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    exec tmux attach -t "$SESSION_NAME"
fi

# Build Gemini args
SESSION_FILE="/home/coding-agent/.gemini-ttyd-sessions/${PORT}"
GEMINI_ARGS="gemini --approval-mode yolo"
if [ -n "$LLM_MODEL" ]; then
    GEMINI_ARGS="$GEMINI_ARGS --model $LLM_MODEL"
fi

if [ -f "$SESSION_FILE" ]; then
    SESSION_ID=$(cat "$SESSION_FILE")
    if [ -n "$SESSION_ID" ] && gemini --list-sessions 2>/dev/null | grep -qF "$SESSION_ID"; then
        GEMINI_ARGS="$GEMINI_ARGS --resume $SESSION_ID"
    fi
fi

# Start tmux session with Gemini, then attach
WORK_DIR="/home/coding-agent/workspace${SCOPE:+/$SCOPE}"
tmux -u new-session -d -s "$SESSION_NAME" -e PORT="${PORT}" -c "$WORK_DIR" $GEMINI_ARGS
exec tmux attach -t "$SESSION_NAME"
