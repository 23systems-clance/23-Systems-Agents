/**
 * Admin authorization middleware for Slack commands (T025).
 *
 * Looks up AdminUser by slackUserId, validates RBAC role hierarchy
 * (ADMIN > EDITOR > VIEWER), and returns typed AdminUser or sends
 * an ephemeral error message.
 */

import type { AdminUser, AdminRole } from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

const log = logger.withContext({ service: 'adminAuth' });

// -------------------------------------------------------------------------
// Role Hierarchy
// -------------------------------------------------------------------------

/** Numeric weight for each role — higher means more privilege. */
const ROLE_WEIGHT: Record<AdminRole, number> = {
  ADMIN: 30,
  EDITOR: 20,
  VIEWER: 10,
};

/**
 * Checks whether `actualRole` meets or exceeds `requiredRole`.
 *
 * @param actualRole - The user's assigned role.
 * @param requiredRole - The minimum role needed for the operation.
 * @returns `true` if the user has sufficient privileges.
 */
export function checkRole(actualRole: AdminRole, requiredRole: AdminRole): boolean {
  return ROLE_WEIGHT[actualRole] >= ROLE_WEIGHT[requiredRole];
}

// -------------------------------------------------------------------------
// User Lookup
// -------------------------------------------------------------------------

/**
 * Finds an AdminUser by their Slack user ID.
 *
 * If the AdminUser record exists but has no `slackUserId` set, the first
 * match by email lookup is attempted via the Slack Web API in the caller.
 *
 * @param slackUserId - The Slack user ID (e.g. "U012AB3CD").
 * @returns The AdminUser record, or `null` if not found.
 */
export async function lookupAdminUser(slackUserId: string): Promise<AdminUser | null> {
  try {
    const user = await prisma.adminUser.findFirst({
      where: { slackUserId },
    });

    if (user) {
      log.debug('Admin user found by slackUserId', {
        adminUserId: user.id,
        slackUserId,
        role: user.role,
      });
    }

    return user;
  } catch (error) {
    log.error('Failed to look up admin user', {
      slackUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// -------------------------------------------------------------------------
// Authorization Result
// -------------------------------------------------------------------------

/** Result of authorizing a Slack user for an admin command. */
export interface AuthorizationResult {
  /** Whether the user is authorized. */
  authorized: boolean;
  /** The AdminUser record if authorized. */
  adminUser?: AdminUser;
  /** Error message if not authorized. */
  error?: string;
}

/**
 * Authorizes a Slack user for an admin command requiring `requiredRole`.
 *
 * Steps:
 * 1. Look up AdminUser by slackUserId.
 * 2. If not found, return unauthorized.
 * 3. Check the role hierarchy.
 * 4. Return result.
 *
 * @param slackUserId - The Slack user ID.
 * @param requiredRole - The minimum AdminRole needed.
 * @returns AuthorizationResult indicating success or failure.
 */
export async function authorizeSlackUser(
  slackUserId: string,
  requiredRole: AdminRole,
): Promise<AuthorizationResult> {
  const adminUser = await lookupAdminUser(slackUserId);

  if (!adminUser) {
    log.warn('Unauthorized admin command attempt — user not found', { slackUserId });
    return {
      authorized: false,
      error: 'You do not have permission to use this command. Your Slack account is not linked to an admin user.',
    };
  }

  if (!checkRole(adminUser.role, requiredRole)) {
    log.warn('Unauthorized admin command attempt — insufficient role', {
      slackUserId,
      actualRole: adminUser.role,
      requiredRole,
    });
    return {
      authorized: false,
      error: `You do not have permission to use this command. Required role: ${requiredRole}, your role: ${adminUser.role}.`,
    };
  }

  return { authorized: true, adminUser };
}
