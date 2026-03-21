/**
 * Seed script: insert current workspace as a WorkspaceInstallation record.
 *
 * Ensures backward compatibility — the existing single-workspace bot token
 * is stored as an encrypted WorkspaceInstallation so the authorize function
 * works for both legacy trigger flows and new agent conversations.
 *
 * Usage: npx tsx src/scripts/seedWorkspace.ts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import crypto from 'crypto';

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const botToken = process.env['SLACK_BOT_TOKEN'];
  const encryptionKey = process.env['TOKEN_ENCRYPTION_KEY'];

  if (!botToken) {
    throw new Error('SLACK_BOT_TOKEN environment variable required');
  }
  if (!encryptionKey) {
    throw new Error('TOKEN_ENCRYPTION_KEY environment variable required');
  }

  // Encrypt the bot token using AES-256-GCM (inline to avoid config dependency)
  const key = Buffer.from(encryptionKey, 'hex');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let ciphertext = cipher.update(botToken, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  const encryptedToken = `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;

  // Extract team ID from an existing job record
  const existingJob = await prisma.job.findFirst({
    select: { slackTeamId: true },
  });

  const teamId = existingJob?.slackTeamId || process.env['SLACK_TEAM_ID'];

  if (!teamId) {
    throw new Error(
      'Cannot determine team ID. Set SLACK_TEAM_ID env var or ensure at least one Job record exists.',
    );
  }

  try {
    await prisma.workspaceInstallation.upsert({
      where: { slackTeamId: teamId },
      update: {},
      create: {
        slackTeamId: teamId,
        slackTeamName: process.env['SLACK_TEAM_NAME'] || 'Primary Workspace',
        botToken: encryptedToken,
        botId: process.env['SLACK_BOT_ID'] || '',
        botUserId: process.env['SLACK_BOT_USER_ID'] || '',
        appId: process.env['SLACK_APP_ID'] || '',
        installedByUserId: '',
        scopes: 'assistant:write,chat:write,im:history,channels:history,groups:history,files:read,channels:join',
        status: 'ACTIVE',
        onboardingComplete: true,
      },
    });

    console.log(`Workspace installation seeded for team ${teamId}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
