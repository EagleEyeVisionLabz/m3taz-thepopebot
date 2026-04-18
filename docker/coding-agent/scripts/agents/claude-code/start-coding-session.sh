#!/bin/bash
# Called by ttyd on each connection — uses tmux to keep Claude alive between disconnects

SESSION_NAME="claude-${PORT}"

# Already running — just reattach
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    exec tmux attach -t "$SESSION_NAME"
fi

# Build Claude args
SESSION_FILE="/home/coding-agent/.claude-ttyd-sessions/${PORT}"
CLAUDE_ARGS=(claude --dangerously-skip-permissions)
if [ -n "$LLM_MODEL" ]; then
    CLAUDE_ARGS+=(--model "$LLM_MODEL")
fi

if [ -f "$SESSION_FILE" ]; then
    SESSION_ID=$(cat "$SESSION_FILE")
    if [ -f "/home/coding-agent/.claude/projects/-home-coding-agent-workspace/${SESSION_ID}.jsonl" ]; then
        CLAUDE_ARGS+=(--resume "$SESSION_ID")
    fi
fi

# Start tmux session with Claude, then attach
WORK_DIR="/home/coding-agent/workspace${SCOPE:+/$SCOPE}"
tmux -u new-session -d -s "$SESSION_NAME" -e PORT="${PORT}" -c "$WORK_DIR" "${CLAUDE_ARGS[@]}"
exec tmux attach -t "$SESSION_NAME"
