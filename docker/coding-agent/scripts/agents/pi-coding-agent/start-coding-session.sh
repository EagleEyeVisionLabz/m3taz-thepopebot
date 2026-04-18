#!/bin/bash
# Called by ttyd on each connection — uses tmux to keep Pi alive between disconnects

SESSION_NAME="pi-${PORT}"

# Already running — just reattach
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    exec tmux attach -t "$SESSION_NAME"
fi

# Build Pi args
PI_ARGS="pi"
if [ -n "$LLM_MODEL" ]; then
    PI_ARGS="$PI_ARGS --model $LLM_MODEL"
fi
PI_ARGS="$PI_ARGS --session-dir /home/coding-agent/.pi-ttyd-sessions/${PORT} -c"

# Start tmux session with Pi, then attach
WORK_DIR="/home/coding-agent/workspace${SCOPE:+/$SCOPE}"
tmux -u new-session -d -s "$SESSION_NAME" -e PORT="${PORT}" -c "$WORK_DIR" $PI_ARGS
exec tmux attach -t "$SESSION_NAME"
