'use server';

import { loadTemplates, getTemplate } from './templates.js';
import { resolveInputs, validateInputs, buildTeamName } from './resolver.js';
import { humanToCron } from './schedule.js';
import {
  createCluster,
  getCluster,
  getClusters,
  renameCluster,
  toggleCluster,
  deleteCluster,
  createClusterRoleAction,
  updateClusterRoleAction,
  triggerRoleManually,
  getClusterStatus,
  getClusterLogs,
} from '../../Clusters/lib/cluster/actions.js';

// ── Templates ──────────────────────────────────────────

export async function getTemplates() {
  return loadTemplates();
}

export async function getTemplateById(id) {
  return getTemplate(id);
}

// ── Template Matching (LLM) ────────────────────────────

export async function matchTemplate(userDescription) {
  const { routeTask } = await import('./router.js');
  return routeTask(userDescription);
}

// ── Team Creation (Wizard) ─────────────────────────────

/**
 * Create a team from a template with user inputs.
 *
 * @param {string} templateId - Template to deploy
 * @param {object} userInputs - User's form values keyed by input.id
 * @param {object} schedule - Schedule selection { preset, hour?, minute?, dayOfWeek?, dayOfMonth?, customCron? }
 * @returns {{ success: boolean, teamId?: string, error?: string }}
 */
export async function createTeamFromTemplate(templateId, userInputs, schedule, options = {}) {
  try {
    const template = await getTemplate(templateId);
    if (!template) {
      return { success: false, error: 'Template not found' };
    }

    // Validate inputs
    const { valid, errors } = validateInputs(template.inputs, userInputs);
    if (!valid) {
      return { success: false, error: errors.join(', ') };
    }

    // Resolve template variables
    const resolved = resolveInputs(template, userInputs);

    // Create the cluster
    const teamName = buildTeamName(template, userInputs);
    const cluster = await createCluster(teamName);
    if (!cluster) {
      return { success: false, error: 'Failed to create team' };
    }

    // Update system prompt
    const { updateClusterSystemPrompt } = await import('../../Clusters/lib/cluster/actions.js');
    await updateClusterSystemPrompt(cluster.id, resolved.systemPrompt);

    // Update folders
    if (resolved.folders?.length) {
      const { updateClusterFolders } = await import('../../Clusters/lib/cluster/actions.js');
      await updateClusterFolders(cluster.id, resolved.folders);
    }

    // Create roles
    const roleIds = [];
    for (const roleDef of resolved.roles) {
      let triggerConfig = {};
      if (schedule?.preset && schedule.preset !== 'now') {
        const { cron } = humanToCron(schedule);
        if (cron) {
          triggerConfig.cron = { enabled: true, schedule: cron };
        }
      }
      if (options.requiresApproval) {
        triggerConfig.requiresApproval = true;
      }

      const roleResult = await createClusterRoleAction(cluster.id, roleDef.roleName, roleDef.role);
      if (roleResult?.success && roleResult.role) {
        const roleId = roleResult.role.id;
        const hasConfig = Object.keys(triggerConfig).length > 0;
        await updateClusterRoleAction(roleId, {
          prompt: roleDef.prompt,
          maxConcurrency: roleDef.maxConcurrency || 1,
          triggerConfig: hasConfig ? JSON.stringify(triggerConfig) : null,
        });
        roleIds.push({ id: roleId, dependsOn: roleDef.dependsOn, roleName: roleDef.roleName });
      }
    }

    // If "run now", trigger the first role(s) (those with no dependencies)
    if (!schedule?.preset || schedule.preset === 'now') {
      for (const role of roleIds) {
        if (!role.dependsOn) {
          await triggerRoleManually(role.id);
        }
      }
    }

    // Enable the cluster
    await toggleCluster(cluster.id);

    return { success: true, teamId: cluster.id };
  } catch (err) {
    console.error('createTeamFromTemplate error:', err);
    return { success: false, error: err.message };
  }
}

// ── AI Team Suggestions ───────────────────────────────

/**
 * Use LLM to suggest team members based on a task description.
 *
 * @param {string} taskDescription - What the team should do
 * @returns {{ success: boolean, teamName?: string, members?: Array<{ name, role, description, tools }> }}
 */
