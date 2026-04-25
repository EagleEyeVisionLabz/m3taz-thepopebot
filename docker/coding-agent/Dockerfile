# coding-agent base — extends thepopebot-base with interactive-workspace
# specifics (tmux, ttyd, agent-job scripts, entrypoint).
#
# Per-agent images (Dockerfile.claude-code, Dockerfile.pi-coding-agent, etc.)
# extend this image and add the agent's CLI binary on top.
ARG BASE_IMAGE=thepopebot-base
FROM ${BASE_IMAGE}

USER root

# tmux for terminal multiplexing inside ttyd sessions
RUN apt-get update && apt-get install -y --no-install-recommends tmux \
    && rm -rf /var/lib/apt/lists/*

# ttyd — web terminal server for interactive workspace runtime
RUN curl -fsSL -o /usr/local/bin/ttyd \
        https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64 \
    && chmod +x /usr/local/bin/ttyd

# Workspace dir for the coding-agent user
RUN mkdir -p /home/coding-agent/workspace \
    && chown coding-agent:coding-agent /home/coding-agent/workspace

# ──────────────────────────────────────────────
# Copy scripts, commands, and configs
# ──────────────────────────────────────────────
COPY scripts/ /scripts/
COPY .tmux.conf /home/coding-agent/.tmux.conf
COPY .tmux.conf /scripts/.tmux.conf
COPY entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
    && chmod +x /scripts/**/*.sh \
    && chown coding-agent:coding-agent /home/coding-agent/.tmux.conf

# ──────────────────────────────────────────────
# Runtime config
# ──────────────────────────────────────────────
USER coding-agent
WORKDIR /home/coding-agent/workspace

# RUNTIME: job | headless | interactive | cluster-worker | command/*
ENV RUNTIME=""

ENTRYPOINT ["/entrypoint.sh"]
