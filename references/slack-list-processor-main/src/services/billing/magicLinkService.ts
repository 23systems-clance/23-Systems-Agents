/**
 * Magic link service for client payment onboarding.
 *
 * Generates secure tokens, stores MagicLink records, and delivers
 * links via Slack DM (primary) and email (secondary via Resend).
 */

import crypto from 'node:crypto';
import { WebClient } from '@slack/web-api';
import { Resend } from 'resend';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';
import type { BillingProfile, MagicLink } from '@prisma/client';

const slackClient = new WebClient(config.slack.botToken);

/**
 * Generate a magic link and send via Slack DM + email.
 */
export async function generateAndSendMagicLink(
  billingProfileId: string,
  options?: { expiresInHours?: number },
): Promise<{
  magicLink: MagicLink;
  url: string;
  delivery: {
    slackDm: 'sent' | 'failed';
    email: 'sent' | 'failed' | 'skipped';
    channelNotification: 'sent' | 'failed';
  };
}> {
  const profile = await prisma.billingProfile.findUniqueOrThrow({
    where: { id: billingProfileId },
  });

  const workspace = await prisma.workspaceInstallation.findFirst({
    where: { slackTeamId: profile.slackTeamId },
    select: { slackTeamName: true },
  });
  const workspaceName = workspace?.slackTeamName ?? profile.slackTeamId;

  // Generate 64-char hex token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresInHours = options?.expiresInHours ?? 24;
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  const magicLink = await prisma.magicLink.create({
    data: {
      billingProfileId,
      token,
      expiresAt,
    },
  });

  const url = `${config.billing.appBaseUrl}/billing/setup/${token}`;

  const delivery = {
    slackDm: 'failed' as 'sent' | 'failed',
    email: 'skipped' as 'sent' | 'failed' | 'skipped',
    channelNotification: 'failed' as 'sent' | 'failed',
  };

  // Send Slack DM to billing contact
  if (profile.billingContactUserId) {
    try {
      const dmResult = await slackClient.conversations.open({
        users: profile.billingContactUserId,
      });

      if (dmResult.channel?.id) {
        await slackClient.chat.postMessage({
          channel: dmResult.channel.id,
          text: `Set up billing for ${workspaceName}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Set up billing for ${workspaceName}*\n\nClick the link below to set up your payment method. This link expires in ${expiresInHours} hours.`,
              },
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Set Up Billing' },
                  url,
                  style: 'primary',
                  action_id: 'billing_setup_link',
                },
              ],
            },
          ],
        });
        delivery.slackDm = 'sent';
      }
    } catch (error) {
      logger.error('Failed to send billing magic link DM', { error, billingProfileId });
    }
  }

  // Send email via Resend
  if (profile.billingEmail && config.billing.resendApiKey) {
    try {
      const resend = new Resend(config.billing.resendApiKey);
      await resend.emails.send({
        from: 'Slack Agent Billing <billing@developerlabs.ai>',
        to: profile.billingEmail,
        subject: `Set up billing for ${workspaceName}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Set up billing for ${workspaceName}</h2>
            <p>Click the button below to set up your payment method. This link expires in ${expiresInHours} hours.</p>
            <a href="${url}" style="display: inline-block; background: #0066FF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 16px;">Set Up Billing</a>
            <p style="margin-top: 24px; color: #666; font-size: 14px;">If the button doesn't work, copy this link: ${url}</p>
          </div>
        `,
      });
      delivery.email = 'sent';
    } catch (error) {
      logger.error('Failed to send billing magic link email', { error, billingProfileId });
      delivery.email = 'failed';
    }
  }

  return { magicLink, url, delivery };
}

/**
 * Validate a magic link token and return action to take.
 */
export async function validateMagicLink(token: string): Promise<
  | { valid: true; used: false; billingProfile: BillingProfile }
  | { valid: true; used: true; billingProfile: BillingProfile }
  | { valid: false; reason: 'expired' | 'not_found' }
> {
  const magicLink = await prisma.magicLink.findUnique({
    where: { token },
    include: { billingProfile: true },
  });

  if (!magicLink) {
    return { valid: false, reason: 'not_found' };
  }

  if (magicLink.expiresAt < new Date() && !magicLink.usedAt) {
    return { valid: false, reason: 'expired' };
  }

  if (magicLink.usedAt) {
    return { valid: true, used: true, billingProfile: magicLink.billingProfile };
  }

  return { valid: true, used: false, billingProfile: magicLink.billingProfile };
}
