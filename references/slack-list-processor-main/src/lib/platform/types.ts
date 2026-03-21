/**
 * Shared TypeScript types for the Vertical Pack Platform.
 *
 * These interfaces mirror the Prisma models defined in data-model.md
 * and are used across services, routes, and workers.
 */

// ---------------------------------------------------------------------------
// Enums (mirrored from Prisma schema)
// ---------------------------------------------------------------------------

export enum AgentStatus {
  DRAFT = 'DRAFT',
  TESTING = 'TESTING',
  PUBLISHED = 'PUBLISHED',
  DEPRECATED = 'DEPRECATED',
}

export enum McpServerStatus {
  HEALTHY = 'HEALTHY',
  ERROR = 'ERROR',
  UNKNOWN = 'UNKNOWN',
}

export enum McpAuthType {
  API_KEY = 'API_KEY',
  OAUTH2 = 'OAUTH2',
  BEARER_TOKEN = 'BEARER_TOKEN',
  BASIC_AUTH = 'BASIC_AUTH',
  NONE = 'NONE',
}

export enum SkillStatus {
  DRAFT = 'DRAFT',
  TESTING = 'TESTING',
  PUBLISHED = 'PUBLISHED',
  DEPRECATED = 'DEPRECATED',
}

export enum SkillTriggerType {
  SLACK_COMMAND = 'SLACK_COMMAND',
  API_CALL = 'API_CALL',
  SCHEDULED = 'SCHEDULED',
  EVENT = 'EVENT',
  MANUAL = 'MANUAL',
}

export enum SkillDeliveryChannel {
  SLACK_THREAD = 'SLACK_THREAD',
  EMAIL = 'EMAIL',
  CRM_SYNC = 'CRM_SYNC',
  FILE_DOWNLOAD = 'FILE_DOWNLOAD',
  WEBHOOK = 'WEBHOOK',
}

export enum PackStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  DEPRECATED = 'DEPRECATED',
}

export enum PackCategory {
  SALES = 'SALES',
  OPERATIONS = 'OPERATIONS',
  RESEARCH = 'RESEARCH',
  EXECUTIVE = 'EXECUTIVE',
  CUSTOM = 'CUSTOM',
}

export enum PackTier {
  FREE = 'FREE',
  STARTER = 'STARTER',
  GROWTH = 'GROWTH',
  AGENCY = 'AGENCY',
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum SkillExecutionStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  SPEND_LIMIT_BLOCKED = 'SPEND_LIMIT_BLOCKED',
}

// ---------------------------------------------------------------------------
// Agent interfaces
// ---------------------------------------------------------------------------

export interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: AgentStatus;
  modelId: string;
  maxTokens: number;
  creditCost: number;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  toolIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentVersion {
  id: string;
  agentId: string;
  version: number;
  status: AgentStatus;
  systemPrompt: string;
  modelId: string;
  maxTokens: number;
  toolIds: string[];
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  changeNote: string | null;
  publishedAt: Date | null;
  publishedBy: string | null;
  createdAt: Date;
}

export interface CreateAgentInput {
  name: string;
  slug: string;
  description?: string;
  modelId: string;
  systemPrompt: string;
  maxTokens: number;
  creditCost: number;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  toolIds?: string[];
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  modelId?: string;
  systemPrompt?: string;
  maxTokens?: number;
  creditCost?: number;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  toolIds?: string[];
  changeNote?: string;
}

