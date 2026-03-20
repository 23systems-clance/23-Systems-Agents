import { auth } from '23wf/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PortalLayout } from '../../lib/portal/components/portal-layout.jsx';
import { getTeams } from '../../lib/portal/actions.js';

export default async function TeamsPage() {
  const session = await auth();
  if (!session) redirect('/login');

  const teams = await getTeams();

  return (
    <PortalLayout session={session}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Teams</h1>
          <p className="text-muted-foreground mt-1">
            All your agent teams in one place.
          </p>
        </div>
        <Link
          href="/team/new"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + New Team
        </Link>
      </div>

      {teams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <h3 className="font-medium mb-2">No teams yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Create your first agent team from a template.
          </p>
          <Link
            href="/team/new"
            className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Browse Templates
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map(team => (
            <Link
              key={team.id}
              href={`/team/${team.id}`}
              className="block rounded-xl border border-border p-5 hover:border-primary/50 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-medium text-sm">{team.name}</h3>
                <span className={`inline-flex items-center gap-1 text-xs ${
                  team.enabled === 1 ? 'text-green-600' : 'text-muted-foreground'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    team.enabled === 1 ? 'bg-green-500' : 'bg-muted-foreground'
                  }`} />
                  {team.enabled === 1 ? 'Active' : 'Paused'}
                </span>
              </div>

              {team.updatedAt && (
                <div className="text-xs text-muted-foreground mt-1">
                  Updated {new Date(team.updatedAt).toLocaleDateString()}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </PortalLayout>
  );
}
