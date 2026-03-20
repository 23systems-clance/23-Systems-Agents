import { auth } from '23wf/auth';
import { redirect } from 'next/navigation';
import { PortalLayout } from '../lib/portal/components/portal-layout.jsx';
import { HomeDashboard } from '../lib/portal/components/home-dashboard.jsx';
import { getTeams, getTemplates } from '../lib/portal/actions.js';

export default async function Home() {
  const session = await auth();
  if (!session) redirect('/login');

  const [teams, templates] = await Promise.all([
    getTeams(),
    getTemplates(),
  ]);

  return (
    <PortalLayout session={session}>
      <HomeDashboard teams={teams} templates={templates} />
    </PortalLayout>
  );
}
