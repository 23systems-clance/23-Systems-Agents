/**
 * Default Static Prompts
 * Feature 23: Dynamic Suggested Prompts
 */

import { SuggestedPrompt } from '../types/promptTypes';

export const DEFAULT_PROMPTS: SuggestedPrompt[] = [
  {
    title: 'Upload a list',
    message: 'Upload a company list to get started with enrichment',
  },
  {
    title: 'What can you do?',
    message: 'Show me all available enrichment and reporting features',
  },
  {
    title: 'Check my usage',
    message: 'How many API credits do I have remaining this month?',
  },
  {
    title: 'Recent activity',
    message: 'Show me my recent enrichment jobs and their status',
  },
];
