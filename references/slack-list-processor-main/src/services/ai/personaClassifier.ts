/**
 * Hybrid persona classifier for job titles.
 *
 * Classifies job titles into PersonaType values using a two-stage approach:
 * 1. Fast deterministic lookup via the personaLookup table (~200 common titles).
 * 2. AI classification via Claude Haiku 4.5 Tool Use for unmatched titles.
 *
 * Implements contracts sections 5.2 (single) and 5.3 (batch) from api-contracts.md.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import { lookupPersona, type PersonaType } from '../../data/personaLookup.js';
import logger from '../../lib/logger.js';
import { trackUsage } from '../../services/metering/usageTracker.js';
import { logError } from '../admin/errorLogger.js';
import { calculateAiCost } from './costCalculator.js';
import { resolvePrompt } from './promptResolver.js';

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

/** Result of classifying a single job title. */
export interface PersonaClassification {
  personaType: PersonaType;
  confidence: number;
  source: 'lookup' | 'ai';
}

/** Result of classifying a single job title within a batch (includes index). */
export interface BatchPersonaClassification extends PersonaClassification {
  index: number;
}

// ---------------------------------------------------------------------------
// Anthropic client
// ---------------------------------------------------------------------------

const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
});

// ---------------------------------------------------------------------------
// Tool definitions (per contracts sections 5.2 and 5.3)
// ---------------------------------------------------------------------------

/** Tool definition for single persona classification. */
const CLASSIFY_PERSONA_TOOL: Anthropic.Messages.Tool = {
  name: 'classify_persona',
  description: 'Classify a job title into a persona type',
  input_schema: {
    type: 'object' as const,
    properties: {
      persona_type: {
        type: 'string',
        enum: [
          'IT_LEADER',
          'ENGINEERING_LEADER',
          'FINANCE_LEADER',
          'SALES_LEADER',
          'FOUNDER_OWNER',
          'CEO',
          'OPERATIONS_LEADER',
          'HR_LEADER',
          'CUSTOMER_SUCCESS_LEADER',
          'MARKETING_LEADER',
          'PRODUCT_LEADER',
          'COMPLIANCE_LEADER',
          'RESEARCH_LEADER',
          'NON_LEADER',
        ],
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['persona_type', 'confidence'],
  },
};

/** Tool definition for batch persona classification. */
const CLASSIFY_PERSONAS_BATCH_TOOL: Anthropic.Messages.Tool = {
  name: 'classify_personas_batch',
  description: 'Classify multiple job titles into persona types',
  input_schema: {
    type: 'object' as const,
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            persona_type: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['index', 'persona_type', 'confidence'],
        },
      },
    },
    required: ['classifications'],
  },
};

/** System prompt for persona classification. */
const SYSTEM_PROMPT = `You are a job title classifier. Given a job title, classify it into exactly one persona type.

Persona types:
- IT_LEADER: CTO, CIO, CISO, VP/Director/Head of IT, Technology
- ENGINEERING_LEADER: VP/Director/Head of Engineering, Software Development, Infrastructure
- FINANCE_LEADER: CFO, VP/Director/Head of Finance, Accounting, Controller
- SALES_LEADER: CRO, VP/Director/Head of Sales, Business Development
- FOUNDER_OWNER: Founder, Co-Founder, Owner, Managing Partner
- CEO: Chief Executive Officer
- OPERATIONS_LEADER: COO, VP/Director/Head of Operations, Supply Chain, Procurement
- HR_LEADER: CHRO, VP/Director/Head of HR, People, Talent
- CUSTOMER_SUCCESS_LEADER: VP/Director/Head of Customer Success, Client Services, Customer Support
- MARKETING_LEADER: CMO, VP/Director/Head of Marketing, Growth, Demand Generation
- PRODUCT_LEADER: CPO, VP/Director/Head of Product, Product Management
- COMPLIANCE_LEADER: CCO, General Counsel, VP/Director/Head of Compliance, Legal, Risk
- RESEARCH_LEADER: Chief Scientist, VP/Director/Head of Research, R&D, Data Science
- NON_LEADER: Does not fit any leadership persona above

Set confidence between 0.0 and 1.0 based on how clearly the title matches a persona.`;

// ---------------------------------------------------------------------------
// Valid persona type values (for runtime validation)
// ---------------------------------------------------------------------------

const VALID_PERSONA_TYPES = new Set<string>([
  'IT_LEADER',
  'ENGINEERING_LEADER',
  'FINANCE_LEADER',
  'SALES_LEADER',
  'FOUNDER_OWNER',
  'CEO',
  'OPERATIONS_LEADER',
  'HR_LEADER',
  'CUSTOMER_SUCCESS_LEADER',
  'MARKETING_LEADER',
  'PRODUCT_LEADER',
  'COMPLIANCE_LEADER',
  'RESEARCH_LEADER',
  'NON_LEADER',
]);