export interface AgentTestResult {
  output: Record<string, unknown>;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  durationMs: number;
  toolCallsMade: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// MCP Server interfaces
// ---------------------------------------------------------------------------

export interface McpServer {
  id: string;
  name: string;
  slug: string;
  provider: string;
  baseUrl: string;
  authType: McpAuthType;
  credentials: string | null;
  status: McpServerStatus;
  byokEnabled: boolean;
  rateLimitRpm: number | null;
  lastHealthCheck: Date | null;
  lastHealthError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface McpTool {
  id: string;
  serverId: string;
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  creditCost: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMcpServerInput {
  name: string;
  slug: string;
  provider: string;
  baseUrl: string;
  authType: McpAuthType;
  credentials?: Record<string, unknown>;
  byokEnabled?: boolean;
  rateLimitRpm?: number;
}

export interface CreateMcpToolInput {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  creditCost?: number;
}

export interface HealthCheckResult {
  status: McpServerStatus;
  latencyMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Skill interfaces
// ---------------------------------------------------------------------------

export interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: SkillStatus;
  agentId: string;
  agentVersionId: string;
  triggerType: SkillTriggerType;
  triggerConfig: Record<string, unknown> | null;
  deliveryChannels: SkillDeliveryChannel[];
  deliveryConfig: Record<string, unknown> | null;
  mcpToolIds: string[];
  inputMapping: Record<string, unknown> | null;
  outputMapping: Record<string, unknown> | null;
  creditCost: number;
  retryPolicy: RetryPolicy | null;
  chainEventName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
}

export interface CreateSkillInput {
  name: string;
  slug: string;
  description?: string;
  agentId: string;
  agentVersionId: string;
  triggerType: SkillTriggerType;
  triggerConfig?: Record<string, unknown>;
  deliveryChannels?: SkillDeliveryChannel[];
  deliveryConfig?: Record<string, unknown>;
  mcpToolIds?: string[];
  inputMapping?: Record<string, unknown>;
  outputMapping?: Record<string, unknown>;
  creditCost: number;
  retryPolicy?: RetryPolicy;
  chainEventName?: string;
}

export interface VersionCheckResult {
  currentVersion: number;
  latestPublishedVersion: number;
  updateAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Vertical Pack interfaces
// ---------------------------------------------------------------------------

export interface VerticalPack {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: PackCategory;
  status: PackStatus;
  tier: PackTier;
  monthlyPriceUsd: number | null;
  creditsIncluded: number;
  overageRateUsd: number | null;
  stripePriceId: string | null;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePackInput {
  name: string;
  slug: string;
  description?: string;
  category: PackCategory;
  tier: PackTier;
  monthlyPriceUsd?: number;
  creditsIncluded: number;
  overageRateUsd?: number;
  skillIds?: string[];
}

// ---------------------------------------------------------------------------
// Pack Subscription interfaces
// ---------------------------------------------------------------------------

export interface PackSubscription {
  id: string;
  packId: string;
  slackTeamId: string;
  status: SubscriptionStatus;
  creditsIncluded: number;
  creditsUsed: number;
  overageRateUsd: number | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  stripeSubscriptionId: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Skill Execution interfaces
// ---------------------------------------------------------------------------

export interface SkillExecution {
  id: string;
  skillId: string;
  slackTeamId: string;
  slackUserId: string | null;
  status: SkillExecutionStatus;
  triggerType: SkillTriggerType;
  triggerSource: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  creditsCost: number;
  packSubscriptionId: string | null;
  bullmqJobId: string | null;
  errorMessage: string | null;
  retryCount: number;
  executionTrace: Record<string, unknown> | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface AgentInvocation {
  id: string;
  executionId: string;
  agentVersionId: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  modelId: string;
  durationMs: number;
  toolCallsMade: Record<string, unknown>[] | null;
  errorMessage: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Job data interfaces (for BullMQ queues)
// ---------------------------------------------------------------------------

export interface SkillExecutionJobData {
  executionId: string;
  skillId: string;
  slackTeamId: string;
  slackUserId?: string;
  input: Record<string, unknown>;
  triggerType: SkillTriggerType;
  triggerSource?: string;
  packSubscriptionId?: string;
  isSandbox?: boolean;
}

export interface CreditCheckResult {
  allowed: boolean;
  packSubscriptionId: string | null;
  creditsRemaining: number;
  reason?: string;
}

export interface CreditDeductionResult {
  transactionId: string;
  newBalance: number;
  isOverage: boolean;
}
