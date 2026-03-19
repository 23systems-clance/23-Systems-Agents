/**
 * Input Resolver — resolves {{input.*}} template variables in cluster configs.
 *
 * Takes a template's cluster definition and user-provided input values,
 * returns a fully resolved cluster config ready for createCluster().
 */

/**
 * Deep clone a value (JSON-safe).
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Replace all {{input.fieldId}} tokens in a string with actual values.
 */
function resolveString(str, inputs) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{input\.(\w+)\}\}/g, (match, fieldId) => {
    return inputs[fieldId] !== undefined ? String(inputs[fieldId]) : match;
  });
}

/**
 * Recursively resolve all strings in an object or array.
 */
function resolveDeep(value, inputs) {
  if (typeof value === 'string') return resolveString(value, inputs);
  if (Array.isArray(value)) return value.map(item => resolveDeep(item, inputs));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = resolveDeep(val, inputs);
    }
    return result;
  }
  return value;
}

/**
 * Validate user inputs against template input definitions.
 * Returns { valid: boolean, errors: string[], values: object }
 *
 * - Fills in defaults for missing optional fields
 * - Validates required fields are present
 * - Validates select values are in the options list
 */
export function validateInputs(templateInputs, userInputs) {
  const errors = [];
  const values = {};

  for (const input of templateInputs) {
    const value = userInputs[input.id];

    if (input.required && (!value || (typeof value === 'string' && !value.trim()))) {
      errors.push(`"${input.label}" is required`);
      continue;
    }

    if (value !== undefined && value !== '') {
      if (input.type === 'select' && input.options) {
        const validValues = input.options.map(o => o.value);
        if (!validValues.includes(value)) {
          errors.push(`"${input.label}" has an invalid selection`);
          continue;
        }
      }
      values[input.id] = value;
    } else if (input.default !== undefined) {
      values[input.id] = input.default;
    } else {
      values[input.id] = '';
    }
  }

  return { valid: errors.length === 0, errors, values };
}

/**
 * Resolve a template's cluster config with user inputs.
 *
 * Returns a fully resolved cluster object with all {{input.*}} replaced:
 * {
 *   systemPrompt: "...",
 *   folders: [...],
 *   roles: [{ roleName, role, prompt, maxConcurrency, dependsOn }, ...]
 * }
 */
export function resolveInputs(template, userInputs) {
  const { valid, errors, values } = validateInputs(template.inputs, userInputs);
  if (!valid) {
    throw new Error(`Input validation failed: ${errors.join(', ')}`);
  }

  const resolved = resolveDeep(deepClone(template.cluster), values);
  return resolved;
}

/**
 * Build a team name from template name and primary input.
 * e.g., "Research Team" + "CRM tools" → "Research Team — CRM tools"
 */
export function buildTeamName(template, userInputs) {
  const primaryInput = template.inputs.find(i => i.required) || template.inputs[0];
  const primaryValue = userInputs[primaryInput?.id];

  if (primaryValue && primaryValue.length <= 50) {
    return `${template.name} — ${primaryValue}`;
  }
  if (primaryValue) {
    return `${template.name} — ${primaryValue.substring(0, 47)}...`;
  }
  return template.name;
}