export async function suggestTeamMembers(taskDescription) {
  try {
    const { createModel } = await import('../../Clusters/lib/ai/model.js');
    const { z } = await import('zod');

    const model = await createModel({ maxTokens: 1024 });

    const availableTools = [
      { id: 'brave-search', name: 'Web Search', desc: 'Search the web and extract content from pages' },
      { id: 'browser-tools', name: 'Browser', desc: 'Navigate websites, fill forms, take screenshots' },
      { id: 'youtube-transcript', name: 'YouTube', desc: 'Fetch and analyze YouTube video transcripts' },
      { id: 'notebooklm', name: 'NotebookLM', desc: 'Research synthesis, generate reports, podcasts, and summaries from sources' },
      { id: 'sop-generator', name: 'SOP Generator', desc: 'Create branded Standard Operating Procedure documents' },
      { id: 'slack', name: 'Slack', desc: 'Send messages and updates to Slack channels' },
    ];

    const schema = z.object({
      teamName: z.string().describe('A short, descriptive name for this team (2-4 words)'),
      members: z.array(z.object({
        name: z.string().describe('Role name like Researcher, Writer, Analyst, etc.'),
        role: z.string().describe('One sentence describing what this member does'),
        description: z.string().describe('2-3 sentences explaining WHY this member is needed for the task and what specific value they bring to the team'),
        tools: z.array(z.string().describe('Tool ID from the available tools list (e.g., brave-search, browser-tools, youtube-transcript, notebooklm, sop-generator, slack)')).describe('Tool IDs this member should use'),
      })).describe('The team members needed, in execution order'),
    });

    const toolList = availableTools.map(t => `- ${t.id}: ${t.name} — ${t.desc}`).join('\n');

    const response = await model.withStructuredOutput(schema).invoke([
      ['system', `You are a team designer. Given a task description, suggest the ideal team of AI agents to accomplish it.

Available tools that members can use:
${toolList}

Rules:
- Suggest 2-4 members (keep it simple)
- Members run sequentially — each one builds on the previous one's work
- First member should gather/research, middle members should process/analyze, last member should produce the final output
- Role names should be simple and descriptive (e.g., Researcher, Writer, Analyst, Editor, Scanner)
- Role descriptions should be one clear sentence about what they do
- The description field should explain WHY this member is part of the team and what specific value they add
- Assign 1-3 relevant tools to each member based on what they need to do their job
- Team name should be short and task-relevant (e.g., "Market Research Team", "Blog Content Team")`],
      ['human', taskDescription],
    ]);

    return {
      success: true,
      teamName: response.teamName,
      members: response.members,
      availableTools,
    };
  } catch (err) {
    console.error('suggestTeamMembers error:', err?.message || err);
    return { success: false, teamName: '', members: [], error: err?.message };
  }
}

// ── Custom Team Creation (No Template) ────────────────

/**
 * Create a custom team from scratch — user defines name, task, and members.
 *
 * @param {object} config
 * @param {string} config.name - Team name
 * @param {string} config.task - What the team should do
 * @param {Array<{ name: string, role: string }>} config.members - Team members
 * @param {object} schedule - Schedule selection
 * @returns {{ success: boolean, teamId?: string, error?: string }}
 */
