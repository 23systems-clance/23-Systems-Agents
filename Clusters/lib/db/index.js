import fs from 'fs';
import path from 'path';
import { wfDb, dataDir, PROJECT_ROOT } from '../paths.js';
import * as schema from './schema.js';

let _db = null;
let _pool = null;

/**
 * Detect whether to use Postgres or SQLite based on DATABASE_URL env var.
 */
function usePostgres() {
  return !!process.env.DATABASE_URL;
}

/**
 * Get or create the Drizzle database instance (lazy singleton).
 * Uses Postgres if DATABASE_URL is set, otherwise falls back to SQLite.
 * Must call initDatabase() first to ensure migrations are applied.
 */
export function getDb() {
  if (!_db) {
    if (usePostgres()) {
      throw new Error('Postgres DB not initialized. Call initDatabase() first.');
    }
    // SQLite fallback: create synchronously
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const Database = globalThis.__betterSqlite3;
    if (!Database) throw new Error('SQLite DB not initialized. Call initDatabase() first.');
    const sqlite = new Database(wfDb);
    sqlite.pragma('journal_mode = WAL');
    const { drizzle } = globalThis.__drizzleSqlite;
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

/**
 * Initialize the database — apply pending migrations.
 * Called from instrumentation.js at server startup.
 */
export async function initDatabase() {
  if (usePostgres()) {
    await initPostgres();
  } else {
    await initSqlite();
  }
}

async function initPostgres() {
  const pg = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');

  _pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(_pool, { schema });

  const migrationsFolder = path.join(PROJECT_ROOT, 'node_modules', '23wf', 'drizzle');
  await migrate(db, { migrationsFolder });

  // Set the singleton — Postgres getDb() returns this instance
  _db = db;
}

async function initSqlite() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const Database = (await import('better-sqlite3')).default;
  const drizzleSqlite = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');

  // Cache for getDb() fallback
  globalThis.__betterSqlite3 = Database;
  globalThis.__drizzleSqlite = drizzleSqlite;

  const sqlite = new Database(wfDb);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzleSqlite.drizzle(sqlite, { schema });

  const migrationsFolder = path.join(PROJECT_ROOT, 'node_modules', '23wf', 'drizzle');
  migrate(db, { migrationsFolder });
  sqlite.close();

  // Force re-creation of drizzle instance on next getDb() call
  _db = null;
}
