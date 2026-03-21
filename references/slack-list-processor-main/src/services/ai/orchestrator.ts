/**
 * AI Intent Classifier using Anthropic Claude Haiku 4.5.
 *
 * Classifies user ENRICH messages into one of five intent types
 * (technographic, contact, combined, tech_report, unknown) using
 * Claude Tool Use with a forced classify_intent tool call.
 *
 * Implements contracts section 5.1 from api-contracts.md.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import { calculateAiCost, type AiUsageData } from './costCalculator.js';
import { resolvePrompt } from './promptResolver.js';

/** Result of intent classification from the AI orchestrator. */
export interface IntentResult {
  intent: 'technographic' | 'contact' | 'combined' | 'tech_report' | 'unknown';
  confidence: number;
  technology?: string;
  country?: string;
  additionalFilters?: Record<string, string>;
}

/** Token usage information from an Anthropic API response. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Full result of intent classification including AI usage data for logging. */
export interface IntentClassificationResult {
  intent: IntentResult;
  usage: AiUsageData;
}

const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
});

/** Tool definition matching contracts section 5.1. */
const CLASSIFY_INTENT_TOOL: Anthropic.Messages.Tool = {
  name: 'classify_intent',
  description: "Classify the user's enrichment intent from their ENRICH message",
  input_schema: {
    type: 'object' as const,
    properties: {
      intent: {
        type: 'string',
        enum: ['technographic', 'contact', 'combined', 'tech_report', 'unknown'],
      },
      confidence: {
        type: 'number',
        description: 'Confidence score between 0 and 1',
      },
      technology: {
        type: 'string',
        description: 'For tech_report: technology name to search for',
      },
      country: {
        type: 'string',
        description: 'For tech_report: country filter if mentioned',
      },
      additional_filters: {
        type: 'object',
        description: 'Any additional filters extracted from the message',
      },
    },
    required: ['intent', 'confidence'],
  },
};

/** System prompt guiding the classifier. */
const SYSTEM_PROMPT = `You are an intent classifier for a Slack-based company list enrichment bot. Users send messages starting with "ENRICH" to request different types of data enrichment.

Classify the user's message into exactly one of these five intents:

1. **technographic** — The user wants to enrich a company list with technology stack data (BuiltWith). Keywords: "tech stacks", "technologies", "what software", "tech data", "technographic".

2. **contact** — The user wants to find decision makers / contacts for companies on a list (Apollo.io). Keywords: "contacts", "decision makers", "people", "emails", "phone numbers", "who works at".

3. **combined** — The user wants BOTH technographic data AND contacts in a single enrichment. Keywords: "tech stacks and contacts", "full enrichment", "everything", "technologies and decision makers".

4. **tech_report** — The user wants to generate a report of companies using a specific technology (no file upload needed). Keywords: "find companies using [technology]", "who uses [technology]", "companies that use [technology]", "report on [technology]". CRITICAL: Always extract the EXACT technology name from the user's message and country if mentioned.

5. **unknown** — The message does not clearly match any of the above intents.

Set confidence between 0.0 and 1.0 based on how clearly the message matches the intent. Use 0.9+ for obvious matches, 0.5-0.8 for ambiguous messages, below 0.5 for guesses.`;

/**
 * Classifies a user's ENRICH message into an intent type using Claude Haiku 4.5.
 *
 * Returns both the classification result and AI usage data (tokens, cost, duration)
 * so callers can log it to api_usage_logs once a jobId is available.
 *
 * @param userMessage - The raw message text from the user (includes ENRICH prefix).
 * @param documentContext - Optional document content to inject as AI context.
 * @returns Intent result with AI usage data for cost attribution.
 */
export async function classifyIntent(
  userMessage: string,
  documentContext?: string,
): Promise<IntentClassificationResult> {
  const startMs = Date.now();

  // Resolve prompt from library (Redis → DB → compiled default)
  const resolved = await resolvePrompt('enrichment-intent-classifier');

  let systemPrompt = resolved.content;
  if (documentContext) {
    systemPrompt +=
      '\n\n--- Referenced Document Context ---\n' +
      documentContext +
      '\n\nUse this context to better understand the user\'s enrichment preferences. ' +
      'If the context includes ICP criteria, persona priorities, or configuration settings, ' +
      'incorporate them into your classification and parameter extraction.';
  }

  // Use resolved tool definitions or fall back to inline constant
  const tools = (resolved.toolDefinitions as unknown as Anthropic.Messages.Tool[]) ?? [CLASSIFY_INTENT_TOOL];

  const response = await anthropic.messages.create({
    model: resolved.modelConfig.model,
    max_tokens: resolved.modelConfig.maxTokens,
    tools,
    tool_choice: { type: 'tool', name: 'classify_intent' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
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

  // Extract tool use block from response content.
  const toolUseBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
  );

  if (!toolUseBlock) {
    return { intent: { intent: 'unknown', confidence: 0 }, usage };
  }

  const input = toolUseBlock.input as Record<string, unknown>;

  return {
    intent: {
      intent: (input.intent as IntentResult['intent']) ?? 'unknown',
      confidence: (input.confidence as number) ?? 0,
      technology: input.technology as string | undefined,
      country: input.country as string | undefined,
      additionalFilters: input.additional_filters as Record<string, string> | undefined,
    },
    usage,
  };
}

/**
 * Extracts token usage from an Anthropic API response.
 *
 * @param response - Raw Anthropic messages response object.
 * @returns Input and output token counts.
 */
export function getTokenUsage(response: Anthropic.Messages.Message): TokenUsage {
  return {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}
