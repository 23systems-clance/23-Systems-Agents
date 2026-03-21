/**
 * Prompt Generation - TypeScript Type Definitions
 * Feature 23: Dynamic Suggested Prompts
 */

export interface IPromptGenerator {
  generate(context: PromptContext): Promise<SuggestedPrompt[]>;
  recordClick(event: PromptClickEventInput): Promise<void>;
}

export interface PromptContext {
  userId: string;
  teamId: string;
  channelId?: string;
  threadTs: string;
  activeJobs: JobSummary[];
  completedJobs: JobSummary[];
  failedJobs: JobSummary[];
  totalEnrichmentCount: number;
  channelEnrichmentHistory?: ChannelHistory;
  channelDocuments?: DocumentSummary[];
  channelPresets?: PresetSummary[];
  workspaceConfig: WorkspaceConfig;
  generatedAt: Date;
}

export interface JobSummary {
  id: string;
  type: 'technographic' | 'contact' | 'combined' | 'tech_report';
  status: 'active' | 'completed' | 'failed';
  createdAt: Date;
  rowCount?: number;
}

export interface ChannelHistory {
  totalJobs: number;
  mostCommonType: 'technographic' | 'contact' | 'combined';
  lastJobAt: Date;
}

export interface DocumentSummary {
  id: string;
  documentType: 'icp' | 'use_cases';
  slug: string;
  uploadedAt?: Date; // Optional - schema uses createdAt
}

export interface PresetSummary {
  id: string;
  name: string;
  enrichmentType: 'technographic' | 'contact' | 'combined';
}

export interface WorkspaceConfig {
  apolloEnabled: boolean;
  apolloCreditsRemaining: number;
  builtWithEnabled: boolean;
  usagePercentage: number;
}

export interface SuggestedPrompt {
  title: string;
  message: string;
}

export interface PromptClickEventInput {
  userId: string;
  teamId: string;
  channelId?: string;
  threadTs: string;
  promptTitle: string;
  promptPosition: number;
  contextType: 'default' | 'channel' | 'activity' | 'workspace';
  metadata?: Record<string, any>;
}

export interface PromptTemplate {
  id: string;
  category: 'onboarding' | 'enrichment' | 'job_management' | 'follow_up' | 'reporting' | 'channel_specific';
  subcategory: string;
  basePriority: number;
  isApplicable(context: PromptContext): boolean;
  render(context: PromptContext): SuggestedPrompt;
}

export interface PromptCandidate {
  template: PromptTemplate;
  score: number;
  scoreBreakdown: {
    basePriority: number;
    recencyBonus: number;
    diversityPenalty: number;
  };
}

export interface IPromptContextCache {
  get(teamId: string, userId: string): Promise<PromptContext | null>;
  set(teamId: string, userId: string, context: PromptContext): Promise<void>;
  invalidate(teamId: string, userId: string): Promise<void>;
  invalidateWorkspace(teamId: string): Promise<void>;
}

export interface IPromptContextBuilder {
  build(slackContext: SlackThreadContext): Promise<PromptContext>;
}

export interface SlackThreadContext {
  userId: string;
  teamId: string;
  channelId?: string;
  threadTs: string;
}
