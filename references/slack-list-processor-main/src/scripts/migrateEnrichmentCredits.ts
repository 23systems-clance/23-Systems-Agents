/**
 * Enrichment Credit Migration Script (T056 — Feature 39).
 *
 * For each workspace with a BillingProfile, creates a PackSubscription
 * to the Enrichment Pack with:
 *   - creditsIncluded = monthlyAllowance from BillingProfile
 *   - creditsUsed = estimated from current period usage
 *
 * Idempotent: skips workspaces that already have an active subscription.
 *
 * Usage: npx tsx src/scripts/migrateEnrichmentCredits.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateCredits() {
  console.log('Starting credit migration...\n');

  // Find the Enrichment Pack
  const enrichmentPack = await prisma.verticalPack.findUnique({
    where: { slug: 'enrichment-pack' },
  });

  if (!enrichmentPack) {
    console.error('Enrichment Pack not found. Run migrateEnrichment.ts first.');
    process.exit(1);
  }

  console.log(`Found Enrichment Pack: ${enrichmentPack.id}\n`);

  // Get all billing profiles
  const billingProfiles = await prisma.billingProfile.findMany({
    where: { status: { not: 'SUSPENDED' } },
  });

  console.log(`Found ${billingProfiles.length} billing profiles to migrate.\n`);

  let created = 0;
  let skipped = 0;

  for (const profile of billingProfiles) {
    // Check for existing subscription
    const existing = await prisma.packSubscription.findFirst({
      where: {
        packId: enrichmentPack.id,
        slackTeamId: profile.slackTeamId,
        status: 'ACTIVE',
      },
    });

    if (existing) {
      console.log(`  SKIP: ${profile.slackTeamId} — already subscribed (${existing.id})`);
      skipped++;
      continue;
    }

    // Estimate current period usage from credit transactions
    const now = new Date();
    const periodStart = new Date(now);
    periodStart.setDate(profile.billingCycleDay);
    if (periodStart > now) {
      periodStart.setMonth(periodStart.getMonth() - 1);
    }

    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    // Sum deductions in current period
    const usageAgg = await prisma.creditTransaction.aggregate({
      where: {
        billingProfileId: profile.id,
        type: 'ENRICHMENT_DEDUCTION',
        createdAt: { gte: periodStart },
      },
      _sum: { amount: true },
    });

    const creditsUsed = Math.abs(usageAgg._sum.amount ?? 0);

    // Create subscription
    const subscription = await prisma.packSubscription.create({
      data: {
        packId: enrichmentPack.id,
        slackTeamId: profile.slackTeamId,
        status: 'ACTIVE',
        creditsIncluded: profile.monthlyAllowance,
        creditsUsed,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });

    console.log(
      `  CREATE: ${profile.slackTeamId} — ${profile.monthlyAllowance} credits, ${creditsUsed} used (${subscription.id})`,
    );
    created++;
  }

  console.log(`\nMigration complete!`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped: ${skipped}`);
}

migrateCredits()
  .catch((err) => {
    console.error('Credit migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
