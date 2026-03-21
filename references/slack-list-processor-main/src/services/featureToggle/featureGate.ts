/**
 * Feature gate Bolt middleware.
 *
 * Provides a `requireFeature()` middleware factory for gating Slack
 * commands, actions, and events behind feature flags. When a disabled
 * feature is accessed, the user receives a "not available on your plan"
 * message instead of the normal handler.
 */

import type { Middleware, SlackCommandMiddlewareArgs, SlackActionMiddlewareArgs, SlackEventMiddlewareArgs } from '@slack/bolt';
import type { FeatureFlagKey, FeatureFlags } from '../../types/featureFlags.js';
import logger from '../../lib/logger.js';

/** Extended Bolt context with feature flags injected by authorize(). */
interface FeatureFlagContext {
  featureFlags?: FeatureFlags;
  isPlatformOwner?: boolean;
}

/**
 * Creates a Bolt middleware that gates access behind a feature flag.
 *
 * If the feature is disabled for the workspace, the middleware responds
 * with a "not available on your plan" message and does NOT call next().
 *
 * Usage:
 * ```ts
 * app.command('/campaign', requireFeature('campaigns'), campaignHandler);
 * app.action('dialer_start', requireFeature('dialer'), dialerHandler);
 * ```
 *
 * @param feature - Feature flag key to check.
 * @returns Bolt middleware function.
 */
export function requireFeature(
  feature: FeatureFlagKey,
): Middleware<SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs | SlackEventMiddlewareArgs> {
  return async (args) => {
    const { context, next } = args;
    const ctx = context as FeatureFlagContext;
    const flags = ctx.featureFlags;

    // If no flags in context (shouldn't happen), allow through for safety
    if (!flags) {
      logger.warn('requireFeature: no featureFlags in context', { feature });
      await next();
      return;
    }

    if (flags[feature] === true) {
      await next();
      return;
    }

    logger.info('Feature gated — access blocked', {
      feature,
      teamId: (context as Record<string, unknown>).teamId,
    });

    // Acknowledge the interaction before responding (required for commands and actions)
    const ack = (args as unknown as Record<string, unknown>).ack as (() => Promise<void>) | undefined;
    if (ack) {
      await ack();
    }

    // Respond with "not available" message
    const respond = (args as unknown as Record<string, unknown>).respond as ((msg: Record<string, unknown>) => Promise<void>) | undefined;
    if (respond) {
      await respond({
        text: `This feature is not available on your current plan. Contact your administrator to enable "${feature}".`,
        response_type: 'ephemeral',
      });
    }
  };
}
