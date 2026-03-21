/**
 * Seed script for provider pricing configuration (Feature 27).
 *
 * Seeds the ProviderCost table with current pricing rates for:
 * - Apollo email enrichment
 * - Wiza email and phone enrichment
 * - AI Ark email and phone enrichment
 *
 * Run via ECS task:
 * npx ts-node scripts/seed-provider-pricing.ts
 */

import { PrismaClient, Provider, DataType } from '@prisma/client';

const prisma = new PrismaClient();

interface ProviderPricing {
  provider: Provider;
  dataType: DataType;
  costPerUnit: number;
  creditsPerUnit?: number;
  notes: string;
}

const pricing: ProviderPricing[] = [
  {
    provider: 'APOLLO',
    dataType: 'EMAIL',
    costPerUnit: 0.05,
    notes: 'Existing Apollo email pricing (1 credit @ $0.05/credit)',
  },
  {
    provider: 'WIZA',
    dataType: 'EMAIL',
    costPerUnit: 0.05,
    creditsPerUnit: 2,
    notes: 'Corrected pricing from research: 2 credits × $0.025 = $0.05',
  },
  {
    provider: 'WIZA',
    dataType: 'PHONE',
    costPerUnit: 0.125,
    creditsPerUnit: 5,
    notes: 'Corrected pricing from research: 5 credits × $0.025 = $0.125',
  },
  {
    provider: 'AI_ARK',
    dataType: 'EMAIL',
    costPerUnit: 0.14,
    notes: 'Estimate based on $0.27/credit - confirm with AI Ark sales',
  },
  {
    provider: 'AI_ARK',
    dataType: 'PHONE',
    costPerUnit: 0.27,
    notes: 'Estimate based on $0.27/credit - confirm with AI Ark sales',
  },
];

async function seedProviderPricing(): Promise<void> {
  console.log('🌱 Seeding provider pricing...');

  const effectiveDate = new Date('2026-03-14T00:00:00Z');

  for (const p of pricing) {
    const result = await prisma.providerCost.upsert({
      where: {
        provider_dataType_effectiveDate: {
          provider: p.provider,
          dataType: p.dataType,
          effectiveDate,
        },
      },
      create: {
        provider: p.provider,
        dataType: p.dataType,
        costPerUnit: p.costPerUnit,
        creditsPerUnit: p.creditsPerUnit ?? null,
        effectiveDate,
        notes: p.notes,
      },
      update: {
        // Update if already exists (allows re-running script)
        costPerUnit: p.costPerUnit,
        creditsPerUnit: p.creditsPerUnit ?? null,
        notes: p.notes,
      },
    });

    console.log(`  ✓ ${p.provider} ${p.dataType}: $${p.costPerUnit}/unit`);
  }

  console.log('✅ Provider pricing seeded successfully');
}

async function main(): Promise<void> {
  try {
    await seedProviderPricing();
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
