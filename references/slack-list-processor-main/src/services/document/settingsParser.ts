/**
 * Settings document parser.
 *
 * Extracts YAML front matter from Settings-type documents using
 * gray-matter. Validates recognized keys against the settings schema
 * and returns parsed settings alongside the remaining content.
 */

import matter from 'gray-matter';
import logger from '../../lib/logger.js';

/** Parsed settings result. */
export interface ParsedSettingsResult {
  /** Parsed key-value settings from YAML front matter. */
  settings: Record<string, unknown>;
  /** Document content after front matter extraction. */
  content: string;
}

/** Recognized settings keys and their validation rules. */
const SETTINGS_SCHEMA: Record<
  string,
  { type: 'number' | 'string' | 'string[]'; min?: number; max?: number }
> = {
  decision_makers: { type: 'number', min: 1, max: 10 },
  personas: { type: 'string[]' },
  max_rows: { type: 'number', min: 1, max: 5000 },
  instantly_campaign_id: { type: 'string' },
  purpose: { type: 'string' },
};

/**
 * Parses a Settings document's YAML front matter.
 *
 * Validates recognized keys against the schema. Unrecognized keys pass
 * through in the settings object for future extensibility and AI context.
 *
 * @param markdownContent - Raw markdown content with optional YAML front matter.
 * @returns Parsed settings and remaining content.
 */
export function parseSettings(markdownContent: string): ParsedSettingsResult {
  const parsed = matter(markdownContent);
  const rawData = parsed.data as Record<string, unknown>;
  const settings: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rawData)) {
    const schema = SETTINGS_SCHEMA[key];

    if (!schema) {
      // Unrecognized key -- pass through without validation.
      settings[key] = value;
      continue;
    }

    // Validate recognized keys.
    switch (schema.type) {
      case 'number': {
        const num = Number(value);
        if (Number.isNaN(num)) {
          logger.warn('Settings key has invalid number value', { key, value });
          continue;
        }
        if (schema.min !== undefined && num < schema.min) {
          logger.warn('Settings key below minimum', { key, value, min: schema.min });
          settings[key] = schema.min;
          continue;
        }
        if (schema.max !== undefined && num > schema.max) {
          logger.warn('Settings key above maximum', { key, value, max: schema.max });
          settings[key] = schema.max;
          continue;
        }
        settings[key] = num;
        break;
      }
      case 'string': {
        if (typeof value !== 'string') {
          logger.warn('Settings key has invalid string value', { key, value });
          continue;
        }
        settings[key] = value;
        break;
      }
      case 'string[]': {
        if (!Array.isArray(value)) {
          logger.warn('Settings key has invalid array value', { key, value });
          continue;
        }
        settings[key] = value.map(String);
        break;
      }
    }
  }

  return {
    settings,
    content: parsed.content.trim(),
  };
}
