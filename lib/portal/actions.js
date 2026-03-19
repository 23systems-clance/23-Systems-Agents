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
export async function createTeamFromTemplate(templateId, userInputs, schedule) {
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
      // Build trigger config based on schedule
      let triggerConfig = null;
      if (schedule?.preset && schedule.preset !== 'now') {
        const { cron } = humanToCron(schedule);
        if (cron) {
          triggerConfig = { cron: { enabled: true, schedule: cron } };
        }
      }

      const roleId = await createClusterRoleAction(cluster.id, roleDef.roleName, roleDef.role);
      if (roleId) {
        // Update role with prompt, concurrency, and trigger config
        await updateClusterRoleAction(roleId, {
          prompt: roleDef.prompt,
          maxConcurrency: roleDef.maxConcurrency || 1,
          triggerConfig: triggerConfig ? JSON.stringify(triggerConfig) : null,
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
 */
export async function runTeamTask(teamId, taskDescription) {
  try {
    const team = await getCluster(teamId);
    if (!team) return { success: false, error: 'Team not found' };

    // Update the first role's prompt with the new task
    const firstRoles = team.roles.filter(r => {
      // Find roles with no dependsOn — they start first
      const roleDef = team.roles.find(other => other.roleName === r.roleName);
      return !roleDef?.dependsOn;
    });

    // Trigger the first role(s)
    for (const role of firstRoles) {
      await triggerRoleManually(role.id);
    }

    return { success: true };
  } catch (err) {
    console.error('runTeamTask error:', err);
    return { success: false, error: err.message };
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
    const { auth } = await import('thepopebot/auth');
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
