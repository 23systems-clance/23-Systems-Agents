#!/usr/bin/env node
/**
 * One-time data migration: SQLite → Postgres.
 * Exports all SQLite tables as JSON, then imports into Postgres.
 *
 * Prerequisites:
 *   - Postgres running (docker compose -f docker-compose.infra.yml up -d)
 *   - Drizzle migrations applied to Postgres
 *   - DATABASE_URL set in .env
 *
 * Usage: node scripts/migrate-sqlite-to-postgres.js
 */

import Database from 'better-sqlite3';
import pg from 'pg';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', '23wf.sqlite');
const PG_URL = process.env.DATABASE_URL;

if (!PG_URL) {
  console.error('DATABASE_URL not set. Add it to .env first.');
  process.exit(1);
}

if (!fs.existsSync(SQLITE_PATH)) {
  console.error(`SQLite database not found at ${SQLITE_PATH}`);
  process.exit(1);
}

const TABLES = [
  'users',
  'chats',
  'messages',
  'notifications',
  'subscriptions',
  'settings',
  'clusters',
  'cluster_roles',
  'code_workspaces',
  'leads',
];

async function migrate() {
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pool = new pg.Pool({ connectionString: PG_URL });

  try {
    for (const table of TABLES) {
      // Check if table exists in SQLite
      const exists = sqlite.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
      ).get(table);

      if (!exists) {
        console.log(`  Skipping ${table} (not in SQLite)`);
        continue;
      }

      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      if (rows.length === 0) {
        console.log(`  Skipping ${table} (empty)`);
        continue;
      }

      const columns = Object.keys(rows[0]);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      const insertSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

      let inserted = 0;
      for (const row of rows) {
        const values = columns.map(col => row[col]);
        try {
          await pool.query(insertSql, values);
          inserted++;
        } catch (err) {
          console.warn(`  Warning: failed to insert row in ${table}:`, err.message);
        }
      }
      console.log(`  ${table}: ${inserted}/${rows.length} rows migrated`);
    }

    console.log('\nMigration complete.');
  } finally {
    sqlite.close();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
