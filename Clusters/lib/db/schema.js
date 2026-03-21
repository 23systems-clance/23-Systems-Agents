import { pgTable, text, integer, bigint, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('admin'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const chats = pgTable('chats', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull().default('New Chat'),
  starred: integer('starred').notNull().default(0),
  codeWorkspaceId: text('code_workspace_id'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  notification: text('notification').notNull(),
  payload: text('payload').notNull(),
  read: integer('read').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey(),
  platform: text('platform').notNull(),
  channelId: text('channel_id').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const codeWorkspaces = pgTable('code_workspaces', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  containerName: text('container_name').unique(),
  repo: text('repo'),
  branch: text('branch'),
  featureBranch: text('feature_branch'),
  title: text('title').notNull().default('Code Workspace'),
  codingAgent: text('coding_agent').notNull().default('claude-code'),
  lastInteractiveCommit: text('last_interactive_commit'),
  starred: integer('starred').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const clusters = pgTable('clusters', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull().default('New Cluster'),
  systemPrompt: text('system_prompt').notNull().default(''),
  folders: text('folders'),
  enabled: integer('enabled').notNull().default(0),
  starred: integer('starred').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const clusterRoles = pgTable('cluster_roles', {
  id: text('id').primaryKey(),
  clusterId: text('cluster_id').notNull(),
  roleName: text('role_name').notNull(),
  role: text('role').notNull().default(''),
  prompt: text('prompt').notNull().default('Execute your role.'),
  triggerConfig: text('trigger_config'),
  maxConcurrency: integer('max_concurrency').notNull().default(1),
  cleanupWorkerDir: integer('cleanup_worker_dir').notNull().default(0),
  folders: text('folders'),
  mcpServers: text('mcp_servers'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const leads = pgTable('leads', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  projectSummary: text('project_summary'),
  conversationJson: text('conversation_json'),
  recommendationsJson: text('recommendations_json'),
  reportPath: text('report_path'),
  personaMode: text('persona_mode'),
  source: text('source').notNull().default('consult-page'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export const settings = pgTable('settings', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  createdBy: text('created_by'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

// --- New tables for Spec 006: Infrastructure Migration ---

export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  prompt: text('prompt').notNull(),
  status: text('status').notNull().default('queued'),
  branch: text('branch'),
  prUrl: text('pr_url'),
  prNumber: integer('pr_number'),
  commitSha: text('commit_sha'),
  logSha: text('log_sha'),
  exitCode: integer('exit_code'),
  error: text('error'),
  mergeResult: text('merge_result'),
  changedFiles: text('changed_files'),
  llmProvider: text('llm_provider'),
  llmModel: text('llm_model'),
  agentBackend: text('agent_backend').default('pi'),
  startedAt: bigint('started_at', { mode: 'number' }),
  completedAt: bigint('completed_at', { mode: 'number' }),
  durationMs: bigint('duration_ms', { mode: 'number' }),
  currentStep: text('current_step'),
  stepHistory: text('step_history'),
  retryCount: integer('retry_count').default(0),
  validationErrors: text('validation_errors'),
  bullmqJobId: text('bullmq_job_id'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
}, (table) => [
  index('idx_jobs_status').on(table.status),
  index('idx_jobs_created_at').on(table.createdAt),
]);

export const capabilities = pgTable('capabilities', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),
  version: text('version').default('1.0.0'),
  sourcePath: text('source_path'),
  config: text('config'),
  enabled: integer('enabled').notNull().default(1),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
}, (table) => [
  index('idx_capabilities_type').on(table.type),
  index('idx_capabilities_category').on(table.category),
]);

export const jobCapabilities = pgTable('job_capabilities', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  capabilityId: text('capability_id').notNull(),
  tokensUsed: integer('tokens_used').default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => [
  index('idx_job_capabilities_job').on(table.jobId),
]);
