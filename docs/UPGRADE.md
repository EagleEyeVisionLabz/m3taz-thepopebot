# Upgrading

For the standard upgrade process (manual or automated), see [Updating](../README.md#updating) in the README. This document covers **how automated upgrades work** and **how to recover when something goes wrong**.

## How Automated Upgrades Work

Two GitHub Actions workflows handle automated upgrades:

### 1. upgrade-event-handler.yml (manual trigger)

Triggered via `workflow_dispatch` (Actions tab > "Upgrade Event Handler" > Run workflow). This workflow:

1. Clones your repo into a temp directory inside the event handler container
2. Runs `npm install` + `npm update thepopebot`
3. If the version changed, creates an `upgrade/thepopebot-<version>-<timestamp>` branch
4. Opens a PR and enables auto-merge with `--delete-branch`

This workflow only updates `package.json` and `package-lock.json`. It does **not** run `thepopebot init`, rebuild, or restart anything. That happens when the PR merges.

### 2. rebuild-event-handler.yml (on push to main)

Triggered automatically when the upgrade PR merges to `main`. This workflow detects the version change and:

1. Runs `npx thepopebot init --no-install` inside the running container to scaffold updated templates against the project tree
2. Runs `npm install` so the local CLI in `node_modules/thepopebot` matches the new version
3. Commits any template changes back to `main` with a `[skip ci]` marker (so the rebuild doesn't loop)
4. Pulls the new event-handler Docker image (which already contains the baked `.next` build + production `node_modules`)
5. Stops and removes the old container, then `docker compose up -d` the new one

If the change isn't a version bump (normal code push) or only touches `logs/`, the workflow short-circuits — there is no in-container `.next` rebuild step anymore, since `.next` ships in the image.

## Recovering from a Failed Upgrade

If an automated upgrade fails, SSH into your server and rebuild manually:

```bash
docker exec thepopebot-event-handler npm install --omit=dev
docker exec thepopebot-event-handler bash -c 'rm -rf .next-new .next-old && NEXT_BUILD_DIR=.next-new npm run build && mv .next .next-old 2>/dev/null; mv .next-new .next && rm -rf .next-old'
docker exec thepopebot-event-handler npx pm2 restart all
```

### Merge conflicts on upgrade PR?

If the upgrade PR has merge conflicts in GitHub, resolve them in the GitHub UI or locally:

```bash
git fetch origin
git checkout upgrade/thepopebot-<version>-<timestamp>
git merge main
# resolve conflicts
git push
```

Once resolved, the PR merges and `rebuild-event-handler.yml` takes over.

### Useful diagnostic commands

```bash
docker ps -a | grep thepopebot-event-handler          # container running?
docker logs thepopebot-event-handler --tail 50         # container logs
docker exec thepopebot-event-handler npx pm2 status    # PM2 status
docker exec thepopebot-event-handler npx pm2 logs --lines 30  # app logs
```
