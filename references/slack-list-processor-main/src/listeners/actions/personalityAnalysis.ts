/**
 * Bolt action handler for "Analyze Personality" button (T072).
 *
 * When triggered from enrichment results, shows a contact selector,
 * then calls AIARC personality analysis API and posts results as
 * a Block Kit message in the thread.
 */

import type { App } from '@slack/bolt';
import { prisma } from '../../models/index.js';
import { personalityAnalysis } from '../../services/aiark/client.js';
import type {
  PersonalityAnalysisResponse,
  DISCProfile,
  OCEANProfile,
} from '../../types/personality.js';
import logger from '../../lib/logger.js';

/**
 * Registers the personality_analyze action and follow-up handlers.
 *
 * @param app - Slack Bolt application instance.
 */
export function registerPersonalityAnalysisHandlers(app: App): void {
  // Step 1: User clicks "Analyze Personality" — show contact selector
  app.action('personality_analyze', async ({ action, ack, client, body }) => {
    await ack();

    const jobId = (action as { value?: string }).value;
    if (!jobId) return;

    const channelId = (body as { channel?: { id: string } }).channel?.id;
    const threadTs = (body as { message?: { ts: string } }).message?.ts;
    if (!channelId) return;

    try {
      // Load contacts with LinkedIn URLs from this job
      const contacts = await prisma.jobContact.findMany({
        where: {
          jobId,
          linkedinUrl: { not: null },
        },
        select: {
          id: true,
          fullName: true,
          jobTitle: true,
          linkedinUrl: true,
          jobCompany: { select: { companyName: true } },
        },
        take: 25,
      });

      if (contacts.length === 0) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: 'No contacts with LinkedIn profiles found in this enrichment.',
        });
        return;
      }

      // Build static_select with contacts
      const options = contacts.map((c) => ({
        text: {
          type: 'plain_text' as const,
          text: `${c.fullName || 'Unknown'}${c.jobCompany?.companyName ? ` (${c.jobCompany.companyName})` : ''}`.slice(0, 75),
        },
        value: c.id,
      }));

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks: [
          {
            type: 'section' as const,
            text: {
              type: 'mrkdwn' as const,
              text: 'Select a contact to analyze their personality profile:',
            },
            accessory: {
              type: 'static_select' as const,
              action_id: 'personality_contact_select',
              placeholder: { type: 'plain_text' as const, text: 'Choose a contact...' },
              options,
            },
          },
        ],
        text: 'Select a contact for personality analysis.',
      });
    } catch (err) {
      logger.error('Failed to show personality contact selector', {
        error: err instanceof Error ? err.message : String(err),
        jobId,
      });
    }
  });

  // Step 2: User selects a contact — run AIARC analysis
  app.action('personality_contact_select', async ({ action, ack, client, body }) => {
    await ack();

    const selectedContactId = (action as { selected_option?: { value: string } }).selected_option?.value;
    if (!selectedContactId) return;

    const channelId = (body as { channel?: { id: string } }).channel?.id;
    const threadTs = (body as { message?: { ts: string } }).message?.ts;
    if (!channelId) return;

    try {
      // Load the selected contact
      const contact = await prisma.jobContact.findUnique({
        where: { id: selectedContactId },
        select: {
          fullName: true,
          linkedinUrl: true,
          jobTitle: true,
          jobCompany: { select: { companyName: true, resolvedDomain: true, domain: true } },
        },
      });

      if (!contact || !contact.linkedinUrl) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: 'Contact not found or missing LinkedIn URL.',
        });
        return;
      }

      // Post "analyzing..." message
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `Analyzing personality for *${contact.fullName}*... This may take a moment.`,
      });

      // Call AIARC
      const result = await personalityAnalysis({
        linkedin: contact.linkedinUrl,
        name: contact.fullName ?? undefined,
        domain: contact.jobCompany?.resolvedDomain ?? contact.jobCompany?.domain ?? undefined,
      });

      if (result.error) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: `Personality analysis unavailable for ${contact.fullName}: ${result.error}`,
        });
        return;
      }

      // Format and post results
      const blocks = buildPersonalityBlocks(
        contact.fullName ?? 'Unknown',
        contact.jobTitle ?? null,
        contact.jobCompany?.companyName ?? null,
        result,
      );

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks,
        text: `Personality analysis for ${contact.fullName}`,
      });
    } catch (err) {
      logger.error('Personality analysis failed', {
        error: err instanceof Error ? err.message : String(err),
        contactId: selectedContactId,
      });

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Personality analysis failed. Please try again later.',
      }).catch(() => {});
    }
  });
}

