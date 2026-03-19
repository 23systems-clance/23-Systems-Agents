'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { runTeamTask, pauseTeam, deleteTeam } from '../actions.js';
import { translateContainerState, statusColor } from '../status.js';

export function TeamDashboard({ team, status }) {
  const router = useRouter();
  const [taskInput, setTaskInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const roles = team.roles || [];
  const isEnabled = team.enabled === 1;

  const handleRunTask = async (e) => {
    e.preventDefault();
    if (!taskInput.trim()) return;
    setLoading(true);
    try {
      await runTeamTask(team.id, taskInput);
      setTaskInput('');
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const handlePause = async () => {
    await pauseTeam(team.id);
    router.refresh();
  };

  const handleDelete = async () => {
    await deleteTeam(team.id);
    router.push('/teams');
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <Link href="/teams" className="text-xs text-muted-foreground hover:text-foreground transition-colors mb-2 inline-block">
            &larr; Back to teams
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{team.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePause}
            className={`rounded-lg border border-border px-3 py-2 text-xs transition-colors ${
              isEnabled
                ? 'text-yellow-600 hover:bg-yellow-500/10'
                : 'text-green-600 hover:bg-green-500/10'
            }`}
          >
            {isEnabled ? 'Pause' : 'Resume'}
          </button>
          <button
            onClick={() => setShowDelete(true)}
            className="rounded-lg border border-border px-3 py-2 text-xs text-red-500 hover:bg-red-500/10 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Pipeline Visualization */}
      <div className="mb-8">
        <h2 className="text-sm font-medium mb-3">Pipeline</h2>
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {roles.map((role, i) => {
            const roleStatus = status?.[role.id];
            const state = translateContainerState(
              roleStatus?.running > 0 ? { state: 'running' } : null,
              role
            );

            return (
              <div key={role.id} className="flex items-center gap-2">
                <div className={`rounded-xl border p-4 min-w-[140px] ${
                  state.status === 'working' ? 'border-blue-500 bg-blue-500/5' :
                  state.status === 'done' ? 'border-green-500 bg-green-500/5' :
                  state.status === 'failed' ? 'border-red-500 bg-red-500/5' :
                  'border-border'
                }`}>
                  <div className="text-sm font-medium mb-1">{role.roleName}</div>
                  <div className={`text-xs ${statusColor(state.status)}`}>
                    {state.label}
                  </div>
                  {state.detail && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {state.detail}
                    </div>
                  )}
                </div>
                {i < roles.length - 1 && (
                  <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9,18 15,12 9,6" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Run Again */}
      <div className="mb-8">
        <form onSubmit={handleRunTask}>
          <div className="rounded-xl border border-border p-4">
            <label className="block text-sm font-medium mb-2">
              Run again with a new task
            </label>
            <div className="flex gap-3">
              <input
                type="text"
                value={taskInput}
                onChange={e => setTaskInput(e.target.value)}
                placeholder="Describe what the team should work on..."
                className="flex-1 rounded-lg border border-border bg-input px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="submit"
                disabled={!taskInput.trim() || loading || !isEnabled}
                className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Starting...' : 'Go'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Team Members Detail */}
      <div className="mb-8">
        <h2 className="text-sm font-medium mb-3">Team Members</h2>
        <div className="space-y-3">
          {roles.map(role => (
            <div key={role.id} className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{role.roleName}</span>
                {role.dependsOn && (
                  <span className="text-xs text-muted-foreground">
                    Runs after: {typeof role.dependsOn === 'string' ? role.dependsOn : 'previous step'}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {role.role}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Advanced Link */}
      <div className="text-center">
        <Link
          href={`/dev/cluster/${team.id}`}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Open in Developer Portal
        </Link>
      </div>

      {/* Delete Confirmation */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-xl bg-background border border-border p-6 max-w-sm mx-4">
            <h3 className="font-semibold mb-2">Delete this team?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This will stop all running workers and remove the team. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDelete(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="rounded-lg bg-red-500 text-white px-4 py-2 text-sm hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
