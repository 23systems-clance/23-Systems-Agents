'use server';

import { auth } from '../auth/index.js';
import {
  createChat as dbCreateChat,
  getChatById,
  getChatByWorkspaceId,
  getMessagesByChatId,
  deleteChat as dbDeleteChat,
  deleteAllChatsByUser,
  updateChatTitle,
  toggleChatStarred,
} from '../db/chats.js';
import {
  getNotifications as dbGetNotifications,
  getUnreadCount as dbGetUnreadCount,
  markAllRead as dbMarkAllRead,
} from '../db/notifications.js';

/**
 * Get the authenticated user or throw.
 */
async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  return session.user;
}

/**
 * Get all chats for the authenticated user (includes Telegram chats).
 * @returns {Promise<object[]>}
 */
export async function getChats(limit) {
  const user = await requireAuth();
  const { or, eq, desc } = await import('drizzle-orm');
  const { getDb } = await import('../db/index.js');
  const { chats, codeWorkspaces } = await import('../db/schema.js');
  const db = getDb();
  let query = db
    .select({
      id: chats.id,
      userId: chats.userId,
      title: chats.title,
      starred: chats.starred,
      codeWorkspaceId: chats.codeWorkspaceId,
      containerName: codeWorkspaces.containerName,
      createdAt: chats.createdAt,
      updatedAt: chats.updatedAt,
    })
    .from(chats)
    .leftJoin(codeWorkspaces, eq(chats.codeWorkspaceId, codeWorkspaces.id))
    .where(or(eq(chats.userId, user.id), eq(chats.userId, 'telegram')))
    .orderBy(desc(chats.updatedAt));
  if (limit) query = query.limit(limit);
  return query.all();
}

/**
 * Get messages for a specific chat (with ownership check).
 * @param {string} chatId
 * @returns {Promise<object[]>}
 */
export async function getChatMessages(chatId) {
  const user = await requireAuth();
  const chat = getChatById(chatId);
  if (!chat || (chat.userId !== user.id && chat.userId !== 'telegram')) {
    return [];
  }
  return getMessagesByChatId(chatId);
}

/**
 * Create a new chat.
 * @param {string} [id] - Optional chat ID
 * @param {string} [title='New Chat']
 * @returns {Promise<object>}
 */
export async function createChat(id, title = 'New Chat') {
  const user = await requireAuth();
  return dbCreateChat(user.id, title, id);
}

/**
 * Delete a chat (with ownership check).
 * @param {string} chatId
 * @returns {Promise<{success: boolean}>}
 */
export async function deleteChat(chatId) {
  const user = await requireAuth();
  const chat = getChatById(chatId);
  if (!chat || chat.userId !== user.id) {
    return { success: false };
  }
  dbDeleteChat(chatId);
  return { success: true };
}

/**
 * Rename a chat (with ownership check).
 * @param {string} chatId
 * @param {string} title
 * @returns {Promise<{success: boolean}>}
 */
export async function renameChat(chatId, title) {
  const user = await requireAuth();
  const chat = getChatById(chatId);
  if (!chat || chat.userId !== user.id) {
    return { success: false };
  }
  updateChatTitle(chatId, title);
  return { success: true };
}

/**
 * Toggle a chat's starred status (with ownership check).
 * @param {string} chatId
 * @returns {Promise<{success: boolean, starred?: number}>}
 */
export async function starChat(chatId) {
  const user = await requireAuth();
  const chat = getChatById(chatId);
  if (!chat || chat.userId !== user.id) {
    return { success: false };
  }
  const starred = toggleChatStarred(chatId);
  return { success: true, starred };
}

/**
 * Delete all chats for the authenticated user.
 * @returns {Promise<{success: boolean}>}
 */
export async function deleteAllChats() {
  const user = await requireAuth();
  deleteAllChatsByUser(user.id);
  return { success: true };
}

/**
 * Get notifications, newest first, with pagination.
 * @returns {Promise<{notifications: object[], hasMore: boolean}>}
 */
