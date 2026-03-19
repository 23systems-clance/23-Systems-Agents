'use client';

import { useEffect, useState, useRef } from 'react';
import { statusColor } from '../status.js';

/**
 * Real-time pipeline status visualization.
 *
 * Connects to the existing cluster SSE stream and translates
 * container events into plain-English status updates.
 */
export function PipelineStatus({ clusterId, roles, initialStatus }) {
  const [roleStates, setRoleStates] = useState(() =>
    buildInitialStates(roles, initialStatus)
  );
  const eventSourceRef = useRef(null);

  useEffect(() => {
    // Connect to the existing cluster SSE stream
    const url = `/stream/cluster/${clusterId}/logs`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener('status', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.roles) {
          setRoleStates(prev => mergeRoleStates(prev, roles, data));
        }
      } catch {}
    });

    es.addEventListener('log', (event) => {
      try {
        const data = JSON.parse(event.data);
        // Update the role state based on log activity
        if (data.containerName) {
          setRoleStates(prev => markRoleActive(prev, roles, data.containerName));
        }
      } catch {}
    });

    es.onerror = () => {
      // SSE will auto-reconnect
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [clusterId]);

  // Compute overall progress
  const total = roleStates.length;
  const done = roleStates.filter(r => r.status === 'done').length;
  const working = roleStates.filter(r => r.status === 'working' || r.status === 'starting').length;
  const failed = roleStates.filter(r => r.status === 'failed').length;

  let overallLabel = 'Ready to run';
  if (failed > 0) overallLabel = 'Failed';
  else if (working > 0) overallLabel = `Working — ${done} of ${total} complete`;
  else if (done === total && total > 0) overallLabel = 'All done';

  return (
    <div>
      {/* Overall Status */}
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-2.5 h-2.5 rounded-full ${
          failed > 0 ? 'bg-red-500' :
          working > 0 ? 'bg-blue-500 animate-pulse' :
          done === total && total > 0 ? 'bg-green-500' :
          'bg-muted-foreground'
        }`} />
        <span className="text-sm font-medium">{overallLabel}</span>
      </div>

      {/* Pipeline Steps */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {roleStates.map((roleState, i) => (
          <div key={roleState.roleId} className="flex items-center gap-2">
            <div className={`rounded-xl border p-4 min-w-[150px] transition-colors ${
              roleState.status === 'working' || roleState.status === 'starting'
                ? 'border-blue-500 bg-blue-500/5'
                : roleState.status === 'done'
                ? 'border-green-500 bg-green-500/5'
                : roleState.status === 'failed'
                ? 'border-red-500 bg-red-500/5'
                : roleState.status === 'waiting'
                ? 'border-yellow-500/50 bg-yellow-500/5'
                : 'border-border'
            }`}>
              <div className="text-sm font-medium mb-1">{roleState.roleName}</div>
              <div className={`text-xs ${statusColor(roleState.status)}`}>
                {roleState.status === 'working' && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse mr-1.5" />
                )}
                {roleState.label}
              </div>
              {roleState.detail && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {roleState.detail}
                </div>
              )}
            </div>
            {i < roleStates.length - 1 && (
              <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9,18 15,12 9,6" />
              </svg>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Build initial role states from server-provided status.
 */
function buildInitialStates(roles, initialStatus) {
  return roles.map(role => {
    const st = initialStatus?.[role.id];
    const running = st?.running || 0;

    if (running > 0) {
      return {
        roleId: role.id,
        roleName: role.roleName,
        status: 'working',
        label: 'Working...',
        detail: null,
      };
    }

    // Check if this role has a dependency
    const dependsOn = role.triggerConfig?.dependsOn || role.dependsOn;
    if (dependsOn) {
      return {
        roleId: role.id,
        roleName: role.roleName,
        status: 'waiting',
        label: `Waiting for ${dependsOn}`,
        detail: null,
      };
    }

    return {
      roleId: role.id,
      roleName: role.roleName,
      status: 'idle',
      label: 'Ready',
      detail: null,
    };
  });
}

/**
 * Merge SSE status data into role states.
 */
function mergeRoleStates(prevStates, roles, sseData) {
  const containersByRole = {};

  // Group containers by role short ID
  if (sseData.containers) {
    for (const container of sseData.containers) {
      // Container names: cluster-{cid}-role-{rid}-{uuid}
      const match = container.name?.match(/role-([a-f0-9]+)-/);
      if (match) {
        const rid = match[1];
        if (!containersByRole[rid]) containersByRole[rid] = [];
        containersByRole[rid].push(container);
      }
    }
  }

  return prevStates.map(state => {
    const role = roles.find(r => r.id === state.roleId);
    const rid = role?.id?.replace(/-/g, '').slice(0, 8);
    const containers = containersByRole[rid] || [];
    const running = containers.filter(c => c.state === 'running');

    if (running.length > 0) {
      return { ...state, status: 'working', label: 'Working...', detail: null };
    }

    const exited = containers.filter(c => c.state === 'exited');
    if (exited.length > 0) {
      const latest = exited[0];
      if (latest.exitCode === 0) {
        return { ...state, status: 'done', label: 'Done', detail: null };
      }
      const errorDetail = translateExitCode(latest.exitCode);
      return { ...state, status: 'failed', label: 'Failed', detail: errorDetail };
    }

    return state;
  });
}

/**
 * Mark a role as active based on a container name from a log event.
 */
function markRoleActive(prevStates, roles, containerName) {
  const match = containerName.match(/role-([a-f0-9]+)-/);
  if (!match) return prevStates;

  const rid = match[1];

  return prevStates.map(state => {
    const role = roles.find(r => r.id === state.roleId);
    const roleRid = role?.id?.replace(/-/g, '').slice(0, 8);

    if (roleRid === rid && state.status !== 'done' && state.status !== 'failed') {
      return { ...state, status: 'working', label: 'Working...' };
    }
    return state;
  });
}

/**
 * Translate container exit codes to plain-English error messages.
 */
function translateExitCode(code) {
  switch (code) {
    case 1: return 'The task encountered an error';
    case 124: return 'Timed out — the task took too long';
    case 125: return 'Container failed to start';
    case 126: return 'Permission denied';
    case 127: return 'Command not found';
    case 137: return 'Ran out of memory';
    case 143: return 'Task was stopped';
    default: return code ? `Exited with error (code ${code})` : null;
  }
}
