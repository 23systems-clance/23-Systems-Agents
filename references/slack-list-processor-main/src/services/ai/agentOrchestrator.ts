/**
 * Agent Intent Classifier using Anthropic Claude Haiku 4.5.
 *
 * Extends the existing orchestrator with multi-turn conversation context
 * and 13 agent-specific intents. Uses Claude Tool Use (forced) for
 * structured classification with confidence scoring.
 *
 * Implements agent-intents.md contract.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import { calculateAiCost, type AiUsageData } from './costCalculator.js';
import type { ConversationTurn } from '../agent/contextStore.js';
import logger from '../../lib/logger.js';
import { resolvePrompt } from './promptResolver.js';

/** All possible agent intents. */
export type AgentIntent =
  | 'technographic'
  | 'contact'
  | 'combined'
  | 'tech_report'
  | 'job_status'
  | 'job_cancel'
  | 'job_history'
  | 'job_download'
  | 'filter_results'
  | 'usage_query'
  | 'settings_update'
  | 'help'
  | 'clarification'
  | 'confirmation'
  | 'unknown';

/** Result of agent intent classification. */
export interface AgentIntentResult {
  intent: AgentIntent;
  confidence: number;
  technology?: string;
  requestedCount?: number;
  jobId?: string;
  filterExpression?: string;
  enrichmentType?: string;
  usagePeriod?: string;
}

/** Full result including AI usage data for cost attribution. */
export interface AgentClassificationResult {
  intent: AgentIntentResult;
  usage: AiUsageData;
}

const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
});

/** Tool definition per agent-intents.md contract. */
const CLASSIFY_AGENT_INTENT_TOOL: Anthropic.Messages.Tool = {
  name: 'classify_agent_intent',
  description: 'Classify the user message intent within an agent conversation',
  input_schema: {
    type: 'object' as const,
    properties: {
      intent: {
        type: 'string',
        enum: [
          'technographic',
          'contact',
          'combined',
          'tech_report',
          'job_status',
          'job_cancel',
          'job_history',
          'job_download',
          'filter_results',
          'usage_query',
          'settings_update',
          'help',
          'clarification',
          'confirmation',
          'unknown',
        ],
      },
      confidence: {
        type: 'number',
        description: 'Confidence score between 0.0 and 1.0',
        minimum: 0.0,
        maximum: 1.0,
      },
      technology: {
        type: 'string',
        description: 'For tech_report: EXACT technology name extracted from the user\'s current message. Do NOT use names from conversation history.',
      },
      requestedCount: {
        type: 'number',
        description: 'For tech_report: EXACT number from the user\'s current message (e.g. "100 companies" -> 100). Only extract if explicitly stated in THIS message.',
      },
      jobId: {
        type: 'string',
        description: 'For job_status/cancel/download: specific job ID referenced',
      },
      filterExpression: {
        type: 'string',
        description: 'For filter_results: natural language filter expression',
      },
      enrichmentType: {
        type: 'string',
        description: 'Clarified enrichment type if user is specifying',
      },
      usagePeriod: {
        type: 'string',
        description: 'For usage_query: time period like "this month" or "last 30 days"',
      },
    },
    required: ['intent', 'confidence'],
  },
};

/** System prompt for agent context classification. */
const AGENT_SYSTEM_PROMPT = `You are an intent classifier for a Slack-based AI agent that helps users with company list enrichment. Users interact via a conversational side-panel.

Classify the user's message into exactly one of these intents:

**Enrichment intents:**
1. **technographic** — Enrich a company list with technology stack data (BuiltWith). Keywords: "tech stacks", "technologies", "what software they use".
2. **contact** — Find decision makers / contacts for companies (Apollo.io). Keywords: "contacts", "decision makers", "people", "emails", "find who".
3. **combined** — Both tech data AND contacts. Keywords: "full enrichment", "everything", "tech stacks and contacts".
4. **tech_report** — Generate a technology adoption report (no file needed). Keywords: "find companies using [tech]", "who uses [tech]". CRITICAL: Extract the EXACT technology name from the user's CURRENT message (e.g. "find me 50 companies using HubSpot" → technology: "HubSpot", requestedCount: 50). Do NOT use technology names from conversation history or previous messages.

**Job management intents:**
5. **job_status** — Check on running/recent jobs. Keywords: "what's running?", "check my jobs", "status of".
6. **job_cancel** — Cancel/stop a job. Keywords: "stop job", "cancel the enrichment". Extract job ID if mentioned.
7. **job_history** — View past enrichments. Keywords: "my last enrichments", "show history", "past jobs".
8. **job_download** — Download results from a job. Keywords: "download results", "get the file", "send me the output".

**Filter intent:**
9. **filter_results** — Filter previous enrichment results. Keywords: "filter out", "only show", "exclude companies". Extract the filter expression.

**Admin intent:**
10. **usage_query** — Check workspace API usage/costs. Keywords: "show our usage", "how much have we spent", "API credits". Extract time period if mentioned.

**Settings intent:**
11. **settings_update** — Update workspace settings like spending caps or API limits. Keywords: "set cap", "change limit", "update settings", "show settings", "configure". Extract the setting details.

**Conversation management:**
12. **help** — User asking what the agent can do. Keywords: "what can you do?", "help", "how does this work".
13. **clarification** — User is responding to a question from the agent with additional information. Contextual — identify when the user is providing a missing parameter or choosing between options.
14. **confirmation** — User is confirming a proposed action. Keywords: "yes", "go ahead", "start it", "do it", "sounds good".
15. **unknown** — Message doesn't match any intent.

**Confidence scoring:**
- 0.90+ for clear, unambiguous matches
- 0.50-0.89 for reasonable but ambiguous matches
- Below 0.50 for guesses

Consider the conversation history to disambiguate. If a user says "yes" after the agent proposed an enrichment, classify as "confirmation", not "unknown".`;

