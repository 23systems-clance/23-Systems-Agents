/**
 * Error Handling Utilities for Prompt Generation
 * Feature 23: Dynamic Suggested Prompts
 */

import logger from '../lib/logger';
import { SuggestedPrompt } from '../types/promptTypes';
import { DEFAULT_PROMPTS } from '../constants/defaultPrompts';

export class PromptGenerationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly context?: Record<string, any>
  ) {
    super(message);
    this.name = 'PromptGenerationError';
  }
}

export class PromptContextBuildError extends PromptGenerationError {
  constructor(message: string, cause?: unknown, context?: Record<string, any>) {
    super(message, cause, context);
    this.name = 'PromptContextBuildError';
  }
}

export class PromptScoringError extends PromptGenerationError {
  constructor(message: string, cause?: unknown, context?: Record<string, any>) {
    super(message, cause, context);
    this.name = 'PromptScoringError';
  }
}

export class PromptTemplateError extends PromptGenerationError {
  constructor(message: string, cause?: unknown, context?: Record<string, any>) {
    super(message, cause, context);
    this.name = 'PromptTemplateError';
  }
}

export function fallbackToDefaultPrompts(
  error: Error,
  context: { userId?: string; teamId?: string; operation?: string }
): SuggestedPrompt[] {
  logger.error('Prompt generation failed, falling back to defaults', {
    error: { name: error.name, message: error.message },
    ...context,
  });
  return DEFAULT_PROMPTS;
}

export function validatePrompts(prompts: SuggestedPrompt[]): SuggestedPrompt[] {
  const MAX_PROMPTS = 4;
  const MAX_TITLE_LENGTH = 25;
  const MAX_MESSAGE_LENGTH = 150;

  if (prompts.length !== MAX_PROMPTS) {
    logger.warn('Invalid prompt count, using defaults', { count: prompts.length });
    return DEFAULT_PROMPTS;
  }

  return prompts.map(prompt => ({
    title: prompt.title.substring(0, MAX_TITLE_LENGTH),
    message: prompt.message.substring(0, MAX_MESSAGE_LENGTH),
  }));
}

export function createErrorContext(
  operation: string,
  metadata?: Record<string, any>
): Record<string, any> {
  return {
    operation,
    timestamp: new Date().toISOString(),
    feature: 'dynamic-suggested-prompts',
    ...metadata,
  };
}
