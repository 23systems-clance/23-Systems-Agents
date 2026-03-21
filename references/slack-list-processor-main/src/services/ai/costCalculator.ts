/**
 * Shared cost calculation for Anthropic AI API calls.
 *
 * Uses configured cost-per-token rates to estimate USD spend
 * for intent classification and persona classification calls.
 */

import { config } from '../../config/index.js';

/**
 * Token usage and cost data from an AI API call.
 * Carried alongside results so callers can log it to api_usage_logs.
 */
export interface AiUsageData {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
}

/**
 * Calculates estimated USD cost from token counts using config rates.
 *
 * @param inputTokens - Number of input tokens consumed.
 * @param outputTokens - Number of output tokens generated.
 * @returns Estimated cost in USD.
 */
export function calculateAiCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1000) * config.anthropic.costPer1kInputTokens;
  const outputCost = (outputTokens / 1000) * config.anthropic.costPer1kOutputTokens;
  return inputCost + outputCost;
}
