#!/usr/bin/env tsx
/**
 * Flush prompt cache for agent-intent-classifier.
 * Run with: npx tsx scripts/flush-prompt-cache.ts
 */

import { prisma } from '../src/models/index.js';
import { invalidateCache } from '../src/services/ai/promptResolver.js';
import logger from '../src/lib/logger.js';

async function main() {
  console.log('Flushing prompt cache for agent-intent-classifier...');

  // Check if DB has a published version
  const prompt = await prisma.prompt.findUnique({
    where: { slug: 'agent-intent-classifier' },
    include: {
      versions: {
        where: { status: 'PUBLISHED' },
        take: 1,
      },
    },
  });

  if (prompt && prompt.versions.length > 0) {
    console.log(`Found DB prompt version ${prompt.versions[0].version}`);
    console.log('Content preview:', prompt.versions[0].content.substring(0, 200));
    console.log('\nWARNING: Database has a published version. To use compiled defaults, you need to:');
    console.log('1. Archive the published version, OR');
    console.log('2. Update the DB version with the new content');
    console.log('\nFor now, just invalidating cache...');
  } else {
    console.log('No DB prompt found - will use compiled defaults after cache flush');
  }

  // Invalidate cache
  await invalidateCache('agent-intent-classifier');
  await invalidateCache('enrichment-intent-classifier');

  console.log('Cache invalidated successfully!');
  console.log('The service will now load prompts from:');
  console.log(prompt && prompt.versions.length > 0 ? '  -> Database (published version)' : '  -> Compiled defaults');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
