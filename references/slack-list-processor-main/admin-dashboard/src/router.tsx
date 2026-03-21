import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { AppLayout } from '@/components/layout/AppLayout';
import { BdrLayout } from '@/components/layout/BdrLayout';
import { ClientLayout } from '@/components/layout/ClientLayout';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const LoginPage = lazy(() => import('@/pages/login'));
const OverviewPage = lazy(() => import('@/pages/overview'));
const UsagePage = lazy(() => import('@/pages/usage'));
const ErrorsPage = lazy(() => import('@/pages/errors'));
const ClientsPage = lazy(() => import('@/pages/clients'));
const ThresholdsPage = lazy(() => import('@/pages/thresholds'));
const ReportsPage = lazy(() => import('@/pages/reports'));
const SettingsPage = lazy(() => import('@/pages/settings'));
const UsersPage = lazy(() => import('@/pages/users'));
const JobsPage = lazy(() => import('@/pages/jobs'));
const EnrichmentPage = lazy(() => import('@/pages/enrichment'));

// BDR pages (separate auth flow via magic link)
const BdrTasksPage = lazy(() => import('@/pages/bdr/tasks'));
const BdrCallsPage = lazy(() => import('@/pages/bdr/calls'));
const BdrUniboxPage = lazy(() => import('@/pages/bdr/unibox'));
const BdrStatsPage = lazy(() => import('@/pages/bdr/stats'));
const BdrDialerPage = lazy(() => import('@/pages/bdr/dialer'));

// Campaign admin pages
const CampaignsPage = lazy(() => import('@/pages/campaigns'));
const CampaignCreatePage = lazy(() => import('@/pages/campaign-create'));
const CampaignDetailPage = lazy(() => import('@/pages/campaign-detail'));
const BdrActivityPage = lazy(() => import('@/pages/bdr-activity'));
const EodReportsPage = lazy(() => import('@/pages/eod-reports'));

// Onboarding pages (Feature 7)
const OnboardingPlansPage = lazy(() => import('@/pages/onboarding-plans'));
const OnboardingPlanDetailPage = lazy(() => import('@/pages/onboarding-plan-detail'));
const OnboardingEnrollmentsPage = lazy(() => import('@/pages/onboarding-enrollments'));
const OnboardingProgressPage = lazy(() => import('@/pages/onboarding-progress'));
const ContentLibraryPage = lazy(() => import('@/pages/content-library'));

// Client & BDR management pages
const ManagedClientsPage = lazy(() => import('@/pages/managed-clients'));
const ManagedBdrsPage = lazy(() => import('@/pages/managed-bdrs'));

// Billing pages (Feature 12)
const BillingPage = lazy(() => import('@/pages/billing'));
const BillingDetailPage = lazy(() => import('@/pages/billing-detail'));
const CreditRatesPage = lazy(() => import('@/pages/credit-rates'));

// Workflow Builder pages (Feature 7-workflow-builder)
const WorkflowsPage = lazy(() => import('@/pages/workflows'));
const WorkflowBuilderPage = lazy(() => import('@/pages/workflow-builder'));
const WorkflowAnalyticsPage = lazy(() => import('@/pages/workflow-analytics'));
const WorkflowExecutionDetailPage = lazy(() => import('@/pages/workflow-execution-detail'));
const WorkflowStyleTestPage = lazy(() => import('@/pages/workflow-style-test'));

// Config doc upload page (public, token-based auth)
const UploadPage = lazy(() => import('@/pages/upload'));

// Channel-client mapping admin page
const ChannelMappingsPage = lazy(() => import('@/pages/channel-mappings'));

// Apollo cache admin page (Feature 22)
const ApolloCachePage = lazy(() => import('@/pages/apollo-cache'));

// Cache metrics page (Feature 17)
const CacheMetricsPage = lazy(() => import('@/pages/cache-metrics'));

// CRM pages (Feature 18)
const CrmConnectionsPage = lazy(() => import('@/pages/crm-connections'));
const CrmFieldMappingsPage = lazy(() => import('@/pages/crm-field-mappings'));

// Provider Costs page (Feature 27)
const ProviderCostsPage = lazy(() => import('@/pages/provider-costs'));

// Active Calls monitoring page (Feature 22 - Power Dialer Phase 6)
const ActiveCallsPage = lazy(() => import('@/pages/active-calls'));

// Recording Library pages (Feature 22 - Power Dialer Phase 8)
const RecordingsPage = lazy(() => import('@/pages/recordings'));
const RecordingDetailPage = lazy(() => import('@/pages/recording-detail'));

