# thepopebot-base — shared foundation for both event-handler and coding-agent.
#
# Anything both images need lives here so the two stay in lockstep without
# manual mirroring. The event-handler runs the SDK in-process and shells out
# to these binaries the same way coding-agent containers do, so they need
# the same toolchain.
#
# Coding-agent-specific extras (tmux, ttyd, agent CLIs) live in
# docker/coding-agent/Dockerfile. Event-handler-specific extras (pm2, gosu,
# Next.js runtime) live in docker/event-handler/Dockerfile.

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# ──────────────────────────────────────────────
# System packages
# ──────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        # Core utilities
        git \
        curl \
        jq \
        procps \
        ca-certificates \
        gnupg \
        build-essential \
        locales \
        # Emoji rendering for browser screenshots
        fonts-noto-color-emoji \
        fonts-symbola \
        # Chromium system deps for the playwright-cli skill
        libnss3 \
        libnspr4 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libdbus-1-3 \
        libxkbcommon0 \
        libatspi2.0-0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libasound2t64 \
        libpango-1.0-0 \
        libcairo2 \
    && rm -rf /var/lib/apt/lists/* \
    && locale-gen en_US.UTF-8

ENV LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8 \
    LC_CTYPE=en_US.UTF-8

# ──────────────────────────────────────────────
# GitHub CLI
# ──────────────────────────────────────────────
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# ──────────────────────────────────────────────
# Node.js 22 (NodeSource)
# ──────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# ──────────────────────────────────────────────
# Shared user (UID 1001) — file-ownership contract between event-handler
# and coding-agent containers sharing workspace volumes.
# ──────────────────────────────────────────────
RUN useradd -m -s /bin/bash -u 1001 coding-agent

# ──────────────────────────────────────────────
# playwright-cli + Chromium for the playwright-cli skill.
# Install browser to /opt/pw-browsers (outside /home) so volume mounts
# don't shadow it. Bake default config so `playwright-cli open` works
# with zero flags.
# ──────────────────────────────────────────────
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN npm install -g @playwright/cli@0.1.3 \
    && npx playwright install chromium \
    && chown -R coding-agent:coding-agent /opt/pw-browsers

RUN mkdir -p /etc/playwright \
    && echo '{"browser":{"browserName":"chromium","launchOptions":{"headless":true,"args":["--no-sandbox"]}},"outputDir":"/tmp"}' \
       > /etc/playwright/cli.config.json
ENV PLAYWRIGHT_MCP_CONFIG=/etc/playwright/cli.config.json
