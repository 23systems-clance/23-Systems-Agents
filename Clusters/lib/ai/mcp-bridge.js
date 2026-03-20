/**
 * MCP-to-LangChain Bridge
 *
 * Reads MCP server manifests from mcp-servers/ and config/MCP_SERVERS.json,
 * connects to active servers via @langchain/mcp-adapters, and returns
 * LangChain-compatible tools for use in the agent's tool array.
 */

import fs from 'fs';
import path from 'path';
import { mcpServersDir, mcpServersConfig } from '../paths.js';

let _mcpClient = null;

/**
 * Scan mcp-servers/ directory for available MCP server manifests.
 * Returns an array of { name, description, manifest, dir } objects.
 */
export function scanMCPServers() {
  if (!fs.existsSync(mcpServersDir)) return [];

  const servers = [];
  try {
    const entries = fs.readdirSync(mcpServersDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(mcpServersDir, entry.name, 'MCP_SERVER.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        servers.push({
          name: manifest.name || entry.name,
          description: manifest.description || '',
          manifest,
          dir: path.join(mcpServersDir, entry.name),
        });
      } catch (err) {
        console.warn(`[mcp-bridge] Failed to parse ${manifestPath}:`, err.message);
      }
    }
  } catch (err) {
    console.warn('[mcp-bridge] Failed to scan mcp-servers/:', err.message);
  }
  return servers;
}

/**
 * Read config/MCP_SERVERS.json to get the list of active server names.
 * Returns { active_servers: string[] }.
 */
function readActiveConfig() {
  try {
    if (!fs.existsSync(mcpServersConfig)) return { active_servers: [] };
    return JSON.parse(fs.readFileSync(mcpServersConfig, 'utf8'));
  } catch (err) {
    console.warn('[mcp-bridge] Failed to read MCP_SERVERS.json:', err.message);
    return { active_servers: [] };
  }
}

/**
 * Resolve ${VAR} references in env values from process.env.
 */
function resolveEnv(envMap) {
  if (!envMap) return undefined;
  const resolved = {};
  for (const [key, value] of Object.entries(envMap)) {
    if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
      const varName = value.slice(2, -1);
      resolved[key] = process.env[varName] || '';
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

/**
 * Build the MultiServerMCPClient config from active server manifests.
 * Only builds config for the requested server names (or all active if not specified).
 */
export function buildMCPClientConfig(serverNames) {
  const available = scanMCPServers();
  const config = readActiveConfig();
  const activeNames = serverNames || config.active_servers || [];

  const mcpServers = {};

  for (const name of activeNames) {
    const server = available.find((s) => s.name === name);
    if (!server) {
      console.warn(`[mcp-bridge] MCP server "${name}" not found in mcp-servers/`);
      continue;
    }

    const manifest = server.manifest;
    if (manifest.transport === 'sse') {
      mcpServers[name] = {
        transport: 'sse',
        url: manifest.url,
        headers: manifest.headers || {},
      };
    } else if (manifest.transport === 'stdio' || !manifest.transport) {
      mcpServers[name] = {
        transport: 'stdio',
        command: manifest.command || 'node',
        args: (manifest.args || ['server.js']).map((arg) =>
          // Resolve relative paths against the server directory
          arg.startsWith('/') ? arg : path.join(server.dir, arg)
        ),
        env: resolveEnv(manifest.env),
        stderr: 'pipe',
      };
    }
  }

  return mcpServers;
}

/**
 * Load MCP tools as LangChain-compatible tools.
 * Returns a flat array of DynamicStructuredTool instances.
 *
 * @param {string[]} [serverNames] - Optional list of server names. Defaults to config/MCP_SERVERS.json active_servers.
 * @returns {Promise<import('@langchain/core/tools').StructuredTool[]>}
 */
export async function loadMCPTools(serverNames) {
  const mcpServers = buildMCPClientConfig(serverNames);

  if (Object.keys(mcpServers).length === 0) {
    return [];
  }

  try {
    const { MultiServerMCPClient } = await import('@langchain/mcp-adapters');

    // Close previous client if it exists
    if (_mcpClient) {
      try { await _mcpClient.close(); } catch {}
    }

    _mcpClient = new MultiServerMCPClient({ mcpServers });
    const tools = await _mcpClient.getTools();

    console.log(`[mcp-bridge] Loaded ${tools.length} MCP tool(s) from ${Object.keys(mcpServers).length} server(s): ${Object.keys(mcpServers).join(', ')}`);

    return tools;
  } catch (err) {
    console.error('[mcp-bridge] Failed to load MCP tools:', err.message);
    return [];
  }
}

/**
 * Disconnect all MCP server connections.
 * Called by resetAgent() to clean up.
 */
export async function closeMCPConnections() {
  if (_mcpClient) {
    try {
      await _mcpClient.close();
    } catch (err) {
      console.warn('[mcp-bridge] Error closing MCP connections:', err.message);
    }
    _mcpClient = null;
  }
}

/**
 * Build MCP config JSON for injecting into Docker containers.
 * Returns the mcpServers object in Claude Code settings format.
 *
 * @param {string[]} serverNames - List of MCP server names to include
 * @returns {object} Claude Code-compatible mcpServers config
 */
export function buildMCPConfigForContainer(serverNames) {
  const available = scanMCPServers();
  const mcpServers = {};

  for (const name of serverNames) {
    const server = available.find((s) => s.name === name);
    if (!server) continue;

    const manifest = server.manifest;

    // For containers, the mcp-servers/ dir is bind-mounted at a known path
    // We use absolute paths within the container
    mcpServers[name] = {
      command: manifest.command || 'node',
      args: (manifest.args || ['server.js']).map((arg) =>
        arg.startsWith('/') ? arg : `/app/mcp-servers/${name}/${arg}`
      ),
      env: resolveEnv(manifest.env) || {},
    };
  }

  return mcpServers;
}