// Prompt Library pages (Feature 19)
const PromptLibraryPage = lazy(() => import('@/pages/prompt-library'));
const PromptDetailPage = lazy(() => import('@/pages/prompt-detail'));
const PromptDiffPage = lazy(() => import('@/pages/prompt-diff'));
const PromptVariablesPage = lazy(() => import('@/pages/prompt-variables'));

// Dialer Analytics page (Feature 22 - Power Dialer Phase 10)
const DialerAnalyticsPage = lazy(() => import('@/pages/dialer-analytics'));

// Salesfloor page (Feature 22 - Power Dialer Phase 11)
const SalesfloorPage = lazy(() => import('@/pages/salesfloor'));

// Network Requirements page (Feature 22 - Power Dialer Phase 12)
const NetworkRequirementsPage = lazy(() => import('@/pages/network-requirements'));

// Contact detail page (Feature 29 - Smart Reply Assistant)
const ContactDetailPage = lazy(() => import('@/pages/contact-detail'));

// Autonomous agent pages (Feature 31)
const AutonomousDashboardPage = lazy(() => import('@/pages/autonomous/Dashboard'));
const AutonomousAgentListPage = lazy(() => import('@/pages/autonomous/AgentList'));
const AutonomousAgentDetailPage = lazy(() => import('@/pages/autonomous/AgentDetail'));
const AutonomousTeamListPage = lazy(() => import('@/pages/autonomous/TeamList'));
const AutonomousTeamDetailPage = lazy(() => import('@/pages/autonomous/TeamDetail'));
const AutonomousAuditTrailPage = lazy(() => import('@/pages/autonomous/AuditTrail'));
const AutonomousSystemEventsPage = lazy(() => import('@/pages/autonomous/SystemEvents'));

// Platform pages (Feature 39 - Vertical Pack Platform)
const AgentRegistryPage = lazy(() => import('@/pages/platform/agent-registry'));
const AgentDetailPage = lazy(() => import('@/pages/platform/agent-detail'));
const McpServersPage = lazy(() => import('@/pages/platform/mcp-servers'));
const McpServerDetailPage = lazy(() => import('@/pages/platform/mcp-server-detail'));
const SkillComposerPage = lazy(() => import('@/pages/platform/skill-composer'));
const SkillDetailPage = lazy(() => import('@/pages/platform/skill-detail'));
const PackManagerPage = lazy(() => import('@/pages/platform/pack-manager'));
const PackDetailPage = lazy(() => import('@/pages/platform/pack-detail'));
const ExecutionLogsPage = lazy(() => import('@/pages/platform/execution-logs'));
const PlatformAnalyticsPage = lazy(() => import('@/pages/platform/platform-analytics'));
const PackCatalogPage = lazy(() => import('@/pages/platform/pack-catalog'));

// Licensing & Workspace Management pages (Feature 35)
const LicensingPage = lazy(() => import('@/pages/licensing'));
const WorkspaceManagementPage = lazy(() => import('@/pages/workspace-management'));

// Client dashboard pages (Feature 35)
const ClientLoginPage = lazy(() => import('@/pages/client-login'));
const ClientOverviewPage = lazy(() => import('@/pages/client-overview'));
const ClientBillingPage = lazy(() => import('@/pages/client-billing'));
const ClientEnrichmentsPage = lazy(() => import('@/pages/client-enrichments'));
const ClientChannelsPage = lazy(() => import('@/pages/client-channels'));
const ClientSettingsPage = lazy(() => import('@/pages/client-settings'));

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;
}

/** Guard: redirects to /login if no active session. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAdminAuth();

  if (isLoading) return <PageSkeleton />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Guard: redirects to / if already authenticated (for login page). */
function RedirectIfAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAdminAuth();

  if (isLoading) return <PageSkeleton />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** BDR auth guard — uses magic link tokens, not admin auth. */
function RequireBdrAuth({ children }: { children: React.ReactNode }) {
  // BDR auth is handled server-side via session cookie established by magic link.
  // If the API returns 401, the axios interceptor redirects to /bdr/auth-required.
  return <>{children}</>;
}

