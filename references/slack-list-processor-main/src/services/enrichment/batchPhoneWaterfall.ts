/**
 * Batch phone waterfall orchestrator (Feature 27, US2/US3).
 *
 * Processes contacts through Apollo → Wiza → AI Ark in batch mode.
 * Only failures cascade to the next provider.
 */

import { Provider } from '@prisma/client';
import logger from '../../lib/logger.js';
import { getCostPerUnit } from './costCalculator.js';
import { cachePhoneResult } from './cache.js';
import { recordProviderAttemptsBatch } from './waterfall.js';
import { enrichPhonesWithApolloBatch } from '../apollo/phoneEnrichment.js';
import { enrichPhonesWithWizaBatch } from '../wiza/phoneEnrichment.js';
import { enrichPhonesWithAIArkBatch } from '../aiark/phoneEnrichment.js';
import type {
  EnrichmentContact,
  ProviderAttemptResult,
} from '../../types/providers.js';

/**
 * Result of batch phone waterfall for a single contact.
 */
export interface BatchPhoneContactResult {
  contactId: string;
  phone: string | null;
  provider: Provider | null;
  cost: number;
}

/**
 * Summary of batch phone waterfall enrichment.
 */
export interface BatchPhoneWaterfallSummary {
  totalContacts: number;
  apolloSuccesses: number;
  wizaSuccesses: number;
  aiArkSuccesses: number;
  totalSuccesses: number;
  totalFailures: number;
  totalCost: number;
  durationMs: number;
  results: Map<string, BatchPhoneContactResult>;
}

/**
 * Options for batch phone waterfall.
 */
export interface BatchPhoneWaterfallOptions {
  jobId: string;
  onProgress?: (phase: string, completed: number, total: number) => void;
}

/**
 * Enrich phones using batch waterfall: Apollo → Wiza → AI Ark.
 *
 * @param contacts - Contacts to enrich.
 * @param options - Job ID and optional progress callback.
 * @returns Batch phone waterfall summary.
 */
