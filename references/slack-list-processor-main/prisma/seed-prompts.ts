/**
 * Idempotent prompt seeding script.
 *
 * Upserts the 4 core AI prompts with their v1 content as PUBLISHED.
 * Safe to run multiple times — existing prompts and published versions
 * are not overwritten (uses upsert with create-only semantics for versions).
 *
 * Run: npx tsx prisma/seed-prompts.ts
 *
 * @module seed-prompts
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import {
  AGENT_INTENT_CLASSIFIER_PROMPT,
  ENRICHMENT_INTENT_CLASSIFIER_PROMPT,
  PERSONA_CLASSIFIER_PROMPT,
  FILTER_PARSER_PROMPT,
  type DefaultPrompt,
} from '../src/services/ai/defaultPrompts.js';

// ---------------------------------------------------------------------------
// Standalone Prisma client (seed runs outside the app process)
// ---------------------------------------------------------------------------

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ...(process.env.NODE_ENV === 'production' ? { ssl: { rejectUnauthorized: false } } : {}),
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Prompt definitions to seed
// ---------------------------------------------------------------------------

const PROMPTS_TO_SEED: DefaultPrompt[] = [
  AGENT_INTENT_CLASSIFIER_PROMPT,
  ENRICHMENT_INTENT_CLASSIFIER_PROMPT,
  PERSONA_CLASSIFIER_PROMPT,
  FILTER_PARSER_PROMPT,
];

/**
 * Template variables to seed. Maps variable name → description + default.
 * Only variables actually used in prompt templates need entries here.
 */
const VARIABLES_TO_SEED: {
  name: string;
  description: string;
  defaultValue: string | null;
  promptSlugs: string[];
}[] = [
  {
    name: 'availableColumns',
    description: 'Comma-separated list of column headers from the uploaded file (injected at runtime)',
    defaultValue: null, // Runtime-only — no stored default
    promptSlugs: ['filter-parser'],
  },
  {
    name: 'sampleData',
    description: 'First few rows of data from the uploaded file for context (injected at runtime)',
    defaultValue: null, // Runtime-only — no stored default
    promptSlugs: ['filter-parser'],
  },
];

// ---------------------------------------------------------------------------
// Seed logic
// ---------------------------------------------------------------------------

async function seedPrompts(): Promise<void> {
  console.log('Seeding prompts...');

  for (const def of PROMPTS_TO_SEED) {
    // Upsert the prompt record
    const prompt = await prisma.prompt.upsert({
      where: { slug: def.slug },
      update: {
        // Only update metadata fields — don't overwrite customisations
        displayName: def.displayName,
        description: def.description,
        category: def.category,
        modelConfig: def.modelConfig,
        toolDefinitions: def.toolDefinitions,
      },
      create: {
        slug: def.slug,
        displayName: def.displayName,
        description: def.description,
        category: def.category,
        modelConfig: def.modelConfig,
        toolDefinitions: def.toolDefinitions,
      },
    });

    // Check if a v1 version already exists
    const existingV1 = await prisma.promptVersion.findUnique({
      where: {
        promptId_version: {
          promptId: prompt.id,
          version: 1,
        },
      },
    });

    if (!existingV1) {
      // Create v1 as PUBLISHED
      await prisma.promptVersion.create({
        data: {
          promptId: prompt.id,
          version: 1,
          content: def.content,
          status: 'PUBLISHED',
          publishedBy: 'system-seed',
          publishedAt: new Date(),
          changeNote: 'Initial seeded version from compiled defaults',
        },
      });
      console.log(`  Created v1 PUBLISHED for "${def.slug}"`);
    } else {
      console.log(`  v1 already exists for "${def.slug}" — skipped`);
    }
  }

  console.log('Seeding template variables...');

  for (const varDef of VARIABLES_TO_SEED) {
    const variable = await prisma.promptVariable.upsert({
      where: { name: varDef.name },
      update: {
        description: varDef.description,
      },
      create: {
        name: varDef.name,
        description: varDef.description,
        defaultValue: varDef.defaultValue,
      },
    });

    // Link variable to its prompts
    for (const slug of varDef.promptSlugs) {
      const prompt = await prisma.prompt.findUnique({ where: { slug } });
      if (!prompt) {
        console.warn(`  Warning: prompt "${slug}" not found for variable "${varDef.name}"`);
        continue;
      }

      await prisma.promptVariableMapping.upsert({
        where: {
          promptId_variableId: {
            promptId: prompt.id,
            variableId: variable.id,
          },
        },
        update: {},
        create: {
          promptId: prompt.id,
          variableId: variable.id,
        },
      });
    }

    console.log(`  Seeded variable "${varDef.name}" → [${varDef.promptSlugs.join(', ')}]`);
  }

  console.log('Prompt seeding complete.');
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

seedPrompts()
  .catch((err) => {
    console.error('Prompt seeding failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
