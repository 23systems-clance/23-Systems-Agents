/**
 * Variable interpolation engine for workflow nodes.
 *
 * Replaces {{variable}} placeholders in strings with values from
 * the execution context. Supports nested paths and array indexing.
 */

/**
 * Resolves a nested path from an object.
 *
 * @param obj - The context object.
 * @param path - Dot-separated path, e.g. "contact.email" or "contacts[0].name".
 * @returns The resolved value, or undefined if the path doesn't exist.
 */
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Interpolates {{variable}} placeholders in a string with values from context.
 *
 * @param template - The string containing {{variable}} placeholders.
 * @param context - The execution context with variable values.
 * @param missingBehavior - How to handle missing variables: 'empty' replaces with '',
 *                          'keep' leaves the placeholder as-is. Default 'empty'.
 * @returns The interpolated string.
 *
 * @example
 * interpolate("Hello {{name}}", { name: "Jane" })
 * // "Hello Jane"
 *
 * interpolate("{{contact.email}}", { contact: { email: "a@b.com" } })
 * // "a@b.com"
 */
export function interpolate(
  template: string,
  context: Record<string, unknown>,
  missingBehavior: 'empty' | 'keep' = 'empty'
): string {
  if (!template || typeof template !== 'string') return template || '';

  return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
    const trimmedPath = path.trim();
    const value = resolvePath(context, trimmedPath);

    if (value === undefined || value === null) {
      return missingBehavior === 'keep' ? `{{${trimmedPath}}}` : '';
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  });
}

/**
 * Interpolates all string values in a headers object.
 *
 * @param headers - Key-value header pairs with potential {{variable}} placeholders.
 * @param context - The execution context.
 * @returns Headers with interpolated values.
 */
export function interpolateHeaders(
  headers: Record<string, string>,
  context: Record<string, unknown>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[interpolate(key, context)] = interpolate(value, context);
  }
  return result;
}
