import redis from '../../lib/redis.js';
import type { AiUsageData } from '../ai/costCalculator.js';
import type { ApolloContactFilters } from '../../types/enrichmentFilters.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single pending file detected in a thread. */
export interface PendingFile {
  fileId: string;
  fileName: string;
  fileType: 'csv' | 'xlsx';
}

/** Structured filter criterion parsed from natural language or form input. */
export interface FilterCriterion {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty' | 'regex';
  value: string;
  action: 'include' | 'exclude';
}

/** Shape of a conversation stored in Redis during the enrichment flow. */
export interface ConversationState {
  fileId: string;
  fileName: string;
  fileType: 'csv' | 'xlsx';
  userId: string;
  channelId: string;
  threadTs: string;
  status: 'pending' | 'processing' | 'completed';
  /** Multiple files uploaded in the same thread. */
  pendingFiles?: PendingFile[];
  /** Whether the uploaded file is a company list or a contact list. */
  listType?: 'company' | 'contact';
  enrichIntent?: 'technographic' | 'contact' | 'combined';
  purpose?: string;
  isCosell?: boolean;
  cosellProvider?: string;
  listOwner?: string;
  additionalContext?: string;
  technology?: string;
  filters?: Record<string, string>;
  enrichInstruction?: string;
  /** What contact data to enrich: basic contacts, email, mobile, or all. */
  enrichDataType?: 'contact_data' | 'email' | 'mobile' | 'all';
  /** Source job ID when chaining contact enrichment from a completed technographic job. */
  sourceJobId?: string;
  /** AI usage from intent classification, carried forward for logging after Job creation. */
  intentUsage?: AiUsageData;
  /** Apollo contact search filters selected for this job (preset or custom). */
  contactFilters?: ApolloContactFilters;

  // -- /filter and /analyze extensions --

  /** Which command flow this conversation belongs to. */
  flowType?: 'enrich' | 'filter' | 'analyze' | 'analyze_config_upload' | 'split';
  /** Parsed filter criteria for the /filter flow. */
  filterCriteria?: FilterCriterion[];
  /** Currently selected column in the /filter column picker. */
  filterSelectedColumn?: string;
  /** Source enrichment job IDs selected for /analyze. */
  analysisSourceJobIds?: string[];
  /** Config doc type being uploaded for /analyze upload. */
  configDocType?: 'ICP' | 'USE_CASES' | 'CAMPAIGNS' | 'SETTINGS';
  /** Slack team ID, stored for flows that need it after initial ack. */
  teamId?: string;


  // -- /split extensions --

  /** Selected split mode for the /split flow. */
  splitMode?: 'half' | 'quarters' | 'by_column' | 'custom';
  /** Column name to group by (for by_column split mode). */
  splitColumn?: string;
  /** Number of equal parts (for custom split mode). */
  splitCount?: number;
  /** Client name for output file naming. */
  splitClientName?: string;
  /** Campaign/target list name for output file naming. */
  splitCampaignName?: string;
  /** Billing rate snapshot captured at billing gate check, stored on Job for deduction consistency. */
  creditRateSnapshot?: Record<string, unknown>;
  /** Estimated row count from initial file upload, used for billing estimation before full parse. */
  totalRows?: number;
  /** When true, bypass persistent domain cache and make fresh BuiltWith API calls (Feature 17). */
  forceRefresh?: boolean;
  /** Requested number of companies from user's query (e.g. "100 salesforce companies"). */
  requestedCount?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** TTL applied to every conversation key (1 hour). */
const TTL_SECONDS = 3600;

/**
 * Builds the Redis key for a given Slack thread.
 */
function buildKey(channelId: string, threadTs: string): string {
  return `conversation:${channelId}:${threadTs}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persists a full conversation state to Redis with a 1-hour TTL.
 */
export async function setConversation(
  channelId: string,
  threadTs: string,
  state: ConversationState,
): Promise<void> {
  const key = buildKey(channelId, threadTs);
  await redis.set(key, JSON.stringify(state), 'EX', TTL_SECONDS);
}

/**
 * Retrieves a conversation state from Redis, or null if not found / expired.
 */
export async function getConversation(
  channelId: string,
  threadTs: string,
): Promise<ConversationState | null> {
  const key = buildKey(channelId, threadTs);
  const raw = await redis.get(key);
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as ConversationState;
}

/**
 * Merges a partial update into an existing conversation state. If the
 * conversation does not exist the update is silently ignored.
 */
export async function updateConversation(
  channelId: string,
  threadTs: string,
  partial: Partial<ConversationState>,
): Promise<void> {
  const existing = await getConversation(channelId, threadTs);
  if (!existing) {
    return;
  }
  const merged: ConversationState = { ...existing, ...partial };
  await setConversation(channelId, threadTs, merged);
}

/**
 * Deletes a conversation state from Redis.
 */
export async function deleteConversation(
  channelId: string,
  threadTs: string,
): Promise<void> {
  const key = buildKey(channelId, threadTs);
  await redis.del(key);
}