/**
 * Builds Block Kit blocks for personality analysis results.
 */
function buildPersonalityBlocks(
  name: string,
  title: string | null,
  company: string | null,
  result: PersonalityAnalysisResponse,
): import('@slack/types').KnownBlock[] {
  const blocks: import('@slack/types').KnownBlock[] = [];

  // Header
  const subtitle = [title, company].filter(Boolean).join(' at ');
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `Personality Profile: ${name}` },
  });

  if (subtitle) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${subtitle}*` },
    });
  }

  // Archetype
  if (result.archetype) {
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Archetype:* ${result.archetype.name} (${result.archetype.score}/10)\n${result.archetype.description}`,
        },
      },
    );
  }

  // DISC Profile
  if (result.disc) {
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*DISC Profile*\n' + formatDISC(result.disc),
        },
      },
    );
  }

  // OCEAN Profile
  if (result.ocean) {
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*OCEAN (Big Five) Profile*\n' + formatOCEAN(result.ocean),
        },
      },
    );
  }

  // Communication Style
  if (result.communication_style) {
    const style = result.communication_style;
    const lines: string[] = [];
    if (style.tags?.length) lines.push(`*Tags:* ${style.tags.join(', ')}`);
    if (style.what_to_say?.length) lines.push(`*What to say:* ${style.what_to_say.join('; ')}`);
    if (style.what_to_avoid?.length) lines.push(`*What to avoid:* ${style.what_to_avoid.join('; ')}`);

    if (lines.length > 0) {
      blocks.push(
        { type: 'divider' },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Communication Style*\n${lines.join('\n')}` },
        },
      );
    }
  }

  // Email Approach
  if (result.email_approach) {
    const ea = result.email_approach;
    const emailLines: string[] = [];
    if (ea.tone) emailLines.push(`*Tone:* ${ea.tone}`);
    if (ea.length) emailLines.push(`*Length:* ${ea.length}`);
    if (ea.subject) emailLines.push(`*Subject line:* ${ea.subject}`);
    if (ea.greeting) emailLines.push(`*Greeting:* ${ea.greeting}`);
    if (ea.messaging) emailLines.push(`*Messaging:* ${ea.messaging}`);
    if (ea.closing) emailLines.push(`*Closing:* ${ea.closing}`);

    if (emailLines.length > 0) {
      blocks.push(
        { type: 'divider' },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Email Approach*\n${emailLines.join('\n')}` },
        },
      );
    }
  }

  // Decision Traits
  if (result.decision_traits) {
    const dt = result.decision_traits;
    const dtLines: string[] = [];
    if (dt.risk_tolerance) dtLines.push(`*Risk tolerance:* ${dt.risk_tolerance}`);
    if (dt.decision_speed) dtLines.push(`*Decision speed:* ${dt.decision_speed}`);
    if (dt.decision_drivers) dtLines.push(`*Decision drivers:* ${dt.decision_drivers}`);
    if (dt.ability_to_say_no) dtLines.push(`*Ability to say no:* ${dt.ability_to_say_no}`);

    if (dtLines.length > 0) {
      blocks.push(
        { type: 'divider' },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Decision Traits*\n${dtLines.join('\n')}` },
        },
      );
    }
  }

  return blocks;
}

/** Formats DISC profile dimensions as a compact string. */
function formatDISC(disc: DISCProfile): string {
  return [
    `D (Dominance): ${disc.dominance.score}/10 - ${disc.dominance.level}`,
    `I (Influence): ${disc.influence.score}/10 - ${disc.influence.level}`,
    `S (Steadiness): ${disc.steadiness.score}/10 - ${disc.steadiness.level}`,
    `C (Calculativeness): ${disc.calculativeness.score}/10 - ${disc.calculativeness.level}`,
  ].join('\n');
}

/** Formats OCEAN profile dimensions as a compact string. */
function formatOCEAN(ocean: OCEANProfile): string {
  return [
    `O (Openness): ${ocean.openness.score}/10 - ${ocean.openness.level}`,
    `C (Conscientiousness): ${ocean.conscientiousness.score}/10 - ${ocean.conscientiousness.level}`,
    `E (Extraversion): ${ocean.extraversion.score}/10 - ${ocean.extraversion.level}`,
    `A (Agreeableness): ${ocean.agreeableness.score}/10 - ${ocean.agreeableness.level}`,
    `N (Emotional Stability): ${ocean.emotional_stability.score}/10 - ${ocean.emotional_stability.level}`,
  ].join('\n');
}
