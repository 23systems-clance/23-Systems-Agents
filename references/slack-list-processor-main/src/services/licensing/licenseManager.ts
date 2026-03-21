/**
 * License key management service (T042).
 *
 * Admin-facing service for creating, listing, and revoking license keys.
 * All operations are logged to AuditLog for compliance.
 */

import { prisma } from '../../models/index.js';
import { generateLicenseKey } from './keyGenerator.js';
import type { FeatureFlags } from '../../types/featureFlags.js';
import logger from '../../lib/logger.js';

/** Options for creating a license key. */
interface CreateLicenseKeyOptions {
  featureFlags: FeatureFlags;
  initialCredits: number;
  subscriptionTier: string;
  expiresAt?: Date | null;
  notes?: string | null;
  createdByAdminId: string;
}

/** Filters for listing license keys. */
interface ListLicenseKeysFilters {
  status?: 'active' | 'activated' | 'expired' | 'revoked' | 'all';
  page?: number;
  limit?: number;
}

/**
 * Creates a new license key with the specified feature flags and credits.
 *
 * @param options - License key creation options.
 * @returns The created license key record.
 */
export async function createLicenseKey(options: CreateLicenseKeyOptions) {
  const key = generateLicenseKey();

  const licenseKey = await prisma.licenseKey.create({
    data: {
      key,
      featureFlags: options.featureFlags as unknown as Record<string, boolean>,
      initialCredits: options.initialCredits,
      subscriptionTier: options.subscriptionTier,
      singleUse: true,
      expiresAt: options.expiresAt ?? null,
      notes: options.notes ?? null,
      createdByAdminId: options.createdByAdminId,
    },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      action: 'LICENSE_KEY_CREATED',
      actorUserId: options.createdByAdminId,
      actorTeamId: '',
      targetType: 'LicenseKey',
      targetId: licenseKey.id,
      metadata: {
        subscriptionTier: options.subscriptionTier,
        initialCredits: options.initialCredits,
        expiresAt: options.expiresAt?.toISOString() ?? null,
      },
    },
  });

  logger.info('License key created', {
    keyId: licenseKey.id,
    tier: options.subscriptionTier,
    credits: options.initialCredits,
    adminId: options.createdByAdminId,
  });

  return licenseKey;
}

/**
 * Lists license keys with optional status filtering and pagination.
 *
 * @param filters - Filtering and pagination options.
 * @returns Paginated list of license keys and total count.
 */
export async function listLicenseKeys(filters: ListLicenseKeysFilters = {}) {
  const { status = 'all', page = 1, limit = 25 } = filters;
  const skip = (page - 1) * limit;

  const where = buildStatusFilter(status);

  const [keys, total] = await Promise.all([
    prisma.licenseKey.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        createdByAdmin: { select: { email: true, name: true } },
      },
    }),
    prisma.licenseKey.count({ where }),
  ]);

  return { keys, total, page };
}

/**
 * Gets a single license key by ID.
 *
 * @param id - License key record ID.
 * @returns The license key or null.
 */
export async function getLicenseKey(id: string) {
  return prisma.licenseKey.findUnique({
    where: { id },
    include: {
      createdByAdmin: { select: { email: true, name: true } },
      activatedWorkspaces: { select: { slackTeamId: true, slackTeamName: true } },
    },
  });
}

/**
 * Revokes a license key, preventing future use.
 *
 * @param id      - License key record ID.
 * @param adminId - Admin performing the revocation.
 * @returns The revoked key or null if not found.
 */
export async function revokeLicenseKey(id: string, adminId: string) {
  const key = await prisma.licenseKey.findUnique({ where: { id } });

  if (!key) return null;
  if (key.revokedAt) return key; // Already revoked

  const revokedKey = await prisma.licenseKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      action: 'LICENSE_KEY_REVOKED',
      actorUserId: adminId,
      actorTeamId: '',
      targetType: 'LicenseKey',
      targetId: id,
      metadata: {
        activatedWorkspaceId: key.activatedWorkspaceId,
      },
    },
  });

  logger.info('License key revoked', { keyId: id, adminId });

  return revokedKey;
}

/**
 * Builds Prisma where clause from status filter.
 */
function buildStatusFilter(status: string) {
  const now = new Date();

  switch (status) {
    case 'active':
      return {
        activatedWorkspaceId: null,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      };
    case 'activated':
      return { activatedWorkspaceId: { not: null } };
    case 'expired':
      return { expiresAt: { lte: now }, revokedAt: null };
    case 'revoked':
      return { revokedAt: { not: null } };
    default:
      return {};
  }
}