/**
 * Classifies a user message within an agent conversation context.
 *
 * Assembles conversation history and channel context into the classification
 * prompt for accurate multi-turn intent resolution.
 *
 * @param userMessage - Current user message text
 * @param conversationHistory - Previous turns in this thread (max 20)
 * @param channelContext - Name of the channel user is viewing (optional)
 * @param activeJobId - ID of any active job in this thread (optional)
 * @param hasUploadedFile - Whether the user uploaded a file alongside this message
 */
export async function classifyAgentIntent(
  userMessage: string,
  conversationHistory: ConversationTurn[] = [],
  channelContext?: string,
  activeJobId?: string,
  hasUploadedFile?: boolean,
): Promise<AgentClassificationResult> {
  const startMs = Date.now();

  // Resolve prompt from library (Redis → DB → compiled default)
  const resolved = await resolvePrompt('agent-intent-classifier');

  // Build system prompt with optional runtime context
  let systemPrompt = resolved.content;
  if (channelContext) {
    systemPrompt += `\n\nThe user is currently viewing channel: #${channelContext}`;
  }
  if (activeJobId) {
    systemPrompt += `\n\nThere is an active job in this thread: ${activeJobId}`;
  }
  if (hasUploadedFile) {
    systemPrompt += '\n\nIMPORTANT: The user has uploaded a company list file (CSV/XLSX) alongside this message. ' +
      'If they mention a technology (e.g., "find companies that use AWS"), classify as "technographic" — ' +
      'they want to enrich their uploaded file with tech data, then filter for that technology. ' +
      'If they ask for contacts, classify as "contact". If they say "enrich" or "both", classify accordingly. ' +
      'If the message is vague or empty, classify as "unknown". Always extract the technology name if mentioned.';
  }

  // Use resolved tool definitions or fall back to inline constant
  const tools = (resolved.toolDefinitions as unknown as Anthropic.Messages.Tool[]) ?? [CLASSIFY_AGENT_INTENT_TOOL];

  // Assemble messages: conversation history + current message
  const messages: Anthropic.Messages.MessageParam[] = [];

  for (const turn of conversationHistory) {
    messages.push({
      role: turn.role === 'user' ? 'user' : 'assistant',
      content: turn.content,
    });
  }

  messages.push({ role: 'user', content: userMessage });

  const response = await anthropic.messages.create({
    model: resolved.modelConfig.model,
    max_tokens: resolved.modelConfig.maxTokens,
    tools,
    tool_choice: { type: 'tool', name: 'classify_agent_intent' },
    system: systemPrompt,
    messages,
  });

  const durationMs = Date.now() - startMs;
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;

  const usage: AiUsageData = {
    inputTokens,
    outputTokens,
    estimatedCostUsd: calculateAiCost(inputTokens, outputTokens),
    durationMs,
  };

  // Extract tool use block
  const toolUseBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
  );

  if (!toolUseBlock) {
    return { intent: { intent: 'unknown', confidence: 0 }, usage };
  }

  const input = toolUseBlock.input as Record<string, unknown>;

  const result: AgentClassificationResult = {
    intent: {
      intent: (input.intent as AgentIntent) ?? 'unknown',
      confidence: (input.confidence as number) ?? 0,
      technology: input.technology as string | undefined,
      requestedCount: input.requestedCount as number | undefined,
      jobId: input.jobId as string | undefined,
      filterExpression: input.filterExpression as string | undefined,
      enrichmentType: input.enrichmentType as string | undefined,
      usagePeriod: input.usagePeriod as string | undefined,
    },
    usage,
  };

  logger.info('agent:classification', {
    intent: result.intent.intent,
    confidence: result.intent.confidence,
    technology: result.intent.technology,
    requestedCount: result.intent.requestedCount,
    durationMs,
    inputTokens,
    outputTokens,
  });

  return result;
}
