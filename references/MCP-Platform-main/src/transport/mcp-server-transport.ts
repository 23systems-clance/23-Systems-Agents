/**
 * MCP Server Transport Layer
 * Handles Model Context Protocol communication via stdio
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ServerConfig } from '../types/config.js';
import type { Logger } from '../infrastructure/logger.js';
import { BuildWithService } from '../services/builtwith-service.js';
import { toolDefinitions } from '../tools/tool-definitions.js';
import {
  freeLookupSchema,
  domainLookupSchema,
  listSitesSchema,
} from '../tools/tool-schemas.js';
import { BuildWithError } from '../types/errors.js';

export class MCPServerTransport {
  private logger: Logger;
  private config: ServerConfig;
  private server: Server;
  private service: BuildWithService;

  constructor(config: ServerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;

    // Initialize MCP server
    this.server = new Server(
      {
        name: 'builtwith-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize BuildWith service
    this.service = new BuildWithService(config, logger);

    // Register handlers
    this.registerHandlers();
  }

  /**
   * Register MCP request handlers
   */
  private registerHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      this.logger.debug({ msg: 'Handling list tools request' });
      return {
        tools: toolDefinitions,
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      this.logger.info({
        msg: 'Tool call received',
        tool: name,
        args,
      });

      try {
        let result: unknown;

        switch (name) {
          case 'builtwith_free_lookup': {
            const input = freeLookupSchema.parse(args);
            result = await this.service.getFreeLookup(input.domain);
            break;
          }

          case 'builtwith_domain_lookup': {
            const input = domainLookupSchema.parse(args);
            result = await this.service.getDomainLookup(input.domain, {
              hideMetadata: input.hideMetadata,
              onlyLive: input.onlyLive,
            });
            break;
          }

          case 'builtwith_list_sites': {
            const input = listSitesSchema.parse(args);
            result = await this.service.listSites(input.technology, {
              includeMetadata: input.includeMetadata,
              offset: input.offset,
              since: input.since,
            });
            break;
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        this.logger.info({
          msg: 'Tool call completed',
          tool: name,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        this.logger.error({
          msg: 'Tool call failed',
          tool: name,
          error: (error as Error).message,
        });

        // Format error response
        const errorResponse = this.formatError(error as Error);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(errorResponse, null, 2),
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Format error for client response
   */
  private formatError(error: Error): Record<string, unknown> {
    if (error instanceof BuildWithError) {
      return {
        error: error.message,
        category: error.category,
        isRetryable: error.isRetryable,
        statusCode: error.statusCode,
      };
    }

    // Validation errors (Zod)
    if (error.name === 'ZodError') {
      return {
        error: 'Validation error',
        category: 'VALIDATION',
        isRetryable: false,
        details: error.message,
      };
    }

    // Generic error
    return {
      error: error.message,
      category: 'CLIENT',
      isRetryable: false,
    };
  }

  /**
   * Initialize and start the MCP server
   */
  async initialize(): Promise<void> {
    this.logger.info({ msg: 'Initializing MCP Server Transport' });

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    this.logger.info({ msg: 'MCP Server connected via stdio' });
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info({ msg: 'Shutting down MCP Server Transport' });
    await this.server.close();
    this.logger.info({ msg: 'MCP Server shutdown complete' });
  }
}
