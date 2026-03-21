/** Centralized React Query key factory. */
export const queryKeys = {
  overview: (params?: Record<string, string>) => ['overview', params] as const,
  usage: {
    trends: (params?: Record<string, string>) => ['usage', 'trends', params] as const,
    logs: (params?: Record<string, string>) => ['usage', 'logs', params] as const,
  },
  errors: {
    list: (params?: Record<string, string>) => ['errors', 'list', params] as const,
    detail: (id: string) => ['errors', 'detail', id] as const,
    trends: (params?: Record<string, string>) => ['errors', 'trends', params] as const,
  },
  workspaces: {
    list: (params?: Record<string, string>) => ['workspaces', 'list', params] as const,
    detail: (id: string) => ['workspaces', 'detail', id] as const,
  },
  managedClients: {
    list: (params?: Record<string, string>) => ['managedClients', 'list', params] as const,
    detail: (id: string) => ['managedClients', 'detail', id] as const,
    hubspot: (id: string) => ['managedClients', 'hubspot', id] as const,
  },
  bdrs: {
    list: (params?: Record<string, string>) => ['bdrs', 'list', params] as const,
    detail: (id: string) => ['bdrs', 'detail', id] as const,
  },
  jobs: {
    list: (params?: Record<string, string>) => ['jobs', 'list', params] as const,
    detail: (id: string) => ['jobs', 'detail', id] as const,
  },
  thresholds: {
    list: () => ['thresholds'] as const,
  },
  reports: {
    scheduled: () => ['reports', 'scheduled'] as const,
  },
  retention: {
    list: () => ['retention'] as const,
  },
  users: {
    list: () => ['users'] as const,
  },
  enrichmentPresets: {
    list: () => ['enrichmentPresets'] as const,
  },
  onboardingPlans: {
    list: (params?: Record<string, string>) => ['onboardingPlans', 'list', params] as const,
    detail: (id: string) => ['onboardingPlans', 'detail', id] as const,
    preview: (id: string) => ['onboardingPlans', 'preview', id] as const,
  },
  onboardingEnrollments: {
    list: (params?: Record<string, string>) => ['onboardingEnrollments', 'list', params] as const,
    detail: (id: string) => ['onboardingEnrollments', 'detail', id] as const,
  },
  onboardingProgress: {
    dashboard: (params?: Record<string, string>) => ['onboardingProgress', 'dashboard', params] as const,
    checkins: (enrollmentId: string) => ['onboardingProgress', 'checkins', enrollmentId] as const,
  },
  contentLibrary: {
    list: (params?: Record<string, string>) => ['contentLibrary', 'list', params] as const,
    categories: (params?: Record<string, string>) => ['contentLibrary', 'categories', params] as const,
  },
  workflows: {
    list: (params?: Record<string, string>) => ['workflows', 'list', params] as const,
    detail: (id: string) => ['workflows', 'detail', id] as const,
    version: (workflowId: string, versionId: string) => ['workflows', 'version', workflowId, versionId] as const,
    templates: () => ['workflows', 'templates'] as const,
    executions: (workflowId: string, params?: Record<string, string>) => ['workflows', 'executions', workflowId, params] as const,
    execution: (id: string) => ['workflows', 'execution', id] as const,
    analytics: (workflowId: string, params?: Record<string, string>) => ['workflows', 'analytics', workflowId, params] as const,
    funnel: (workflowId: string, params?: Record<string, string>) => ['workflows', 'funnel', workflowId, params] as const,
    nodeAnalytics: (workflowId: string, nodeId: string, params?: Record<string, string>) => ['workflows', 'nodeAnalytics', workflowId, nodeId, params] as const,
  },
  upload: {
    context: (token: string) => ['upload', 'context', token] as const,
    docs: (token: string) => ['upload', 'docs', token] as const,
  },
  billing: {
    list: (params?: Record<string, string>) => ['billing', 'list', params] as const,
    detail: (id: string) => ['billing', 'detail', id] as const,
    transactions: (id: string, params?: Record<string, string>) => ['billing', 'transactions', id, params] as const,
    kpis: () => ['billing', 'kpis'] as const,
  },
  creditRates: {
    active: () => ['creditRates', 'active'] as const,
    preview: (params?: Record<string, string>) => ['creditRates', 'preview', params] as const,
  },
  slackUsers: {
    list: () => ['slackUsers'] as const,
  },
  slackChannels: {
    list: (teamId: string) => ['slackChannels', teamId] as const,
  },
  channelMappings: {
    list: (teamId?: string) => ['channelMappings', teamId] as const,
  },
  qualityGateConfig: {
    detail: (clientId: string) => ['qualityGateConfig', clientId] as const,
    defaults: () => ['qualityGateConfig', 'defaults'] as const,
  },
  cache: {
    metrics: () => ['cache', 'metrics'] as const,
    config: () => ['cache', 'config'] as const,
    entries: (params?: Record<string, string>) => ['cache', 'entries', params] as const,
  },
  crm: {
    connections: (params?: Record<string, string>) => ['crm', 'connections', params] as const,
    connection: (id: string) => ['crm', 'connection', id] as const,
    fieldMappings: (connectionId: string) => ['crm', 'fieldMappings', connectionId] as const,
    properties: (connectionId: string) => ['crm', 'properties', connectionId] as const,
  },
  providerCosts: {
    list: (params?: Record<string, string>) => ['providerCosts', 'list', params] as const,
  },
  autonomous: {
    dashboard: () => ['autonomous', 'dashboard'] as const,
    agents: (params?: Record<string, string>) => ['autonomous', 'agents', params] as const,
    agent: (id: string) => ['autonomous', 'agent', id] as const,
    teams: (params?: Record<string, string>) => ['autonomous', 'teams', params] as const,
    team: (id: string) => ['autonomous', 'team', id] as const,
    audit: (params?: Record<string, string>) => ['autonomous', 'audit', params] as const,
    events: (params?: Record<string, string>) => ['autonomous', 'events', params] as const,
  },
  prompts: {
    list: (params?: Record<string, string>) => ['prompts', 'list', params] as const,
    detail: (slug: string) => ['prompts', 'detail', slug] as const,
    versions: (slug: string) => ['prompts', 'versions', slug] as const,
    version: (slug: string, versionId: string) => ['prompts', 'version', slug, versionId] as const,
    diff: (slug: string, from: string, to: string) => ['prompts', 'diff', slug, from, to] as const,
    testRuns: (slug: string, versionId: string) => ['prompts', 'testRuns', slug, versionId] as const,
    variables: () => ['prompts', 'variables'] as const,
    overrides: (workspaceId?: string) => ['prompts', 'overrides', workspaceId] as const,
  },
} as const;
