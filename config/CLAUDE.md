# config/ — Next.js Config + Server Bootstrap

## Next.js Config Wrapper (index.js)

`withThepopebot()` wraps the user's `next.config.mjs`. Adds `transpilePackages` and `serverExternalPackages` for npm-package dependencies that need special bundling (Drizzle, better-sqlite3, etc.).

## Instrumentation Hook (instrumentation.js)

Loaded by Next.js once on server start. The user's project re-exports it from their own `instrumentation.js`:

```js
export { register } from 'thepopebot/instrumentation';
```

### Boot sequence

1. **Skip during `next build`** — checks `process.argv` for `'build'` to avoid keeping the event loop alive during build output.
2. **Load `.env`** — `dotenv.config()` from project root.
3. **Default `AUTH_URL` from `APP_URL`** — so NextAuth redirects to the correct host on sign-out.
4. **Validate `AUTH_SECRET`** — throws if unset (required for session encryption).
5. **`initDatabase()`** — `lib/db/index.js`. Opens SQLite, runs Drizzle migrations.
6. **`migrateEnvToDb()`** — `lib/db/config.js`. Idempotent first-run migration of `.env` values into the settings table.
7. **`loadCrons()`** — `lib/cron.js`. Reads `agent-job/CRONS.json`, schedules user-defined crons.
8. **`startBuiltinCrons()`** — `lib/cron.js`. Starts internal crons (e.g., npm version check). Then warms the in-memory update flag from `lib/db/update-check.js`.
9. **`startClusterRuntime()`** — `lib/cluster/runtime.js`. Registers cluster role triggers (cron + file watch + webhook).
10. **`startMaintenanceCron()`** — `lib/maintenance.js`. Hourly cleanup of expired agent-job API keys and other housekeeping.
11. **Config file watchers** — chokidar watches `agent-job/CRONS.json` and `event-handler/TRIGGERS.json` (with `awaitWriteFinish`). Changes call `reloadCrons()` / `reloadTriggers()` in place — no PM2 restart needed after a `git pull` updates the configs. Invalid JSON is logged and ignored; the previous schedule keeps running.

`initialized` is module-scoped so the sequence runs exactly once even if `register()` is called more than once.
