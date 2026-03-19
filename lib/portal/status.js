/**
 * Status Translator — converts container states to plain English.
 *
 * Translates Docker container states and cluster role states
 * into user-friendly language for the End User Portal.
 */

/**
 * Translate a single container's state to plain English.
 *
 * @param {object} container - Container info from Docker
 * @param {string} container.state - 'running', 'exited', 'created', 'dead', etc.
 * @param {number} [container.exitCode] - Exit code if exited
 * @param {string} [container.startedAt] - ISO timestamp
 * @param {object} [role] - Role definition with dependsOn info
 * @returns {{ status: string, label: string, detail: string, icon: string }}
 */
export function translateContainerState(container, role) {
  if (!container) {
    if (role?.dependsOn) {
      return {
        status: 'waiting',
        label: `Waiting for ${role.dependsOn}`,
        detail: `Will start after ${role.dependsOn} finishes`,
        icon: 'clock',
      };
    }
    return {
      status: 'idle',
      label: 'Ready',
      detail: 'Not running',
      icon: 'circle',
    };
  }

  switch (container.state) {
    case 'created':
      return {
        status: 'starting',
        label: 'Starting up...',
        detail: 'Container is being prepared',
        icon: 'loader',
      };

    case 'running': {
      const elapsed = container.startedAt
        ? formatElapsed(new Date(container.startedAt))
        : '';
      return {
        status: 'working',
        label: 'Working...',
        detail: elapsed ? `Started ${elapsed} ago` : 'In progress',
        icon: 'activity',
      };
    }

    case 'exited':
      if (container.exitCode === 0) {
        return {
          status: 'done',
          label: 'Done',
          detail: container.finishedAt
            ? `Completed ${formatElapsed(new Date(container.finishedAt))} ago`
            : 'Completed',
          icon: 'check',
        };
      }
      return {
        status: 'failed',
        label: 'Failed',
        detail: translateExitCode(container.exitCode),
        icon: 'x',
      };

    case 'dead':
      return {
        status: 'failed',
        label: 'Failed',
        detail: 'Container stopped unexpectedly',
        icon: 'x',
      };

    case 'paused':
      return {
        status: 'paused',
        label: 'Paused',
        detail: 'Container is paused',
        icon: 'pause',
      };

    default:
      return {
        status: 'unknown',
        label: container.state || 'Unknown',
        detail: '',
        icon: 'help',
      };
  }
}

/**
 * Translate the overall state of a cluster (all roles + containers).
 *
 * @param {Array} roles - Role definitions from the cluster
 * @param {object} containersByRole - Map of roleId → container[] from Docker
 * @returns {{ overall: string, label: string, progress: string, roles: Array }}
 */
export function translateClusterState(roles, containersByRole) {
  const roleStates = roles.map(role => {
    const containers = containersByRole[role.id] || [];
    const latestContainer = containers[0] || null;
    const state = translateContainerState(latestContainer, role);

    return {
      roleId: role.id,
      roleName: role.roleName,
      ...state,
    };
  });

  const working = roleStates.filter(r => r.status === 'working' || r.status === 'starting');
  const done = roleStates.filter(r => r.status === 'done');
  const failed = roleStates.filter(r => r.status === 'failed');
  const waiting = roleStates.filter(r => r.status === 'waiting');
  const total = roleStates.length;

  let overall, label;

  if (failed.length > 0) {
    overall = 'failed';
    label = `Failed — ${failed[0].roleName} encountered an error`;
  } else if (working.length > 0) {
    overall = 'working';
    const workingNames = working.map(r => r.roleName).join(', ');
    label = `Working — ${workingNames}`;
  } else if (done.length === total) {
    overall = 'done';
    label = 'All done';
  } else if (waiting.length > 0 && done.length > 0) {
    overall = 'working';
    label = `In progress — ${done.length} of ${total} roles complete`;
  } else {
    overall = 'idle';
    label = 'Ready to run';
  }

  const progress = `${done.length} of ${total} roles complete`;

  return { overall, label, progress, roles: roleStates };
}

/**
 * Translate a Docker exit code to a plain-English error message.
 */
function translateExitCode(exitCode) {
  switch (exitCode) {
    case 1: return 'The task encountered an error';
    case 2: return 'The task was misconfigured';
    case 125: return 'Could not start the container';
    case 126: return 'Permission denied';
    case 127: return 'Required tool not found';
    case 130: return 'Task was cancelled';
    case 137: return 'Ran out of memory or was stopped';
    case 143: return 'Task was stopped gracefully';
    default: return exitCode ? `Exited with error code ${exitCode}` : 'Unknown error';
  }
}

/**
 * Format elapsed time since a date as a human-readable string.
 */
function formatElapsed(since) {
  const now = new Date();
  const diffMs = now - since;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s`;
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHour < 24) return `${diffHour}h`;
  if (diffDay === 1) return '1 day';
  return `${diffDay} days`;
}

/**
 * Get a color class for a status (for UI rendering).
 */
export function statusColor(status) {
  switch (status) {
    case 'working':
    case 'starting':
      return 'text-blue-500';
    case 'done':
      return 'text-green-500';
    case 'failed':
      return 'text-red-500';
    case 'waiting':
      return 'text-yellow-500';
    case 'paused':
      return 'text-orange-500';
    case 'idle':
    default:
      return 'text-muted-foreground';
  }
}

/**
 * Get a background color class for a status (for UI cards).
 */
export function statusBg(status) {
  switch (status) {
    case 'working':
    case 'starting':
      return 'bg-blue-500/10';
    case 'done':
      return 'bg-green-500/10';
    case 'failed':
      return 'bg-red-500/10';
    case 'waiting':
      return 'bg-yellow-500/10';
    default:
      return 'bg-muted';
  }
}
