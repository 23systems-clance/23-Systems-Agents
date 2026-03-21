/**
 * AI-powered auto-label generation for uploaded config documents.
 *
 * Uses Claude Haiku to summarize document content into a short label
 * (5-10 words). Falls back to "{DocType} - {filename}" on failure.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import { calculateAiCost, type AiUsageData } from '../ai/costCalculator.js';
import { DOC_TYPE_LABELS } from '../analyze/configDocService.js';
import type { ConfigDocType } from '@prisma/client';
import logger from '../../lib/logger.js';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

/** Max characters of markdown content to send to AI for label generation. */
const MAX_CONTENT_CHARS = 2000;

/**
 * Generates a short display label for a config document using AI.
 *
 * @param markdownContent - The full markdown content of the document
 * @param docType - The config document type
 * @param originalFileName - Original uploaded filename (used as fallback)
 * @returns The generated label and AI usage data
 */
export async function generateLabel(
  markdownContent: string,
  docType: ConfigDocType,
  originalFileName: string,
): Promise<{ label: string; usage: AiUsageData | null }> {
  const fallbackLabel = `${DOC_TYPE_LABELS[docType]} - ${originalFileName}`;

  try {
    const truncated = markdownContent.slice(0, MAX_CONTENT_CHARS);
    const start = Date.now();

    const response = await anthropic.messages.create({
      model: config.anthropic.haikuModel,
      max_tokens: 50,
      messages: [
        {
          role: 'user',
          content: `Summarize this document in 5-10 words as a label, starting with the document type (e.g. "ICP - ...", "Campaign - ...", "Settings - ..."). Return ONLY the label, nothing else.\n\n${truncated}`,
        },
      ],
    });

    const durationMs = Date.now() - start;
    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';

    const usage: AiUsageData = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      estimatedCostUsd: calculateAiCost(response.usage.input_tokens, response.usage.output_tokens),
      durationMs,
    };

    if (!text || text.length > 100) {
      logger.warn('AI label too long or empty, using fallback', { text, docType });
      return { label: fallbackLabel, usage };
    }

    logger.info('Auto-generated config doc label', { label: text, docType, durationMs });
    return { label: text, usage };
  } catch (err) {
    logger.warn('AI label generation failed, using fallback', { docType, err });
    return { label: fallbackLabel, usage: null };
  }
}
