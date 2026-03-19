'use client';

import { useState } from 'react';
import Link from 'next/link';
import { readOutputFile } from '../output.js';

/**
 * Run History — shows all past runs for a team with expandable output viewer.
 */
export function RunHistory({ teamId, teamName, logs }) {
  const [expandedRun, setExpandedRun] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const runs = parseRuns(logs);

  if (runs.length === 0) {
    return (
      <div>
        <Header teamId={teamId} teamName={teamName} />
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <div className="text-muted-foreground mb-2">
            <ClockIcon className="h-8 w-8 mx-auto mb-3 opacity-50" />
          </div>
          <h3 className="font-medium mb-2">No runs yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            This team hasn&apos;t been run yet. Go to the team dashboard to start a task.
          </p>
          <Link
            href={`/team/${teamId}`}
            className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const handleLoadFile = async (filePath) => {
    setLoadingFile(true);
    try {
      const result = await readOutputFile(teamId, filePath);
      setFileContent(result);
    } catch {
      setFileContent({ content: 'Failed to load file', type: 'text' });
    }
    setLoadingFile(false);
  };

  return (
    <div>
      <Header teamId={teamId} teamName={teamName} />

      <div className="space-y-3">
        {runs.map((run, i) => (
          <div
            key={i}
            className="rounded-xl border border-border overflow-hidden"
          >
            {/* Run Summary Row */}
            <button
              onClick={() => {
                setExpandedRun(expandedRun === i ? null : i);
                setFileContent(null);
              }}
              className="w-full flex items-center gap-4 p-4 text-left hover:bg-muted/30 transition-colors"
            >
              <StatusBadge status={run.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{run.roleName}</span>
                  <span className={`text-xs ${statusTextColor(run.status)}`}>
                    {run.status === 'completed' ? 'Completed' :
                     run.status === 'failed' ? 'Failed' :
                     run.status === 'running' ? 'Running...' : 'Unknown'}
                  </span>
                </div>
                {run.sessionName && (
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {run.sessionName}
                  </div>
                )}
              </div>
              <div className="text-xs text-muted-foreground text-right">
                {run.timestamp ? formatTimestamp(run.timestamp) : ''}
              </div>
              <ChevronIcon className={`h-4 w-4 text-muted-foreground transition-transform ${
                expandedRun === i ? 'rotate-180' : ''
              }`} />
            </button>

            {/* Expanded Details */}
            {expandedRun === i && (
              <div className="border-t border-border p-4 bg-muted/10">
                <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                  <div>
                    <span className="text-xs text-muted-foreground">Role</span>
                    <div className="font-medium">{run.roleName}</div>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Status</span>
                    <div className={`font-medium ${statusTextColor(run.status)}`}>
                      {run.status === 'completed' ? 'Completed successfully' :
                       run.status === 'failed' ? 'Failed' :
                       run.status === 'running' ? 'Currently running' : 'Unknown'}
                    </div>
                  </div>
                  {run.timestamp && (
                    <div>
                      <span className="text-xs text-muted-foreground">Started</span>
                      <div>{run.timestamp.toLocaleString()}</div>
                    </div>
                  )}
                  {run.duration && (
                    <div>
                      <span className="text-xs text-muted-foreground">Duration</span>
                      <div>{run.duration}</div>
                    </div>
                  )}
                </div>

                {/* Quick link to dashboard */}
                <div className="flex gap-2">
                  <Link
                    href={`/team/${teamId}`}
                    className="text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    View dashboard
                  </Link>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Header({ teamId, teamName }) {
  return (
    <div className="mb-6">
      <Link
        href={`/team/${teamId}`}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors mb-2 inline-block"
      >
        &larr; Back to {teamName}
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Run History</h1>
      <p className="text-muted-foreground mt-1">
        Past runs and their results for this team.
      </p>
    </div>
  );
}

function StatusBadge({ status }) {
  const bg = status === 'completed' ? 'bg-green-500' :
             status === 'failed' ? 'bg-red-500' :
             status === 'running' ? 'bg-blue-500 animate-pulse' :
             'bg-muted-foreground';

  return (
    <div className={`w-2.5 h-2.5 rounded-full ${bg}`} />
  );
}

function statusTextColor(status) {
  return status === 'completed' ? 'text-green-600' :
         status === 'failed' ? 'text-red-500' :
         status === 'running' ? 'text-blue-500' :
         'text-muted-foreground';
}

/**
 * Parse log entries into a flat list of runs, sorted newest first.
 */
function parseRuns(logs) {
  if (!logs || !Array.isArray(logs)) return [];

  const runs = [];
  for (const entry of logs) {
    const roleName = entry.roleName || `Role ${entry.roleShortId || '?'}`;
    for (const session of (entry.sessions || [])) {
      let timestamp = null;
      const match = session.name?.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
      if (match) {
        timestamp = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}`);
      }

      const status = session.exitCode === 0 ? 'completed' :
                     session.exitCode ? 'failed' :
                     session.running ? 'running' : 'completed';

      runs.push({
        roleName,
        sessionName: session.name,
        timestamp,
        status,
        duration: session.duration || null,
      });
    }
  }

  // Sort newest first
  runs.sort((a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0));
  return runs;
}

function formatTimestamp(date) {
  if (!date || isNaN(date.getTime())) return '';

  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Inline SVG Icons ─────────────────────────────────

function ClockIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" />
    </svg>
  );
}

function ChevronIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6,9 12,15 18,9" />
    </svg>
  );
}