/**
 * Validates that a string is a valid PersonaType value.
 */
function isValidPersonaType(value: string): value is PersonaType {
  return VALID_PERSONA_TYPES.has(value);
}

// ---------------------------------------------------------------------------
// Single classification
// ---------------------------------------------------------------------------

/**
 * Classifies a single job title into a PersonaType.
 *
 * First checks the static lookup table for an exact (normalized) match.
 * Falls back to Claude Haiku 4.5 with forced tool use if no match is found.
 * Defaults to NON_LEADER on any error.
 *
 * @param jobTitle - The raw job title string to classify.
 * @param jobId - Optional job ID for API usage logging.
 * @returns Classification result with persona type, confidence, and source.
 */
export async function classifyPersona(
  jobTitle: string,
  jobId?: string,
  slackTeamId?: string,
): Promise<PersonaClassification> {
  // Stage 1: Try deterministic lookup.
  const lookupResult = lookupPersona(jobTitle);
  if (lookupResult !== null) {
    logger.debug('Persona classified via lookup', {
      jobTitle,
      personaType: lookupResult,
    });
    return { personaType: lookupResult, confidence: 1.0, source: 'lookup' };
  }

  // Stage 2: AI classification via Claude Haiku 4.5.
  try {
    const startMs = Date.now();

    // Resolve prompt from library (Redis → DB → compiled default)
    const resolved = await resolvePrompt('persona-classifier');
    const tools = (resolved.toolDefinitions as unknown as Anthropic.Messages.Tool[]) ?? [CLASSIFY_PERSONA_TOOL];

    const response = await anthropic.messages.create({
      model: resolved.modelConfig.model,
      max_tokens: resolved.modelConfig.maxTokens,
      tools,
      tool_choice: { type: 'tool', name: 'classify_persona' },
      system: resolved.content,
      messages: [
        {
          role: 'user',
          content: `Classify this job title: "${jobTitle}"`,
        },
      ],
    });

    const durationMs = Date.now() - startMs;

    // Log AI usage if jobId is available.
    if (jobId && slackTeamId) {
      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      await trackUsage({
        jobId,
        slackTeamId,
        service: 'ANTHROPIC',
        endpoint: 'classifyPersona:persona-classifier',
        tokensInput: inputTokens,
        tokensOutput: outputTokens,
        estimatedCostUsd: calculateAiCost(inputTokens, outputTokens),
        durationMs,
      });
    }

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock =>
        block.type === 'tool_use',
    );

    if (!toolUseBlock) {
      logger.warn('AI persona classification returned no tool use block', {
        jobTitle,
      });
      return { personaType: 'NON_LEADER', confidence: 0, source: 'ai' };
    }

    const input = toolUseBlock.input as Record<string, unknown>;
    const rawPersonaType = input.persona_type as string;
    const confidence = (input.confidence as number) ?? 0;

    if (!isValidPersonaType(rawPersonaType)) {
      logger.warn('AI returned invalid persona type, defaulting to NON_LEADER', {
        jobTitle,
        rawPersonaType,
      });
      return { personaType: 'NON_LEADER', confidence: 0, source: 'ai' };
    }

    logger.debug('Persona classified via AI', {
      jobTitle,
      personaType: rawPersonaType,
      confidence,
    });

    return { personaType: rawPersonaType, confidence, source: 'ai' };
  } catch (error) {
    logger.error('AI persona classification failed, defaulting to NON_LEADER', {
      jobTitle,
      error: error instanceof Error ? error.message : String(error),
    });
    logError({
      category: 'API_ERROR',
      service: 'ai_orchestrator',
      message: `AI persona classification failed: ${error instanceof Error ? error.message : String(error)}`,
      stackTrace: error instanceof Error ? error.stack : undefined,
      metadata: { jobTitle },
    });
    return { personaType: 'NON_LEADER', confidence: 0, source: 'ai' };
  }
}

// ---------------------------------------------------------------------------
// Batch classification
// ---------------------------------------------------------------------------

/**
 * Classifies multiple job titles into PersonaType values.
 *
 * First attempts lookup-table classification for each title. Titles that
 * do not match are sent to Claude Haiku 4.5 in a single batch API call
 * using the classify_personas_batch tool. Results are merged and returned
 * in the original index order.
 *
 * Defaults to NON_LEADER for any titles that fail classification.
 *
 * @param titles - Array of objects with index and jobTitle.
 * @param jobId - Optional job ID for API usage logging.
 * @returns Array of classification results preserving original indices.
 */
