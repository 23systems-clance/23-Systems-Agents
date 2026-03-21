/**
 * Bolt action and view handlers for HubSpot activity queries.
 *
 * Handles:
 * - `hubspot_activity_today` — Query today's activity
 * - `hubspot_activity_7days` — Query last 7 days activity
 * - `hubspot_activity_custom` — Open custom date range modal
 * - `hubspot_activity_custom_range` — Process custom date range submission
 */

import type { App } from '@slack/bolt';
import { prisma } from '../../models/index.js';
import {
  getContactActivity,
  getActivitySummary,
  type HubSpotActivity,
  type HubSpotActivitySummary,
} from '../../services/hubspot/hubspotActivity.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Registers all HubSpot activity action and view handlers on the Bolt app.
 *
 * @param app - Slack Bolt application instance
 */
export function registerHubspotActivityHandlers(app: App): void {
  // --- Today button ---
  app.action('hubspot_activity_today', async ({ action, ack, body, client }) => {
    await ack();
    if (action.type !== 'button') return;

    const channelId = body.channel?.id;
    if (!channelId) return;

    const { email } = parseButtonValue(action.value);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    await queryAndPost(channelId, email, startOfDay, now, client);
  });

  // --- Last 7 Days button ---
  app.action('hubspot_activity_7days', async ({ action, ack, body, client }) => {
    await ack();
    if (action.type !== 'button') return;

    const channelId = body.channel?.id;
    if (!channelId) return;

    const { email } = parseButtonValue(action.value);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);

    await queryAndPost(channelId, email, sevenDaysAgo, now, client);
  });

  // --- Custom button → opens date range modal ---
  app.action('hubspot_activity_custom', async ({ action, ack, body, client }) => {
    await ack();
    if (action.type !== 'button') return;

    const channelId = body.channel?.id;
    if (!channelId) return;

    const { email } = parseButtonValue(action.value);

    await client.views.open({
      trigger_id: (body as { trigger_id: string }).trigger_id,
      view: {
        type: 'modal' as const,
        callback_id: 'hubspot_activity_custom_range',
        title: { type: 'plain_text' as const, text: 'Custom Date Range' },
        submit: { type: 'plain_text' as const, text: 'Get Activity' },
        private_metadata: JSON.stringify({ channelId, email }),
        blocks: [
          {
            type: 'input' as const,
            block_id: 'start_date',
            label: { type: 'plain_text' as const, text: 'Start Date' },
            element: { type: 'datepicker' as const, action_id: 'start_date_picker' },
          },
          {
            type: 'input' as const,
            block_id: 'end_date',
            label: { type: 'plain_text' as const, text: 'End Date' },
            element: { type: 'datepicker' as const, action_id: 'end_date_picker' },
          },
        ],
      },
    });
  });

  // --- Custom date range modal submission ---
  app.view('hubspot_activity_custom_range', async ({ ack, view, client }) => {
    const startDateStr = view.state.values['start_date']?.['start_date_picker']?.selected_date;
    const endDateStr = view.state.values['end_date']?.['end_date_picker']?.selected_date;

    if (!startDateStr || !endDateStr) {
      await ack({ response_action: 'errors', errors: { start_date: 'Please select a start date' } });
      return;
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr + 'T23:59:59Z');

    if (endDate < startDate) {
      await ack({ response_action: 'errors', errors: { end_date: 'End date must be after start date' } });
      return;
    }

    await ack();

    const metadata = JSON.parse(view.private_metadata || '{}');
    const { channelId, email } = metadata;

    if (channelId) {
      await queryAndPost(channelId, email, startDate, endDate, client);
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parses the button value JSON containing optional email.
 */
function parseButtonValue(value?: string): { email: string | null } {
  try {
    const parsed = JSON.parse(value || '{}');
    return { email: parsed.email || null };
  } catch {
    return { email: null };
  }
}

/**
 * Queries HubSpot activity and posts results to the Slack channel.
 */
async function queryAndPost(
  channelId: string,
  email: string | null,
  startDate: Date,
  endDate: Date,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
): Promise<void> {
  try {
    const mapping = await prisma.channelClientMapping.findFirst({
      where: { slackChannelId: channelId },
    });
    if (!mapping) return;

    if (email) {
      const activities = await getContactActivity({
        clientId: mapping.clientId,
        email,
        startDate,
        endDate,
      });
      await postContactActivity(client, channelId, email, startDate, endDate, activities);
    } else {
      const summary = await getActivitySummary({
        clientId: mapping.clientId,
        startDate,
        endDate,
      });
      await postActivitySummary(client, channelId, summary);
    }
  } catch (err) {
    logger.error('Failed to query HubSpot activity', { error: err, channelId, email });
    await client.chat.postMessage({
      channel: channelId,
      text: 'Failed to fetch HubSpot activity. Please try again.',
    });
  }
}

/**
 * Posts activity for a single contact as a Block Kit message.
 */
async function postContactActivity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  channelId: string,
  email: string,
  startDate: Date,
  endDate: Date,
  activities: HubSpotActivity[],
): Promise<void> {
  const dateRange = formatDateRange(startDate, endDate);
  const calls = activities.filter((a) => a.type === 'call').length;
  const emails = activities.filter((a) => a.type === 'email').length;
  const meetings = activities.filter((a) => a.type === 'meeting').length;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `HubSpot Activity: ${email}` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*${dateRange}*`,
          '',
          `:phone: *Calls:* ${calls}`,
          `:email: *Emails:* ${emails}`,
          `:calendar: *Meetings:* ${meetings}`,
          '',
          `*Total engagements:* ${activities.length}`,
        ].join('\n'),
      },
    },
  ];

  if (activities.length > 0) {
    blocks.push({ type: 'divider' });

    // Show up to 10 recent activities
    for (const activity of activities.slice(0, 10)) {
      const icon = activity.type === 'call' ? ':phone:' : activity.type === 'email' ? ':email:' : ':calendar:';
      const date = activity.timestamp.toISOString().split('T')[0];
      let detail = `${icon} *${activity.type.charAt(0).toUpperCase() + activity.type.slice(1)}* — ${date}`;

      if (activity.outcome) detail += `\nOutcome: ${activity.outcome}`;
      if (activity.duration) detail += ` | Duration: ${Math.round(activity.duration / 60)} min`;
      if (activity.subject) detail += `\nSubject: ${activity.subject}`;
      if (activity.notes) detail += `\nNotes: ${activity.notes.slice(0, 200)}`;

      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: detail } });
    }
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'Activity from HubSpot' }],
  });

  await client.chat.postMessage({
    channel: channelId,
    blocks,
    text: `HubSpot Activity for ${email}: ${activities.length} engagements`,
  });
}

/**
 * Posts an activity summary across all contacts as a Block Kit message.
 */
async function postActivitySummary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  channelId: string,
  summary: HubSpotActivitySummary,
): Promise<void> {
  const dateRange = formatDateRange(summary.dateRange.start, summary.dateRange.end);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'HubSpot Activity Summary' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*${dateRange}*`,
          '',
          `:phone: *Calls:* ${summary.calls}`,
          `:email: *Emails:* ${summary.emails}`,
          `:calendar: *Meetings:* ${summary.meetings}`,
          '',
          `*Total engagements:* ${summary.totalEngagements} across ${summary.uniqueContacts} contacts`,
        ].join('\n'),
      },
    },
  ];

  if (summary.topContacts.length > 0) {
    const topList = summary.topContacts
      .map((c, i) => `${i + 1}. ${c.email} — ${c.count} engagements`)
      .join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Most Active Contacts:*\n${topList}` },
    });
  }

  if (summary.recentNotes.length > 0) {
    const noteList = summary.recentNotes
      .map((n) => `\u2022 ${n.email} (${n.date.toISOString().split('T')[0]}): ${n.note}`)
      .join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Recent Conversation Notes:*\n${noteList}` },
    });
  }

  await client.chat.postMessage({
    channel: channelId,
    blocks,
    text: `HubSpot Activity Summary: ${summary.totalEngagements} engagements across ${summary.uniqueContacts} contacts`,
  });
}

/**
 * Formats a date range as "Mar 4 - Mar 11, 2026".
 */
function formatDateRange(start: Date, end: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const s = `${months[start.getMonth()]} ${start.getDate()}`;
  const e = `${months[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  return `${s} \u2013 ${e}`;
}
