/**
 * Batch waterfall orchestrator for multi-provider email enrichment (Feature 27).
 *
 * Processes contacts through provider phases (Apollo → Wiza → AI Ark)
 * in batch mode. Each phase runs concurrently, and only failures
 * cascade to the next provider. ~10x faster than per-contact sequential.
 *
 * Implements FR-001, FR-002, FR-003 (waterfall sequences, stop on success,
 * no double charging).
 */

import { Provider } from '@prisma/client';
import logger from '../../lib/logger.js';
import { getCachedEmailsBatch, cacheEmailResult } from './cache.js';
import { recordProviderAttemptsBatch } from './waterfall.js';
import { getCostPerUnit } from './costCalculator.js';
import { enrichEmailsWithApolloBatch } from '../apollo/emailEnrichment.js';
import { enrichEmailsWithWizaBatch } from '../wiza/batchEnrichment.js';
import { enrichEmailsWithAIArkBatch } from '../aiark/batchEnrichment.js';
import type {
  EnrichmentContact,
  ProviderAttemptResult,
} from '../../types/providers.js';

/**
 * Result of batch waterfall enrichment for a single contact.
 */
export interface BatchContactResult {
  contactId: string;
  email: string | null;
  provider: Provider | null;
  cost: number;
  fromCache: boolean;
}

/**
 * Summary of batch waterfall enrichment across all contacts.
 */
export interface BatchWaterfallSummary {
  totalContacts: number;
  cacheHits: number;
  apolloSuccesses: number;
  wizaSuccesses: number;
  aiArkSuccesses: number;
  totalSuccesses: number;
  totalFailures: number;
  totalCost: number;
  durationMs: number;
  results: Map<string, BatchContactResult>;
}

/**
 * Options for batch waterfall enrichment.
 */
export interface BatchWaterfallOptions {
  jobId: string;
  onProgress?: (phase: string, completed: number, total: number) => void;
}

/**
 * Enrich emails using batch waterfall: Apollo → Wiza → AI Ark.
 *
 * Processes all contacts through each provider phase in batch,
 * only passing failures to the next phase. Records all attempts
 * and caches successes.
 *
 * @param contacts - Contacts to enrich.
 * @param options - Job ID and optional progress callback.
 * @returns Batch waterfall summary with per-contact results.
 */
