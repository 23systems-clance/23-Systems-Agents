/**
 * AI-powered natural language filter parser using Claude Haiku.
 *
 * Takes a user's plain-English filter instruction (e.g. "exclude companies
 * with more than 200 employees") and converts it to structured filter
 * criteria using forced tool use.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import { calculateAiCost, type AiUsageData } from './costCalculator.js';
import type { FilterCriterion } from '../state/conversationStore.js';
import logger from '../../lib/logger.js';
import { resolvePrompt } from './promptResolver.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of parsing a natural language filter instruction. */
export interface FilterParseResult {
  /** Structured filter criteria extracted from the user's message. */
  filters: FilterCriterion[];
  /** Human-readable explanation of what was parsed. */
  explanation: string;
  /** Whether the AI understood the user's intent as a valid filter instruction. */
  understood: boolean;
  /** AI usage data for cost tracking. */
  usage: AiUsageData;
}

// ---------------------------------------------------------------------------
// Client and tool definition
// ---------------------------------------------------------------------------

const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
});

/** Tool definition for the filter parser. */
const PARSE_FILTER_TOOL: Anthropic.Messages.Tool = {
  name: 'parse_filter',
  description: 'Parse natural language filter criteria into structured filter operations for a data list.',
  input_schema: {
    type: 'object' as const,
    properties: {
      filters: {
        type: 'array',
        description: 'Array of filter operations to apply',
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'Column name to filter on (must match one of the available columns)',
            },
            operator: {
              type: 'string',
              enum: [
                'equals', 'not_equals', 'contains', 'not_contains',
                'greater_than', 'less_than', 'is_empty', 'is_not_empty', 'regex',
              ],
              description: 'Comparison operator',
            },
            value: {
              type: 'string',
              description: 'Value to compare against (use empty string for is_empty/is_not_empty)',
            },
            action: {
              type: 'string',
              enum: ['include', 'exclude'],
              description: 'Whether to include rows matching this criterion or exclude them',
            },
          },
          required: ['field', 'operator', 'value', 'action'],
        },
      },
      explanation: {
        type: 'string',
        description: 'Human-readable explanation of the parsed filter criteria',
      },
      understood: {
        type: 'boolean',
        description: 'Set to true if the user message is a valid, understandable filter instruction. Set to false if the message is unclear, unrelated to filtering, nonsensical, or you cannot determine what filter to apply.',
      },
    },
    required: ['filters', 'explanation', 'understood'],
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a natural language filter instruction into structured criteria.
 *
 * @param userMessage - The user's natural language filter instruction.
 * @param headers - Column headers from the uploaded file.
 * @param sampleRows - First few rows of data for context.
 * @returns Parsed filter criteria with usage data.
 */
export async function parseFilterCriteria(
  userMessage: string,
  headers: string[],
  sampleRows: Record<string, string>[],
): Promise<FilterParseResult> {
  const sampleData = sampleRows.slice(0, 3).map((row) => {
    const entries = headers.map((h) => `${h}: ${row[h] ?? ''}`);
    return entries.join(', ');
  }).join('\n');

  // Resolve prompt from library with runtime job context for template variables.
  // {{availableColumns}} and {{sampleData}} are injected at runtime, not stored in the prompt.
  const resolved = await resolvePrompt('filter-parser', undefined, {
    availableColumns: headers.join(', '),
    sampleData: `Sample data (first ${Math.min(3, sampleRows.length)} rows):\n${sampleData}`,
  });

  const tools = (resolved.toolDefinitions as unknown as Anthropic.Messages.Tool[]) ?? [PARSE_FILTER_TOOL];

  const startTime = Date.now();

  const response = await anthropic.messages.create({
    model: resolved.modelConfig.model,
    max_tokens: resolved.modelConfig.maxTokens,
    system: resolved.content,
    messages: [{ role: 'user', content: userMessage }],
    tools,
    tool_choice: { type: 'tool', name: 'parse_filter' },
  });

  const durationMs = Date.now() - startTime;

  // Extract the tool use result
  const toolUseBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
  );

  if (!toolUseBlock) {
    logger.error('Filter parser: no tool_use block in response');
    throw new Error('Failed to parse filter criteria: no tool response');
  }

  const input = toolUseBlock.input as {
    filters: FilterCriterion[];
    explanation: string;
    understood: boolean;
  };

  const estimatedCostUsd = calculateAiCost(
    response.usage.input_tokens,
    response.usage.output_tokens,
  );

  const usage: AiUsageData = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    estimatedCostUsd,
    durationMs,
  };

  logger.info('Filter criteria parsed', {
    filterCount: input.filters.length,
    explanation: input.explanation,
    understood: input.understood,
    durationMs,
  });

  return {
    filters: input.filters,
    explanation: input.explanation,
    understood: input.understood !== false,
    usage,
  };
}
