/**
 * MCP Server Registry Service (Feature 39 - Vertical Pack Platform)
 *
 * CRUD for MCP server connections, tool management, health checks,
 * and BYOK credential management.
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { encrypt, decrypt } from '../../lib/tokenEncryption.js';
import type { McpServerStatus } from '@prisma/client';

const log = logger.withContext({ service: 'mcpServerRegistry' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateServerInput {
  name: string;
  slug: string;
  provider: string;
  baseUrl: string;
  authType: 'API_KEY' | 'OAUTH2' | 'BEARER_TOKEN' | 'BASIC_AUTH' | 'NONE';
  credentials?: string;
  byokEnabled?: boolean;
  rateLimitRpm?: number;
}

export interface UpdateServerInput {
  name?: string;
  baseUrl?: string;
  credentials?: string;
  byokEnabled?: boolean;
  rateLimitRpm?: number;
}

export interface CreateToolInput {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  creditCost?: number;
}

export interface HealthCheckResult {
  status: 'HEALTHY' | 'ERROR';
  latencyMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Server CRUD (T019)
// ---------------------------------------------------------------------------

export async function createServer(input: CreateServerInput) {
  const server = await prisma.mcpServer.create({
    data: {
      name: input.name,
      slug: input.slug,
      provider: input.provider,
      baseUrl: input.baseUrl,
      authType: input.authType,
      credentials: input.credentials ? encrypt(input.credentials) : undefined,
      byokEnabled: input.byokEnabled ?? false,
      rateLimitRpm: input.rateLimitRpm,
    },
  });

  log.info('MCP server created', { serverId: server.id, slug: server.slug });
  return server;
}

export async function getServer(serverId: string) {
  return prisma.mcpServer.findUnique({
    where: { id: serverId },
    include: { tools: true },
  });
}

export async function listServers(status?: McpServerStatus) {
  const where = status ? { status } : {};
  const servers = await prisma.mcpServer.findMany({
    where,
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { tools: true } },
    },
  });

  return servers.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    provider: s.provider,
    status: s.status,
    byokEnabled: s.byokEnabled,
    toolCount: s._count.tools,
    lastHealthCheck: s.lastHealthCheck,
    createdAt: s.createdAt,
  }));
}

export async function updateServer(serverId: string, input: UpdateServerInput) {
  const server = await prisma.mcpServer.update({
    where: { id: serverId },
    data: {
      ...(input.name && { name: input.name }),
      ...(input.baseUrl && { baseUrl: input.baseUrl }),
      ...(input.credentials !== undefined && { credentials: input.credentials ? encrypt(input.credentials) : null }),
      ...(input.byokEnabled !== undefined && { byokEnabled: input.byokEnabled }),
      ...(input.rateLimitRpm !== undefined && { rateLimitRpm: input.rateLimitRpm }),
    },
    include: { tools: true },
  });

  log.info('MCP server updated', { serverId });
  return server;
}

export async function deleteServer(serverId: string) {
  await prisma.mcpServer.delete({ where: { id: serverId } });
  log.info('MCP server deleted', { serverId });
}

// ---------------------------------------------------------------------------
// Tool Management (T020)
// ---------------------------------------------------------------------------

export async function addTool(serverId: string, input: CreateToolInput) {
  const tool = await prisma.mcpTool.create({
    data: {
      serverId,
      name: input.name,
      description: input.description,
      inputSchema: (input.inputSchema ?? undefined) as any,
      outputSchema: (input.outputSchema ?? undefined) as any,
      creditCost: input.creditCost ?? 0,
    },
  });

  log.info('MCP tool added', { serverId, toolId: tool.id, name: tool.name });
  return tool;
}

export async function updateTool(toolId: string, input: Partial<CreateToolInput>) {
  return prisma.mcpTool.update({
    where: { id: toolId },
    data: {
      ...(input.name && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.inputSchema !== undefined && { inputSchema: input.inputSchema as any }),
      ...(input.outputSchema !== undefined && { outputSchema: input.outputSchema as any }),
      ...(input.creditCost !== undefined && { creditCost: input.creditCost }),
    } as any,
  });
}

export async function removeTool(toolId: string) {
  await prisma.mcpTool.delete({ where: { id: toolId } });
  log.info('MCP tool removed', { toolId });
}

export async function listToolsForServer(serverId: string) {
  return prisma.mcpTool.findMany({
    where: { serverId },
    orderBy: { name: 'asc' },
  });
}

// ---------------------------------------------------------------------------
// Health Check (T021)
// ---------------------------------------------------------------------------

export async function runHealthCheck(serverId: string): Promise<HealthCheckResult> {
  const server = await prisma.mcpServer.findUnique({
    where: { id: serverId },
  });

  if (!server) throw new Error(`MCP server ${serverId} not found`);

  const start = Date.now();
  let status: 'HEALTHY' | 'ERROR' = 'HEALTHY';
  let error: string | undefined;

  try {
    const headers: Record<string, string> = { 'User-Agent': 'SlackListProcessor-HealthCheck/1.0' };

    // Decrypt and build auth header based on authType
    if (server.credentials) {
      const decryptedCreds = decrypt(server.credentials);
      switch (server.authType) {
        case 'API_KEY':
          headers['X-API-Key'] = decryptedCreds;
          break;
        case 'BEARER_TOKEN':
          headers['Authorization'] = `Bearer ${decryptedCreds}`;
          break;
        case 'BASIC_AUTH':
          headers['Authorization'] = `Basic ${Buffer.from(decryptedCreds).toString('base64')}`;
          break;
      }
    }

    const response = await fetch(server.baseUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      status = 'ERROR';
      error = `HTTP ${response.status}: ${response.statusText}`;
    }
  } catch (err) {
    status = 'ERROR';
    error = err instanceof Error ? err.message : String(err);
  }

  const latencyMs = Date.now() - start;

  // Update server status in DB
  await prisma.mcpServer.update({
    where: { id: serverId },
    data: {
      status,
      lastHealthCheck: new Date(),
      lastHealthError: error ?? null,
    },
  });

  log.info('MCP health check completed', { serverId, status, latencyMs });

  return { status, latencyMs, error };
}

/**
 * Run health checks on all registered MCP servers.
 * Used by the periodic health check worker.
 */
