import { auth } from '23wf/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PortalLayout } from '../../../lib/portal/components/portal-layout.jsx';
import { TeamWizard } from '../../../lib/portal/components/team-wizard.jsx';
import { CustomTeamWizard } from '../../../lib/portal/components/custom-team-wizard.jsx';
import { getTemplateById, getTemplates } from '../../../lib/portal/actions.js';
import { TemplateGallery } from '../../../lib/portal/components/template-gallery.jsx';

export default async function NewTeamPage({ searchParams }) {
  const session = await auth();
  if (!session) redirect('/login');

  const params = await searchParams;
  const templateId = params?.template;
  const isCustom = params?.custom === 'true';
  const browsing = params?.browse === 'true';
  const describe = params?.describe || '';

  // Custom team wizard (no template)
  if (isCustom) {
    return (
      <PortalLayout session={session}>
        <CustomTeamWizard initialTask={describe} />
      </PortalLayout>
    );
  }

  // If a template is specified, show the template wizard
  if (templateId) {
    const template = await getTemplateById(templateId);
    if (!template) redirect('/team/new');

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

  // If browsing templates
  if (browsing) {
    const templates = await getTemplates();
    return (
      <PortalLayout session={session}>
        <div className="mb-6">
          <Link href="/team/new" className="text-xs text-muted-foreground hover:text-foreground transition-colors mb-2 inline-block">
            &larr; Back
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Choose a Template</h1>
          <p className="text-muted-foreground mt-1">
            Pick a pre-built template to get started quickly.
          </p>
        </div>
        <TemplateGallery templates={templates} />
      </PortalLayout>
    );
  }

  // Default: show the choice screen
  const templates = await getTemplates();
  return (
    <PortalLayout session={session}>
      <div className="max-w-2xl mx-auto">
        <div className="mb-10 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Create a New Team</h1>
          <p className="text-muted-foreground mt-1">
            How would you like to get started?
          </p>
        </div>

        {/* Two big option cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          <Link
            href="/team/new?custom=true"
            className="group block rounded-xl border-2 border-border p-6 transition-all hover:border-primary hover:shadow-lg text-center"
          >
            <div className="rounded-full bg-primary/10 w-14 h-14 flex items-center justify-center mx-auto mb-4 group-hover:bg-primary/20 transition-colors">
              <svg className="h-7 w-7 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold mb-2 group-hover:text-primary transition-colors">
              Build from Scratch
            </h2>
            <p className="text-sm text-muted-foreground">
              Name your team, describe the task, and define your own members.
            </p>
          </Link>

          <Link
            href="/team/new?browse=true"
            className="group block rounded-xl border-2 border-border p-6 transition-all hover:border-primary hover:shadow-lg text-center"
          >
            <div className="rounded-full bg-primary/10 w-14 h-14 flex items-center justify-center mx-auto mb-4 group-hover:bg-primary/20 transition-colors">
              <svg className="h-7 w-7 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold mb-2 group-hover:text-primary transition-colors">
              Start from a Template
            </h2>
            <p className="text-sm text-muted-foreground">
              Choose from {templates.length} pre-built teams — research, content, SEO, and more.
            </p>
          </Link>
        </div>

        {/* Popular templates quick links */}
        {templates.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-3 text-center">Popular templates</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {templates.slice(0, 4).map(template => (
                <Link
                  key={template.id}
                  href={`/team/new?template=${template.id}`}
                  className="rounded-lg border border-border p-3 text-center hover:border-primary/50 transition-all group"
                >
                  <div className="text-sm font-medium group-hover:text-primary transition-colors truncate">
                    {template.name}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {template.cluster?.roles?.length || 0} members
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
