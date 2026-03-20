/**
 * HTTP/SSE Server Transport Layer
 * Handles Model Context Protocol communication via HTTP
 */

import Fastify, { FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
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

export class HTTPServerTransport {
  private logger: Logger;
  private config: ServerConfig;
  private server: Server;
  private service: BuildWithService;
  private fastify: ReturnType<typeof Fastify>;

  constructor(config: ServerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;

    // Initialize Fastify
    this.fastify = Fastify({
      logger: false, // Use our Pino logger instead
    });

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

    // Register MCP handlers
    this.registerMCPHandlers();
  }

  /**
   * Register MCP request handlers
   */
  private registerMCPHandlers(): void {
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

    if (error.name === 'ZodError') {
      return {
        error: 'Validation error',
        category: 'VALIDATION',
        isRetryable: false,
        details: error.message,
      };
    }

    return {
      error: error.message,
      category: 'CLIENT',
      isRetryable: false,
    };
  }

  /**
   * Initialize and start the HTTP server
   */
  async initialize(port: number = 3000): Promise<void> {
    this.logger.info({ msg: 'Initializing HTTP Server Transport' });

    // Register CORS
    await this.fastify.register(cors, {
      origin: true, // Allow all origins for development
      methods: ['GET', 'POST', 'OPTIONS'],
    });

    // Health check endpoint
    this.fastify.get('/health', async () => {
      return {
        status: 'healthy',
        service: 'builtwith-mcp-server',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      };
    });

    // MCP endpoint - List tools
    this.fastify.get('/mcp/tools', async () => {
      this.logger.debug({ msg: 'Handling list tools request via HTTP' });
      return {
        tools: toolDefinitions,
      };
    });

    // MCP endpoint - Call tool
    this.fastify.post('/mcp/tools/call', async (request: FastifyRequest) => {
      const { name, arguments: args } = request.body as {
        name: string;
        arguments: unknown;
      };

      this.logger.info({
        msg: 'Tool call received via HTTP',
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
          msg: 'Tool call completed via HTTP',
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
          msg: 'Tool call failed via HTTP',
          tool: name,
          error: (error as Error).message,
        });

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

    // Server info endpoint
    this.fastify.get('/mcp/info', async () => {
      return {
        name: 'builtwith-mcp-server',
        version: '1.0.0',
        description: 'BuildWith API MCP Server with HTTP transport',
        capabilities: {
          tools: {},
        },
        config: {
          rateLimit: {
            requestsPerSecond: this.config.rateLimit.requestsPerSecond,
            maxConcurrent: this.config.rateLimit.maxConcurrent,
          },
          cache: {
            enabled: this.config.cache.enabled,
            maxSize: this.config.cache.maxSize,
            ttlMs: this.config.cache.ttlMs,
          },
        },
        stats: this.service.getCacheStats(),
      };
    });

    // Start server
    await this.fastify.listen({ port, host: '0.0.0.0' });

    this.logger.info({
      msg: 'HTTP Server started',
      port,
      url: `http://localhost:${port}`,
    });
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info({ msg: 'Shutting down HTTP Server Transport' });
    await this.fastify.close();
    await this.server.close();
    this.logger.info({ msg: 'HTTP Server shutdown complete' });
  }
}
