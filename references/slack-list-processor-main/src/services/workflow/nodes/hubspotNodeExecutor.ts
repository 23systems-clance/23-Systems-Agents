/**
 * HubSpot node executor for the workflow engine.
 *
 * Handles both Import mode (pull contacts from HubSpot list) and
 * Sync mode (push contacts to HubSpot with identity resolution).
 */

import type { HubSpotNodeConfig } from '../types.js';
import logger from '../../../lib/logger.js';

/**
 * Executes a HubSpot node against the execution context.
 *
 * @param config - The HubSpot node configuration.
 * @param context - The workflow execution context.
 */
export async function executeHubSpotNode(
  config: HubSpotNodeConfig,
  context: Record<string, unknown>
): Promise<void> {
  const outputVar = config.outputVariable || '_hubspotResult';

  if (config.mode === 'import') {
    await executeImport(config, context, outputVar);
  } else if (config.mode === 'sync') {
    await executeSync(config, context, outputVar);
  } else {
    logger.error('HubSpot node: unknown mode', { mode: config.mode });
    context[outputVar] = { error: `Unknown mode: ${config.mode}` };
  }
}

/**
 * Imports contacts from a HubSpot list.
 */
async function executeImport(
  config: HubSpotNodeConfig,
  context: Record<string, unknown>,
  outputVar: string
): Promise<void> {
  if (!config.listId) {
    logger.error('HubSpot import: missing listId');
    context[outputVar] = { error: 'Missing listId for import' };
    return;
  }

  try {
    // Dynamic import to avoid circular dependency and allow the client to be extended
    const { getContactsFromList } = await import('../../hubspot/hubspotClient.js');
    const contacts = await getContactsFromList(config.listId);

    context[outputVar] = contacts;
    logger.info(`HubSpot import: fetched ${contacts.length} contacts from list ${config.listId}`);
  } catch (err) {
    logger.error('HubSpot import failed', {
      listId: config.listId,
      error: err instanceof Error ? err.message : String(err),
    });
    context[outputVar] = { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Syncs contacts to HubSpot with identity resolution.
 * For large batches (100+ contacts), this should be queued via BullMQ.
 */
async function executeSync(
  config: HubSpotNodeConfig,
  context: Record<string, unknown>,
  outputVar: string
): Promise<void> {
  // Get contacts from upstream context
  const inputData = context._parsedData || context._rawData || [];
  const contacts = Array.isArray(inputData) ? inputData : [inputData];

  if (contacts.length === 0) {
    logger.warn('HubSpot sync: no contacts to sync');
    context[outputVar] = {
      mode: 'sync',
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      total: 0,
    };
    return;
  }

  logger.info(`HubSpot sync: processing ${contacts.length} contacts`);

  // For now, store a sync request that can be picked up by the BullMQ worker
  // or processed inline for small batches
  const syncReport = {
    mode: 'sync',
    total: contacts.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    fieldMapping: config.fieldMapping,
    syncMatchFields: config.syncMatchFields,
    fuzzyThreshold: config.fuzzyThreshold ?? 85,
    contacts,
    status: contacts.length > 100 ? 'queued' : 'processing',
  };

  if (contacts.length <= 100) {
    // Process inline for small batches — delegate to CRM adapter if available
    try {
      const { getAdapter } = await import('../../crm/crmAdapterRegistry.js');
      const { prisma } = await import('../../../models/index.js');

      // Look up CRM connection for this workflow's client
      const clientId = context._clientId as string | undefined;
      let connectionId: string | undefined;

      if (clientId) {
        const crmConnection = await prisma.crmConnection.findUnique({
          where: { clientId_crmType: { clientId, crmType: 'HUBSPOT' } },
          include: { fieldMappings: true },
        });
        if (crmConnection) {
          connectionId = crmConnection.id;
          const adapter = getAdapter('HUBSPOT');

          // Convert workflow contacts to canonical format for the adapter
          const canonicalContacts = (contacts as Record<string, unknown>[]).map((c) => ({
            email: String(c.email || ''),
            firstName: c.firstName as string | null || c.firstname as string | null || null,
            lastName: c.lastName as string | null || c.lastname as string | null || null,
            jobTitle: c.jobTitle as string | null || c.jobtitle as string | null || null,
            company: c.company as string | null || null,
            domain: c.domain as string | null || c.website as string | null || null,
            phone: c.phone as string | null || null,
            mobilePhone: c.mobilePhone as string | null || c.mobilephone as string | null || null,
            linkedinUrl: c.linkedinUrl as string | null || null,
            city: c.city as string | null || null,
            state: c.state as string | null || null,
            country: c.country as string | null || null,
          })).filter((c) => c.email);

          const upsertResult = await adapter.upsertContacts(
            connectionId,
            canonicalContacts,
            crmConnection.fieldMappings,
          );

          context[outputVar] = {
            mode: 'sync',
            total: canonicalContacts.length,
            created: upsertResult.succeeded,
            updated: 0,
            skipped: 0,
            failed: upsertResult.failed,
          };

          logger.info('HubSpot sync via CRM adapter complete', {
            total: canonicalContacts.length,
            succeeded: upsertResult.succeeded,
            failed: upsertResult.failed,
          });

          return;
        }
      }

      // Fallback to legacy sync if no CRM connection found
      const { syncContactsToHubSpot } = await import('../../hubspot/hubspotSyncService.js');
      const result = await syncContactsToHubSpot(
        contacts as Record<string, unknown>[],
        config
      );
      context[outputVar] = result;
    } catch (err) {
      logger.error('HubSpot sync failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      syncReport.failed = contacts.length;
      syncReport.status = 'failed';
      context[outputVar] = syncReport;
    }
  } else {
    // Large batch — mark as queued for BullMQ processing
    syncReport.status = 'queued';
    context[outputVar] = syncReport;
    context._hubspotSyncPending = {
      contacts,
      config,
    };
  }
}
