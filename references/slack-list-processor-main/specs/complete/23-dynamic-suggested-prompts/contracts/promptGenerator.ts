/**
 * Prompt Generator - TypeScript Interface Contracts
 *
 * Internal service interfaces for dynamic prompt generation.
 * This is not a REST API - these are TypeScript contracts for internal use.
 */

/**
 * Main prompt generator service interface
 */
export interface IPromptGenerator {
  /**
   * Generate 4 suggested prompts based on user/channel/workspace context
   *
   * @param context - Aggregated context from Slack event + DB queries
   * @returns Array of exactly 4 suggested prompts
   * @throws Error if prompt generation fails (caller should fall back to static prompts)
   */
  generate(context: PromptContext): Promise<SuggestedPrompt[]>;

  /**
   * Record a prompt click event for analytics
   *
   * @param event - Click event details
   * @returns Promise resolving when event is persisted
   */
  recordClick(event: PromptClickEventInput): Promise<void>;
}

/**
 * Ephemeral context object built from Slack event + DB queries
 */
export interface PromptContext {
  // User identity
  userId: string;
  teamId: string;
  channelId?: string;    // Undefined for DM threads
  threadTs: string;

  // User activity (recent jobs)
  activeJobs: JobSummary[];
  completedJobs: JobSummary[];  // Within 48h
  failedJobs: JobSummary[];     // Within 24h
  totalEnrichmentCount: number; // All-time (for power user detection)

  // Channel context (if channelId present)
  channelEnrichmentHistory?: ChannelHistory;
  channelDocuments?: DocumentSummary[];
  channelPresets?: PresetSummary[];

  // Workspace configuration
  workspaceConfig: WorkspaceConfig;

  // Meta
  generatedAt: Date;
}

/**
 * Job summary for activity context
 */
export interface JobSummary {
  id: string;
  type: 'technographic' | 'contact' | 'combined' | 'tech_report';
  status: 'active' | 'completed' | 'failed';
  createdAt: Date;
  rowCount?: number;
}

/**
 * Channel enrichment history summary
 */
export interface ChannelHistory {
  totalJobs: number;
  mostCommonType: 'technographic' | 'contact' | 'combined';
  lastJobAt: Date;
}

/**
 * Document summary for channel context
 */
export interface DocumentSummary {
  id: string;
  documentType: 'icp' | 'use_cases';
  slug: string;
  uploadedAt: Date;
}

/**
 * Preset summary for channel context
 */
export interface PresetSummary {
  id: string;
  name: string;
  enrichmentType: 'technographic' | 'contact' | 'combined';
}

/**
 * Workspace configuration summary
 */
export interface WorkspaceConfig {
  apolloEnabled: boolean;
  apolloCreditsRemaining: number;
  builtWithEnabled: boolean;
  usagePercentage: number; // 0-100 (e.g., 85 = 85% of monthly cap)
}

/**
 * Suggested prompt returned by generator (Slack API format)
 */
export interface SuggestedPrompt {
  title: string;   // Max 25 chars (Slack limit)
  message: string; // Max 150 chars (Slack limit)
}

/**
 * Input for recording prompt click events
 */
export interface PromptClickEventInput {
  userId: string;
  teamId: string;
  channelId?: string;  // Null for DM threads
  threadTs: string;
  promptTitle: string;
  promptPosition: number; // 1-4
  contextType: 'default' | 'channel' | 'activity' | 'workspace';
  metadata?: Record<string, any>; // Optional JSON blob (e.g., { jobType, jobId })
}

/**
 * Prompt template definition
 */
export interface PromptTemplate {
  id: string;
  category: 'onboarding' | 'enrichment' | 'job_management' | 'follow_up' | 'reporting' | 'channel_specific';
  subcategory: string;
  basePriority: number; // Base score before recency/diversity adjustments

  /**
   * Check if this prompt is applicable given the current context
   */
  isApplicable(context: PromptContext): boolean;

  /**
   * Render the prompt title and message from context
   */
  render(context: PromptContext): SuggestedPrompt;
}

/**
 * Prompt candidate with calculated score
 */
export interface PromptCandidate {
  template: PromptTemplate;
  score: number;
  scoreBreakdown: {
    basePriority: number;
    recencyBonus: number;
    diversityPenalty: number;
  };
}

/**
 * Prompt context cache service
 */
export interface IPromptContextCache {
  /**
   * Get cached context for user
   * @returns Cached context or null if not found/expired
   */
  get(teamId: string, userId: string): Promise<PromptContext | null>;

  /**
   * Cache context for user (5-minute sliding TTL)
   */
  set(teamId: string, userId: string, context: PromptContext): Promise<void>;

  /**
   * Invalidate cached context for user (e.g., after job state change)
   */
  invalidate(teamId: string, userId: string): Promise<void>;

  /**
   * Invalidate all user contexts in workspace (e.g., after workspace config change)
   */
  invalidateWorkspace(teamId: string): Promise<void>;
}

/**
 * Prompt context builder service
 */
export interface IPromptContextBuilder {
  /**
   * Build PromptContext from Slack event and database queries
   *
   * @param slackContext - Basic context from Slack event
   * @returns Fully populated PromptContext
   * @throws Error if required data cannot be fetched (caller should fall back)
   */
  build(slackContext: SlackThreadContext): Promise<PromptContext>;
}

/**
 * Minimal Slack context from event payload
 */
export interface SlackThreadContext {
  userId: string;
  teamId: string;
  channelId?: string;
  threadTs: string;
}
