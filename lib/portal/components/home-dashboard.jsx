'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { matchTemplate } from '../actions.js';

export function HomeDashboard({ teams, templates }) {
  const router = useRouter();
  const [quickTask, setQuickTask] = useState('');
  const [routing, setRouting] = useState(false);
  const [routeHint, setRouteHint] = useState(null);

  const handleQuickTask = async (e) => {
    e.preventDefault();
    if (!quickTask.trim() || routing) return;

    setRouting(true);
    setRouteHint(null);

    try {
      // Use LLM to match the task to a template
      const match = await matchTemplate(quickTask);

      if (match.templateId && match.confidence !== 'low') {
        // Build URL with template + suggested inputs
        const params = new URLSearchParams({ template: match.templateId });
        for (const [key, value] of Object.entries(match.suggestedInputs || {})) {
          if (value) params.set(`input_${key}`, value);
        }
        setRouteHint(`Matched: ${match.reason}`);
        setTimeout(() => router.push(`/team/new?${params.toString()}`), 600);
      } else {
        // No match — go to custom team wizard with the description pre-filled
        router.push(`/team/new?custom=true&describe=${encodeURIComponent(quickTask)}`);
      }
    } catch {
      // Fallback: go to custom team wizard
      router.push(`/team/new?custom=true&describe=${encodeURIComponent(quickTask)}`);
    }
    setRouting(false);
  };

  return (
    <div>
      {/* Quick Task Input */}
      <div className="mb-10">
        <form onSubmit={handleQuickTask}>
          <div className="rounded-xl border border-border p-5 bg-muted/30">
            <label className="block text-lg font-semibold mb-3">
              What do you need done?
            </label>
            <div className="flex gap-3">
              <input
                type="text"
                value={quickTask}
                onChange={e => setQuickTask(e.target.value)}
                placeholder="e.g., Research the top CRM tools for small businesses"
                className="flex-1 rounded-lg border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="submit"
                disabled={!quickTask.trim() || routing}
                className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {routing ? 'Finding...' : 'Go'}
              </button>
            </div>
            {routeHint && (
              <div className="mt-2 text-sm text-green-600">{routeHint}</div>
            )}
          </div>
        </form>
      </div>

      {/* Teams Section */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Your Teams</h2>
          <Link
            href="/team/new"
            className="text-sm text-primary hover:text-primary/80 transition-colors"
          >
            + New Team
          </Link>
        </div>

        {teams.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <div className="text-muted-foreground/50 mb-3">
              <svg className="h-10 w-10 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <h3 className="font-medium mb-1">No teams yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first AI team from a template — it takes less than a minute.
            </p>
            <Link
              href="/team/new"
              className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Create a Team
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.map(team => (
              <TeamCard key={team.id} team={team} />
            ))}
          </div>
        )}
      </div>

      {/* Quick Start Templates */}
      {teams.length < 3 && templates.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Quick Start</h2>
            <Link
              href="/templates"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              View all templates
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {templates.slice(0, 4).map(template => (
              <Link
                key={template.id}
                href={`/team/new?template=${template.id}`}
                className="rounded-lg border border-border p-4 hover:border-primary/50 transition-all group"
              >
                <h3 className="text-sm font-medium group-hover:text-primary transition-colors">
                  {template.name}
                </h3>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {template.description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TeamCard({ team }) {
  const isEnabled = team.enabled === 1;
  const roleCount = team.roles?.length || 0;

  return (
    <Link
      href={`/team/${team.id}`}
      className="block rounded-xl border border-border p-4 hover:border-primary/50 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-medium text-sm truncate">{team.name}</h3>
        <span className={`inline-flex items-center gap-1 text-xs ${
          isEnabled ? 'text-green-600' : 'text-muted-foreground'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            isEnabled ? 'bg-green-500' : 'bg-muted-foreground'
          }`} />
          {isEnabled ? 'Active' : 'Paused'}
        </span>
      </div>

      <div className="text-xs text-muted-foreground">
        {roleCount} member{roleCount !== 1 ? 's' : ''}
      </div>

      {team.updatedAt && (
        <div className="text-xs text-muted-foreground mt-2">
          Last active: {formatTimeAgo(team.updatedAt)}
        </div>
      )}
    </Link>
  );
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}
