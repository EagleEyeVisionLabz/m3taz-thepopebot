# ── Stage 1: builder ──────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
# Rename package to avoid npm treating "thepopebot" as a self-install
RUN TPB_VERSION=$(node -p "require('./package.json').version") && \
    echo "{\"private\":true}" > package.json && \
    npm install --no-save "thepopebot@${TPB_VERSION}" tailwindcss @tailwindcss/postcss

# ── Stage 2: Next.js build ───────────────────────────────────────
FROM node:22-bookworm-slim AS nextjs
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
# Use a minimal package.json to avoid self-referencing exports
# (the repo package.json has name "thepopebot", which makes Node resolve
# imports like 'thepopebot/config' to ./config/ instead of node_modules)
RUN echo '{"private":true}' > package.json
COPY web/ ./
RUN ./node_modules/.bin/next build

# ── Stage 3: runtime ─────────────────────────────────────────────
FROM node:22-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl git ca-certificates && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends gh && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g pm2

# Run as coding-agent (UID 1001) so files created by in-process SDK
# are natively owned by the same user as interactive coding agent containers.
# gosu for dropping to coding-agent at runtime after fixing socket perms.
RUN apt-get update && \
    apt-get install -y --no-install-recommends gosu && \
    rm -rf /var/lib/apt/lists/* && \
    useradd -m -s /bin/bash -u 1001 coding-agent

# Agent runtime parity with the coding-agent base image. The in-process SDK
# shells out to these inside this container; without them, chat-mode agents hit
# "command not found" for tools their system prompt advertises.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        jq \
        procps \
        locales \
        build-essential \
        fonts-noto-color-emoji \
        fonts-symbola \
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
        libasound2 \
        libpango-1.0-0 \
        libcairo2 && \
    rm -rf /var/lib/apt/lists/* && \
    locale-gen en_US.UTF-8

ENV LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8 \
    LC_CTYPE=en_US.UTF-8

# playwright-cli + Chromium for the playwright-cli skill. Mirror the
# coding-agent setup: install browser to /opt/pw-browsers (outside /home) and
# bake a default config so `playwright-cli open` works with zero flags.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN npm install -g @playwright/cli@0.1.3 && \
    npx playwright install chromium && \
    chown -R coding-agent:coding-agent /opt/pw-browsers

RUN mkdir -p /etc/playwright && \
    echo '{"browser":{"browserName":"chromium","launchOptions":{"headless":true,"args":["--no-sandbox"]}},"outputDir":"/tmp"}' \
       > /etc/playwright/cli.config.json
ENV PLAYWRIGHT_MCP_CONFIG=/etc/playwright/cli.config.json

WORKDIR /app
# Set ownership at copy time. Docker layers are immutable, so a post-copy
# `chown -R /app` would rewrite every file into a new layer (~1.7GB duplicate).
# `--chown=` avoids the duplicate by setting ownership during the COPY itself.
COPY --chown=coding-agent:coding-agent --from=builder /app/node_modules ./node_modules
RUN echo '{"private":true}' > package.json && chown coding-agent:coding-agent package.json
COPY --chown=coding-agent:coding-agent --from=nextjs /app/.next ./.next
COPY --chown=coding-agent:coding-agent web/server.js web/next.config.mjs web/instrumentation.js web/middleware.js web/postcss.config.mjs ./

COPY docker/event-handler/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
CMD ["pm2-runtime", "--kill-timeout", "120000", "server.js"]
