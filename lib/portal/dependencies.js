'use server';

/**
 * Role Dependency Executor — triggers downstream roles when upstream roles complete.
 *
 * This implements the sequential execution pattern for template-based teams:
 * Researcher → Analyst → Writer (each starts when the previous finishes).
 *
 * Called by a polling mechanism on the team dashboard when container states change.
 */

import {
  getCluster,
  triggerRoleManually,
  getClusterStatus,
} from '../../Clusters/lib/cluster/actions.js';

/**
 * Check if any dependent roles should be triggered based on current container states.
 *
 * Looks at the cluster's roles, finds which ones have completed (container exited 0),
 * and triggers any roles that depend on them (via dependsOn field in role metadata).
 *
 * @param {string} teamId - Cluster ID
 * @param {string} completedRoleName - The roleName of the role that just completed
 * @returns {{ triggered: string[] }} - List of role names that were triggered
 */
export async function triggerDependentRoles(teamId, completedRoleName) {
  try {
    const team = await getCluster(teamId);
    if (!team || !team.roles) return { triggered: [] };

    const status = await getClusterStatus(teamId);
    const triggered = [];

    for (const role of team.roles) {
      // Check if this role depends on the completed role
      // dependsOn could be stored in the role's prompt or in a metadata field
      // For now, we check the role instruction text for the pattern
      const dependsOn = extractDependsOn(role);

      if (dependsOn === completedRoleName) {
        // Check if this role is already running
        const roleStatus = status?.[role.id];
        if (roleStatus?.running > 0) continue;

        // Trigger it
        await triggerRoleManually(role.id);
        triggered.push(role.roleName);
      }
    }

    return { triggered };
  } catch (err) {
    console.error('triggerDependentRoles error:', err);
    return { triggered: [] };
  }
}

/**
 * Check the entire dependency chain and trigger any roles that are ready.
 *
 * A role is "ready" if:
 * 1. It has a dependsOn that has completed
 * 2. It is not already running
 * 3. It has not already completed
 *
 * @param {string} teamId
 * @returns {{ triggered: string[] }}
 */
export async function checkAndTriggerReady(teamId) {
  try {
    const team = await getCluster(teamId);
    if (!team || !team.roles) return { triggered: [] };

    const status = await getClusterStatus(teamId);
    const triggered = [];

    // Build a map of role status
    const roleMap = {};
    for (const role of team.roles) {
      const st = status?.[role.id];
      roleMap[role.roleName] = {
        role,
        running: st?.running || 0,
        max: st?.max || 1,
      };
    }

    // For each role, check if its dependency is met
    for (const role of team.roles) {
      const dependsOn = extractDependsOn(role);
      if (!dependsOn) continue;

      const roleStatus = roleMap[role.roleName];
      if (roleStatus.running > 0) continue; // Already running

      const depStatus = roleMap[dependsOn];
      if (!depStatus) continue;

      // If the dependency has no running containers (and it was started before),
      // we assume it completed. Trigger the dependent role.
      if (depStatus.running === 0) {
        await triggerRoleManually(role.id);
        triggered.push(role.roleName);
      }
    }

    return { triggered };
  } catch (err) {
    console.error('checkAndTriggerReady error:', err);
    return { triggered: [] };
  }
}

/**
 * Extract the dependsOn value from a role.
 *
 * Templates store dependsOn in the role definition, but since the Clusters DB
 * doesn't have a native dependsOn column, we look for it in:
 * 1. role.dependsOn (if the template resolver preserved it)
 * 2. A pattern in the role instructions mentioning "after {RoleName}"
 *
 * Note: For v1, this is best-effort. A proper dependsOn column would be ideal.
 */
function extractDependsOn(role) {
  // Direct field (if stored as custom metadata)
  if (role.dependsOn) return role.dependsOn;

  // Check triggerConfig for custom dependsOn field
  const config = typeof role.triggerConfig === 'string'
    ? JSON.parse(role.triggerConfig)
    : role.triggerConfig;

  if (config?.dependsOn) return config.dependsOn;

  return null;
}
