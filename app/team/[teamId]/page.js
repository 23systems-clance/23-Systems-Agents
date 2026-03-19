import { auth } from 'thepopebot/auth';
import { redirect } from 'next/navigation';
import { PortalLayout } from '../../../lib/portal/components/portal-layout.jsx';
import { TeamDashboard } from '../../../lib/portal/components/team-dashboard.jsx';
import { getTeam, getTeamStatus, getTeamLogs } from '../../../lib/portal/actions.js';
import { getTeamOutput } from '../../../lib/portal/output.js';

export default async function TeamPage({ params }) {
  const session = await auth();
  if (!session) redirect('/login');

  const { teamId } = await params;
  const team = await getTeam(teamId);
  if (!team) redirect('/teams');

  const [status, output, logs] = await Promise.all([
    getTeamStatus(teamId),
    getTeamOutput(teamId),
    getTeamLogs(teamId),
  ]);

  return (
    <PortalLayout session={session}>
      <TeamDashboard team={team} status={status} output={output} logs={logs} />
    </PortalLayout>
  );
}
