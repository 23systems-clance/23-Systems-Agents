/**
 * Managed client CRUD routes.
 *
 * CRUD operations for business client entities with encrypted API keys.
 * Only ADMIN role can manage clients.
 */

import { Router } from 'express';
import { prisma } from '../../models/index.js';
import { requireAdmin } from '../../lib/adminAuth.js';
import { logAudit } from '../../lib/auditLogger.js';
import { encrypt } from '../../lib/tokenEncryption.js';
import { getDecryptedKey } from '../../lib/clientApiService.js';
import { listCampaigns as listInstantlyCampaigns } from '../../services/instantly/instantlyClient.js';
import { listCampaigns as listHeyReachCampaigns } from '../../services/heyreach/heyreachClient.js';
import { disconnect as disconnectHubSpot } from '../../services/hubspot/hubspotOAuth.js';
import { resolveChannelName } from './slackChannels.js';
import logger from '../../lib/logger.js';

export const clientManagementRouter = Router();

// All client management routes require ADMIN role.
clientManagementRouter.use(requireAdmin);

/**
 * Generates a URL-safe slug from a name string.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Maps a ManagedClient record to a safe API response (no encrypted keys).
 */
function toClientResponse(client: {
  id: string;
  name: string;
  slug: string;
  slackTeamId: string | null;
  instantlyApiKey: string | null;
  heyreachApiKey: string | null;
  hubspotApiKey: string | null;
  hubspotPortalId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: client.id,
    name: client.name,
    slug: client.slug,
    slackTeamId: client.slackTeamId,
    hasInstantlyKey: !!client.instantlyApiKey,
    hasHeyreachKey: !!client.heyreachApiKey,
    hasHubspotKey: !!client.hubspotApiKey,
    hubspotPortalId: client.hubspotPortalId,
    isActive: client.isActive,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
  };
}

/**
 * GET /clients/workspace-installations
 * Returns active workspace installations for the admin dashboard.
 */
clientManagementRouter.get('/workspace-installations', async (_req, res) => {
  try {
    const workspaces = await prisma.workspaceInstallation.findMany({
      where: { status: 'ACTIVE' },
      select: { slackTeamId: true, slackTeamName: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ workspaces });
  } catch (error) {
    logger.error('Failed to list workspace installations', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to list workspaces' });
  }
});

/**
 * GET /clients
 * List all managed clients.
 */
clientManagementRouter.get('/', async (req, res) => {
  try {
    const search = req.query.search as string | undefined;
    const isActive = req.query.isActive as string | undefined;

    const where: Record<string, unknown> = {};
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [clients, total] = await Promise.all([
      prisma.managedClient.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { bdrs: true, channelMappings: true } },
        },
      }),
      prisma.managedClient.count({ where }),
    ]);

    res.json({
      clients: clients.map((c) => ({
        ...toClientResponse(c),
        bdrCount: c._count.bdrs,
        channelCount: c._count.channelMappings,
      })),
      total,
    });
  } catch (error) {
    logger.error('Failed to list managed clients', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to list clients' });
  }
});

/**
 * GET /clients/:id
 * Get a single client with associated BDRs.
 */