export async function createCustomTeam(config, schedule) {
  try {
    if (!config.name?.trim()) return { success: false, error: 'Team name is required' };
    if (!config.task?.trim()) return { success: false, error: 'Task description is required' };
    if (!config.members?.length) return { success: false, error: 'At least one team member is required' };

    // Create the cluster
    const cluster = await createCluster(config.name.trim());
    if (!cluster) return { success: false, error: 'Failed to create team' };

    // Set system prompt from the task description
    const systemPrompt = `You are a team working on the following task: ${config.task}. Your shared workspace is at {{CLUSTER_SHARED_DIR}}. Collaborate effectively and save all output to the shared workspace.`;
    const { updateClusterSystemPrompt } = await import('../../Clusters/lib/cluster/actions.js');
    await updateClusterSystemPrompt(cluster.id, systemPrompt);

    // Create roles from members
    const roleIds = [];
    let prevRoleName = null;
    for (const member of config.members) {
      let triggerConfig = {};
      if (schedule?.preset && schedule.preset !== 'now') {
        const { cron } = humanToCron(schedule);
        if (cron) triggerConfig.cron = { enabled: true, schedule: cron };
      }
      if (config.requiresApproval) {
        triggerConfig.requiresApproval = true;
      }

      const roleName = member.name.trim() || 'Worker';
      const roleDesc = member.role.trim() || `You help with: ${config.task}`;
      const prompt = `Your task: ${config.task}\n\nYour role: ${roleDesc}\n\nSave your output to {{CLUSTER_SHARED_DIR}}.`;

      const roleResult = await createClusterRoleAction(cluster.id, roleName, roleDesc);
      if (roleResult?.success && roleResult.role) {
        const roleId = roleResult.role.id;
        const mcpServers = member.tools?.length ? member.tools : null;
        const hasConfig = Object.keys(triggerConfig).length > 0;

        await updateClusterRoleAction(roleId, {
          prompt,
          maxConcurrency: 1,
          triggerConfig: hasConfig ? JSON.stringify(triggerConfig) : null,
          mcpServers: mcpServers,
        });
        roleIds.push({ id: roleId, dependsOn: prevRoleName, roleName });
        prevRoleName = roleName;
      }
    }

    // If "run now", trigger the first role(s)
    if (!schedule?.preset || schedule.preset === 'now') {
      for (const role of roleIds) {
        if (!role.dependsOn) {
          await triggerRoleManually(role.id);
        }
      }
    }

    await toggleCluster(cluster.id);
    return { success: true, teamId: cluster.id };
  } catch (err) {
    console.error('createCustomTeam error:', err);
    return { success: false, error: err.message };
  }
}

// ── Team Management ────────────────────────────────────

export async function getTeams() {
  return getClusters();
}

export async function getTeam(teamId) {
  return getCluster(teamId);
}

export async function renameTeam(teamId, name) {
  return renameCluster(teamId, name);
}

export async function deleteTeam(teamId) {
  return deleteCluster(teamId);
}

export async function pauseTeam(teamId) {
  return toggleCluster(teamId);
}

// ── Team Execution ─────────────────────────────────────

/**
 * Run a team with a new task (re-triggers first roles).
 * Creates a dated session folder (MMDD - Request) in the shared directory
 * so output files are organized by run rather than piling up.
 */
