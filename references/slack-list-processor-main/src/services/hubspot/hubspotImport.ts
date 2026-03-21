/**
 * HubSpot import service.
 *
 * Manages the lifecycle of contact import jobs: creating DB records,
 * enqueuing BullMQ jobs, cancellation, and history queries.
 */

import { prisma } from '../../models/index.js';
import { hubspotImportQueue } from '../queue/queues.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parameters for starting a new import job. */
export interface StartImportParams {
  connectionId: string;
  sourceFile: { name: string; url: string; rowCount: number };
  clientName: string;
  campaignName: string;
  columnMapping: Record<string, string>;
  enrichmentJobId?: string;
  slackContext: { channelId: string; threadTs?: string; userId: string };
}

// ---------------------------------------------------------------------------
// Service Functions
// ---------------------------------------------------------------------------

/**
 * Creates a HubSpotImportJob record and enqueues a BullMQ job for async processing.
 *
 * The list name follows the convention: `LIST : MMDD [CLIENT] Campaign Name`
 *
 * @param params - Import job parameters
 * @returns The created HubSpotImportJob record
 */
export async function startImport(params: StartImportParams) {
  const { connectionId, sourceFile, clientName, campaignName, columnMapping, enrichmentJobId, slackContext } = params;

  // Format list name: LIST : MMDD [CLIENT] Campaign Name
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const listName = `LIST : ${mm}${dd} [${clientName.toUpperCase()}] ${campaignName}`;

  // Get clientId from connection
  const connection = await prisma.hubSpotConnection.findUnique({
    where: { id: connectionId },
    select: { clientId: true },
  });

  if (!connection) {
    throw new Error(`HubSpot connection ${connectionId} not found`);
  }

  // Create DB record
  const importJob = await prisma.hubSpotImportJob.create({
    data: {
      connectionId,
      sourceFileName: sourceFile.name,
      sourceFileUrl: sourceFile.url,
      sourceRowCount: sourceFile.rowCount,
      enrichmentJobId: enrichmentJobId || null,
      clientName,
      campaignName,
      listName,
      columnMapping,
      contactsTotal: sourceFile.rowCount,
      slackChannelId: slackContext.channelId,
      slackThreadTs: slackContext.threadTs || null,
      slackUserId: slackContext.userId,
    },
  });

  // Enqueue BullMQ job
  const bullmqJob = await hubspotImportQueue.add(
    'hubspot-import',
    {
      importJobId: importJob.id,
      clientId: connection.clientId,
      channelId: slackContext.channelId,
      threadTs: slackContext.threadTs,
    },
    { jobId: `hubspot-import-${importJob.id}` },
  );

  // Update DB with BullMQ job ID
  await prisma.hubSpotImportJob.update({
    where: { id: importJob.id },
    data: { bullmqJobId: bullmqJob.id },
  });

  logger.info('HubSpot import job created', {
    importJobId: importJob.id,
    connectionId,
    listName,
    rowCount: sourceFile.rowCount,
  });

  return importJob;
}

/**
 * Cancels a pending or in-progress import job.
 *
 * @param importJobId - HubSpotImportJob UUID
 */
export async function cancelImport(importJobId: string): Promise<void> {
  const job = await prisma.hubSpotImportJob.findUnique({
    where: { id: importJobId },
  });

  if (!job) {
    throw new Error(`Import job ${importJobId} not found`);
  }

  if (job.status !== 'PENDING' && job.status !== 'PROCESSING') {
    throw new Error(`Cannot cancel import with status ${job.status}`);
  }

  await prisma.hubSpotImportJob.update({
    where: { id: importJobId },
    data: { status: 'CANCELLED', completedAt: new Date() },
  });

  logger.info('HubSpot import job cancelled', { importJobId });
}

/**
 * Returns recent import jobs for a client.
 *
 * @param clientId - ManagedClient UUID
 * @param limit - Maximum number of results (default 10)
 */
export async function getImportHistory(clientId: string, limit = 10) {
  const connection = await prisma.hubSpotConnection.findUnique({
    where: { clientId },
    select: { id: true },
  });

  if (!connection) return [];

  return prisma.hubSpotImportJob.findMany({
    where: { connectionId: connection.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
