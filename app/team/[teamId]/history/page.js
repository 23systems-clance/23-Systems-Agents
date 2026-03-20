import { auth } from '23wf/auth';
import { redirect } from 'next/navigation';
import { PortalLayout } from '../../../../lib/portal/components/portal-layout.jsx';
import { RunHistory } from '../../../../lib/portal/components/run-history.jsx';
import { getTeam, getTeamLogs } from '../../../../lib/portal/actions.js';

export default async function HistoryPage({ params }) {
  const session = await auth();
  if (!session) redirect('/login');

  const { teamId } = await params;
  const team = await getTeam(teamId);
  if (!team) redirect('/teams');

  const logs = await getTeamLogs(teamId);

  return (
    <PortalLayout session={session}>
      <RunHistory teamId={teamId} teamName={team.name} logs={logs} />
    </PortalLayout>
  );
}
