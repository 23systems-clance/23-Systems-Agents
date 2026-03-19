'use client';

/**
 * Activity feed showing recent team runs and their outcomes.
 *
 * Displays log entries from cluster execution history in a
 * simple, chronological feed format.
 */
export function ActivityFeed({ logs }) {
  if (!logs || logs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <svg className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22,12 18,12 15,21 9,3 6,12 2,12" />
        </svg>
        <p className="text-sm font-medium mb-1">No activity yet</p>
        <p className="text-xs text-muted-foreground">
          Run the team to see a log of each step here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {logs.map((entry, i) => (
        <ActivityEntry key={i} entry={entry} />
      ))}
    </div>
  );
}

function ActivityEntry({ entry }) {
  const { roleName, sessionName, timestamp, status } = parseEntry(entry);

  return (
    <div className="flex items-start gap-3 py-2">
      <StatusDot status={status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{roleName}</span>
          <span className={`text-xs ${
            status === 'completed' ? 'text-green-600' :
            status === 'failed' ? 'text-red-500' :
            status === 'running' ? 'text-blue-500' :
            'text-muted-foreground'
          }`}>
            {status === 'completed' ? 'completed' :
             status === 'failed' ? 'failed' :
             status === 'running' ? 'running...' :
             'unknown'}
          </span>
        </div>
        {timestamp && (
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(timestamp)}
          </span>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }) {
  const colorClass =
    status === 'completed' ? 'bg-green-500' :
    status === 'failed' ? 'bg-red-500' :
    status === 'running' ? 'bg-blue-500 animate-pulse' :
    'bg-muted-foreground';

  return (
    <div className="mt-1.5">
      <div className={`w-2 h-2 rounded-full ${colorClass}`} />
    </div>
  );
}

/**
 * Parse a log entry from getClusterLogs() into display format.
 * Log entries have format: { roleShortId, roleName?, sessions: [{ name, timestamp }] }
 */
function parseEntry(entry) {
  const roleName = entry.roleName || `Role ${entry.roleShortId || '?'}`;
  const latestSession = entry.sessions?.[0];
  const sessionName = latestSession?.name || '';

  // Parse timestamp from session name format: YYYY-MM-DD_HH-MM-SS_uuid
  let timestamp = null;
  if (sessionName) {
    const match = sessionName.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
    if (match) {
      timestamp = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}`);
    }
  }

  // Determine status — if meta.json exists and has exit code, use that
  const status = latestSession?.exitCode === 0 ? 'completed' :
                 latestSession?.exitCode ? 'failed' :
                 latestSession?.running ? 'running' : 'completed';

  return { roleName, sessionName, timestamp, status };
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