clientManagementRouter.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const client = await prisma.managedClient.findUnique({
      where: { id },
      include: {
        bdrs: {
          include: {
            bdr: {
              select: {
                id: true,
                name: true,
                email: true,
                slackUserId: true,
                isActive: true,
              },
            },
          },
        },
        channelMappings: {
          select: {
            id: true,
            slackChannelId: true,
            slackTeamId: true,
          },
        },
        campaigns: {
          select: {
            id: true,
            name: true,
            campaignType: true,
            status: true,
            totalContacts: true,
            activeContacts: true,
            completedContacts: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!client) {
      res.status(404).json({ error: 'not_found', message: 'Client not found' });
      return;
    }

    // Ensure a usable slackTeamId — fall back to first active workspace if null.
    let effectiveTeamId = client.slackTeamId;
    if (!effectiveTeamId) {
      const firstWorkspace = await prisma.workspaceInstallation.findFirst({
        where: { status: 'ACTIVE' },
        select: { slackTeamId: true },
      });
      effectiveTeamId = firstWorkspace?.slackTeamId ?? null;
    }

    // Fetch workflows assigned to this client.
    const workflows = await prisma.workflowTemplate.findMany({
      where: { clientId: id },
      select: {
        id: true,
        name: true,
        triggerType: true,
        isActive: true,
        createdAt: true,
        versions: {
          where: { status: 'PUBLISHED' },
          select: { version: true, publishedAt: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      ...toClientResponse({ ...client, slackTeamId: effectiveTeamId }),
      bdrs: client.bdrs.map((bc) => bc.bdr),
      channels: await Promise.all(client.channelMappings.map(async (m) => ({
        id: m.id,
        slackChannelId: m.slackChannelId,
        slackTeamId: m.slackTeamId,
        channelName: await resolveChannelName(m.slackTeamId, m.slackChannelId),
      }))),
      campaigns: client.campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        campaignType: c.campaignType,
        status: c.status,
        totalContacts: c.totalContacts,
        activeContacts: c.activeContacts,
        completedContacts: c.completedContacts,
        createdAt: c.createdAt.toISOString(),
      })),
      workflows: workflows.map((w) => ({
        id: w.id,
        name: w.name,
        trigger_type: w.triggerType,
        is_active: w.isActive,
        current_version: w.versions[0]?.version ?? null,
        published_at: w.versions[0]?.publishedAt?.toISOString() ?? null,
        created_at: w.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error('Failed to get client detail', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to get client' });
  }
});

/**
 * POST /clients
 * Create a new managed client. Encrypts API keys before storage.
 */
clientManagementRouter.post('/', async (req, res) => {
  try {
    const { name, slug, slackTeamId, instantlyApiKey, heyreachApiKey, hubspotApiKey, hubspotPortalId } =
      req.body;

    if (!name) {
      res.status(400).json({ error: 'bad_request', message: 'name is required' });
      return;
    }

    // Resolve slackTeamId: use provided value or fall back to first active workspace.
    let resolvedTeamId = slackTeamId as string | undefined;
    if (!resolvedTeamId) {
      const firstWorkspace = await prisma.workspaceInstallation.findFirst({
        where: { status: 'ACTIVE' },
        select: { slackTeamId: true },
      });
      if (firstWorkspace) {
        resolvedTeamId = firstWorkspace.slackTeamId;
      }
    } else {
      const workspace = await prisma.workspaceInstallation.findUnique({
        where: { slackTeamId: resolvedTeamId },
      });
      if (!workspace) {
        res.status(404).json({ error: 'not_found', message: 'Workspace not found for this slackTeamId' });
        return;
      }
    }

    const finalSlug = slug || slugify(name);

    // Check for duplicate slug.
    const existing = await prisma.managedClient.findUnique({ where: { slug: finalSlug } });
    if (existing) {
      res.status(409).json({ error: 'conflict', message: 'A client with this slug already exists' });
      return;
    }

    const client = await prisma.managedClient.create({
      data: {
        name,
        slug: finalSlug,
        slackTeamId: resolvedTeamId || null,
        instantlyApiKey: instantlyApiKey ? encrypt(instantlyApiKey) : null,
        heyreachApiKey: heyreachApiKey ? encrypt(heyreachApiKey) : null,
        hubspotApiKey: hubspotApiKey ? encrypt(hubspotApiKey) : null,
        hubspotPortalId: hubspotPortalId || null,
      },
    });

    logAudit({
      action: 'client_created',
      actorUserId: req.admin!.id,
      targetType: 'ManagedClient',
      targetId: client.id,
      metadata: { name: client.name, slug: client.slug, slackTeamId: resolvedTeamId },
    }).catch(() => {});

    res.status(201).json({ ...toClientResponse(client), bdrCount: 0, channelCount: 0 });
  } catch (error) {
    logger.error('Failed to create managed client', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to create client' });
  }
});

/**
 * PUT /clients/:id
 * Update a managed client. Re-encrypts changed API keys.
 */
clientManagementRouter.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, slackTeamId, instantlyApiKey, heyreachApiKey, hubspotApiKey, hubspotPortalId, isActive } =
      req.body;

    const existing = await prisma.managedClient.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'Client not found' });
      return;
    }

    // Check slug uniqueness if changing.
    if (slug && slug !== existing.slug) {
      const dup = await prisma.managedClient.findUnique({ where: { slug } });
      if (dup) {
        res.status(409).json({ error: 'conflict', message: 'Slug already in use' });
        return;
      }
    }

    // Validate workspace if changing.
    if (slackTeamId && slackTeamId !== existing.slackTeamId) {
      const workspace = await prisma.workspaceInstallation.findUnique({
        where: { slackTeamId },
      });
      if (!workspace) {
        res.status(404).json({ error: 'not_found', message: 'Workspace not found for this slackTeamId' });
        return;
      }
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = slug;
    if (slackTeamId !== undefined) updateData.slackTeamId = slackTeamId;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (hubspotPortalId !== undefined) updateData.hubspotPortalId = hubspotPortalId || null;

    // Only re-encrypt if a new key value is provided (non-empty string).
    if (instantlyApiKey !== undefined) {
      updateData.instantlyApiKey = instantlyApiKey ? encrypt(instantlyApiKey) : null;
    }
    if (heyreachApiKey !== undefined) {
      updateData.heyreachApiKey = heyreachApiKey ? encrypt(heyreachApiKey) : null;
    }
    if (hubspotApiKey !== undefined) {
      updateData.hubspotApiKey = hubspotApiKey ? encrypt(hubspotApiKey) : null;
    }

    const client = await prisma.managedClient.update({
      where: { id },
      data: updateData,
      include: { _count: { select: { bdrs: true, channelMappings: true } } },
    });

    logAudit({
      action: 'client_updated',
      actorUserId: req.admin!.id,
      targetType: 'ManagedClient',
      targetId: id,
      metadata: { fields: Object.keys(updateData) },
    }).catch(() => {});

    res.json({ ...toClientResponse(client), bdrCount: client._count.bdrs, channelCount: client._count.channelMappings });
  } catch (error) {
    logger.error('Failed to update managed client', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to update client' });
  }
});

/**
 * DELETE /clients/:id
 * Soft-delete a managed client (set isActive=false).
 */
clientManagementRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.managedClient.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'Client not found' });
      return;
    }

    await prisma.managedClient.update({
      where: { id },
      data: { isActive: false },
    });

    logAudit({
      action: 'client_deactivated',
      actorUserId: req.admin!.id,
      targetType: 'ManagedClient',
      targetId: id,
    }).catch(() => {});

    res.json({ message: 'Client deactivated' });
  } catch (error) {
    logger.error('Failed to deactivate managed client', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to deactivate client' });
  }
});

