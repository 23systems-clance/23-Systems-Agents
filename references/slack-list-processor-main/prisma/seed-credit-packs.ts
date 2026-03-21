/**
 * Seed script for initial CreditPack records (T078).
 *
 * Creates standard credit pack tiers if they don't already exist.
 * Run via: npx tsx prisma/seed-credit-packs.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CREDIT_PACKS = [
  {
    name: 'Starter Pack',
    creditAmount: 100,
    priceUsd: 29,
    sortOrder: 1,
  },
  {
    name: 'Growth Pack',
    creditAmount: 250,
    priceUsd: 59,
    sortOrder: 2,
  },
  {
    name: 'Professional Pack',
    creditAmount: 500,
    priceUsd: 99,
    sortOrder: 3,
  },
  {
    name: 'Enterprise Pack',
    creditAmount: 1000,
    priceUsd: 179,
    sortOrder: 4,
  },
];

async function main(): Promise<void> {
  console.log('Seeding credit packs...');

  for (const pack of CREDIT_PACKS) {
    const existing = await prisma.creditPack.findFirst({
      where: { name: pack.name },
    });

    if (existing) {
      console.log(`  Skipping "${pack.name}" (already exists)`);
      continue;
    }

    await prisma.creditPack.create({
      data: {
        name: pack.name,
        creditAmount: pack.creditAmount,
        priceUsd: pack.priceUsd,
        sortOrder: pack.sortOrder,
        active: true,
      },
    });
    console.log(`  Created "${pack.name}" (${pack.creditAmount} credits / $${pack.priceUsd})`);
  }

  console.log('Credit pack seeding complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
