/** Overview endpoint response (GET /overview). */
export interface OverviewResponse {
  period: { startDate: string; endDate: string };
  summary: {
    totalCostUsd: string;
    totalApiCalls: number;
    totalTokensInput: number;
    totalTokensOutput: number;
    activeJobs: number;
    completedJobs: number;
    failedJobs: number;
  };
  costByProvider: Array<{
    service: string;
    costUsd: string;
    percentage: number;
  }>;
  costByWorkspace: Array<{
    slackTeamId: string;
    slackTeamName: string;
    costUsd: string;
  }>;
  openErrors: number;
  errorRatePercent: number;
}

/** Usage trends data point (GET /usage/trends). */
export interface TrendPoint {
  period: string;
  totalCostUsd: string;
  totalRequests: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalCreditsConsumed: string;
  errorCount: number;
  avgDurationMs: number | null;
}

export interface UsageTrendsResponse {
  granularity: string;
  data_points: TrendPoint[];
}

/** Usage log entry (GET /usage/logs). */
export interface UsageLogEntry {
  id: string;
  service: string;
  endpoint: string;
  responseStatus: string | null;
  durationMs: number | null;
  creditsConsumed: string;
  tokensInput: number | null;
  tokensOutput: number | null;
  estimatedCostUsd: string;
  createdAt: string;
  job: {
    id: string;
    jobType: string;
    slackUserId: string;
    slackChannelId: string;
    slackChannelName: string;
    slackTeamId: string;
  };
}