export const appRouter = createBrowserRouter([
  // BDR routes (separate auth flow from admin, shared layout with sidebar)
  {
    path: '/bdr',
    element: <RequireBdrAuth><BdrLayout /></RequireBdrAuth>,
    children: [
      { path: 'tasks', element: <LazyPage><BdrTasksPage /></LazyPage> },
      { path: 'calls/:campaignId', element: <LazyPage><BdrCallsPage /></LazyPage> },
      { path: 'dialer', element: <LazyPage><BdrDialerPage /></LazyPage> },
      { path: 'unibox', element: <LazyPage><BdrUniboxPage /></LazyPage> },
      { path: 'stats', element: <LazyPage><BdrStatsPage /></LazyPage> },
    ],
  },
  {
    path: '/bdr/auth-required',
    element: (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Authentication Required</h1>
          <p className="text-muted-foreground">
            Please use the link from your daily Slack DM to access the task dashboard.
          </p>
        </div>
      </div>
    ),
  },
  // Client dashboard routes (Feature 35 — separate auth via Slack OAuth)
  {
    path: '/client/login',
    element: <LazyPage><ClientLoginPage /></LazyPage>,
  },
  {
    path: '/client',
    element: <ClientLayout />,
    children: [
      { index: true, element: <LazyPage><ClientOverviewPage /></LazyPage> },
      { path: 'billing', element: <LazyPage><ClientBillingPage /></LazyPage> },
      { path: 'enrichments', element: <LazyPage><ClientEnrichmentsPage /></LazyPage> },
      { path: 'channels', element: <LazyPage><ClientChannelsPage /></LazyPage> },
      { path: 'packs', element: <LazyPage><PackCatalogPage /></LazyPage> },
      { path: 'settings', element: <LazyPage><ClientSettingsPage /></LazyPage> },
    ],
  },
  {
    path: '/login',
    element: (
      <RedirectIfAuth>
        <LazyPage>
          <LoginPage />
        </LazyPage>
      </RedirectIfAuth>
    ),
  },
  // Config doc upload (public route, token-based auth)
  {
    path: '/upload/:token',
    element: <LazyPage><UploadPage /></LazyPage>,
  },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <LazyPage><OverviewPage /></LazyPage> },
      { path: 'usage', element: <LazyPage><UsagePage /></LazyPage> },
      { path: 'errors', element: <LazyPage><ErrorsPage /></LazyPage> },
      { path: 'workspaces', element: <LazyPage><ClientsPage /></LazyPage> },
      { path: 'workspaces/:id', element: <LazyPage><ClientsPage /></LazyPage> },
      { path: 'clients', element: <LazyPage><ManagedClientsPage /></LazyPage> },
      { path: 'clients/:id', element: <LazyPage><ManagedClientsPage /></LazyPage> },
      { path: 'bdrs', element: <LazyPage><ManagedBdrsPage /></LazyPage> },
      { path: 'bdrs/:id', element: <LazyPage><ManagedBdrsPage /></LazyPage> },
      { path: 'jobs', element: <LazyPage><JobsPage /></LazyPage> },
      { path: 'enrichment', element: <LazyPage><EnrichmentPage /></LazyPage> },
      { path: 'thresholds', element: <LazyPage><ThresholdsPage /></LazyPage> },
      { path: 'reports', element: <LazyPage><ReportsPage /></LazyPage> },
      { path: 'settings', element: <LazyPage><SettingsPage /></LazyPage> },
      { path: 'users', element: <LazyPage><UsersPage /></LazyPage> },
      { path: 'campaigns', element: <LazyPage><CampaignsPage /></LazyPage> },
      { path: 'campaigns/create', element: <LazyPage><CampaignCreatePage /></LazyPage> },
      { path: 'campaigns/:id', element: <LazyPage><CampaignDetailPage /></LazyPage> },
      { path: 'bdr-activity', element: <LazyPage><BdrActivityPage /></LazyPage> },
      { path: 'eod-reports', element: <LazyPage><EodReportsPage /></LazyPage> },
      { path: 'onboarding-plans', element: <LazyPage><OnboardingPlansPage /></LazyPage> },
      { path: 'onboarding-plans/new', element: <LazyPage><OnboardingPlanDetailPage /></LazyPage> },
      { path: 'onboarding-plans/:planId', element: <LazyPage><OnboardingPlanDetailPage /></LazyPage> },
      { path: 'onboarding-enrollments', element: <LazyPage><OnboardingEnrollmentsPage /></LazyPage> },
      { path: 'onboarding-enrollments/:enrollmentId', element: <LazyPage><OnboardingEnrollmentsPage /></LazyPage> },
      { path: 'onboarding-progress', element: <LazyPage><OnboardingProgressPage /></LazyPage> },
      { path: 'content-library', element: <LazyPage><ContentLibraryPage /></LazyPage> },
      { path: 'billing', element: <LazyPage><BillingPage /></LazyPage> },
      { path: 'billing/new', element: <LazyPage><BillingDetailPage /></LazyPage> },
      { path: 'billing/:profileId', element: <LazyPage><BillingDetailPage /></LazyPage> },
      { path: 'credit-rates', element: <LazyPage><CreditRatesPage /></LazyPage> },
      { path: 'provider-costs', element: <LazyPage><ProviderCostsPage /></LazyPage> },
      { path: 'workflows', element: <LazyPage><WorkflowsPage /></LazyPage> },
      { path: 'workflows/new', element: <LazyPage><WorkflowBuilderPage /></LazyPage> },
      { path: 'workflows/:workflowId/edit', element: <LazyPage><WorkflowBuilderPage /></LazyPage> },
      { path: 'workflows/:workflowId/analytics', element: <LazyPage><WorkflowAnalyticsPage /></LazyPage> },
      { path: 'workflows/:workflowId/executions/:executionId', element: <LazyPage><WorkflowExecutionDetailPage /></LazyPage> },
      { path: 'workflows/style-test', element: <LazyPage><WorkflowStyleTestPage /></LazyPage> },
      { path: 'channel-mappings', element: <LazyPage><ChannelMappingsPage /></LazyPage> },
      { path: 'apollo-cache', element: <LazyPage><ApolloCachePage /></LazyPage> },
      { path: 'cache-metrics', element: <LazyPage><CacheMetricsPage /></LazyPage> },
      { path: 'crm/connections', element: <LazyPage><CrmConnectionsPage /></LazyPage> },
      { path: 'crm/connections/:connectionId/mappings', element: <LazyPage><CrmFieldMappingsPage /></LazyPage> },
      { path: 'prompts', element: <LazyPage><PromptLibraryPage /></LazyPage> },
      { path: 'prompts/variables', element: <LazyPage><PromptVariablesPage /></LazyPage> },
      { path: 'prompts/:slug', element: <LazyPage><PromptDetailPage /></LazyPage> },
      { path: 'prompts/:slug/diff', element: <LazyPage><PromptDiffPage /></LazyPage> },
      { path: 'active-calls', element: <LazyPage><ActiveCallsPage /></LazyPage> },
      { path: 'recordings', element: <LazyPage><RecordingsPage /></LazyPage> },
      { path: 'recordings/:recordingId', element: <LazyPage><RecordingDetailPage /></LazyPage> },
      { path: 'dialer-analytics', element: <LazyPage><DialerAnalyticsPage /></LazyPage> },
      { path: 'salesfloor', element: <LazyPage><SalesfloorPage /></LazyPage> },
      { path: 'network-requirements', element: <LazyPage><NetworkRequirementsPage /></LazyPage> },
      { path: 'contacts/:contactId', element: <LazyPage><ContactDetailPage /></LazyPage> },
      { path: 'licensing', element: <LazyPage><LicensingPage /></LazyPage> },
      { path: 'workspace-mgmt', element: <LazyPage><WorkspaceManagementPage /></LazyPage> },
      // Autonomous agent routes (Feature 31)
      { path: 'autonomous', element: <LazyPage><AutonomousDashboardPage /></LazyPage> },
      { path: 'autonomous/agents', element: <LazyPage><AutonomousAgentListPage /></LazyPage> },
      { path: 'autonomous/agents/:agentId', element: <LazyPage><AutonomousAgentDetailPage /></LazyPage> },
      { path: 'autonomous/teams', element: <LazyPage><AutonomousTeamListPage /></LazyPage> },
      { path: 'autonomous/teams/:teamId', element: <LazyPage><AutonomousTeamDetailPage /></LazyPage> },
      { path: 'autonomous/audit', element: <LazyPage><AutonomousAuditTrailPage /></LazyPage> },
      { path: 'autonomous/events', element: <LazyPage><AutonomousSystemEventsPage /></LazyPage> },
      // Platform routes (Feature 39)
      { path: 'platform/agents', element: <LazyPage><AgentRegistryPage /></LazyPage> },
      { path: 'platform/agents/new', element: <LazyPage><AgentDetailPage /></LazyPage> },
      { path: 'platform/agents/:agentId', element: <LazyPage><AgentDetailPage /></LazyPage> },
      { path: 'platform/mcp-servers', element: <LazyPage><McpServersPage /></LazyPage> },
      { path: 'platform/mcp-servers/new', element: <LazyPage><McpServerDetailPage /></LazyPage> },
      { path: 'platform/mcp-servers/:serverId', element: <LazyPage><McpServerDetailPage /></LazyPage> },
      { path: 'platform/skills', element: <LazyPage><SkillComposerPage /></LazyPage> },
      { path: 'platform/skills/new', element: <LazyPage><SkillDetailPage /></LazyPage> },
      { path: 'platform/skills/:skillId', element: <LazyPage><SkillDetailPage /></LazyPage> },
      { path: 'platform/packs', element: <LazyPage><PackManagerPage /></LazyPage> },
      { path: 'platform/packs/new', element: <LazyPage><PackDetailPage /></LazyPage> },
      { path: 'platform/packs/:packId', element: <LazyPage><PackDetailPage /></LazyPage> },
      { path: 'platform/executions', element: <LazyPage><ExecutionLogsPage /></LazyPage> },
      { path: 'platform/analytics', element: <LazyPage><PlatformAnalyticsPage /></LazyPage> },
    ],
  },
]);