export async function enrichPhonesBatchWaterfall(
  contacts: EnrichmentContact[],
  options: BatchPhoneWaterfallOptions,
): Promise<BatchPhoneWaterfallSummary> {
  const startTime = Date.now();
  const { jobId, onProgress } = options;

  const results = new Map<string, BatchPhoneContactResult>();
  let apolloSuccesses = 0;
  let wizaSuccesses = 0;
  let aiArkSuccesses = 0;
  let totalCost = 0;

  logger.info('Batch phone waterfall starting', {
    jobId,
    totalContacts: contacts.length,
  });

  // ── Phase 1: Apollo ──────────────────────────────────────────────
  logger.info('Batch phone waterfall: Phase 1 (Apollo) starting', {
    jobId,
    contactCount: contacts.length,
  });

  const apolloResults = await enrichPhonesWithApolloBatch(
    contacts,
    onProgress ? (completed, total) => onProgress('Apollo', completed, total) : undefined,
  );

  const apolloAttempts: Array<{ contactId: string; jobId: string; result: ProviderAttemptResult }> = [];
  const apolloCost = await getCostPerUnit('APOLLO', 'PHONE');

  for (const contact of contacts) {
    const phone = apolloResults.get(contact.id) ?? null;

    if (phone) {
      apolloSuccesses++;
      totalCost += apolloCost;
      results.set(contact.id, {
        contactId: contact.id,
        phone,
        provider: 'APOLLO',
        cost: apolloCost,
      });

      await cachePhoneResult(contact, phone, 'APOLLO', apolloCost);

      apolloAttempts.push({
        contactId: contact.id,
        jobId,
        result: {
          provider: 'APOLLO',
          dataType: 'PHONE',
          status: 'SUCCESS',
          phoneFound: phone,
          cost: apolloCost,
        },
      });
    } else {
      apolloAttempts.push({
        contactId: contact.id,
        jobId,
        result: {
          provider: 'APOLLO',
          dataType: 'PHONE',
          status: 'NO_DATA',
        },
      });
    }
  }

  await recordProviderAttemptsBatch(apolloAttempts);

  logger.info('Batch phone waterfall: Phase 1 (Apollo) complete', {
    jobId,
    successes: apolloSuccesses,
    failures: contacts.length - apolloSuccesses,
  });

  // Filter to Apollo failures
  let remaining = contacts.filter((c) => !results.has(c.id));

  if (remaining.length === 0) {
    return buildSummary(contacts.length, results, apolloSuccesses, wizaSuccesses, aiArkSuccesses, totalCost, startTime);
  }

  // ── Phase 2: Wiza ────────────────────────────────────────────────
  logger.info('Batch phone waterfall: Phase 2 (Wiza) starting', {
    jobId,
    contactCount: remaining.length,
  });

  const wizaResults = await enrichPhonesWithWizaBatch(
    remaining,
    onProgress ? (completed, total) => onProgress('Wiza', completed, total) : undefined,
  );

  const wizaAttempts: Array<{ contactId: string; jobId: string; result: ProviderAttemptResult }> = [];
  const wizaCost = await getCostPerUnit('WIZA', 'PHONE');

  for (const contact of remaining) {
    const phone = wizaResults.get(contact.id) ?? null;

    if (phone) {
      wizaSuccesses++;
      totalCost += wizaCost;
      results.set(contact.id, {
        contactId: contact.id,
        phone,
        provider: 'WIZA',
        cost: wizaCost,
      });

      await cachePhoneResult(contact, phone, 'WIZA', wizaCost);

      wizaAttempts.push({
        contactId: contact.id,
        jobId,
        result: {
          provider: 'WIZA',
          dataType: 'PHONE',
          status: 'SUCCESS',
          phoneFound: phone,
          cost: wizaCost,
        },
      });
    } else {
      wizaAttempts.push({
        contactId: contact.id,
        jobId,
        result: {
          provider: 'WIZA',
          dataType: 'PHONE',
          status: 'NO_DATA',
        },
      });
    }
  }

  await recordProviderAttemptsBatch(wizaAttempts);

  logger.info('Batch phone waterfall: Phase 2 (Wiza) complete', {
    jobId,
    successes: wizaSuccesses,
    failures: remaining.length - wizaSuccesses,
  });

  // Filter to Wiza failures
  remaining = remaining.filter((c) => !results.has(c.id));

  if (remaining.length === 0) {
    return buildSummary(contacts.length, results, apolloSuccesses, wizaSuccesses, aiArkSuccesses, totalCost, startTime);
  }

  // ── Phase 3: AI Ark ──────────────────────────────────────────────
  logger.info('Batch phone waterfall: Phase 3 (AI Ark) starting', {
    jobId,
    contactCount: remaining.length,
  });

  if (onProgress) onProgress('AI Ark', 0, remaining.length);

  const aiArkResults = await enrichPhonesWithAIArkBatch(
    remaining,
    onProgress ? (completed, total) => onProgress('AI Ark', completed, total) : undefined,
  );

  const aiArkAttempts: Array<{ contactId: string; jobId: string; result: ProviderAttemptResult }> = [];
  const aiArkCost = await getCostPerUnit('AI_ARK', 'PHONE');

  for (const contact of remaining) {
    const phone = aiArkResults.get(contact.id) ?? null;

    if (phone) {
      aiArkSuccesses++;
      totalCost += aiArkCost;
      results.set(contact.id, {
        contactId: contact.id,
        phone,
        provider: 'AI_ARK',
        cost: aiArkCost,
      });

      await cachePhoneResult(contact, phone, 'AI_ARK', aiArkCost);

      aiArkAttempts.push({
        contactId: contact.id,
        jobId,
        result: {
          provider: 'AI_ARK',
          dataType: 'PHONE',
          status: 'SUCCESS',
          phoneFound: phone,
          cost: aiArkCost,
        },
      });
    } else {
      aiArkAttempts.push({
        contactId: contact.id,
        jobId,
        result: {
          provider: 'AI_ARK',
          dataType: 'PHONE',
          status: 'NO_DATA',
        },
      });
    }
  }

  await recordProviderAttemptsBatch(aiArkAttempts);

  logger.info('Batch phone waterfall: Phase 3 (AI Ark) complete', {
    jobId,
    successes: aiArkSuccesses,
    failures: remaining.length - aiArkSuccesses,
  });

  // Set null for contacts with no result
  for (const contact of contacts) {
    if (!results.has(contact.id)) {
      results.set(contact.id, {
        contactId: contact.id,
        phone: null,
        provider: null,
        cost: 0,
      });
    }
  }

  return buildSummary(contacts.length, results, apolloSuccesses, wizaSuccesses, aiArkSuccesses, totalCost, startTime);
}

/**
 * Build the final summary object.
 */
function buildSummary(
  totalContacts: number,
  results: Map<string, BatchPhoneContactResult>,
  apolloSuccesses: number,
  wizaSuccesses: number,
  aiArkSuccesses: number,
  totalCost: number,
  startTime: number,
): BatchPhoneWaterfallSummary {
  const totalSuccesses = apolloSuccesses + wizaSuccesses + aiArkSuccesses;
  const durationMs = Date.now() - startTime;

  const summary: BatchPhoneWaterfallSummary = {
    totalContacts,
    apolloSuccesses,
    wizaSuccesses,
    aiArkSuccesses,
    totalSuccesses,
    totalFailures: totalContacts - totalSuccesses,
    totalCost,
    durationMs,
    results,
  };

  logger.info('Batch phone waterfall complete', {
    totalContacts,
    apolloSuccesses,
    wizaSuccesses,
    aiArkSuccesses,
    totalSuccesses,
    totalFailures: summary.totalFailures,
    totalCost: totalCost.toFixed(2),
    durationMs,
  });

  return summary;
}
