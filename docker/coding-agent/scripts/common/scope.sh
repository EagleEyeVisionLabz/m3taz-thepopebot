#!/bin/bash
# Change into the scoped subdirectory within the workspace if SCOPE is set.
# Because entrypoint.sh sources all scripts, the cd persists through subsequent steps.

if [ -n "$SCOPE" ]; then
    SCOPE_DIR="/home/coding-agent/workspace/$SCOPE"
    if [ -d "$SCOPE_DIR" ]; then
        cd "$SCOPE_DIR"
        echo "  Scoped to: $SCOPE"
    else
        echo "  WARNING: Scope directory '$SCOPE' does not exist in workspace, staying at root"
    fi
fi