export async function runAllHealthChecks(): Promise<void> {
  const servers = await prisma.mcpServer.findMany({
    select: { id: true, name: true, status: true },
  });

  for (const server of servers) {
    try {
      const previousStatus = server.status;
      const result = await runHealthCheck(server.id);

      // Notify on status transition to ERROR
      if (previousStatus !== 'ERROR' && result.status === 'ERROR') {
        log.warn('MCP server health degraded', {
          serverId: server.id,
          serverName: server.name,
          error: result.error,
        });
      }
    } catch (err) {
      log.error('Health check failed for server', {
        serverId: server.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// BYOK Credential Management (T023)
// ---------------------------------------------------------------------------

export async function setByokCredentials(
  serverId: string,
  slackTeamId: string,
  credentials: Record<string, unknown>,
) {
  const server = await prisma.mcpServer.findUnique({ where: { id: serverId } });
  if (!server) throw new Error(`MCP server ${serverId} not found`);
  if (!server.byokEnabled) throw new Error('BYOK is not enabled for this server');

  const encryptedCreds = encrypt(JSON.stringify(credentials));

  const result = await prisma.mcpByokCredential.upsert({
    where: { serverId_slackTeamId: { serverId, slackTeamId } },
    create: {
      serverId,
      slackTeamId,
      credentials: encryptedCreds,
      isValid: true,
    },
    update: {
      credentials: encryptedCreds,
      isValid: true,
      lastValidatedAt: new Date(),
    },
  });

  log.info('BYOK credentials set', { serverId, slackTeamId });
  return result;
}

export async function getByokCredentials(serverId: string, slackTeamId: string) {
  const record = await prisma.mcpByokCredential.findUnique({
    where: { serverId_slackTeamId: { serverId, slackTeamId } },
  });
  if (!record) return null;

  return {
    ...record,
    credentials: JSON.parse(decrypt(record.credentials)) as Record<string, unknown>,
  };
}
