#!/usr/bin/env node

/**
 * BuildWith MCP Server
 * Provides technology profiling via the BuildWith API through the Model Context Protocol.
 * Ported from references/MCP-Platform-main/ — simplified to plain JS with no infrastructure deps.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ── Schemas ──────────────────────────────────────────────

const freeLookupSchema = z.object({
  domain: z.string().min(1).describe('Domain to lookup (e.g., example.com)'),
});

const domainLookupSchema = z.object({
  domain: z.string().min(1).describe('Domain to analyze'),
  hideMetadata: z.boolean().optional().default(false).describe('Hide descriptions, links, tags, categories'),
  onlyLive: z.boolean().optional().default(false).describe('Return only currently active technologies'),
});

const listSitesSchema = z.object({
  technology: z.string().min(1).describe('Technology identifier (e.g., "WordPress", "React")'),
  limit: z.number().min(1).max(1000).optional().default(100).describe('Maximum number of results'),
  includeMetadata: z.boolean().optional().default(false).describe('Include contact and company information'),
  offset: z.number().min(0).optional().describe('Pagination offset'),
  since: z.string().optional().describe('Filter results modified since date (YYYY-MM-DD)'),
});

function toMCPSchema(zodSchema) {
  return zodToJsonSchema(zodSchema, { target: 'jsonSchema7', $refStrategy: 'none' });
}

// ── Tool definitions ─────────────────────────────────────

const toolDefinitions = [
  {
    name: 'builtwith_free_lookup',
    description:
      'Get basic technology information for a domain using the BuildWith Free API. ' +
      'Returns technology counts grouped by category.',
    inputSchema: toMCPSchema(freeLookupSchema),
  },
  {
    name: 'builtwith_domain_lookup',
    description:
      'Get comprehensive technology stack analysis for a domain. ' +
      'Returns detailed information about all technologies detected on the website.',
    inputSchema: toMCPSchema(domainLookupSchema),
  },
  {
    name: 'builtwith_list_sites',
    description:
      'Find websites that use a specific technology. ' +
      'Returns a list of domains using the specified technology. Supports pagination.',
    inputSchema: toMCPSchema(listSitesSchema),
  },
];

// ── API Client ───────────────────────────────────────────

const BASE_URL = 'https://api.builtwith.com';
const API_KEY = process.env.BUILTWITH_API_KEY;

async function apiRequest(endpoint, params) {
  if (!API_KEY) {
    throw new Error('BUILTWITH_API_KEY environment variable is required');
  }

  const url = new URL(`${BASE_URL}/${endpoint}/api.json`);
  url.searchParams.set('KEY', API_KEY);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': 'BuildWith-MCP-Server/1.0' },
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 429) throw new Error('Rate limit exceeded — try again later');
    if (status === 401 || status === 403) throw new Error('Invalid or expired BuildWith API key');
    throw new Error(`BuildWith API error: HTTP ${status}`);
  }

  return response.json();
}

async function freeLookup(domain) {
  return apiRequest('free-api', { LOOKUP: domain });
}

async function domainLookup(domain, options = {}) {
  const params = { LOOKUP: domain };
  if (options.hideMetadata) params.hideAll = 'yes';
  if (options.onlyLive) params.onlyLiveTechnologies = 'yes';
  return apiRequest('domain-api', params);
}

async function listSites(technology, options = {}) {
  const params = { TECH: technology };
  if (options.includeMetadata) params.META = 'yes';
  if (options.offset) params.OFFSET = String(options.offset);
  if (options.since) params.SINCE = options.since;
  return apiRequest('lists-api', params);
}

// ── MCP Server ───────────────────────────────────────────

const server = new Server(
  { name: 'builtwith-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'builtwith_free_lookup': {
        const input = freeLookupSchema.parse(args);
        result = await freeLookup(input.domain);
        break;
      }
      case 'builtwith_domain_lookup': {
        const input = domainLookupSchema.parse(args);
        result = await domainLookup(input.domain, {
          hideMetadata: input.hideMetadata,
          onlyLive: input.onlyLive,
        });
        break;
      }
      case 'builtwith_list_sites': {
        const input = listSitesSchema.parse(args);
        result = await listSites(input.technology, {
          includeMetadata: input.includeMetadata,
          offset: input.offset,
          since: input.since,
        });
        break;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
      isError: true,
    };
  }
});

// ── Start ────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[builtwith-mcp] Server started via stdio');
}

main().catch((err) => {
  console.error('[builtwith-mcp] Fatal error:', err);
  process.exit(1);
});
