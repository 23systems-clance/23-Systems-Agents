import { auth } from 'thepopebot/auth';
import { redirect } from 'next/navigation';
import { PortalLayout } from '../../../lib/portal/components/portal-layout.jsx';
import { TeamDashboard } from '../../../lib/portal/components/team-dashboard.jsx';
import { getTeam, getTeamStatus } from '../../../lib/portal/actions.js';

export default async function TeamPage({ params }) {
  const session = await auth();
  if (!session) redirect('/login');

  const { teamId } = await params;
  const team = await getTeam(teamId);
  if (!team) redirect('/teams');

  const status = await getTeamStatus(teamId);

  return (
    <PortalLayout session={session}>
      <TeamDashboard team={team} status={status} />
    </PortalLayout>
  );
}
