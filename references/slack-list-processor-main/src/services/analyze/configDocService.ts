/**
 * CRUD service for per-channel configuration documents.
 *
 * Manages ICP.md, UseCases.md, Campaigns.md, and Settings.md
 * documents stored in PostgreSQL per Slack channel/team.
 */

import { prisma } from '../../models/index.js';
import type { ConfigDocType, ChannelConfigDoc } from '@prisma/client';
import logger from '../../lib/logger.js';
import { deleteFile } from '../../lib/storage.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Map of doc type slugs to Prisma enum values. */
const DOC_TYPE_MAP: Record<string, ConfigDocType> = {
  icp: 'ICP',
  use_cases: 'USE_CASES',
  usecases: 'USE_CASES',
  campaigns: 'CAMPAIGNS',
  settings: 'SETTINGS',
};

/** Human-readable labels for config doc types. */
export const DOC_TYPE_LABELS: Record<ConfigDocType, string> = {
  ICP: 'ICP (Ideal Customer Profile)',
  USE_CASES: 'Use Cases',
  CAMPAIGNS: 'Campaigns',
  SETTINGS: 'Settings',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves a user-provided doc type string to the Prisma enum value.
 * Returns null if the string doesn't match any known type.
 */
export function resolveDocType(input: string): ConfigDocType | null {
  const normalized = input.toLowerCase().replace(/[\s.-]+/g, '_');
  return DOC_TYPE_MAP[normalized] ?? null;
}

/**
 * Upserts a configuration document for a channel. If the doc already
 * exists, it increments the version and updates content.
 */
export async function upsertConfigDoc(params: {
  teamId: string;
  channelId: string;
  docType: ConfigDocType;
  clientId?: string | null;
  content: string;
  uploadedByUserId: string;
  originalFileName?: string;
  displayLabel?: string;
  s3Key?: string;
  originalMimeType?: string;
  contentSizeBytes?: number;
}): Promise<ChannelConfigDoc> {
  const {
    teamId, channelId, docType, clientId, content, uploadedByUserId,
    originalFileName, displayLabel, s3Key, originalMimeType, contentSizeBytes,
  } = params;

  // Check for existing doc to get current version
  const existing = await prisma.channelConfigDoc.findUnique({
    where: {
      slackTeamId_slackChannelId_docType: {
        slackTeamId: teamId,
        slackChannelId: channelId,
        docType,
      },
    },
  });

  const newVersion = existing ? existing.version + 1 : 1;

  // If replacing an existing doc that has an S3 file, delete the old one
  if (existing?.s3Key && s3Key && existing.s3Key !== s3Key) {
    try {
      await deleteFile(existing.s3Key);
    } catch (err) {
      logger.warn('Failed to delete old S3 file during upsert', { s3Key: existing.s3Key, err });
    }
  }

  const doc = await prisma.channelConfigDoc.upsert({
    where: {
      slackTeamId_slackChannelId_docType: {
        slackTeamId: teamId,
        slackChannelId: channelId,
        docType,
      },
    },
    create: {
      slackTeamId: teamId,
      slackChannelId: channelId,
      docType,
      clientId: clientId ?? undefined,
      content,
      uploadedByUserId,
      originalFileName,
      displayLabel,
      s3Key,
      originalMimeType,
      contentSizeBytes,
      version: 1,
    },
    update: {
      clientId: clientId ?? undefined,
      content,
      uploadedByUserId,
      originalFileName,
      displayLabel,
      s3Key,
      originalMimeType,
      contentSizeBytes,
      version: newVersion,
    },
  });

  logger.info('Config doc upserted', {
    teamId,
    channelId,
    docType,
    version: doc.version,
  });

  return doc;
}

/**
 * Retrieves a specific config doc for a channel.
 */
export async function getConfigDoc(
  teamId: string,
  channelId: string,
  docType: ConfigDocType,
): Promise<ChannelConfigDoc | null> {
  return prisma.channelConfigDoc.findUnique({
    where: {
      slackTeamId_slackChannelId_docType: {
        slackTeamId: teamId,
        slackChannelId: channelId,
        docType,
      },
    },
  });
}

/**
 * Retrieves all config docs for a channel.
 * Optionally filters by clientId if provided.
 */
export async function getAllConfigDocs(
  teamId: string,
  channelId: string,
  clientId?: string | null,
): Promise<ChannelConfigDoc[]> {
  const where: any = {
    slackTeamId: teamId,
    slackChannelId: channelId,
  };

  // Apply clientId filter if provided
  if (clientId !== undefined) {
    where.clientId = clientId;
  }

  return prisma.channelConfigDoc.findMany({
    where,
    orderBy: { docType: 'asc' },
  });
}

/**
 * Deletes a config doc for a channel.
 */
export async function deleteConfigDoc(
  teamId: string,
  channelId: string,
  docType: ConfigDocType,
): Promise<boolean> {
  try {
    const doc = await prisma.channelConfigDoc.findUnique({
      where: {
        slackTeamId_slackChannelId_docType: {
          slackTeamId: teamId,
          slackChannelId: channelId,
          docType,
        },
      },
    });

    if (!doc) return false;

    // Delete S3 original file if it exists
    if (doc.s3Key) {
      try {
        await deleteFile(doc.s3Key);
      } catch (err) {
        logger.warn('Failed to delete S3 file during doc deletion', { s3Key: doc.s3Key, err });
      }
    }

    await prisma.channelConfigDoc.delete({
      where: { id: doc.id },
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes a config doc by its ID. Also removes the S3 original file.
 */
export async function deleteConfigDocById(id: string): Promise<ChannelConfigDoc | null> {
  const doc = await prisma.channelConfigDoc.findUnique({ where: { id } });
  if (!doc) return null;

  if (doc.s3Key) {
    try {
      await deleteFile(doc.s3Key);
    } catch (err) {
      logger.warn('Failed to delete S3 file during doc deletion', { s3Key: doc.s3Key, err });
    }
  }

  await prisma.channelConfigDoc.delete({ where: { id } });
  return doc;
}

/**
 * Returns a summary of which config docs exist and which are missing.
 */
export async function getConfigDocStatus(
  teamId: string,
  channelId: string,
): Promise<{
  existing: Array<{ docType: ConfigDocType; version: number; updatedAt: Date }>;
  missing: ConfigDocType[];
}> {
  const docs = await getAllConfigDocs(teamId, channelId);
  const existingTypes = new Set(docs.map((d) => d.docType));

  const allTypes: ConfigDocType[] = ['ICP', 'USE_CASES', 'CAMPAIGNS', 'SETTINGS'];
  const missing = allTypes.filter((t) => !existingTypes.has(t));

  return {
    existing: docs.map((d) => ({
      docType: d.docType,
      version: d.version,
      updatedAt: d.updatedAt,
    })),
    missing,
  };
}