export async function getNotifications(limit = 25, offset = 0) {
  await requireAuth();
  const rows = dbGetNotifications(limit, offset);
  const hasMore = rows.length > limit;
  return { notifications: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

/**
 * Get count of unread notifications.
 * @returns {Promise<number>}
 */
export async function getUnreadNotificationCount() {
  await requireAuth();
  return dbGetUnreadCount();
}

/**
 * Mark all notifications as read.
 * @returns {Promise<{success: boolean}>}
 */
export async function markNotificationsRead() {
  await requireAuth();
  dbMarkAllRead();
  return { success: true };
}

/**
 * Generate a title for a new chat from the first user message.
 * @param {string} chatId
 * @param {string} firstMessage
 * @returns {Promise<void>}
 */
export async function generateChatTitle(chatId, firstMessage) {
  await requireAuth();
  const { autoTitle } = await import('../ai/index.js');
  return await autoTitle(chatId, firstMessage);
}

// ─────────────────────────────────────────────────────────────────────────────
// App info actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the installed package version and update status (auth-gated, never in client bundle).
 * @returns {Promise<{ version: string, updateAvailable: string|null }>}
 */
export async function getAppVersion() {
  await requireAuth();
  const { getInstalledVersion } = await import('../cron.js');
  const { getAvailableVersion, getReleaseNotes } = await import('../db/update-check.js');
  const version = getInstalledVersion();
  const available = getAvailableVersion();
  const isNewer = available && available !== version;
  return {
    version,
    updateAvailable: isNewer ? available : null,
    changelog: isNewer ? getReleaseNotes() : null,
  };
}

/**
 * Trigger the upgrade-event-handler workflow via GitHub Actions.
 * @returns {Promise<{ success: boolean }>}
 */
export async function triggerUpgrade() {
  await requireAuth();
  const { triggerWorkflowDispatch } = await import('../tools/github.js');
  const { getAvailableVersion } = await import('../db/update-check.js');
  const targetVersion = getAvailableVersion();
  await triggerWorkflowDispatch('upgrade-event-handler.yml', 'main', {
    target_version: targetVersion || '',
  });
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// API Key actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create (or replace) the API key.
 * @returns {Promise<{ key: string, record: object } | { error: string }>}
 */
export async function createNewApiKey() {
  const user = await requireAuth();
  try {
    const { createApiKeyRecord } = await import('../db/api-keys.js');
    return createApiKeyRecord(user.id);
  } catch (err) {
    console.error('Failed to create API key:', err);
    return { error: 'Failed to create API key' };
  }
}

/**
 * Get the current API key metadata (no hash).
 * @returns {Promise<object|null>}
 */
export async function getApiKeys() {
  await requireAuth();
  try {
    const { getApiKey } = await import('../db/api-keys.js');
    return getApiKey();
  } catch (err) {
    console.error('Failed to get API key:', err);
    return null;
  }
}

/**
 * Delete the API key.
 * @returns {Promise<{ success: boolean } | { error: string }>}
 */
export async function deleteApiKey() {
  await requireAuth();
  try {
    const mod = await import('../db/api-keys.js');
    mod.deleteApiKey();
    return { success: true };
  } catch (err) {
    console.error('Failed to delete API key:', err);
    return { error: 'Failed to delete API key' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Code mode actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get repositories accessible to the authenticated user.
 * @returns {Promise<{full_name: string, default_branch: string}[]>}
 */
export async function getRepositories() {
  await requireAuth();
  try {
    const { listRepositories } = await import('../tools/github.js');
    return await listRepositories();
  } catch (err) {
    console.error('Failed to get repositories:', err);
    return [];
  }
}

/**
 * Get branches for a repository.
 * @param {string} repoFullName - e.g. "owner/repo"
 * @returns {Promise<{name: string, isDefault: boolean}[]>}
 */
export async function getBranches(repoFullName) {
  await requireAuth();
  try {
    const { listBranches } = await import('../tools/github.js');
    return await listBranches(repoFullName);
  } catch (err) {
    console.error('Failed to get branches:', err);
    return [];
  }
}

/**
 * Get full chat data with optional workspace (left join).
 * @param {string} chatId
 * @returns {Promise<object|null>}
 */
export async function getChatData(chatId) {
  const user = await requireAuth();
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/index.js');
  const { chats, codeWorkspaces } = await import('../db/schema.js');
  const db = getDb();
  const row = db
    .select()
    .from(chats)
    .leftJoin(codeWorkspaces, eq(chats.codeWorkspaceId, codeWorkspaces.id))
    .where(eq(chats.id, chatId))
    .get();
  if (!row) return null;
  const chat = row.chats;
  if (chat.userId !== user.id && chat.userId !== 'telegram') return null;
  const ws = row.code_workspaces;
  return {
    ...chat,
    workspace: ws?.id ? ws : null,
  };
}

/**
 * Get full chat data by workspace ID (left join).
 * @param {string} workspaceId
 * @returns {Promise<object|null>}
 */
export async function getChatDataByWorkspace(workspaceId) {
  const user = await requireAuth();
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/index.js');
  const { chats, codeWorkspaces } = await import('../db/schema.js');
  const db = getDb();
  const row = db
    .select()
    .from(chats)
    .leftJoin(codeWorkspaces, eq(chats.codeWorkspaceId, codeWorkspaces.id))
    .where(eq(chats.codeWorkspaceId, workspaceId))
    .get();
  if (!row) return null;
  const chat = row.chats;
  if (chat.userId !== user.id && chat.userId !== 'telegram') return null;
  const ws = row.code_workspaces;
  return {
    chatId: chat.id,
    ...chat,
    workspace: ws?.id ? ws : null,
  };
}

/**
 * Create a code workspace (DB row + initial feature branch) for a new chat.
 * Called client-side before the stream fires so the workspace ID is available immediately.
 * @param {string} repo - e.g. "owner/repo"
 * @param {string} branch - e.g. "main"
 * @returns {Promise<{id: string, repo: string, branch: string, featureBranch: string, containerName: null}>}
 */
export async function createChatWorkspace(repo, branch) {
  const user = await requireAuth();
  const { createCodeWorkspace, updateFeatureBranch } = await import('../db/code-workspaces.js');
  const workspace = createCodeWorkspace(user.id, { repo, branch });
  const shortId = workspace.id.replace(/-/g, '').slice(0, 8);
  const featureBranch = `23wf/new-chat-${shortId}`;
  updateFeatureBranch(workspace.id, featureBranch);
  return {
    id: workspace.id,
    repo: workspace.repo,
    branch: workspace.branch,
    featureBranch,
    containerName: null,
  };
}

/**
 * Get workspace details by ID.
 * @param {string} workspaceId
 * @returns {Promise<{id: string, repo: string, branch: string, containerName: string|null}|null>}
 */
export async function getWorkspace(workspaceId) {
  await requireAuth();
  try {
    const { getCodeWorkspaceById } = await import('../db/code-workspaces.js');
    const ws = getCodeWorkspaceById(workspaceId);
    if (!ws) return null;
    return { id: ws.id, repo: ws.repo, branch: ws.branch, containerName: ws.containerName, codingAgent: ws.codingAgent, featureBranch: ws.featureBranch };
  } catch (err) {
    console.error('Failed to get workspace:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pull Request actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all open pull requests from GitHub.
 * @returns {Promise<object[]>}
 */
export async function getPullRequests() {
  await requireAuth();
  try {
    const { getOpenPullRequests } = await import('../tools/github.js');
    return await getOpenPullRequests();
  } catch (err) {
    console.error('Failed to get pull requests:', err);
    return [];
  }
}

/**
 * Get the count of open pull requests.
 * @returns {Promise<number>}
 */
export async function getPullRequestCount() {
  await requireAuth();
  try {
    const { getOpenPullRequests } = await import('../tools/github.js');
    const prs = await getOpenPullRequests();
    return prs.length;
  } catch (err) {
    console.error('Failed to get pull request count:', err);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Runners actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get runners status (active + completed jobs with counts).
 * @returns {Promise<object>}
 */
export async function getRunnersStatus(page = 1) {
  await requireAuth();
  try {
    const { getRunnersStatus: fetchStatus } = await import('../tools/github.js');
    return await fetchStatus(page);
  } catch (err) {
    console.error('Failed to get runners status:', err);
    return { error: 'Failed to get runners status', runs: [], hasMore: false };
  }
}

/**
 * Get runners config (crons + triggers).
 * @returns {Promise<{ crons: object[], triggers: object[] }>}
 */
export async function getRunnersConfig() {
  await requireAuth();
  const { cronsFile, triggersFile } = await import('../paths.js');
  const fs = await import('fs');
  let crons = [];
  let triggers = [];
  try { crons = JSON.parse(fs.readFileSync(cronsFile, 'utf8')); } catch {}
  try { triggers = JSON.parse(fs.readFileSync(triggersFile, 'utf8')); } catch {}
  return { crons, triggers };
}

// ── MCP Servers ──────────────────────────────────────────

export async function getMCPServers() {
  await requireAuth();
  const { scanMCPServers } = await import('../ai/mcp-bridge.js');
  const { mcpServersConfig } = await import('../paths.js');
  const fs = await import('fs');

  const available = scanMCPServers();
  let activeConfig = { active_servers: [] };
  try {
    if (fs.existsSync(mcpServersConfig)) {
      activeConfig = JSON.parse(fs.readFileSync(mcpServersConfig, 'utf8'));
    }
  } catch {}

  return available.map((server) => {
    const envKeys = server.manifest.env ? Object.keys(server.manifest.env) : [];
    const envStatus = {};
    for (const key of envKeys) {
      const ref = server.manifest.env[key];
      if (typeof ref === 'string' && ref.startsWith('${') && ref.endsWith('}')) {
        const varName = ref.slice(2, -1);
        envStatus[key] = !!process.env[varName];
      } else {
        envStatus[key] = true;
      }
    }
    return {
      name: server.name,
      description: server.description,
      transport: server.manifest.transport || 'stdio',
      active: (activeConfig.active_servers || []).includes(server.name),
      env: envKeys,
      envStatus,
    };
  });
}

export async function toggleMCPServer(name, active) {
  await requireAuth();
  const { mcpServersConfig } = await import('../paths.js');
  const fs = await import('fs');
  const path = await import('path');

  let config = { active_servers: [] };
  try {
    if (fs.existsSync(mcpServersConfig)) {
      config = JSON.parse(fs.readFileSync(mcpServersConfig, 'utf8'));
    }
  } catch {}

  const servers = new Set(config.active_servers || []);
  if (active) {
    servers.add(name);
  } else {
    servers.delete(name);
  }

  config.active_servers = [...servers];
  fs.mkdirSync(path.dirname(mcpServersConfig), { recursive: true });
  fs.writeFileSync(mcpServersConfig, JSON.stringify(config, null, 2) + '\n', 'utf8');

  // Reset the chat agent so it picks up the new config
  try {
    const { resetAgent } = await import('../ai/agent.js');
    resetAgent();
  } catch {}

  return { success: true };
}

export async function createMCPServer({ name, description, command, args, env }) {
  await requireAuth();
  const { mcpServersDir } = await import('../paths.js');
  const fs = await import('fs');
  const path = await import('path');

  // Validate name (alphanumeric + hyphens only)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    return { error: 'Name must be lowercase alphanumeric with hyphens (e.g. "my-server")' };
  }

  const serverDir = path.join(mcpServersDir, name);
  if (fs.existsSync(serverDir)) {
    return { error: `Server "${name}" already exists` };
  }

  // Build manifest
  const manifest = {
    name,
    description: description || '',
    transport: 'stdio',
    command: command || 'node',
    args: args || ['server.js'],
  };
  if (env && Object.keys(env).length > 0) {
    manifest.env = env;
  }

  // Create directory + files
  fs.mkdirSync(serverDir, { recursive: true });
  fs.writeFileSync(
    path.join(serverDir, 'MCP_SERVER.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );

  // Starter server.js template
  const serverJs = `import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: '${name}', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: '${name}_hello',
      description: 'A sample tool — replace with your own',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input value' },
        },
        required: ['input'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name: toolName, arguments: args } = request.params;

  if (toolName === '${name}_hello') {
    return {
      content: [{ type: 'text', text: \`Hello from ${name}! You said: \${args.input}\` }],
    };
  }

  return { content: [{ type: 'text', text: \`Unknown tool: \${toolName}\` }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);
`;

  fs.writeFileSync(path.join(serverDir, 'server.js'), serverJs, 'utf8');

  // package.json
  const pkg = {
    name: `mcp-server-${name}`,
    version: '1.0.0',
    type: 'module',
    dependencies: {
      '@modelcontextprotocol/sdk': '^1.0.0',
    },
  };
  fs.writeFileSync(path.join(serverDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  return { success: true };
}

// ── Model Inventory ──────────────────────────────────────

/**
 * Get model inventory — all configured LLM models across env, crons, and triggers.
 * @returns {Promise<object>}
 */
export async function getModelInventory() {
  await requireAuth();
  const { cronsFile, triggersFile } = await import('../paths.js');
  const fs = await import('fs');

  // 1. Event handler config (from env)
  const provider = process.env.LLM_PROVIDER || 'anthropic';
  const defaultModels = {
    anthropic: 'claude-sonnet-4-20250514',
    openai: 'gpt-4o',
    google: 'gemini-2.5-pro',
  };
  const model = process.env.LLM_MODEL || defaultModels[provider] || defaultModels.anthropic;
  const maxTokens = Number(process.env.LLM_MAX_TOKENS) || 4096;

  const eventHandler = {
    provider,
    model,
    maxTokens,
    hasApiKey: !!(
      (provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) ||
      (provider === 'openai' && process.env.OPENAI_API_KEY) ||
      (provider === 'google' && process.env.GOOGLE_API_KEY) ||
      (provider === 'custom' && (process.env.CUSTOM_API_KEY || process.env.OPENAI_BASE_URL))
    ),
    baseUrl: process.env.OPENAI_BASE_URL || null,
  };

  // 2. Cron overrides
  let crons = [];
  try { crons = JSON.parse(fs.readFileSync(cronsFile, 'utf8')); } catch {}
  const cronOverrides = crons
    .filter((c) => c.llm_provider || c.llm_model)
    .map((c) => ({
      name: c.name,
      provider: c.llm_provider || null,
      model: c.llm_model || null,
      enabled: c.enabled !== false,
      source: 'cron',
    }));

  // 3. Trigger overrides
  let triggers = [];
  try { triggers = JSON.parse(fs.readFileSync(triggersFile, 'utf8')); } catch {}
  const triggerOverrides = [];
  for (const trigger of triggers) {
    if (!trigger.actions) continue;
    for (const action of trigger.actions) {
      if (action.llm_provider || action.llm_model) {
        triggerOverrides.push({
          name: `${trigger.name} > ${action.type || 'agent'}`,
          provider: action.llm_provider || null,
          model: action.llm_model || null,
          enabled: trigger.enabled !== false,
          source: 'trigger',
        });
      }
    }
  }

  // 4. Collect all unique models
  const allModels = new Set();
  allModels.add(`${provider}/${model}`);
  for (const o of [...cronOverrides, ...triggerOverrides]) {
    const p = o.provider || provider;
    const m = o.model || defaultModels[p] || model;
    allModels.add(`${p}/${m}`);
  }

  return {
    eventHandler,
    cronOverrides,
    triggerOverrides,
    defaultModels,
    uniqueModels: [...allModels],
  };
}

export async function deleteMCPServer(name) {
  await requireAuth();
  const { mcpServersDir, mcpServersConfig } = await import('../paths.js');
  const fs = await import('fs');
  const path = await import('path');

  // Remove from active config
  try {
    if (fs.existsSync(mcpServersConfig)) {
      const config = JSON.parse(fs.readFileSync(mcpServersConfig, 'utf8'));
      config.active_servers = (config.active_servers || []).filter((s) => s !== name);
      fs.writeFileSync(mcpServersConfig, JSON.stringify(config, null, 2) + '\n', 'utf8');
    }
  } catch {}

  // Remove directory
  const serverDir = path.join(mcpServersDir, name);
  if (fs.existsSync(serverDir)) {
    fs.rmSync(serverDir, { recursive: true, force: true });
  }

  // Reset agent
  try {
    const { resetAgent } = await import('../ai/agent.js');
    resetAgent();
  } catch {}

  return { success: true };
}

// ── Public Skills Management ──

export async function getPublicSkillsList() {
  await requireAuth();
  const { readdirSync, readFileSync, existsSync, statSync } = await import('fs');
  const { resolve } = await import('path');

  const skillsDir = resolve(process.cwd(), 'skills');
  if (!existsSync(skillsDir)) return [];

  const entries = readdirSync(skillsDir);
  const skills = [];

  for (const entry of entries) {
    if (entry === 'active') continue;
    const entryPath = resolve(skillsDir, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    const skillMdPath = resolve(entryPath, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    const content = readFileSync(skillMdPath, 'utf-8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;

    const meta = {};
    for (const line of fmMatch[1].split('\n')) {
      const m = line.match(/^(\w+):\s*"?(.+?)"?\s*$/);
      if (m) {
        const val = m[2];
        meta[m[1]] = val === 'true' ? true : val === 'false' ? false : val;
      }
    }

    const hasTree = existsSync(resolve(entryPath, 'conversation-tree.json'));
    const hasConfig = existsSync(resolve(entryPath, 'public-config.json'));
    let config = {};
    if (hasConfig) {
      try { config = JSON.parse(readFileSync(resolve(entryPath, 'public-config.json'), 'utf-8')); } catch {}
    }

    skills.push({
      skillId: entry,
      name: meta.name || entry,
      description: meta.description || '',
      isPublic: !!meta.public,
      hasTree,
      hasConfig,
      title: config.title || '',
      accent: config.accent || '#4361ee',
    });
  }

  return skills;
}

export async function toggleSkillPublic(skillId, makePublic) {
  await requireAuth();
  const { readFileSync, writeFileSync, existsSync } = await import('fs');
  const { resolve } = await import('path');

  const skillMdPath = resolve(process.cwd(), 'skills', skillId, 'SKILL.md');
  if (!existsSync(skillMdPath)) return { error: 'Skill not found' };

  let content = readFileSync(skillMdPath, 'utf-8');

  if (makePublic) {
    // Add public: true before the closing ---
    if (!content.includes('public:')) {
      content = content.replace(/\n---/, '\npublic: true\n---');
    } else {
      content = content.replace(/public:\s*false/, 'public: true');
    }
  } else {
    content = content.replace(/public:\s*true/, 'public: false');
  }

  writeFileSync(skillMdPath, content, 'utf-8');
  return { success: true };
}
