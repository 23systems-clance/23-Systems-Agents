/**
 * Slash command handler for /enrich.
 *
 * Parses subcommands from the text parameter and routes to the
 * appropriate service function. Registered via app.command('/enrich', ...).
 *
 * Subcommands:
 * - (empty) or "help"  → ephemeral usage instructions
 * - "history" / "jobs"  → ephemeral job history
 * - "stop" / "cancel"   → ephemeral cancellation result
 * - "report <tech>"     → visible thread with filter/cache blocks
 * - natural language     → AI classification → tech report or guidance
 */

import type { App } from '@slack/bolt';
import { getHelpText } from '../../services/commands/help.js';
import { getJobHistory } from '../../services/commands/history.js';
import { cancelActiveJob } from '../../services/commands/stop.js';
import { classifyIntent } from '../../services/ai/orchestrator.js';
import { setConversation } from '../../services/state/conversationStore.js';
import { buildReportFilterBlocks } from '../../listeners/actions/reportFilters.js';
import { buildCacheDecisionBlocks } from '../../listeners/actions/cacheDecision.js';
import { personalityAnalysis } from '../../services/aiark/client.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/**
 * Initiates the tech report flow by posting a visible channel message,
 * creating a thread, storing conversation state, and showing filter
 * or cache decision blocks.
 */
async function startReportFlow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  channelId: string,
  userId: string,
  technology: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  intentUsage?: any,
): Promise<void> {
  // Post a visible message in the channel to create a thread root.
  const initialMsg = await client.chat.postMessage({
    channel: channelId,
    text: `<@${userId}> requested a tech report for *${technology}*.`,
  });

  const threadTs = initialMsg.ts as string;

  // Store conversation state keyed to the new thread.
  await setConversation(channelId, threadTs, {
    fileId: '',
    fileName: '',
    fileType: 'csv',
    userId,
    channelId,
    threadTs,
    status: 'pending',
    technology,
    intentUsage,
  });

  // Check cache for a recent matching report.
  const cached = await prisma.techReportCache.findFirst({
    where: { technology: { equals: technology, mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
  });

  if (cached) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildCacheDecisionBlocks(
        cached.id,
        technology,
        cached.resultCount,
        cached.createdAt,
      ),
      text: `Found a cached report for ${technology}`,
    });
  } else {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildReportFilterBlocks(technology),
      text: `Set filters for ${technology} report`,
    });
  }

  logger.info('Tech report flow started via /enrich command', {
    channelId,
    threadTs,
    technology,
    hasCachedResult: !!cached,
  });
}

