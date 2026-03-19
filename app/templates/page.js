import { auth } from 'thepopebot/auth';
import { redirect } from 'next/navigation';
import { PortalLayout } from '../../lib/portal/components/portal-layout.jsx';
import { TemplateGallery } from '../../lib/portal/components/template-gallery.jsx';
import { getTemplates } from '../../lib/portal/actions.js';

export default async function TemplatesPage() {
  const session = await auth();
  if (!session) redirect('/login');

  const templates = await getTemplates();

  return (
    <PortalLayout session={session}>
      <TemplateGallery templates={templates} />
    </PortalLayout>
  );
}
