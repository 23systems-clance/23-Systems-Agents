/**
 * Predefined transform function library for the Parser node.
 *
 * Each function takes a value and optional args, returns a transformed value.
 * Uses a safe, composable approach instead of arbitrary code execution.
 */

import { normalizeDomain } from '../../hubspot/domainNormalizer.js';
import { properCase } from '../../hubspot/nameNormalizer.js';

/** Registry of all available transform functions. */
const transforms: Record<string, (value: unknown, args?: Record<string, unknown>) => unknown> = {
  properCase: (value) => properCase(String(value ?? '')),

  uppercase: (value) => String(value ?? '').toUpperCase(),

  lowercase: (value) => String(value ?? '').toLowerCase(),

  trim: (value) => String(value ?? '').trim(),

  normalizeDomain: (value) => normalizeDomain(String(value ?? '')),

  normalizePhone: (value) => {
    const phone = String(value ?? '').replace(/[^+\d]/g, '');
    if (!phone) return '';
    // Basic E.164: ensure starts with +
    return phone.startsWith('+') ? phone : `+${phone}`;
  },

  split: (value, args) => {
    const delimiter = String(args?.delimiter ?? ',');
    return String(value ?? '').split(delimiter).map((s) => s.trim());
  },

  join: (value, args) => {
    const delimiter = String(args?.delimiter ?? ', ');
    if (Array.isArray(value)) return value.join(delimiter);
    return String(value ?? '');
  },

  replace: (value, args) => {
    const search = String(args?.search ?? '');
    const replacement = String(args?.replacement ?? '');
    if (!search) return String(value ?? '');
    return String(value ?? '').replace(new RegExp(escapeRegex(search), 'g'), replacement);
  },

  extract: (value, args) => {
    const pattern = String(args?.regex ?? args?.pattern ?? '');
    if (!pattern) return '';
    try {
      const match = String(value ?? '').match(new RegExp(pattern));
      return match ? (match[1] ?? match[0]) : '';
    } catch {
      return '';
    }
  },

  default: (value, args) => {
    const fallback = args?.fallbackValue ?? args?.value ?? '';
    if (value === null || value === undefined || value === '') return fallback;
    return value;
  },

  concat: (value, args) => {
    const separator = String(args?.separator ?? ' ');
    const field2Value = args?.field2Value ?? '';
    return `${String(value ?? '')}${separator}${String(field2Value)}`;
  },

  template: (value, args) => {
    const templateStr = String(args?.template ?? value ?? '');
    // Simple replacement of {{field}} patterns from args context
    const ctx = (args?.context ?? {}) as Record<string, unknown>;
    return templateStr.replace(/\{\{([^}]+)\}\}/g, (_m, key: string) => {
      return String(ctx[key.trim()] ?? '');
    });
  },
};

/**
 * Applies a named transform function to a value.
 *
 * @param functionName - The transform function name.
 * @param value - The value to transform.
 * @param args - Optional arguments for the transform.
 * @returns The transformed value.
 * @throws Error if the function name is unknown.
 */
export function applyTransform(
  functionName: string,
  value: unknown,
  args?: Record<string, unknown>
): unknown {
  const fn = transforms[functionName];
  if (!fn) {
    throw new Error(`Unknown transform function: ${functionName}. Available: ${Object.keys(transforms).join(', ')}`);
  }
  return fn(value, args);
}

/**
 * Returns the list of all known transform function names.
 */
export function getTransformFunctionNames(): string[] {
  return Object.keys(transforms);
}

/** Escapes special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
