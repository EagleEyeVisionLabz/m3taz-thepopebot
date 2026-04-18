#!/bin/bash
# Start a bash shell session via ttyd on $PORT — uses tmux to survive disconnects

SESSION_NAME="shell-${PORT}"
WORK_DIR="/home/coding-agent/workspace${SCOPE:+/$SCOPE}"

exec ttyd --writable -p "${PORT}" bash -c "
  if tmux has-session -t ${SESSION_NAME} 2>/dev/null; then
    exec tmux attach -t ${SESSION_NAME}
  fi
  tmux -u new-session -d -s ${SESSION_NAME} -c ${WORK_DIR}
  exec tmux attach -t ${SESSION_NAME}
"
