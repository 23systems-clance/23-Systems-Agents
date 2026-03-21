/**
 * Backfill script: populate ApiUsageLog.slackTeamId from associated Job records.
 *
 * ApiUsageLog.slackTeamId was added as nullable. This script fills it from
 * the parent Job.slackTeamId for all existing records.
 *
 * Usage: npx tsx src/scripts/backfillApiUsageTeamId.ts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Use raw SQL for efficient bulk update joining on the jobs table
    const result = await prisma.$executeRaw`
      UPDATE api_usage_logs
      SET slack_team_id = jobs.slack_team_id
      FROM jobs
      WHERE api_usage_logs.job_id = jobs.id
        AND api_usage_logs.slack_team_id IS NULL
    `;

    console.log(`Backfill complete: ${result} ApiUsageLog records updated with slackTeamId`);

    // Report any remaining nulls (orphaned records)
    const remaining = await prisma.apiUsageLog.count({
      where: { slackTeamId: null },
    });

    if (remaining > 0) {
      console.warn(`Warning: ${remaining} ApiUsageLog records still have null slackTeamId (orphaned or no associated job)`);
    } else {
      console.log('All ApiUsageLog records now have slackTeamId populated');
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