/**
 * Registers the /enrich slash command on the given Bolt app.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerEnrichCommand(app: App): void {
  app.command('/enrich', async ({ command, ack, respond, client }) => {
    // Must acknowledge within 3 seconds.
    await ack();

    const text = command.text.trim();
    const userId = command.user_id;
    const channelId = command.channel_id;
    const subcommand = text.split(/\s+/)[0]?.toLowerCase() ?? '';

    logger.info('/enrich command received', {
      userId,
      channelId,
      text,
      subcommand,
    });

    try {
      // --- help (or no args) ---
      if (!text || subcommand === 'help') {
        await respond({
          response_type: 'ephemeral',
          text: getHelpText(),
        });
        return;
      }

      // --- history / jobs ---
      if (subcommand === 'history' || subcommand === 'jobs') {
        const historyText = await getJobHistory(userId);
        await respond({
          response_type: 'ephemeral',
          text: historyText,
        });
        return;
      }

      // --- stop / cancel ---
      if (subcommand === 'stop' || subcommand === 'cancel') {
        const result = await cancelActiveJob(userId);
        let responseText = result.message;
        if (result.otherActiveCount && result.otherActiveCount > 0) {
          responseText += `\nYou have ${result.otherActiveCount} other active job(s).`;
        }
        await respond({
          response_type: 'ephemeral',
          text: responseText,
        });
        return;
      }

      // --- personality <contactId or search term> ---
      if (subcommand === 'personality') {
        const searchTerm = text.replace(/^personality\s+/i, '').trim();
        if (!searchTerm) {
          await respond({
            response_type: 'ephemeral',
            text: 'Please specify a contact ID or search term. Example: `/enrich personality John Smith`',
          });
          return;
        }

        // Try UUID lookup first, then search by name/email
        const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        let contact;

        if (UUID_REGEX.test(searchTerm)) {
          contact = await prisma.campaignContact.findUnique({
            where: { id: searchTerm },
            select: { id: true, firstName: true, lastName: true, email: true, linkedinUrl: true, companyName: true },
          });
        } else {
          contact = await prisma.campaignContact.findFirst({
            where: {
              OR: [
                { email: { contains: searchTerm, mode: 'insensitive' } },
                { firstName: { contains: searchTerm, mode: 'insensitive' } },
                { lastName: { contains: searchTerm, mode: 'insensitive' } },
              ],
            },
            select: { id: true, firstName: true, lastName: true, email: true, linkedinUrl: true, companyName: true },
            orderBy: { createdAt: 'desc' },
          });
        }

        if (!contact) {
          await respond({
            response_type: 'ephemeral',
            text: `No contact found matching "${searchTerm}".`,
          });
          return;
        }

        if (!contact.linkedinUrl) {
          await respond({
            response_type: 'ephemeral',
            text: `${contact.firstName} ${contact.lastName} has no LinkedIn URL. Personality analysis requires a LinkedIn profile.`,
          });
          return;
        }

        try {
          const data = await personalityAnalysis({ linkedin: contact.linkedinUrl });

          if (data.error) {
            await respond({
              response_type: 'ephemeral',
              text: `Personality analysis unavailable: ${data.error}`,
            });
            return;
          }

          // Store on CampaignContact
          await prisma.campaignContact.update({
            where: { id: contact.id },
            data: {
              personalityData: data as any,
              personalityEnrichedAt: new Date(),
            },
          });

          const archetype = data.archetype?.name ?? 'Unknown';
          const commStyle = data.communication_style?.tags?.join(', ') ?? 'N/A';
          const dashboardUrl = `/api/v1/bdr/personality/${contact.id}`;

          await respond({
            response_type: 'ephemeral',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*Personality Analysis: ${contact.firstName} ${contact.lastName}*${contact.companyName ? ` (${contact.companyName})` : ''}\n\n*Archetype:* ${archetype}\n*Communication Style:* ${commStyle}`,
                },
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: 'View Contact Profile' },
                    url: dashboardUrl,
                    action_id: 'personality_view_profile',
                  },
                ],
              },
            ],
            text: `Personality analysis for ${contact.firstName} ${contact.lastName}: Archetype: ${archetype}`,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await respond({
            response_type: 'ephemeral',
            text: `Personality analysis failed: ${errMsg}`,
          });
        }
        return;
      }

      // --- report <technology> ---
      if (subcommand === 'report') {
        const technology = text.replace(/^report\s+/i, '').trim();
        if (!technology) {
          await respond({
            response_type: 'ephemeral',
            text: 'Please specify a technology. Example: `/enrich report Salesforce`',
          });
          return;
        }

        await startReportFlow(client, channelId, userId, technology);
        return;
      }

      // --- Natural language fallback (AI classification) ---
      const { intent: intentResult, usage: intentUsage } = await classifyIntent(text);

      if (intentResult.intent === 'tech_report' && intentResult.technology && intentResult.confidence >= 0.6) {
        await startReportFlow(client, channelId, userId, intentResult.technology, intentUsage);
        return;
      }

      if (intentResult.intent === 'tech_report') {
        // Technology missing or low confidence.
        await respond({
          response_type: 'ephemeral',
          text: "It sounds like you want a technology report, but I couldn't determine which technology. Please specify, e.g.:\n- `/enrich report Salesforce`\n- `/enrich find companies using HubSpot`",
        });
        return;
      }

      // For file-based intents, guide user to the upload flow.
      await respond({
        response_type: 'ephemeral',
        text: `To enrich a file with *${intentResult.intent}* data, upload a CSV/XLSX file to the channel first, then follow the interactive prompts.\n\nFor tech reports: \`/enrich report Salesforce\`\nFor help: \`/enrich help\``,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error handling /enrich command', {
        userId,
        channelId,
        text,
        error: errorMessage,
      });

      await respond({
        response_type: 'ephemeral',
        text: 'Sorry, something went wrong processing your request. Please try again.',
      });
    }
  });
}