/**
 * GET /clients/:id/hubspot
 * Returns HubSpot connection details, recent imports, and sync logs.
 */
clientManagementRouter.get('/:id/hubspot', async (req, res) => {
  try {
    const { id } = req.params;

    const client = await prisma.managedClient.findUnique({ where: { id } });
    if (!client) {
      res.status(404).json({ error: 'not_found', message: 'Client not found' });
      return;
    }

    const connection = await prisma.hubSpotConnection.findUnique({
      where: { clientId: id },
    });

    if (!connection) {
      res.json({ connected: false });
      return;
    }

    const [recentImports, recentSyncLogs] = await Promise.all([
      prisma.hubSpotImportJob.findMany({
        where: { connectionId: connection.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          listName: true,
          status: true,
          contactsCreated: true,
          contactsUpdated: true,
          contactsFailed: true,
          contactsTotal: true,
          hubspotListUrl: true,
          createdAt: true,
          completedAt: true,
        },
      }),
      prisma.hubSpotSyncLog.findMany({
        where: { connectionId: connection.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          syncType: true,
          direction: true,
          recordsProcessed: true,
          recordsCreated: true,
          recordsUpdated: true,
          recordsFailed: true,
          durationMs: true,
          errorMessage: true,
          createdAt: true,
        },
      }),
    ]);

    res.json({
      connected: true,
      connection: {
        id: connection.id,
        status: connection.status,
        hubspotPortalId: connection.hubspotPortalId,
        hubspotPortalName: connection.hubspotPortalName,
        grantedScopes: connection.grantedScopes,
        connectedBy: connection.connectedBy,
        connectedAt: connection.connectedAt.toISOString(),
        lastRefreshedAt: connection.lastRefreshedAt?.toISOString() ?? null,
        tokenExpiresAt: connection.tokenExpiresAt.toISOString(),
        totalContactsSynced: connection.totalContactsSynced,
        totalActivitiesLogged: connection.totalActivitiesLogged,
        totalSyncFailures: connection.totalSyncFailures,
        lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
      },
      recentImports: recentImports.map((j) => ({
        ...j,
        createdAt: j.createdAt.toISOString(),
        completedAt: j.completedAt?.toISOString() ?? null,
      })),
      recentSyncLogs: recentSyncLogs.map((l) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error('Failed to get client HubSpot details', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to get HubSpot details' });
  }
});

/**
 * DELETE /clients/:id/hubspot
 * Disconnects a client's HubSpot connection (cascading delete).
 */
clientManagementRouter.delete('/:id/hubspot', async (req, res) => {
  try {
    const { id } = req.params;

    const client = await prisma.managedClient.findUnique({ where: { id } });
    if (!client) {
      res.status(404).json({ error: 'not_found', message: 'Client not found' });
      return;
    }

    await disconnectHubSpot(id);

    logAudit({
      action: 'hubspot_disconnected',
      actorUserId: req.admin!.id,
      targetType: 'HubSpotConnection',
      metadata: { clientId: id },
    }).catch(() => {});

    res.json({ message: 'HubSpot disconnected' });
  } catch (error) {
    logger.error('Failed to disconnect HubSpot', {
      error: error instanceof Error ? error.message : String(error),
    });
    const msg = error instanceof Error ? error.message : 'Failed to disconnect HubSpot';
    res.status(500).json({ error: 'internal_error', message: msg });
  }
});

/**
 * POST /clients/:id/bdrs
 * Associate a BDR to this client.
 */
clientManagementRouter.post('/:id/bdrs', async (req, res) => {
  try {
    const { id: clientId } = req.params;
    const { bdrId } = req.body;

    if (!bdrId) {
      res.status(400).json({ error: 'bad_request', message: 'bdrId is required' });
      return;
    }

    // Verify both entities exist.
    const [client, bdr] = await Promise.all([
      prisma.managedClient.findUnique({ where: { id: clientId } }),
      prisma.bdr.findUnique({ where: { id: bdrId } }),
    ]);

    if (!client) {
      res.status(404).json({ error: 'not_found', message: 'Client not found' });
      return;
    }
    if (!bdr) {
      res.status(404).json({ error: 'not_found', message: 'BDR not found' });
      return;
    }

    // Check if already associated.
    const existing = await prisma.bdrClient.findUnique({
      where: { bdrId_clientId: { bdrId, clientId } },
    });
    if (existing) {
      res.status(409).json({ error: 'conflict', message: 'BDR is already associated with this client' });
      return;
    }

    await prisma.bdrClient.create({
      data: { bdrId, clientId },
    });

    logAudit({
      action: 'bdr_client_associated',
      actorUserId: req.admin!.id,
      targetType: 'BdrClient',
      metadata: { bdrId, clientId },
    }).catch(() => {});

    res.status(201).json({ message: 'BDR associated with client' });
  } catch (error) {
    logger.error('Failed to associate BDR to client', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to associate BDR' });
  }
});

/**
 * DELETE /clients/:id/bdrs/:bdrId
 * Disassociate a BDR from this client.
 */
clientManagementRouter.delete('/:id/bdrs/:bdrId', async (req, res) => {
  try {
    const { id: clientId, bdrId } = req.params;

    const existing = await prisma.bdrClient.findUnique({
      where: { bdrId_clientId: { bdrId, clientId } },
    });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'Association not found' });
      return;
    }

    await prisma.bdrClient.delete({
      where: { bdrId_clientId: { bdrId, clientId } },
    });

    logAudit({
      action: 'bdr_client_disassociated',
      actorUserId: req.admin!.id,
      targetType: 'BdrClient',
      metadata: { bdrId, clientId },
    }).catch(() => {});

    res.json({ message: 'BDR disassociated from client' });
  } catch (error) {
    logger.error('Failed to disassociate BDR from client', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to disassociate BDR' });
  }
});

/**
 * GET /clients/:id/external-campaigns
 * Lists campaigns from an external platform (Instantly or HeyReach) using client credentials.
 * Query: platform (required) - 'instantly' | 'heyreach'
 */
clientManagementRouter.get('/:id/external-campaigns', async (req, res) => {
  try {
    const { id: clientId } = req.params;
    const platform = req.query.platform as string;

    if (!platform || (platform !== 'instantly' && platform !== 'heyreach')) {
      res.status(400).json({ error: 'bad_request', message: 'platform query parameter must be "instantly" or "heyreach"' });
      return;
    }

    const apiKey = await getDecryptedKey(clientId, platform);
    if (!apiKey) {
      res.status(404).json({ error: 'no_api_key', message: `Client has no ${platform} API key configured` });
      return;
    }

    let campaigns: Array<{ id: string; name: string; status?: string }>;

    if (platform === 'instantly') {
      const raw = await listInstantlyCampaigns(apiKey);
      campaigns = raw.map((c) => ({ id: c.id, name: c.name, status: c.status }));
    } else {
      const raw = await listHeyReachCampaigns(apiKey);
      campaigns = raw.map((c) => ({ id: String(c.id), name: c.name, status: c.status }));
    }

    res.json({ data: campaigns });
  } catch (error) {
    logger.error('Failed to fetch external campaigns', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to fetch external campaigns' });
  }
});