export interface UsageLogsResponse {
  logs: UsageLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

/** Error log entry (GET /errors). */
export interface ErrorEntry {
  id: string;
  category: string;
  service: string;
  message: string;
  lifecycleState: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  slackTeamId: string;
  jobId: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface ErrorsResponse {
  errors: ErrorEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface ErrorDetail extends ErrorEntry {
  stackTrace: string | null;
  metadata: Record<string, unknown>;
  context: Record<string, unknown> | null;
}

export interface ErrorTrendsResponse {
  granularity: string;
  groups: Array<{
    key: string;
    data_points: Array<{ period: string; count: number }>;
  }>;
}

/** Client (workspace) entry (GET /workspaces). */
export interface ClientEntry {
  slack_team_id: string;
  slack_team_name: string;
  total_jobs: number;
  total_api_calls: number;
  total_cost_usd: string;
  error_rate_percent: number;
  last_active_at: string;
}

export interface ClientsResponse {
  clients: ClientEntry[];
  total: number;
  limit: number;
  offset: number;
}

/** Client detail (GET /workspaces/:id). */
export interface ClientDetail {
  slack_team_id: string;
  slack_team_name: string;
  summary: {
    total_jobs: number;
    total_api_calls: number;
    total_cost_usd: string;
    error_rate_percent: number;
    last_active_at: string;
  };
  cost_by_provider: Array<{
    service: string;
    cost_usd: string;
  }>;
  top_users: Array<{
    slack_user_id: string;
    display_name: string;
    total_jobs: number;
    total_cost_usd: string;
  }>;
  recent_jobs: Array<{
    id: string;
    job_type: string;
    status: string;
    source_file_name: string;
    source_row_count: number;
    purpose: string | null;
    is_cosell: boolean;
    cosell_provider: string | null;
    list_owner: string | null;
    created_at: string;
  }>;
}

/** Job list entry (GET /jobs). */
export interface JobListEntry {
  id: string;
  job_type: string;
  status: string;
  source_file_name: string | null;
  source_row_count: number | null;
  purpose: string | null;
  is_cosell: boolean;
  cosell_provider: string | null;
  list_owner: string | null;
  slack_user_id: string;
  slack_team_id: string;
  slack_channel_name: string | null;
  companies_processed: number;
  contacts_found: number;
  quality_gate_summary: {
    totalRows: number;
    passedRows: number;
    filteredRows: number;
    uniqueDomains: number;
  } | null;
  created_at: string;
  completed_at: string | null;
}

export interface JobsResponse {
  jobs: JobListEntry[];
  total: number;
  limit: number;
  offset: number;
}

/** Full job detail (GET /jobs/:id). */
export interface JobDetail {
  id: string;
  job_type: string;
  status: string;
  progress: number;
  source_file_name: string | null;
  source_file_type: string | null;
  source_row_count: number | null;
  result_file_url: string | null;
  result_file_name: string | null;

  // Conversation flow
  purpose: string | null;
  is_cosell: boolean;
  cosell_provider: string | null;
  list_owner: string | null;
  additional_context: string | null;
  enrich_instruction: string | null;
  parsed_intent: Record<string, unknown> | null;

  // Slack context
  slack_channel_id: string;
  slack_channel_name: string | null;
  slack_thread_ts: string;
  slack_user_id: string;
  slack_team_id: string;

  // Processing results
  companies_processed: number;
  companies_failed: number;
  contacts_found: number;
  error_message: string | null;

  // Persona breakdown
  persona_summary: Array<{ persona_type: string; count: number }>;
  decision_maker_count: number;
  total_contacts: number;

  // Cost
  api_cost: {
    total_cost_usd: string;
    total_tokens_input: number;
    total_tokens_output: number;
    log_count: number;
  };

  // API usage detail
  api_usage_logs: Array<{
    service: string;
    endpoint: string;
    estimated_cost_usd: string;
    credits_consumed: string;
    tokens_input: number | null;
    tokens_output: number | null;
    duration_ms: number | null;
    created_at: string;
  }>;

  // Quality gate (Feature 16)
  quality_gate_result: {
    totalRows: number;
    passedRows: number;
    filteredRows: number;
    uniqueDomains: number;
    duplicateDomainRows: number;
    filterBreakdown: {
      personalEmail: number;
      missingCompany: number;
      suppressionDomain: number;
      duplicateEmail: number;
    };
    filteredFileUrl: string | null;
    filteredFileKey: string | null;
    processingTimeMs: number;
  } | null;
  quality_gate_config_snapshot: Record<string, unknown> | null;

  // Timestamps
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Budget threshold (GET /thresholds). */
export interface Threshold {
  id: string;
  name: string;
  amount_usd: number;
  provider_scope: string | null;
  slack_channel_id: string | null;
  is_active: boolean;
  current_month_spend: number;
  triggered: boolean;
  created_at: string;
  updated_at: string;
}

export interface ThresholdsResponse {
  thresholds: Threshold[];
}

export interface ThresholdCreateInput {
  name: string;
  amount_usd: number;
  provider_scope?: string;
  slack_channel_id?: string;
  is_active?: boolean;
}

/** Scheduled report (GET /reports/scheduled). */
export interface ScheduledReport {
  id: string;
  name: string;
  report_type: string;
  frequency: string;
  slack_channel_id: string;
  filters: Record<string, string>;
  is_active: boolean;
  last_run_at: string | null;
  last_error: string | null;
  created_by: { id: string; name: string };
}

export interface ScheduledReportsResponse {
  reports: ScheduledReport[];
}

export interface ScheduledReportInput {
  name: string;
  report_type: string;
  frequency: string;
  slack_channel_id: string;
  filters?: Record<string, string>;
  is_active?: boolean;
}

/** Retention config (GET /retention). */
export interface RetentionConfig {
  data_type: string;
  retention_days: number;
  last_purged_at: string | null;
  locked: boolean;
}

export interface RetentionResponse {
  configs: RetentionConfig[];
}

/** Admin user (GET /users). */
export interface AdminUserEntry {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: 'ADMIN' | 'VIEWER';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUsersResponse {
  users: AdminUserEntry[];
}

export interface AdminUserCreateInput {
  name: string;
  email: string;
  username: string;
  password: string;
  role: 'ADMIN' | 'VIEWER';
}

export interface AdminUserCreateResponse extends AdminUserEntry {
  apiKey: string;
}

// ---------------------------------------------------------------------------
// Managed Clients (business entities with API keys)
// ---------------------------------------------------------------------------

/** Managed client entry (GET /clients). */
export interface ManagedClientEntry {
  id: string;
  name: string;
  slug: string;
  slackTeamId: string;
  hasInstantlyKey: boolean;
  hasHeyreachKey: boolean;
  hasHubspotKey: boolean;
  hubspotPortalId: string | null;
  isActive: boolean;
  bdrCount: number;
  channelCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedClientsResponse {
  clients: ManagedClientEntry[];
  total: number;
}

/** Channel mapping summary for client detail. */
export interface ChannelMappingSummary {
  id: string;
  slackChannelId: string;
  slackTeamId: string;
  channelName: string | null;
}

/** Campaign summary for client detail. */
export interface CampaignSummary {
  id: string;
  name: string;
  campaignType: string;
  status: string;
  totalContacts: number;
  activeContacts: number;
  completedContacts: number;
  createdAt: string;
}

/** Workflow summary for client detail. */
export interface ClientWorkflowSummary {
  id: string;
  name: string;
  trigger_type: string;
  is_active: boolean;
  current_version: number | null;
  published_at: string | null;
  created_at: string;
}

/** Managed client detail with associated BDRs, channels, campaigns, and workflows (GET /clients/:id). */
export interface ManagedClientDetail {
  id: string;
  name: string;
  slug: string;
  slackTeamId: string;
  hasInstantlyKey: boolean;
  hasHeyreachKey: boolean;
  hasHubspotKey: boolean;
  hubspotPortalId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  bdrs: BdrSummary[];
  channels: ChannelMappingSummary[];
  campaigns: CampaignSummary[];
  workflows: ClientWorkflowSummary[];
}

/** HubSpot connection details returned by GET /clients/:id/hubspot. */
export interface HubSpotConnectionInfo {
  id: string;
  status: 'ACTIVE' | 'DISCONNECTED' | 'TOKEN_EXPIRED' | 'ERROR';
  hubspotPortalId: string;
  hubspotPortalName: string | null;
  grantedScopes: string[];
  connectedBy: string;
  connectedAt: string;
  lastRefreshedAt: string | null;
  tokenExpiresAt: string;
  totalContactsSynced: number;
  totalActivitiesLogged: number;
  totalSyncFailures: number;
  lastSyncAt: string | null;
}

export interface HubSpotImportJobSummary {
  id: string;
  listName: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  contactsCreated: number;
  contactsUpdated: number;
  contactsFailed: number;
  contactsTotal: number;
  hubspotListUrl: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface HubSpotSyncLogSummary {
  id: string;
  syncType: string;
  direction: string;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export type HubSpotClientResponse =
  | { connected: false }
  | {
      connected: true;
      connection: HubSpotConnectionInfo;
      recentImports: HubSpotImportJobSummary[];
      recentSyncLogs: HubSpotSyncLogSummary[];
    };

export interface ManagedClientCreateInput {
  name: string;
  slug?: string;
  slackTeamId?: string;
  instantlyApiKey?: string;
  heyreachApiKey?: string;
  hubspotApiKey?: string;
  hubspotPortalId?: string;
}

export interface ManagedClientUpdateInput {
  name?: string;
  slug?: string;
  slackTeamId?: string;
  instantlyApiKey?: string;
  heyreachApiKey?: string;
  hubspotApiKey?: string;
  hubspotPortalId?: string;
  isActive?: boolean;
}

/** Slack channel returned by GET /slack/channels. */
export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  memberCount: number;
  topic: string | null;
}

export interface SlackChannelsResponse {
  channels: SlackChannel[];
}

// ---------------------------------------------------------------------------
// BDRs (Business Development Representatives)
// ---------------------------------------------------------------------------

/** BDR entry (GET /bdrs). */
export interface BdrEntry {
  id: string;
  name: string;
  email: string | null;
  slackUserId: string;
  slackTeamId: string;
  isActive: boolean;
  clientCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BdrsResponse {
  bdrs: BdrEntry[];
  total: number;
}

/** BDR detail with associated clients (GET /bdrs/:id). */
export interface BdrDetail {
  id: string;
  name: string;
  email: string | null;
  slackUserId: string;
  slackTeamId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  clients: ClientSummary[];
}

export interface BdrCreateInput {
  name: string;
  email?: string;
  slackUserId: string;
  slackTeamId: string;
}

export interface BdrUpdateInput {
  name?: string;
  email?: string;
  slackUserId?: string;
  slackTeamId?: string;
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Slack Users
// ---------------------------------------------------------------------------

/** Slack workspace member returned by GET /slack/users. */
export interface SlackUser {
  id: string;
  teamId: string;
  name: string;
  email: string | null;
  avatar: string | null;
  title: string | null;
}

export interface SlackUsersResponse {
  users: SlackUser[];
}

// ---------------------------------------------------------------------------
// Enrichment Presets
// ---------------------------------------------------------------------------

/** Enrichment preset entry (GET /enrichment-presets). */
export interface EnrichmentPresetEntry {
  id: string;
  name: string;
  isDefault: boolean;
  scope: 'global' | 'private';
  personSeniorities: string[];
  personTitles: string[];
  personDepartments: string[];
  personFunctions: string[];
  perPage: number;
  createdByUserId: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnrichmentPresetsResponse {
  presets: EnrichmentPresetEntry[];
  total: number;
}

export interface EnrichmentPresetCreateInput {
  name: string;
  isDefault?: boolean;
  scope?: 'global' | 'private';
  personSeniorities: string[];
  personTitles?: string[];
  personDepartments?: string[];
  personFunctions?: string[];
  perPage?: number;
}

// ---------------------------------------------------------------------------
// Onboarding Plans (Feature 7)
// ---------------------------------------------------------------------------

/** Training item content types. */
export type TrainingItemType = 'VIDEO' | 'READING' | 'QUIZ' | 'PRACTICE_TASK' | 'CHECKLIST' | 'RESOURCE_LINK' | 'REIMBURSEMENT_INFO';

/** Automation trigger types. */
export type AutomationType = 'CHECK_IN' | 'REMINDER' | 'WEEKLY_SUMMARY' | 'CUSTOM_MESSAGE';

/** Onboarding enrollment statuses. */
export type OnboardingEnrollmentStatus =
  | 'ACTIVE'
  | 'SUPERVISED'
  | 'PENDING_GRADUATION'
  | 'GRADUATED'
  | 'EXTENDED'
  | 'CANCELLED';

/** Module progress statuses. */
export type OnboardingModuleStatus = 'PENDING' | 'DELIVERED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';

/** Manager review statuses for practice tasks. */
export type ManagerReviewStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

/** Training item within an onboarding module. */
export interface OnboardingTrainingItem {
  id: string;
  type: TrainingItemType;
  title: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
  estimated_minutes: number | null;
  sort_order: number;
  library_item_id: string | null;
}

/** Automation within an onboarding module. */
export interface OnboardingAutomation {
  id: string;
  type: AutomationType;
  trigger_time: string;
  content: string | null;
  conditions: Record<string, unknown> | null;
}

/** Module within an onboarding plan. */
export interface OnboardingModule {
  id: string;
  day_number: number;
  week_number: number;
  title: string;
  description: string | null;
  estimated_minutes: number | null;
  training_items: OnboardingTrainingItem[];
  automations: OnboardingAutomation[];
}

/** Plan list entry (GET /onboarding-plans). */
export interface OnboardingPlanListEntry {
  id: string;
  name: string;
  description: string | null;
  duration_days: number;
  supervised_start_day: number | null;
  version: number;
  is_latest: boolean;
  weekdays_only: boolean;
  module_count: number;
  active_enrollments: number;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

/** Plan detail with modules (GET /onboarding-plans/:id). */
export interface OnboardingPlanDetail {
  id: string;
  name: string;
  description: string | null;
  duration_days: number;
  supervised_start_day: number | null;
  version: number;
  is_latest: boolean;
  weekdays_only: boolean;
  created_by_user_id: string;
  created_at: string;
  modules: OnboardingModule[];
}

export interface OnboardingPlansResponse {
  plans: OnboardingPlanListEntry[];
}

export interface OnboardingPlanResponse {
  plan: OnboardingPlanDetail;
}

/** Input for creating/updating a training item within a module. */
export interface TrainingItemInput {
  type: TrainingItemType;
  title: string;
  content?: string;
  metadata?: Record<string, unknown>;
  estimated_minutes?: number;
  library_item_id?: string;
}

/** Input for creating/updating an automation within a module. */
export interface AutomationInput {
  type: AutomationType;
  trigger_time: string;
  content?: string;
  conditions?: Record<string, unknown>;
}

/** Input for creating/updating a module within a plan. */
export interface ModuleInput {
  day_number: number;
  title: string;
  description?: string;
  estimated_minutes?: number;
  training_items: TrainingItemInput[];
  automations: AutomationInput[];
}

/** Input for creating a new onboarding plan. */
export interface OnboardingPlanCreateInput {
  slack_team_id: string;
  name: string;
  description?: string;
  duration_days: number;
  supervised_start_day?: number;
  weekdays_only?: boolean;
  modules: ModuleInput[];
}

/** Preview day entry (GET /onboarding-plans/:id/preview). */
export interface PlanPreviewDay {
  day_number: number;
  week_number: number;
  module_title: string;
  dm_blocks: unknown[];
  automations: Array<{
    type: AutomationType;
    trigger_time: string;
    content: string | null;
  }>;
}

export interface PlanPreviewResponse {
  preview: PlanPreviewDay[];
}

/** Summary types for association displays. */
export interface ClientSummary {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

export interface BdrSummary {
  id: string;
  name: string;
  email: string | null;
  slackUserId: string;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Onboarding Enrollments (Feature 7)
// ---------------------------------------------------------------------------

/** Enrollment list entry (GET /onboarding-enrollments). */
export interface OnboardingEnrollmentListEntry {
  id: string;
  bdr_name: string;
  slack_user_id: string;
  plan_name: string;
  plan_id: string;
  start_date: string;
  status: OnboardingEnrollmentStatus;
  current_day: number;
  total_days: number;
  progress_percentage: number;
  modules_completed: number;
  modules_total: number;
  days_behind: number;
  manager_id: string;
  delivery_hour: number;
  timezone: string;
  expected_end_date: string;
  supervised_campaign_id: string | null;
  created_at: string;
}

export interface OnboardingEnrollmentsResponse {
  enrollments: OnboardingEnrollmentListEntry[];
  summary: {
    total_active: number;
    total_supervised: number;
    total_pending_graduation: number;
    average_progress: number;
  };
}

/** Enrollment detail (GET /onboarding-enrollments/:id). */
export interface OnboardingModuleProgressEntry {
  day_number: number;
  module_title: string;
  status: OnboardingModuleStatus;
  delivered_at: string | null;
  completed_at: string | null;
  quiz_score: number | null;
  manager_review_status: ManagerReviewStatus | null;
  checkin_responses: Array<{
    automation_type: string;
    response: string;
    responded_at: string;
  }>;
}

export interface OnboardingEnrollmentDetail {
  id: string;
  bdr_name: string;
  slack_user_id: string;
  plan: {
    id: string;
    name: string;
    duration_days: number;
    supervised_start_day: number | null;
  };
  start_date: string;
  status: OnboardingEnrollmentStatus;
  current_day: number;
  progress_percentage: number;
  manager_id: string;
  delivery_hour: number;
  timezone: string;
  supervised_campaign_id: string | null;
  graduated_at: string | null;
  extended_days: number;
  module_progress: OnboardingModuleProgressEntry[];
}

export interface OnboardingEnrollmentDetailResponse {
  enrollment: OnboardingEnrollmentDetail;
}

export interface OnboardingEnrollBdrInput {
  slack_team_id: string;
  slack_user_id: string;
  bdr_name: string;
  plan_id: string;
  manager_id: string;
  start_date: string;
  delivery_hour: number;
  timezone: string;
}

export interface OnboardingEnrollmentUpdateInput {
  delivery_hour?: number;
  timezone?: string;
  supervised_campaign_id?: string | null;
}

// ---------------------------------------------------------------------------
// Onboarding Progress Dashboard (Feature 7)
// ---------------------------------------------------------------------------

/** Alert types for onboarding progress monitoring. */
export type OnboardingAlertType = 'behind_schedule' | 'overdue' | 'quiz_failed';

/** Alert entry in the onboarding dashboard. */
export interface OnboardingAlert {
  type: OnboardingAlertType;
  enrollment_id: string;
  bdr_name: string;
  days_behind?: number;
  current_module?: string;
  days_past_expected?: number;
  quiz_topic?: string;
  score?: number;
}

/** Recent graduate entry. */
export interface OnboardingGraduate {
  bdr_name: string;
  plan_name: string;
  graduated_at: string;
  completion_days: number;
}

/** Struggle module entry for analytics. */
export interface OnboardingStruggleModule {
  module_title: string;
  day_number: number;
  incomplete_rate: number;
}

/** Full onboarding dashboard response. */
export interface OnboardingDashboard {
  total_active_enrollments: number;
  total_supervised: number;
  total_pending_graduation: number;
  total_graduated_all_time: number;
  average_progress_percentage: number;
  average_graduation_days: number | null;
  common_struggle_modules: OnboardingStruggleModule[];
  alerts: OnboardingAlert[];
  recent_graduates: OnboardingGraduate[];
}

/** Check-in response entry. */
export interface OnboardingCheckinEntry {
  id: string;
  day_number: number;
  automation_type: string;
  prompt: string;
  response: string;
  responded_at: string;
}

// ---------------------------------------------------------------------------
// Content Library (Feature 7)
// ---------------------------------------------------------------------------

/** Content library item entry. */
export interface ContentLibraryItemEntry {
  id: string;
  team_id: string;
  type: TrainingItemType;
  title: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
  estimated_minutes: number | null;
  category_tags: string[];
  usage_count: number;
  created_at: string;
  updated_at: string;
}

/** Content library list response. */
export interface ContentLibraryResponse {
  items: ContentLibraryItemEntry[];
  total: number;
}

/** Content library category with count. */
export interface ContentCategory {
  tag: string;
  count: number;
}

/** Input for creating a content library item. */
export interface ContentLibraryItemCreateInput {
  team_id: string;
  type: TrainingItemType;
  title: string;
  content?: string;
  metadata?: Record<string, unknown>;
  estimated_minutes?: number;
  category_tags?: string[];
}

/** Input for updating a content library item. */
export interface ContentLibraryItemUpdateInput {
  type?: TrainingItemType;
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  estimated_minutes?: number;
  category_tags?: string[];
}

// ---------------------------------------------------------------------------
// Workflow Builder types
// ---------------------------------------------------------------------------

export interface WorkflowGraph {
  nodes: WorkflowNodeData[];
  edges: WorkflowEdgeData[];
  viewport?: { x: number; y: number; zoom: number };
}

export interface WorkflowNodeData {
  id: string;
  type: string;
  label?: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface WorkflowEdgeData {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  condition?: {
    field: string;
    operator: string;
    value?: string | number | boolean;
  };
  label?: string;
}

export interface WorkflowVersionSummary {
  id: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  published_at: string | null;
  node_count: number;
  edge_count: number;
}

export interface WorkflowVersionDetail extends WorkflowVersionSummary {
  graph: WorkflowGraph;
  created_at: string;
  updated_at: string;
}

export interface WorkflowChannelMapping {
  id: string;
  slack_channel_id: string;
  slack_team_id: string;
  trigger_type: string;
  created_by_user_id?: string;
  created_at?: string;
}

export interface WorkflowListItem {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  is_active: boolean;
  client_id: string | null;
  client_name: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  current_version: WorkflowVersionSummary | null;
  draft_version: WorkflowVersionSummary | null;
  total_runs: number;
  completion_rate: number;
}

export interface WorkflowDetail {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  is_active: boolean;
  client_id: string | null;
  client_name: string | null;
  channel_mappings: WorkflowChannelMapping[];
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  versions: WorkflowVersionSummary[];
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  node_count: number;
  preview_image?: string | null;
  is_custom?: boolean;
}

export interface WorkflowExecutionListItem {
  id: string;
  version_id: string;
  version_number: number;
  slack_user_id: string;
  slack_channel_id: string;
  status: string;
  current_node_id: string | null;
  node_history_count: number;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
}

export interface WorkflowExecutionDetail {
  id: string;
  version_id: string;
  slack_team_id: string;
  slack_user_id: string;
  slack_channel_id: string;
  slack_thread_ts: string;
  status: string;
  current_node_id: string | null;
  context: Record<string, unknown>;
  node_history: Array<{
    node_id: string;
    node_type: string;
    entered_at: string;
    exited_at?: string;
    output?: unknown;
    user_input?: unknown;
  }>;
  error_message: string | null;
  expires_at: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface WorkflowListResponse {
  workflows: WorkflowListItem[];
  total: number;
}

export interface WorkflowExecutionListResponse {
  executions: WorkflowExecutionListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface WorkflowTemplateListResponse {
  templates: WorkflowTemplate[];
}

export interface ValidationResultResponse {
  valid: boolean;
  errors: Array<{ message: string; node_id?: string }>;
  warnings: Array<{ message: string; node_id?: string }>;
}

// ---------------------------------------------------------------------------
// Workflow Analytics types
// ---------------------------------------------------------------------------

export interface WorkflowAnalyticsResponse {
  total_runs: number;
  completed: number;
  failed: number;
  expired: number;
  cancelled: number;
  completion_rate: number;
  avg_duration_seconds: number | null;
  median_duration_seconds: number | null;
  daily_runs: Array<{
    date: string;
    total: number;
    completed: number;
    failed: number;
  }>;
}

export interface WorkflowFunnelStep {
  node_id: string;
  node_type: string;
  label: string;
  reached: number;
  completed: number;
  drop_off_count: number;
  drop_off_rate: number;
}

export interface WorkflowFunnelResponse {
  steps: WorkflowFunnelStep[];
}

export interface NodeAnalyticsResponse {
  reached: number;
  completed: number;
  avg_time_seconds: number | null;
  choice_distribution: Array<{
    label: string;
    count: number;
    percentage: number;
  }>;
}
