/**
 * Action handler for /admin audit "Load More" button (T059).
 *
 * Handles pagination of audit trail results when the user clicks
 * the "Load More" button rendered by the handleAudit subcommand.
 */
import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

const log = logger.withContext({ service: 'adminAuditAction' });

/**
 * Formats a Date as a readable UTC string for audit display.
 *
 * @param date - The date to format
 * @returns Formatted date string like "2026-03-20 14:30:00 UTC", or "N/A"
 */
function fmtDate(date: Date | null | undefined): string {
  if (!date) return 'N/A';
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * Registers the admin_audit_load_more action handler on the Slack app.
 *
 * @param app - The Slack Bolt application instance
 */
export function registerAdminAuditActions(app: App): void {
  app.action('admin_audit_load_more', async ({ action, ack, respond }) => {
    await ack();

    try {
      const payload = JSON.parse('value' in action ? (action.value ?? '{}') : '{}');
      const offset: number = payload.offset ?? 20;
      const hours: number = payload.hours ?? 24;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      const pageSize = 20;

      const actions = await prisma.auditAction.findMany({
        where: { timestamp: { gte: since } },
        orderBy: { timestamp: 'desc' },
        skip: offset,
        take: pageSize + 1, // fetch one extra to know if more exist
      });

      const hasMore = actions.length > pageSize;
      const pageActions = hasMore ? actions.slice(0, pageSize) : actions;

      if (pageActions.length === 0) {
        await respond({
          response_type: 'ephemeral',
          replace_original: false,
          text: 'No more audit actions to show.',
        });
        return;
      }

      const blocks: KnownBlock[] = [
        {
          type: 'header',
          text: { type: 'plain_text', text: `Audit Trail (continued from #${offset + 1})` },
        },
      ];

      for (const a of pageActions) {
        const severityTag = a.severity ? `[${a.severity}]` : '';
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              `*${a.agentName}* ${severityTag}`,
              `Action: \`${a.action}\` | Confidence: ${((a.confidence ?? 0) * 100).toFixed(0)}%`,
              `Outcome: *${a.outcome}* | ${fmtDate(a.timestamp)}`,
            ].join('\n'),
          },
        });
        blocks.push({ type: 'divider' });
      }

      if (hasMore) {
        blocks.push({
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Load More' },
              action_id: 'admin_audit_load_more',
              value: JSON.stringify({ offset: offset + pageSize, hours }),
            },
          ],
        });
      } else {
        blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `End of results. Showing items ${offset + 1}-${offset + pageActions.length}.`,
            },
          ],
        });
      }

      await respond({ response_type: 'ephemeral', replace_original: false, blocks });
    } catch (error) {
      log.error('Failed to load more audit actions', {
        error: error instanceof Error ? error.message : String(error),
      });
      await respond({
        response_type: 'ephemeral',
        replace_original: false,
        text: 'Failed to load more audit actions. Please try again.',
      });
    }
  });

  log.info('Registered admin audit action handlers');
}
