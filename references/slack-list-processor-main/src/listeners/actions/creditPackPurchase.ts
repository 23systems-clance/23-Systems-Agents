/**
 * Credit pack purchase action listener (T028).
 *
 * Handles in-Slack credit pack purchase prompts when a user has
 * insufficient credits. Shows available credit packs with prices
 * and links to Stripe Checkout for purchase.
 */

import type { App } from '@slack/bolt';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';

/**
 * Registers credit pack purchase action handlers.
 *
 * @param app - Slack Bolt app instance.
 */
export function registerCreditPackPurchaseHandlers(app: App): void {
  // Open credit pack purchase options
  app.action('credit_pack_purchase_open', async ({ ack, body, client }) => {
    await ack();

    const actionBody = body as unknown as Record<string, unknown>;
    const userId = (actionBody.user as Record<string, string>)?.id ?? '';
    const teamId = (actionBody.team as Record<string, string>)?.id ?? '';

    try {
      // Fetch active credit packs
      const packs = await prisma.creditPack.findMany({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
      });

      if (packs.length === 0) {
        await client.chat.postMessage({
          channel: userId,
          text: 'No credit packs are currently available. Contact your account manager.',
        });
        return;
      }

      const packBlocks = packs.map((pack) => ({
        type: 'section' as const,
        text: {
          type: 'mrkdwn' as const,
          text: `*${pack.name}*\n${pack.creditAmount.toLocaleString()} credits — $${Number(pack.priceUsd).toFixed(2)}`,
        },
        accessory: {
          type: 'button' as const,
          text: { type: 'plain_text' as const, text: 'Purchase', emoji: true },
          style: 'primary' as const,
          url: `${config.billing.appBaseUrl}/api/v1/admin/credit-packs/${pack.id}/checkout?team=${teamId}`,
          action_id: `credit_pack_buy_${pack.id}`,
        },
      }));

      await client.chat.postMessage({
        channel: userId,
        text: 'Credit packs available for purchase',
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: 'Buy Credit Pack', emoji: true },
          },
          { type: 'divider' },
          ...packBlocks,
          { type: 'divider' },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: 'Credits are added instantly after payment.' }],
          },
        ],
      });
    } catch (error) {
      logger.error('Failed to show credit pack options', {
        userId,
        teamId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Handle individual pack buy button clicks (URL buttons — no-op ack)
  app.action(/^credit_pack_buy_/, async ({ ack }) => {
    await ack();
  });
}
