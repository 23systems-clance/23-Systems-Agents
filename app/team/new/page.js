import { auth } from 'thepopebot/auth';
import { redirect } from 'next/navigation';
import { PortalLayout } from '../../../lib/portal/components/portal-layout.jsx';
import { TeamWizard } from '../../../lib/portal/components/team-wizard.jsx';
import { getTemplateById, getTemplates } from '../../../lib/portal/actions.js';
import { TemplateGallery } from '../../../lib/portal/components/template-gallery.jsx';

export default async function NewTeamPage({ searchParams }) {
  const session = await auth();
  if (!session) redirect('/login');

  const params = await searchParams;
  const templateId = params?.template;

  // If a template is specified, show the wizard
  if (templateId) {
    const template = await getTemplateById(templateId);
    if (!template) redirect('/templates');

    // Extract pre-filled inputs from URL params (from LLM matcher)
    const prefilled = {};
    for (const [key, value] of Object.entries(params)) {
      if (key.startsWith('input_')) {
        prefilled[key.slice(6)] = value;
      }
    }

    return (
      <PortalLayout session={session}>
        <TeamWizard template={template} prefilled={prefilled} />
      </PortalLayout>
    );
  }

  // Otherwise show the template gallery
  const templates = await getTemplates();
  return (
    <PortalLayout session={session}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Build a Team</h1>
        <p className="text-muted-foreground mt-1">
          Choose a template to get started, or describe what you need.
        </p>
      </div>
      <TemplateGallery templates={templates} />
    </PortalLayout>
  );
}
