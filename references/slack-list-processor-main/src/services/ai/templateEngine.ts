/**
 * Template variable resolution engine.
 *
 * Replaces `{{variableName}}` placeholders in prompt content with
 * values resolved via a 3-tier priority chain:
 *   1. Job context (runtime values like column headers)
 *   2. Workspace overrides (per-workspace customisations)
 *   3. Global defaults (from PromptVariable.defaultValue)
 *   4. Empty string (if none of the above provide a value)
 *
 * @module templateEngine
 */

import logger from '../../lib/logger.js';

/** Regex matching `{{variableName}}` — word characters only between braces. */
const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Context layers supplied to the template engine, in resolution priority order.
 */
export interface TemplateContext {
  /** Runtime values injected per-job (e.g. column headers, sample data). */
  jobContext?: Record<string, string>;
  /** Per-workspace variable overrides from WorkspacePromptOverride. */
  workspaceOverrides?: Record<string, string>;
  /** Global default values from PromptVariable.defaultValue. */
  globalDefaults?: Record<string, string>;
}

/**
 * Resolves `{{variableName}}` placeholders in the given content string.
 *
 * Resolution priority (first non-undefined wins):
 *   1. jobContext[name]
 *   2. workspaceOverrides[name]
 *   3. globalDefaults[name]
 *   4. empty string
 *
 * Malformed syntax (e.g. `{{unclosed` or `{single}`) is passed through
 * unchanged — only the strict `{{word}}` pattern is matched.
 *
 * @param content  - The prompt template string.
 * @param context  - The layered resolution context.
 * @returns The content with all `{{...}}` placeholders resolved.
 */
export function resolveTemplateVariables(
  content: string,
  context: TemplateContext = {},
): string {
  const { jobContext, workspaceOverrides, globalDefaults } = context;

  return content.replace(VARIABLE_PATTERN, (_match, name: string) => {
    // Tier 1: job context
    if (jobContext && name in jobContext) {
      return jobContext[name];
    }
    // Tier 2: workspace override
    if (workspaceOverrides && name in workspaceOverrides) {
      return workspaceOverrides[name];
    }
    // Tier 3: global default
    if (globalDefaults && name in globalDefaults) {
      return globalDefaults[name];
    }

    // Tier 4: empty string — log a warning for visibility
    logger.warn('Unresolved template variable', { variable: name });
    return '';
  });
}