export async function enrichEmailsBatchWaterfall(
  contacts: EnrichmentContact[],
  options: BatchWaterfallOptions,
): Promise<BatchWaterfallSummary> {
  const startTime = Date.now();
  const { jobId, onProgress } = options;

  const results = new Map<string, BatchContactResult>();
  let cacheHits = 0;
  let apolloSuccesses = 0;
  let wizaSuccesses = 0;
  let aiArkSuccesses = 0;
  let totalCost = 0;

  logger.info('Batch waterfall starting', {
    jobId,
    totalContacts: contacts.length,
  });

  // ── Phase 0: Batch cache check ──────────────────────────────────
  const cachedEmails = await getCachedEmailsBatch(contacts);

  for (const [contactId, cached] of cachedEmails) {
    results.set(contactId, {
      contactId,
      email: cached.email,
      provider: cached.provider,
      cost: 0, // Cached, no new cost
      fromCache: true,
    });
    cacheHits++;
  }

  logger.info('Batch waterfall: cache phase complete', {
    jobId,
    cacheHits,
    remaining: contacts.length - cacheHits,
  });

  // Filter to uncached contacts
  let remaining = contacts.filter((c) => !results.has(c.id));

  if (remaining.length === 0) {
    return buildSummary(contacts.length, results, cacheHits, apolloSuccesses, wizaSuccesses, aiArkSuccesses, totalCost, startTime);
  }

  // ── Phase 1: Apollo ──────────────────────────────────────────────
  logger.info('Batch waterfall: Phase 1 (Apollo) starting', {
    jobId,
    contactCount: remaining.length,
  });

  const apolloResults = await enrichEmailsWithApolloBatch(
    remaining,
    onProgress ? (completed, total) => onProgress('Apollo', completed, total) : undefined,
  );

  const apolloAttempts: Array<{ contactId: string; jobId: string; result: ProviderAttemptResult }> = [];
  const apolloCost = await getCostPerUnit('APOLLO', 'EMAIL');

  for (const contact of remaining) {
    const email = apolloResults.get(contact.id) ?? null;
    const startedAt = Date.now();

    if (email) {
      apolloSuccesses++;
      totalCost += apolloCost;
      results.set(contact.id, {
        contactId: contact.id,
        email,
        provider: 'APOLLO',
        cost: apolloCost,
        fromCache: false,
      });

      // Cache the result
      await cacheEmailResult(contact, email, 'APOLLO', apolloCost);

      apolloAttempts.push({
        contactId: contact.id,
        jobId,
        result: {
          provider: 'APOLLO',
          dataType: 'EMAIL',
          status: 'SUCCESS',
          emailFound: email,
          cost: apolloCost,
          durationMs: Date.now() - startedAt,
        },
      });
    } else {
      apolloAttempts.push({
        contactId: contact.id,
        jobId,
        result: {
          provider: 'APOLLO',
          dataType: 'EMAIL',
          status: 'NO_DATA',
          durationMs: Date.now() - startedAt,
        },
      });
    }
  }

  // Batch record Apollo attempts
  await recordProviderAttemptsBatch(apolloAttempts);

  logger.info('Batch waterfall: Phase 1 (Apollo) complete', {
    jobId,
    successes: apolloSuccesses,
    failures: remaining.length - apolloSuccesses,
  });

  // Filter to Apollo failures for Wiza
  remaining = remaining.filter((c) => !results.has(c.id));

  if (remaining.length === 0) {
    return buildSummary(contacts.length, results, cacheHits, apolloSuccesses, wizaSuccesses, aiArkSuccesses, totalCost, startTime);
  }

  // ── Phase 2: Wiza ───────────────────────────────────────────────
  logger.info('Batch waterfall: Phase 2 (Wiza) starting', {
    jobId,
    contactCount: remaining.length,
  });

  const wizaResults = await enrichEmailsWithWizaBatch(
    remaining,
    onProgress ? (completed, total) => onProgress('Wiza', completed, total) : undefined,
  );

  const wizaAttempts: Array<{ contactId: string; jobId: string; result: ProviderAttemptResult }> = [];
  const wizaCost = await getCostPerUnit('WIZA', 'EMAIL');

  for (const contact of remaining) {
    const email = wizaResults.get(contact.id) ?? null;
    const startedAt = Date.now();

    if (email) {
      wizaSuccesses++;
      totalCost += wizaCost;
      results.set(contact.id, {
        contactId: contact.id,
        email,
        provider: 'WIZA',
        cost: wizaCost,
        fromCache: false,
      });

      await cacheEmailResult(contact, email, 'WIZA', wizaCost);

      wizaAttempts.push({
        contactId: contact.id,
        jobId,
        result: {
          provider: 'WIZA',
          dataType: 'EMAIL',
          status: 'SUCCESS',
          emailFound: email,
          cost: wizaCost,
          durationMs: Date.now() - startedAt,
        },
      });
    } else {
      wizaAttempts.push({
        contactId: contact.id,
        jobId,
        result: {
          provider: 'WIZA',
          dataType: 'EMAIL',
          status: 'NO_DATA',
          durationMs: Date.now() - startedAt,
        },
      });
    }
  }

  await recordProviderAttemptsBatch(wizaAttempts);

  logger.info('Batch waterfall: Phase 2 (Wiza) complete', {
    jobId,
    successes: wizaSuccesses,
    failures: remaining.length - wizaSuccesses,
  });

  // Filter to Wiza failures for AI Ark
  remaining = remaining.filter((c) => !results.has(c.id));

  if (remaining.length === 0) {
    return buildSummary(contacts.length, results, cacheHits, apolloSuccesses, wizaSuccesses, aiArkSuccesses, totalCost, startTime);
  }

  // ── Phase 3: AI Ark ─────────────────────────────────────────────
  logger.info('Batch waterfall: Phase 3 (AI Ark) starting', {
    jobId,
    contactCount: remaining.length,
  });

  if (onProgress) onProgress('AI Ark', 0, remaining.length);

  const aiArkResults = await enrichEmailsWithAIArkBatch(remaining);

  const aiArkAttempts: Array<{ contactId: string; jobId: string; result: ProviderAttemptResult }> = [];
  const aiArkCost = await getCostPerUnit('AI_ARK', 'EMAIL');

  for (const contact of remaining) {
    const email = aiArkResults.get(contact.id) ?? null;
    const startedAt = Date.now();

    if (email) {
      aiArkSuccesses++;
      totalCost += aiArkCost;
      results.set(contact.id, {
        contactId: contact.id,
        email,
        provider: 'AI_ARK',
        cost: aiArkCost,
        fromCache: false,
      });

      await cacheEmailResult(contact, email, 'AI_ARK', aiArkCost);

      aiArkAttempts.push({
        contactId: contact.id,
        jobId,
        result: {
          provider: 'AI_ARK',
          dataType: 'EMAIL',
          status: 'SUCCESS',
          emailFound: email,
          cost: aiArkCost,
          durationMs: Date.now() - startedAt,
        },
      });
    } else {
      aiArkAttempts.push({
        contactId: contact.id,
        jobId,
        result: {
          provider: 'AI_ARK',
          dataType: 'EMAIL',
          status: 'NO_DATA',
          durationMs: Date.now() - startedAt,
        },
      });
    }
  }

  await recordProviderAttemptsBatch(aiArkAttempts);

  if (onProgress) onProgress('AI Ark', remaining.length, remaining.length);

  logger.info('Batch waterfall: Phase 3 (AI Ark) complete', {
    jobId,
    successes: aiArkSuccesses,
    failures: remaining.length - aiArkSuccesses,
  });

  // Set null for any contacts with no result across all providers
  for (const contact of contacts) {
    if (!results.has(contact.id)) {
      results.set(contact.id, {
        contactId: contact.id,
        email: null,
        provider: null,
        cost: 0,
        fromCache: false,
      });
    }
  }

  return buildSummary(contacts.length, results, cacheHits, apolloSuccesses, wizaSuccesses, aiArkSuccesses, totalCost, startTime);
}

/**
 * Build the final summary object.
 */
function buildSummary(
  totalContacts: number,
  results: Map<string, BatchContactResult>,
  cacheHits: number,
  apolloSuccesses: number,
  wizaSuccesses: number,
  aiArkSuccesses: number,
  totalCost: number,
  startTime: number,
): BatchWaterfallSummary {
  const totalSuccesses = cacheHits + apolloSuccesses + wizaSuccesses + aiArkSuccesses;
  const durationMs = Date.now() - startTime;

  const summary: BatchWaterfallSummary = {
    totalContacts,
    cacheHits,
    apolloSuccesses,
    wizaSuccesses,
    aiArkSuccesses,
    totalSuccesses,
    totalFailures: totalContacts - totalSuccesses,
    totalCost,
    durationMs,
    results,
  };

  logger.info('Batch waterfall complete', {
    totalContacts,
    cacheHits,
    apolloSuccesses,
    wizaSuccesses,
    aiArkSuccesses,
    totalSuccesses,
    totalFailures: summary.totalFailures,
    totalCost: totalCost.toFixed(2),
    durationMs,
    avgMsPerContact: totalContacts > 0 ? Math.round(durationMs / totalContacts) : 0,
  });

  return summary;
}