export async function classifyPersonasBatch(
  titles: Array<{ index: number; jobTitle: string }>,
  jobId?: string,
  slackTeamId?: string,
): Promise<Array<BatchPersonaClassification>> {
  if (titles.length === 0) {
    return [];
  }

  const results: Array<BatchPersonaClassification> = [];
  const needsAi: Array<{ index: number; jobTitle: string }> = [];

  // Stage 1: Try deterministic lookup for each title.
  for (const entry of titles) {
    const lookupResult = lookupPersona(entry.jobTitle);
    if (lookupResult !== null) {
      results.push({
        index: entry.index,
        personaType: lookupResult,
        confidence: 1.0,
        source: 'lookup',
      });
    } else {
      needsAi.push(entry);
    }
  }

  logger.debug('Batch persona classification lookup phase complete', {
    total: titles.length,
    lookupMatches: results.length,
    needsAi: needsAi.length,
  });

  // Stage 2: Classify unmatched titles via AI in a single API call.
  if (needsAi.length > 0) {
    try {
      const titlesDescription = needsAi
        .map((entry) => `- Index ${entry.index}: "${entry.jobTitle}"`)
        .join('\n');

      const startMs = Date.now();

      // Resolve prompt from library for batch classification
      const resolved = await resolvePrompt('persona-classifier');

      const response = await anthropic.messages.create({
        model: resolved.modelConfig.model,
        max_tokens: 4096, // Batch needs higher token limit
        tools: [CLASSIFY_PERSONAS_BATCH_TOOL],
        tool_choice: { type: 'tool', name: 'classify_personas_batch' },
        system: resolved.content,
        messages: [
          {
            role: 'user',
            content: `Classify the following job titles:\n${titlesDescription}`,
          },
        ],
      });

      const durationMs = Date.now() - startMs;

      // Log AI usage if jobId is available.
      if (jobId && slackTeamId) {
        const inputTokens = response.usage?.input_tokens ?? 0;
        const outputTokens = response.usage?.output_tokens ?? 0;
        await trackUsage({
          jobId,
          slackTeamId,
          service: 'ANTHROPIC',
          endpoint: 'classifyPersonasBatch:persona-classifier',
          tokensInput: inputTokens,
          tokensOutput: outputTokens,
          estimatedCostUsd: calculateAiCost(inputTokens, outputTokens),
          durationMs,
        });
      }

      const toolUseBlock = response.content.find(
        (block): block is Anthropic.Messages.ToolUseBlock =>
          block.type === 'tool_use',
      );

      if (!toolUseBlock) {
        logger.warn(
          'AI batch classification returned no tool use block, defaulting all to NON_LEADER',
          { count: needsAi.length },
        );
        for (const entry of needsAi) {
          results.push({
            index: entry.index,
            personaType: 'NON_LEADER',
            confidence: 0,
            source: 'ai',
          });
        }
      } else {
        const input = toolUseBlock.input as Record<string, unknown>;
        const classifications = (input.classifications ?? []) as Array<{
          index: number;
          persona_type: string;
          confidence: number;
        }>;

        // Build a map of AI results by index for fast lookup.
        const aiResultMap = new Map<
          number,
          { persona_type: string; confidence: number }
        >();
        for (const c of classifications) {
          aiResultMap.set(c.index, {
            persona_type: c.persona_type,
            confidence: c.confidence,
          });
        }

        // Merge AI results, defaulting to NON_LEADER for missing entries.
        for (const entry of needsAi) {
          const aiResult = aiResultMap.get(entry.index);
          if (aiResult && isValidPersonaType(aiResult.persona_type)) {
            results.push({
              index: entry.index,
              personaType: aiResult.persona_type,
              confidence: aiResult.confidence ?? 0,
              source: 'ai',
            });
          } else {
            logger.warn(
              'AI batch classification missing or invalid for title, defaulting to NON_LEADER',
              {
                index: entry.index,
                jobTitle: entry.jobTitle,
                rawPersonaType: aiResult?.persona_type,
              },
            );
            results.push({
              index: entry.index,
              personaType: 'NON_LEADER',
              confidence: 0,
              source: 'ai',
            });
          }
        }
      }
    } catch (error) {
      logger.error(
        'AI batch persona classification failed, defaulting all to NON_LEADER',
        {
          count: needsAi.length,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      for (const entry of needsAi) {
        results.push({
          index: entry.index,
          personaType: 'NON_LEADER',
          confidence: 0,
          source: 'ai',
        });
      }
    }
  }

  return results;
}
