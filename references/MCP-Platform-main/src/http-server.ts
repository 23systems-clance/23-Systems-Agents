#!/usr/bin/env node
/**
 * BuildWith MCP Server - HTTP Mode
 * Entry point for HTTP/API server
 */

import 'dotenv/config';
import { HTTPServerTransport } from './transport/http-server-transport.js';
import { loadConfig } from './config/config-loader.js';
import { createLogger } from './infrastructure/logger.js';

async function main(): Promise<void> {
  try {
    // Load configuration
    const config = loadConfig();

    // Initialize logger
    const logger = createLogger(config.logging);

    logger.info({
      msg: 'Starting BuildWith MCP Server (HTTP Mode)',
      version: '1.0.0',
      nodeVersion: process.version,
    });

    // Get port from environment or use default
    const port = parseInt(process.env.PORT || '3000', 10);

    // Initialize HTTP server
    const server = new HTTPServerTransport(config, logger);
    await server.initialize(port);

    logger.info({
      msg: 'BuildWith MCP Server started successfully',
      mode: 'HTTP',
      port,
      endpoints: {
        health: `http://localhost:${port}/health`,
        info: `http://localhost:${port}/mcp/info`,
        tools: `http://localhost:${port}/mcp/tools`,
        call: `http://localhost:${port}/mcp/tools/call`,
      },
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info({ msg: 'Received SIGINT, shutting down gracefully...' });
      await server.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info({ msg: 'Received SIGTERM, shutting down gracefully...' });
      await server.shutdown();
      process.exit(0);
    });
  } catch (error) {
    console.error('Fatal error starting server:', error);
    process.exit(1);
  }
}

main();
