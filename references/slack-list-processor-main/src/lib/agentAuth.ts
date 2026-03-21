/**
 * Slack workspace admin/owner authorization utilities.
 *
 * Uses the Slack users.info API to check if a user has admin or owner privileges.
 * Per R8 requirements: workspace membership = authentication, no per-user auth needed.
 */

import type { WebClient } from '@slack/web-api';
import logger from './logger.js';

/**
 * Checks if a Slack user is a workspace admin or owner.
 *
 * @param client - Slack WebClient instance
 * @param userId - Slack user ID to check
 * @returns Promise<boolean> - True if user is admin or owner
 *
 * @example
 * const isAdmin = await isWorkspaceAdmin(client, 'U12345678');
 * if (isAdmin) {
 *   // Grant access to admin features
 * }
 */
export async function isWorkspaceAdmin(
  client: WebClient,
  userId: string,
): Promise<boolean> {
  try {
    const result = await client.users.info({ user: userId });

    if (!result.ok || !result.user) {
      logger.warn('Failed to fetch user info for admin check', {
        userId,
        error: result.error,
      });
      return false;
    }

    // Check both is_admin and is_owner fields
    const isAdmin = result.user.is_admin === true;
    const isOwner = result.user.is_owner === true;

    return isAdmin || isOwner;
  } catch (error) {
    logger.error('Error checking workspace admin status', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Enforces workspace admin/owner requirement.
 * Throws an error if the user is not an admin or owner.
 *
 * @param client - Slack WebClient instance
 * @param userId - Slack user ID to check
 * @throws Error if user is not a workspace admin or owner
 *
 * @example
 * try {
 *   await requireWorkspaceAdmin(client, userId);
 *   // Proceed with admin-only operation
 * } catch (error) {
 *   await client.chat.postMessage({
 *     channel: userId,
 *     text: 'This feature requires workspace admin privileges.',
 *   });
 * }
 */
export async function requireWorkspaceAdmin(
  client: WebClient,
  userId: string,
): Promise<void> {
  const isAdmin = await isWorkspaceAdmin(client, userId);

  if (!isAdmin) {
    throw new Error(
      'Workspace admin or owner privileges required for this operation',
    );
  }
}
