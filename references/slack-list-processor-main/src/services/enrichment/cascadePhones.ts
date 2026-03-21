/**
 * Phone waterfall cascade: Wiza -> AI Ark for contacts missing phone numbers.
 *
 * After Apollo bulk_match, some contacts may not have phone numbers.
 * This function cascades through Wiza and AI Ark to find phones for those contacts.
 *
 * Extracted to a shared module so it can be called from:
 * - combined.ts (when no email verification gate fires)
 * - emailVerification.ts worker (after email verification completes)
 * - emailVerification.ts action handler (when user skips verification)
 */

import { config } from '../../config/index.js';
import { prisma } from '../../models/index.js';
import { enrichPhonesWithWizaBatch } from '../wiza/phoneEnrichment.js';
import { enrichPhonesWithAIArkBatch } from '../aiark/phoneEnrichment.js';
import { getCostPerUnit } from './costCalculator.js';
import type { EnrichmentContact } from '../../types/providers.js';
import type { Logger } from '../../lib/logger.js';

/**
 * Cascade through Wiza -> AI Ark to find phones for contacts missing them.
 *
 * @param jobId     - Parent job UUID.
 * @param jobLogger - Logger with job context.
 * @returns Count of phones found by each provider.
 */
export async function cascadePhoneWaterfall(
  jobId: string,
  jobLogger: Logger,
): Promise<{ wizaFound: number; aiArkFound: number }> {
  const contactsWithoutPhone = await prisma.jobContact.findMany({
    where: {
      jobId,
      directPhone: null,
      enrichmentStatus: 'ENRICHED',
    },
    select: {
      id: true,
      fullName: true,
      firstName: true,
      lastName: true,
      email: true,
      linkedinUrl: true,
      apolloMetadata: true,
    },
  });

  if (contactsWithoutPhone.length === 0) {
    jobLogger.info('Phone waterfall cascade: all contacts already have phones');
    return { wizaFound: 0, aiArkFound: 0 };
  }

  // Build EnrichmentContact[] from DB records
  const enrichmentContacts: EnrichmentContact[] = contactsWithoutPhone.map((c) => {
    const meta = (c.apolloMetadata ?? {}) as Record<string, unknown>;
    const org = (meta.organization ?? {}) as Record<string, unknown>;
    return {
      id: c.id,
      fullName: c.fullName ?? undefined,
      firstName: c.firstName ?? undefined,
      lastName: c.lastName ?? undefined,
      email: c.email ?? undefined,
      domain: (org.primary_domain as string) ?? undefined,
      companyName: (org.name as string) ?? undefined,
      linkedinUrl: c.linkedinUrl ?? undefined,
    };
  });

  jobLogger.info('Phone waterfall cascade starting (Wiza -> AI Ark)', {
    contactsWithoutPhone: enrichmentContacts.length,
  });

  // Notify the user that phone enrichment is in progress
  const dbJobForSlack = await prisma.job.findUnique({
    where: { id: jobId },
    select: { slackChannelId: true, slackThreadTs: true },
  });
  if (dbJobForSlack) {
    try {
      const { WebClient } = await import('@slack/web-api');
      const slackClient = new WebClient(config.slack.botToken);
      await slackClient.chat.postMessage({
        channel: dbJobForSlack.slackChannelId,
        thread_ts: dbJobForSlack.slackThreadTs,
        text: `Finding phone numbers for ${enrichmentContacts.length} contacts via Wiza and AI Ark...`,
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:telephone_receiver: Finding phone numbers for *${enrichmentContacts.length}* ${enrichmentContacts.length === 1 ? 'contact' : 'contacts'} via Wiza and AI Ark...`,
          },
        }],
      });
    } catch {
      // Non-critical — don't fail the cascade if Slack notification fails
    }
  }

  let wizaFound = 0;
  let aiArkFound = 0;

  // Phase 1: Wiza
  try {
    const wizaResults = await enrichPhonesWithWizaBatch(enrichmentContacts);
    const wizaCost = await getCostPerUnit('WIZA', 'PHONE');
    const afterWizaRemaining: EnrichmentContact[] = [];

    for (const contact of enrichmentContacts) {
      const phone = wizaResults.get(contact.id) ?? null;
      if (phone) {
        wizaFound++;
        await prisma.jobContact.update({
          where: { id: contact.id },
          data: { directPhone: phone, phoneSource: 'WIZA', phoneCost: wizaCost },
        });
      } else {
        afterWizaRemaining.push(contact);
      }
    }

    jobLogger.info('Phone waterfall cascade: Wiza phase complete', {
      wizaFound,
      remaining: afterWizaRemaining.length,
    });

    // Phase 2: AI Ark (only for Wiza failures)
    if (afterWizaRemaining.length > 0) {
      try {
        const aiArkResults = await enrichPhonesWithAIArkBatch(afterWizaRemaining);
        const aiArkCost = await getCostPerUnit('AI_ARK', 'PHONE');

        for (const contact of afterWizaRemaining) {
          const phone = aiArkResults.get(contact.id) ?? null;
          if (phone) {
            aiArkFound++;
            await prisma.jobContact.update({
              where: { id: contact.id },
              data: { directPhone: phone, phoneSource: 'AI_ARK', phoneCost: aiArkCost },
            });
          }
        }

        jobLogger.info('Phone waterfall cascade: AI Ark phase complete', {
          aiArkFound,
          stillMissing: afterWizaRemaining.length - aiArkFound,
        });
      } catch (err) {
        jobLogger.warn('Phone waterfall cascade: AI Ark phase failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    jobLogger.warn('Phone waterfall cascade: Wiza phase failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const totalFound = wizaFound + aiArkFound;
  const stillMissing = enrichmentContacts.length - totalFound;

  jobLogger.info('Phone waterfall cascade complete', {
    totalWithoutPhone: enrichmentContacts.length,
    wizaFound,
    aiArkFound,
    stillMissing,
  });

  // Notify user of phone cascade results
  if (dbJobForSlack && totalFound > 0) {
    try {
      const { WebClient } = await import('@slack/web-api');
      const slackClient = new WebClient(config.slack.botToken);
      const parts: string[] = [];
      if (wizaFound > 0) parts.push(`${wizaFound} via Wiza`);
      if (aiArkFound > 0) parts.push(`${aiArkFound} via AI Ark`);
      await slackClient.chat.postMessage({
        channel: dbJobForSlack.slackChannelId,
        thread_ts: dbJobForSlack.slackThreadTs,
        text: `Phone enrichment complete: found ${totalFound} phone numbers (${parts.join(', ')}).${stillMissing > 0 ? ` ${stillMissing} contacts had no phone available.` : ''}`,
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:white_check_mark: Phone enrichment complete: found *${totalFound}* phone ${totalFound === 1 ? 'number' : 'numbers'} (${parts.join(', ')}).${stillMissing > 0 ? ` ${stillMissing} ${stillMissing === 1 ? 'contact' : 'contacts'} had no phone available.` : ''}`,
          },
        }],
      });
    } catch {
      // Non-critical
    }
  }

  return { wizaFound, aiArkFound };
}
