/**
 * JSON response schema discovery.
 *
 * Recursively traverses a JSON response to extract all leaf paths
 * with their types and array flags for dynamic field mapping.
 */

/** A discovered field path in a JSON response. */
export interface DiscoveredField {
  /** Dot-separated path, e.g. "data.contacts[].email". */
  path: string;
  /** JavaScript typeof for the value. */
  type: string;
  /** Whether this field is inside an array. */
  isArray: boolean;
  /** A sample value for display in the UI. */
  sampleValue?: unknown;
}

/**
 * Recursively discovers all leaf paths in a JSON object.
 *
 * @param obj - The JSON object to traverse.
 * @param prefix - Current path prefix (used in recursion).
 * @param depth - Current recursion depth (max 10 to prevent infinite recursion).
 * @returns Array of discovered field descriptors.
 *
 * @example
 * discoverSchema({ data: { contacts: [{ email: "a@b.com" }] } })
 * // [
 * //   { path: "data.contacts[].email", type: "string", isArray: true, sampleValue: "a@b.com" }
 * // ]
 */
export function discoverSchema(
  obj: unknown,
  prefix = '',
  depth = 0
): DiscoveredField[] {
  if (depth > 10) return [];
  if (obj === null || obj === undefined) return [];

  const fields: DiscoveredField[] = [];

  if (typeof obj !== 'object') {
    // Leaf value at the root
    fields.push({
      path: prefix || '$',
      type: typeof obj,
      isArray: false,
      sampleValue: truncateSample(obj),
    });
    return fields;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      fields.push({
        path: prefix ? `${prefix}[]` : '[]',
        type: 'array',
        isArray: true,
      });
      return fields;
    }

    const firstItem = obj[0];
    const arrayPath = prefix ? `${prefix}[]` : '[]';

    if (typeof firstItem === 'object' && firstItem !== null) {
      fields.push(...discoverSchema(firstItem, arrayPath, depth + 1));
    } else {
      fields.push({
        path: arrayPath,
        type: typeof firstItem,
        isArray: true,
        sampleValue: truncateSample(firstItem),
      });
    }
    return fields;
  }

  // Regular object
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      fields.push({
        path: fullPath,
        type: 'null',
        isArray: false,
        sampleValue: null,
      });
    } else if (Array.isArray(value)) {
      fields.push(...discoverSchema(value, fullPath, depth + 1));
    } else if (typeof value === 'object') {
      fields.push(...discoverSchema(value, fullPath, depth + 1));
    } else {
      fields.push({
        path: fullPath,
        type: typeof value,
        isArray: false,
        sampleValue: truncateSample(value),
      });
    }
  }

  return fields;
}

/**
 * Truncates sample values for display.
 */
function truncateSample(value: unknown): unknown {
  if (typeof value === 'string' && value.length > 100) {
    return value.substring(0, 100) + '...';
  }
  return value;
}
