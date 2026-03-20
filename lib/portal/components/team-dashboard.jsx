'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { runTeamTask, pauseTeam, deleteTeam } from '../actions.js';
import { PipelineStatus } from './pipeline-status.jsx';
import { OutputViewer } from './output-viewer.jsx';
import { ActivityFeed } from './activity-feed.jsx';

export function TeamDashboard({ team, status, output, logs }) {
  const router = useRouter();
  const [taskInput, setTaskInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [runError, setRunError] = useState(null);
  const [showDelete, setShowDelete] = useState(false);
  const [activeTab, setActiveTab] = useState('output');

  const roles = team.roles || [];
  const isEnabled = team.enabled === 1;

  const handleRunTask = async (e) => {
    e.preventDefault();
    if (!taskInput.trim()) return;
    setLoading(true);
    setRunError(null);
    try {
      const result = await runTeamTask(team.id, taskInput);
      if (result?.success === false) {
        setRunError(result.error || 'Something went wrong. Please try again.');
      } else {
        setTaskInput('');
        // Don't router.refresh() immediately — the SSE stream will pick up
        // the new container and update the pipeline status in real-time.
        // A delayed refresh ensures server data catches up without resetting
        // the pipeline status component's SSE-driven state.
        setTimeout(() => router.refresh(), 5000);
      }
    } catch (err) {
      setRunError('Failed to start the task. Please try again.');
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

      {/* Paused Notice */}
      {!isEnabled && (
        <div className="mb-6 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-yellow-700">This team is paused</p>
            <p className="text-xs text-yellow-600/80 mt-0.5">
              Scheduled runs are disabled. Resume the team to start running tasks again.
            </p>
          </div>
          <button
            onClick={handlePause}
            className="rounded-lg border border-yellow-500/30 px-3 py-1.5 text-xs font-medium text-yellow-700 hover:bg-yellow-500/10 transition-colors"
          >
            Resume
          </button>
        </div>
      )}

      {/* Real-time Pipeline Status */}
      <div className="mb-8">
        <h2 className="text-sm font-medium mb-3">Pipeline</h2>
        <PipelineStatus
          clusterId={team.id}
          roles={roles}
          initialStatus={status}
        />
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
            {runError && (
              <div className="mt-2 text-sm text-red-500 flex items-center gap-1.5">
                <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {runError}
              </div>
            )}
          </div>
        </form>
      </div>

      {/* Tabbed Content: Output / Activity / Members */}
      <div className="mb-8">
        <div className="flex gap-1 border-b border-border mb-4">
          {['output', 'activity', 'members'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm capitalize transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'output' && (
          <OutputViewer
            teamId={team.id}
            files={output?.files || []}
            sessions={output?.sessions || []}
            summary={output?.summary}
          />
        )}

        {activeTab === 'activity' && (
          <ActivityFeed logs={logs || []} />
        )}

        {activeTab === 'members' && (
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
        )}
      </div>

      {/* Footer Links */}
      <div className="flex items-center justify-center gap-4">
        <Link
          href={`/team/${team.id}/history`}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View Run History
        </Link>
        <span className="text-xs text-muted-foreground">|</span>
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
