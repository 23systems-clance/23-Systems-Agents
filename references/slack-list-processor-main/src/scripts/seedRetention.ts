/**
 * Retention config seed script.
 *
 * Inserts default retention periods for each data type.
 * Uses upsert so the script is idempotent.
 *
 * Usage: npx tsx src/scripts/seedRetention.ts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const DEFAULTS: Array<{ dataType: string; retentionDays: number }> = [
  { dataType: 'api_usage_logs', retentionDays: 90 },
  { dataType: 'error_logs', retentionDays: 180 },
  { dataType: 'audit_logs', retentionDays: 0 },
  { dataType: 'daily_aggregates', retentionDays: 0 },
];

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    for (const { dataType, retentionDays } of DEFAULTS) {
      await prisma.retentionConfig.upsert({
        where: { dataType },
        update: {},
        create: { dataType, retentionDays },
      });
    }

    console.log('Retention config seeded:');
    for (const { dataType, retentionDays } of DEFAULTS) {
      const label = retentionDays === 0 ? 'permanent' : `${retentionDays} days`;
      console.log(`  ${dataType}: ${label}`);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
