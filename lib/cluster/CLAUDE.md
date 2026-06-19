# lib/cluster/ — Cluster System

Clusters are groups of Docker containers spawned on demand from role definitions. Each cluster has roles that define what containers do, with concurrency limits and multiple trigger types.

## Architecture

- **`actions.js`** — Server Actions (`'use server'`) for all cluster UI operations. Handles auth via `requireAuth()`, delegates to DB functions in `lib/db/clusters.js`, and creates directories on disk at lifecycle events.
- **`execute.js`** — Docker container lifecycle: launch, stop, concurrency checks. Uses `coding-agent-claude-code` Docker image (cluster-worker runtime). Exports path helpers for cluster/role directories.
- **`runtime.js`** — In-memory trigger runtime. Manages cron schedules (node-cron) and file watchers (chokidar). Webhooks are always-on. Started at boot, reloaded when triggers change.
- **`stream.js`** — SSE endpoint for console page. Dynamically discovers running containers via `listContainers()`.
- **`components/`** — React UI (cluster-page, clusters-page, cluster-console-page, clusters-layout).

## Naming & IDs

- **Cluster short ID**: `cluster.id` dashes stripped, first 8 chars → used in `cluster-{shortId}` project name
- **Role short ID**: `role.id` dashes stripped, first 8 chars → `roleShortId(role)` from `lib/db/clusters.js`
- **Container name**: `cluster-{clusterShortId}-role-{roleShortId}-{8-char-uuid}` (dynamic per run)

## Directory Structure on Disk

```
data/clusters/
  cluster-{shortId}/              ← created by createCluster()
    shared/                       ← created by createCluster()
      {folder}/                   ← created by updateClusterFolders()
    role-{roleShortId}/           ← created by createClusterRoleAction()
      shared/                     ← created by createClusterRoleAction()
      worker-{uuid}/             ← created per container launch (ephemeral)
```

## Trigger Types

Roles support multiple concurrent triggers. All paths funnel through `acquireAndRunRole()`, which atomically gates concurrency and launches the container.

| Trigger | Config Key | How It Works |
|---------|-----------|--------------|
| Manual | (always available) | `triggerRoleManually()` → `acquireAndRunRole()` |
| Webhook | (always-on) | POST → `handleClusterWebhook()` → `acquireAndRunRole()` |
| Cron | `cron.schedule` | node-cron → `acquireAndRunRole()` |
| File Watch | `file_watch.paths` | chokidar → `acquireAndRunRole()` |

## Concurrency & Validation

`acquireAndRunRole(roleIdOrData, payload?, trigger?)` is the **atomic gate** that all trigger paths actually use. It checks cluster enabled status and concurrency limits and then launches the container in one indivisible step, returning `{ allowed, reason?, containerName?, error? }`. Reasons: `disabled` (cluster off), `concurrency` (at max), `not_found`. Manual UI triggers, webhooks, cron, and file-watch all funnel through this.

Atomicity comes from a per-role promise chain held in the module-level `_locks` Map (keyed by `role.id`): each call chains onto the previous call for the same role and awaits it before running the concurrency check, so two simultaneous triggers can't both pass the check before either container is observable to `listContainers()`. Different roles still run in parallel, and idle chain entries are pruned in the `finally` block.

Each role has `maxConcurrency` (default 1). The gate counts running instances via `countRunningForRole()` (which uses `listContainers()`).

## Plan Mode (Roles)

`cluster_roles.planMode` (default `0`) gates the worker into Claude's plan-mode (read-only). When set, the worker is launched with `PERMISSION=plan` so it cannot execute mutating tools. Useful for review/analysis roles.

## Prompt Architecture

Workers receive two separate prompts passed as env vars to the container:

- **`SYSTEM_PROMPT`** — Cluster system prompt + role instructions. Passed via `--append-system-prompt` to Claude Code, appended to its built-in system prompt.
- **`PROMPT`** — The role's `prompt` field (default: "Execute your role."). Passed via `-p` as the user prompt.

This separation means the system context (who the role is, workspace layout, shared instructions) goes into the system prompt, while the actual task instruction is the user prompt. Template `{{PLACEHOLDER}}` variables are resolved in both.

Built by `buildTemplateVars()` → `buildWorkerSystemPrompt()` + `resolveClusterVariables(role.prompt)` in `execute.js`.

## Key Functions

**`execute.js`**:
- `clusterNaming(cluster)` → `{ project, dataDir }` for Docker resource naming
- `clusterDir(cluster)` → absolute path to cluster data directory
- `roleDir(cluster, role)` → absolute path to role subdirectory
- `acquireAndRunRole(roleIdOrData, payload?, trigger?)` → atomic gate: per-role serialization via `_locks`, checks disabled + concurrency, then launches; returns `{ allowed, reason?, containerName?, error? }`
- `runClusterRole(roleData, payload?, trigger?)` → launches container (internal; called only by `acquireAndRunRole` — do not call directly)
- `stopRoleContainers(cluster, role)` → stops all containers for a role
- `countRunningForRole(cluster, role)` → counts running containers

**`runtime.js`**:
- `startClusterRuntime()` → called once at boot
- `reloadClusterRuntime()` → called after trigger/role changes
- `handleClusterWebhook(clusterId, roleId, request)` → webhook endpoint handler

## DB Tables

- `clusters` — cluster metadata (name, system_prompt, folders, enabled)
- `cluster_roles` — role definitions scoped to a cluster (role_name, role, prompt, trigger_config, max_concurrency, plan_mode, cleanup_worker_dir, folders)

Workers are ephemeral containers, not database entities.
