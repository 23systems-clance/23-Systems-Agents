import { auth } from '23wf/auth';
import { redirect } from 'next/navigation';
import { PortalLayout } from '../../lib/portal/components/portal-layout.jsx';
import { PortalSettings } from '../../lib/portal/components/portal-settings.jsx';

export default async function AccountPage() {
  const session = await auth();
  if (!session) redirect('/login');

  return (
    <PortalLayout session={session}>
      <PortalSettings session={session} />
    </PortalLayout>
  );
}