export async function runTeamTask(teamId, taskDescription) {
  try {
    const team = await getCluster(teamId);
    if (!team) return { success: false, error: 'Team not found' };
    if (!team.roles?.length) return { success: false, error: 'Team has no members' };

    // Build session folder name: MMDD - Task Description
    const sessionFolder = buildSessionFolder(taskDescription);

    // Create the session folder on disk
    const { clusterDir } = await import('../../Clusters/lib/cluster/execute.js');
    const { getClusterById } = await import('../../Clusters/lib/db/clusters.js');
    const fs = await import('fs');
    const path = await import('path');
    const cluster = getClusterById(teamId);
    if (cluster) {
      const sessionDir = path.join(clusterDir(cluster), 'shared', sessionFolder);
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    // Trigger the first role in the pipeline with the new task as the prompt,
    // directing output to the session folder
    const firstRole = team.roles[0];
    const sessionPrompt = taskDescription?.trim()
      ? `${taskDescription.trim()}\n\nIMPORTANT: Save all output files to {{CLUSTER_SHARED_DIR}}${sessionFolder}/`
      : null;
    const payload = sessionPrompt ? { prompt: sessionPrompt } : null;
    const result = await triggerRoleManually(firstRole.id, payload);
    if (result?.error) {
      return { success: false, error: result.error };
    }

    return { success: true };
  } catch (err) {
    console.error('runTeamTask error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Build a session folder name in MMDD - Request format.
 * Sanitizes the task description for use as a folder name.
 */
function buildSessionFolder(taskDescription) {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${mm}${dd}`;

  if (!taskDescription?.trim()) {
    return `${datePrefix} - Run`;
  }

  // Take first 50 chars of the task, sanitize for filesystem
  const label = taskDescription.trim()
    .substring(0, 50)
    .replace(/[/\\:*?"<>|]/g, '-')  // Remove filesystem-unsafe chars
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .trim();

  return `${datePrefix} - ${label}`;
}

/**
 * Continue the team pipeline — trigger the next role with optional feedback.
 *
 * Used by the approval UI between pipeline steps: the user reviews output
 * from the completed role, provides feedback/selection, and this triggers
 * the next role with that feedback as the prompt override.
 *
 * @param {string} teamId - Cluster ID
 * @param {string} roleId - The role to trigger (the next waiting role)
 * @param {string} [feedback] - User's feedback, selection, or instructions
 * @returns {{ success: boolean, error?: string }}
 */
export async function continueTeamPipeline(teamId, roleId, feedback) {
  try {
    const team = await getCluster(teamId);
    if (!team) return { success: false, error: 'Team not found' };

    // Verify the role belongs to this team
    const role = team.roles?.find(r => r.id === roleId);
    if (!role) return { success: false, error: 'Role not found in this team' };

    const payload = feedback?.trim()
      ? { prompt: feedback.trim() }
      : null;

    const result = await triggerRoleManually(roleId, payload);
    if (result?.error) {
      return { success: false, error: result.error };
    }

    return { success: true };
  } catch (err) {
    console.error('continueTeamPipeline error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Get output files from the shared directory (lightweight, for inline display).
 *
 * @param {string} teamId
 * @returns {{ success: boolean, files?: Array<{ name, relativePath, type }> }}
 */
export async function getTeamOutputFiles(teamId) {
  try {
    const { getTeamOutput } = await import('./output.js');
    const output = await getTeamOutput(teamId);
    return { success: true, files: output?.files || [] };
  } catch (err) {
    return { success: true, files: [] };
  }
}

// ── File Upload ────────────────────────────────────────

/**
 * Upload a file to a team's shared input directory.
 * Used by the wizard for file-type template inputs.
 *
 * @param {string} teamId - Cluster ID
 * @param {FormData} formData - Contains the file
 * @returns {{ success: boolean, filename?: string, error?: string }}
 */
export async function uploadTeamFile(teamId, formData) {
  try {
    const { auth } = await import('23wf/auth');
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return { success: false, error: 'No file provided' };
    }

    const { clusterDir } = await import('../../Clusters/lib/cluster/execute.js');
    const { getClusterById } = await import('../../Clusters/lib/db/clusters.js');
    const fs = await import('fs');
    const path = await import('path');

    const cluster = getClusterById(teamId);
    if (!cluster) return { success: false, error: 'Team not found' };

    const inputDir = path.join(clusterDir(cluster), 'shared', 'input');
    fs.mkdirSync(inputDir, { recursive: true });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filepath = path.join(inputDir, filename);

    fs.writeFileSync(filepath, buffer);

    return { success: true, filename };
  } catch (err) {
    console.error('uploadTeamFile error:', err);
    return { success: false, error: err.message };
  }
}

// ── Team Status ────────────────────────────────────────

export async function getTeamStatus(teamId) {
  return getClusterStatus(teamId);
}

export async function getTeamLogs(teamId) {
  return getClusterLogs(teamId);
}

// ── Tool Management ───────────────────────────────────

/**
 * Get all available tools (built-in skills + installed MCP servers).
 * Unified view for the wizard tool picker.
 */
export async function getAvailableTools() {
  try {
    const { scanMCPServers } = await import('../../Clusters/lib/ai/mcp-bridge.js');
    const { mcpServersConfig } = await import('../../Clusters/lib/paths.js');
    const fs = await import('fs');

    // Built-in tools (always available)
    const builtIn = [
      { id: 'brave-search', name: 'Web Search', desc: 'Search the web and extract content from pages', type: 'builtin' },
      { id: 'browser-tools', name: 'Browser', desc: 'Navigate websites, fill forms, take screenshots', type: 'builtin' },
      { id: 'youtube-transcript', name: 'YouTube', desc: 'Fetch and analyze YouTube video transcripts', type: 'builtin' },
      { id: 'notebooklm', name: 'NotebookLM', desc: 'Research synthesis, generate reports, podcasts, and summaries from sources', type: 'builtin' },
      { id: 'sop-generator', name: 'SOP Generator', desc: 'Create branded Standard Operating Procedure documents', type: 'builtin' },
      { id: 'slack', name: 'Slack', desc: 'Send messages and updates to Slack channels', type: 'builtin' },
    ];

    // Installed MCP servers
    const mcpServers = scanMCPServers();
    let activeConfig = { active_servers: [] };
    try {
      if (fs.existsSync(mcpServersConfig)) {
        activeConfig = JSON.parse(fs.readFileSync(mcpServersConfig, 'utf8'));
      }
    } catch {}

    const installed = mcpServers
      .filter(s => !builtIn.some(b => b.id === s.name))
      .map(s => ({
        id: s.name,
        name: s.description || s.name,
        desc: s.description || `MCP server: ${s.name}`,
        type: 'mcp',
        active: (activeConfig.active_servers || []).includes(s.name),
      }));

    return { success: true, tools: [...builtIn, ...installed] };
  } catch (err) {
    console.error('getAvailableTools error:', err);
    return { success: true, tools: [] };
  }
}

/**
 * Use LLM to search for relevant MCP servers / tools for a given need.
 *
 * @param {string} query - What kind of tool the user needs
 * @returns {{ success: boolean, results: Array<{ name, description, repo, installCommand }> }}
 */
export async function searchToolsOnline(query) {
  try {
    const { createModel } = await import('../../Clusters/lib/ai/model.js');
    const { z } = await import('zod');

    const model = await createModel({ maxTokens: 1024 });

    const schema = z.object({
      results: z.array(z.object({
        name: z.string().describe('Short name for the tool (kebab-case)'),
        displayName: z.string().describe('Human-readable tool name'),
        description: z.string().describe('What this tool does (1-2 sentences)'),
        repo: z.string().describe('GitHub repository URL or npm package name if known, otherwise empty string'),
        npmPackage: z.string().describe('npm package name if this is an npm MCP server, otherwise empty string'),
        setupNotes: z.string().describe('Any API keys or configuration required'),
      })).describe('Relevant tool suggestions'),
    });

    const response = await model.withStructuredOutput(schema).invoke([
      ['system', `You are a tool discovery assistant for an AI agent platform that uses MCP (Model Context Protocol) servers.

Given a user's tool need, suggest 3-5 relevant MCP servers or API integrations they could install.

Focus on:
- Well-known MCP servers from the modelcontextprotocol GitHub org (e.g., @modelcontextprotocol/server-github, @modelcontextprotocol/server-slack, @modelcontextprotocol/server-filesystem)
- Popular community MCP servers on npm (prefix: mcp-server-* or @mcp/*)
- If no known MCP server exists, suggest how to build one from a well-known API

For each result, include:
- The npm package name if it exists (check common naming: @modelcontextprotocol/server-*, mcp-server-*)
- The GitHub repo URL if known
- What API keys or setup is needed
- Keep descriptions concise and practical`],
      ['human', query],
    ]);

    return { success: true, results: response.results };
  } catch (err) {
    console.error('searchToolsOnline error:', err);
    return { success: false, results: [], error: err.message };
  }
}

/**
 * Install an MCP tool from an npm package.
 *
 * @param {object} config
 * @param {string} config.name - Server name (kebab-case)
 * @param {string} config.description - Human-readable description
 * @param {string} config.npmPackage - npm package to install (e.g., "@modelcontextprotocol/server-github")
 * @param {object} [config.env] - Environment variables needed (e.g., { "GITHUB_TOKEN": "${GITHUB_TOKEN}" })
 * @returns {{ success: boolean, error?: string }}
 */
export async function installMCPFromPackage(config) {
  try {
    const { auth } = await import('23wf/auth');
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const { mcpServersDir, mcpServersConfig } = await import('../../Clusters/lib/paths.js');
    const fs = await import('fs');
    const path = await import('path');
    const { execSync } = await import('child_process');

    const name = config.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      return { success: false, error: 'Name must be lowercase alphanumeric with hyphens' };
    }

    const serverDir = path.join(mcpServersDir, name);
    if (fs.existsSync(serverDir)) {
      return { success: false, error: `Tool "${name}" already exists` };
    }

    // Create the server directory and install the package
    fs.mkdirSync(serverDir, { recursive: true });

    // Write package.json
    const pkg = {
      name: `mcp-server-${name}`,
      version: '1.0.0',
      type: 'module',
      dependencies: {
        [config.npmPackage]: 'latest',
      },
    };
    fs.writeFileSync(path.join(serverDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');

    // Install dependencies
    try {
      execSync('npm install', { cwd: serverDir, stdio: 'pipe', timeout: 60000 });
    } catch (installErr) {
      // Clean up on failure
      fs.rmSync(serverDir, { recursive: true, force: true });
      return { success: false, error: `Failed to install package: ${installErr.message}` };
    }

    // Write MCP_SERVER.json manifest
    const manifest = {
      name,
      description: config.description || '',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', config.npmPackage],
    };
    if (config.env && Object.keys(config.env).length > 0) {
      manifest.env = config.env;
    }
    fs.writeFileSync(path.join(serverDir, 'MCP_SERVER.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    // Auto-activate the server
    let activeConfigData = { active_servers: [] };
    try {
      if (fs.existsSync(mcpServersConfig)) {
        activeConfigData = JSON.parse(fs.readFileSync(mcpServersConfig, 'utf8'));
      }
    } catch {}
    const servers = new Set(activeConfigData.active_servers || []);
    servers.add(name);
    activeConfigData.active_servers = [...servers];
    fs.mkdirSync(path.dirname(mcpServersConfig), { recursive: true });
    fs.writeFileSync(mcpServersConfig, JSON.stringify(activeConfigData, null, 2) + '\n', 'utf8');

    // Reset agent to pick up new server
    try {
      const { resetAgent } = await import('../../Clusters/lib/ai/agent.js');
      resetAgent();
    } catch {}

    return { success: true, toolId: name };
  } catch (err) {
    console.error('installMCPFromPackage error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Install an MCP tool from a custom URL (API endpoint or SSE server).
 *
 * @param {object} config
 * @param {string} config.name - Server name (kebab-case)
 * @param {string} config.description - What this server does
 * @param {string} config.url - SSE endpoint URL for the MCP server
 * @param {object} [config.headers] - Custom headers (e.g., auth)
 * @returns {{ success: boolean, error?: string }}
 */
export async function installMCPFromUrl(config) {
  try {
    const { auth } = await import('23wf/auth');
    const session = await auth();
    if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

    const { mcpServersDir, mcpServersConfig } = await import('../../Clusters/lib/paths.js');
    const fs = await import('fs');
    const path = await import('path');

    const name = config.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      return { success: false, error: 'Name must be lowercase alphanumeric with hyphens' };
    }

    const serverDir = path.join(mcpServersDir, name);
    if (fs.existsSync(serverDir)) {
      return { success: false, error: `Tool "${name}" already exists` };
    }

    fs.mkdirSync(serverDir, { recursive: true });

    // For URL-based MCP servers, we create a proxy script that connects via SSE
    const manifest = {
      name,
      description: config.description || '',
      transport: 'sse',
      url: config.url,
    };
    if (config.headers && Object.keys(config.headers).length > 0) {
      manifest.headers = config.headers;
    }
    fs.writeFileSync(path.join(serverDir, 'MCP_SERVER.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    // Auto-activate
    let activeConfigData = { active_servers: [] };
    try {
      if (fs.existsSync(mcpServersConfig)) {
        activeConfigData = JSON.parse(fs.readFileSync(mcpServersConfig, 'utf8'));
      }
    } catch {}
    const serverSet = new Set(activeConfigData.active_servers || []);
    serverSet.add(name);
    activeConfigData.active_servers = [...serverSet];
    fs.mkdirSync(path.dirname(mcpServersConfig), { recursive: true });
    fs.writeFileSync(mcpServersConfig, JSON.stringify(activeConfigData, null, 2) + '\n', 'utf8');

    try {
      const { resetAgent } = await import('../../Clusters/lib/ai/agent.js');
      resetAgent();
    } catch {}

    return { success: true, toolId: name };
  } catch (err) {
    console.error('installMCPFromUrl error:', err);
    return { success: false, error: err.message };
  }
}
