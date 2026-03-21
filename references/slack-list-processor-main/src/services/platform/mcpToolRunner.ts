/**
 * MCP Tool Runner Service (Feature 39 - Vertical Pack Platform)
 *
 * Invokes MCP tools by loading their server configuration,
 * resolving credentials (BYOK or platform), constructing HTTP requests,
 * and handling rate limits (FR-010).
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

const log = logger.withContext({ service: 'mcpToolRunner' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolInvocationResult {
  output: unknown;
  durationMs: number;
  statusCode: number;
  error?: string;
}

// Simple in-memory rate limiter per server
const rateLimitCounters = new Map<string, { count: number; resetAt: number }>();

// ---------------------------------------------------------------------------
// Core Invocation (T029)
// ---------------------------------------------------------------------------

/**
 * Invoke an MCP tool with the given input.
 * Resolves BYOK credentials if available, otherwise uses platform credentials.
 * Enforces server rate limit (FR-010).
 */
export async function invokeTool(
  toolId: string,
  input: Record<string, unknown>,
  slackTeamId?: string,
): Promise<ToolInvocationResult> {
  const tool = await prisma.mcpTool.findUnique({
    where: { id: toolId },
    include: { server: true },
  });

  if (!tool) throw new Error(`MCP tool ${toolId} not found`);
  if (!tool.server) throw new Error(`MCP server not found for tool ${toolId}`);

  const server = tool.server;

  // Check rate limit
  if (server.rateLimitRpm) {
    enforceRateLimit(server.id, server.rateLimitRpm);
  }

  // Resolve credentials: BYOK first, then platform
  let credentials = server.credentials;
  if (server.byokEnabled && slackTeamId) {
    const byok = await prisma.mcpByokCredential.findUnique({
      where: { serverId_slackTeamId: { serverId: server.id, slackTeamId } },
    });
    if (byok?.isValid) {
      credentials = byok.credentials;
    }
  }

  // Build request
  const url = buildToolUrl(server.baseUrl, tool.name);
  const headers = buildHeaders(server.authType, credentials);

  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30000),
    });

    const durationMs = Date.now() - startTime;

    let output: unknown;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      output = await response.json();
    } else {
      output = await response.text();
    }

    if (!response.ok) {
      log.warn('MCP tool invocation returned error', {
        toolId,
        toolName: tool.name,
        serverId: server.id,
        statusCode: response.status,
        durationMs,
      });

      return {
        output,
        durationMs,
        statusCode: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    log.info('MCP tool invocation complete', {
      toolId,
      toolName: tool.name,
      serverId: server.id,
      durationMs,
    });

    return { output, durationMs, statusCode: response.status };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    log.error('MCP tool invocation failed', {
      toolId,
      toolName: tool.name,
      serverId: server.id,
      error: errorMessage,
      durationMs,
    });

    return {
      output: null,
      durationMs,
      statusCode: 0,
      error: errorMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the tool endpoint URL from the server base URL and tool name.
 */
function buildToolUrl(baseUrl: string, toolName: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/${toolName}`;
}

/**
 * Build auth headers based on server auth type.
 */
function buildHeaders(
  authType: string,
  credentials: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'SlackListProcessor-MCPToolRunner/1.0',
  };

  if (!credentials) return headers;

  switch (authType) {
    case 'API_KEY':
      headers['X-API-Key'] = credentials;
      break;
    case 'BEARER_TOKEN':
      headers['Authorization'] = `Bearer ${credentials}`;
      break;
    case 'BASIC_AUTH':
      headers['Authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`;
      break;
    case 'OAUTH2':
      headers['Authorization'] = `Bearer ${credentials}`;
      break;
  }

  return headers;
}

/**
 * Simple in-memory rate limiter per server.
 * Throws if the server has exceeded its requests-per-minute limit.
 */
function enforceRateLimit(serverId: string, limitRpm: number): void {
  const now = Date.now();
  const entry = rateLimitCounters.get(serverId);

  if (!entry || now > entry.resetAt) {
    rateLimitCounters.set(serverId, { count: 1, resetAt: now + 60000 });
    return;
  }

  if (entry.count >= limitRpm) {
    throw new Error(`Rate limit exceeded for MCP server ${serverId}: ${limitRpm} req/min`);
  }

  entry.count++;
}
