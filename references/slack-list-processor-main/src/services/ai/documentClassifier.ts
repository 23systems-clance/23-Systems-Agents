/**
 * AI Document Classifier using Anthropic Claude Haiku 4.5.
 *
 * Classifies uploaded documents into one of five types (ICP, USE_CASE,
 * SETTINGS, ONE_PAGER, UNKNOWN) using Claude Tool Use with a forced
 * classify_document tool call.
 *
 * Implements contracts section 4.1 from api-contracts.md.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import { calculateAiCost, type AiUsageData } from './costCalculator.js';
import logger from '../../lib/logger.js';

/** Result of document classification from the AI classifier. */
export interface DocumentClassification {
  documentType: 'ICP' | 'USE_CASE' | 'SETTINGS' | 'ONE_PAGER' | 'UNKNOWN';
  confidence: number;
  suggestedLabel: string;
  summary: string;
}

/** Full result including AI usage data for cost tracking. */
export interface DocumentClassificationResult {
  classification: DocumentClassification;
  usage: AiUsageData;
}

const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
});

/** Tool definition per contracts section 4.1. */
const CLASSIFY_DOCUMENT_TOOL: Anthropic.Messages.Tool = {
  name: 'classify_document',
  description: 'Classify an uploaded document into a document type and generate a summary',
  input_schema: {
    type: 'object' as const,
    properties: {
      document_type: {
        type: 'string',
        enum: ['ICP', 'USE_CASE', 'SETTINGS', 'ONE_PAGER', 'UNKNOWN'],
        description: 'The classified document type',
      },
      confidence: {
        type: 'number',
        description: 'Classification confidence between 0 and 1',
      },
      suggested_label: {
        type: 'string',
        description: 'A short human-readable label for the document',
      },
      summary: {
        type: 'string',
        description: 'One-sentence description of the document content',
      },
    },
    required: ['document_type', 'confidence', 'suggested_label', 'summary'],
  },
};

/** System prompt guiding the document classifier. */
const SYSTEM_PROMPT = `You are a document classifier for a sales enrichment platform. Users upload documents to configure how company lists are enriched. Classify each document into exactly one type:

1. ICP (Ideal Customer Profile) - Targeting criteria, audience definitions, company filters
2. USE_CASE - Enrichment scenarios, workflow descriptions, campaign strategies
3. SETTINGS - Configuration with key-value pairs (decision makers count, personas, integrations)
4. ONE_PAGER - Marketing materials, product overviews, sales collateral, company briefs
5. UNKNOWN - Does not clearly match any category

Generate a concise one-sentence summary suitable for a table of contents.`;

/**
 * Classifies a document's content and filename using Claude Haiku 4.5.
 *
 * @param content - The document content (markdown or plain text).
 * @param filename - Original filename of the uploaded document.
 * @returns Classification result with AI usage data.
 */
export async function classifyDocument(
  content: string,
  filename: string,
): Promise<DocumentClassificationResult> {
  const startMs = Date.now();

  // Truncate content to avoid excessive token usage -- first 2000 chars is enough for classification.
  const truncatedContent = content.length > 2000 ? content.slice(0, 2000) + '\n...[truncated]' : content;

  const response = await anthropic.messages.create({
    model: config.anthropic.haikuModel,
    max_tokens: 200,
    tools: [CLASSIFY_DOCUMENT_TOOL],
    tool_choice: { type: 'tool', name: 'classify_document' },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Filename: ${filename}\n\n---\n\n${truncatedContent}`,
      },
    ],
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

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
  );

  if (!toolUseBlock) {
    logger.warn('Document classifier returned no tool_use block', { filename });
    return {
      classification: {
        documentType: 'UNKNOWN',
        confidence: 0,
        suggestedLabel: filename.replace(/\.[^.]+$/, ''),
        summary: 'Could not classify document.',
      },
      usage,
    };
  }

  const input = toolUseBlock.input as Record<string, unknown>;

  return {
    classification: {
      documentType: (input.document_type as DocumentClassification['documentType']) ?? 'UNKNOWN',
      confidence: (input.confidence as number) ?? 0,
      suggestedLabel: (input.suggested_label as string) ?? filename.replace(/\.[^.]+$/, ''),
      summary: (input.summary as string) ?? '',
    },
    usage,
  };
}
