#!/usr/bin/env node

/**
 * BuildWith MCP Server
 * Entry point for the Model Context Protocol server providing BuildWith API access
 */

import { MCPServerTransport } from './transport/mcp-server-transport.js';
import { loadConfig } from './config/config-loader.js';
import { createLogger } from './infrastructure/logger.js';

async function main(): Promise<void> {
  try {
    // Load configuration
    const config = loadConfig();

    // Initialize logger
    const logger = createLogger(config.logging);

    logger.info({
      msg: 'Starting BuildWith MCP Server',
      version: '1.0.0',
      nodeVersion: process.version,
    });

    // Initialize MCP server
    const server = new MCPServerTransport(config, logger);
    await server.initialize();

    logger.info('BuildWith MCP Server started successfully');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      await server.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await server.shutdown();
      process.exit(0);
    });
  } catch (error) {
    console.error('Fatal error starting server:', error);
    process.exit(1);
  }
}

main();
