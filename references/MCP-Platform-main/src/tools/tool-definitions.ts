/**
 * MCP Tool Definitions
 * Defines the available tools for the MCP server
 */

import { freeLookupSchema, domainLookupSchema, listSitesSchema } from './tool-schemas.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Convert Zod schema to JSON Schema for MCP
 */
function zodToMCPSchema(zodSchema: any): any {
  return zodToJsonSchema(zodSchema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  });
}

/**
 * Tool definitions for MCP protocol
 */
export const toolDefinitions = [
  {
    name: 'builtwith_free_lookup',
    description:
      'Get basic technology information for a domain using the BuildWith Free API. ' +
      'Returns technology counts grouped by category. Limited to 1 request per second.',
    inputSchema: zodToMCPSchema(freeLookupSchema),
  },
  {
    name: 'builtwith_domain_lookup',
    description:
      'Get comprehensive technology stack analysis for a domain using the BuildWith Domain API. ' +
      'Returns detailed information about all technologies detected on the website, including ' +
      'historical data. Supports filtering for live technologies only and hiding metadata.',
    inputSchema: zodToMCPSchema(domainLookupSchema),
  },
  {
    name: 'builtwith_list_sites',
    description:
      'Find websites that use a specific technology using the BuildWith Lists API. ' +
      'Returns a list of domains that use the specified technology. Supports pagination ' +
      'and optional metadata (contact/company information). Useful for finding sites built ' +
      'with specific frameworks, platforms, or services.',
    inputSchema: zodToMCPSchema(listSitesSchema),
  },
];
