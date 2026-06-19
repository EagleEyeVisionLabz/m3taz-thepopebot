import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { PROJECT_ROOT } from '../paths.js';
import * as schema from './schema.js';
import { backfillLastUsedAt } from './api-keys.js';

const thepopebotDb = process.env.DATABASE_PATH || path.join(PROJECT_ROOT, 'data/db/thepopebot.sqlite');

let _db = null;

/**
 * Get or create the Drizzle database instance (lazy singleton).
 * @returns {import('drizzle-orm/better-sqlite3').BetterSQLite3Database}
 */
export function getDb() {
  if (!_db) {
    // Ensure database directory exists
    const dbDir = path.dirname(thepopebotDb);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const sqlite = new Database(thepopebotDb);
    sqlite.pragma('journal_mode = WAL');
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

/**
 * Initialize the database — apply pending migrations.
 * Called from instrumentation.js at server startup.
 * Uses Drizzle Kit migrations from the package's drizzle/ folder.
 */
export function initDatabase() {
  const dbDir = path.dirname(thepopebotDb);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const sqlite = new Database(thepopebotDb);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });

  // Resolve migrations folder from the installed package.
  // import.meta.url doesn't survive webpack bundling, so resolve from PROJECT_ROOT.
  // Production installs ship the package under node_modules/thepopebot; local
  // clones / monorepo checkouts have the package source AS the project root, so
  // fall back to PROJECT_ROOT/drizzle when the node_modules path is absent.
  const installedMigrations = path.join(PROJECT_ROOT, 'node_modules', 'thepopebot', 'drizzle');
  const localMigrations = path.join(PROJECT_ROOT, 'drizzle');
  let migrationsFolder = null;
  if (fs.existsSync(installedMigrations)) {
    migrationsFolder = installedMigrations;
  } else if (fs.existsSync(localMigrations)) {
    migrationsFolder = localMigrations;
  }

  if (!migrationsFolder) {
    sqlite.close();
    throw new Error(
      `Database migrations folder not found. Looked in:\n  ${installedMigrations}\n  ${localMigrations}\n` +
        'Ensure the thepopebot package (with its drizzle/ migrations) is installed, ' +
        'or that PROJECT_ROOT points at the package source.'
    );
  }

  migrate(db, { migrationsFolder });

  // One-shot cleanup: drop orphan LangGraph checkpoint tables left behind by
  // @langchain/langgraph-checkpoint-sqlite. The React agent has been removed —
  // these tables are never read or written again. Safe to run on every boot
  // (IF EXISTS is a no-op once dropped).
  //
  // DO NOT add any new DDL here. Per CLAUDE.md, schema changes MUST go through
  // the migration workflow (edit lib/db/schema.js → `npm run db:generate`).
  // This block is a temporary legacy-table cleanup, not a precedent for raw DDL;
  // it should be folded into a forward-only Drizzle migration and removed.
  sqlite.exec(`
    DROP TABLE IF EXISTS checkpoints;
    DROP TABLE IF EXISTS checkpoint_blobs;
    DROP TABLE IF EXISTS checkpoint_writes;
    DROP TABLE IF EXISTS writes;
    DROP TABLE IF EXISTS checkpoint_migrations;
  `);

  sqlite.close();

  // Force re-creation of drizzle instance on next getDb() call
  _db = null;

  // Backfill lastUsedAt column from JSON for existing api_key rows
  try {
    backfillLastUsedAt();
  } catch {
    // Non-fatal: backfill is informational
  }
}
