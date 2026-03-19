import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

const TEMPLATES_DIR = join(process.cwd(), 'config', 'templates');

const REQUIRED_FIELDS = ['id', 'name', 'description', 'inputs', 'cluster'];
const VALID_INPUT_TYPES = ['text', 'select', 'textarea', 'file'];
const VALID_CATEGORIES = ['research', 'content', 'data', 'development', 'support', 'marketing', 'custom'];

/**
 * Validate a template object has all required fields and correct structure.
 * Returns { valid: boolean, errors: string[] }
 */
export function validateTemplate(template) {
  const errors = [];

  for (const field of REQUIRED_FIELDS) {
    if (!template[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (template.inputs && Array.isArray(template.inputs)) {
    for (const input of template.inputs) {
      if (!input.id) errors.push('Input missing id');
      if (!input.label) errors.push(`Input "${input.id}" missing label`);
      if (!input.type) errors.push(`Input "${input.id}" missing type`);
      if (input.type && !VALID_INPUT_TYPES.includes(input.type)) {
        errors.push(`Input "${input.id}" has invalid type: ${input.type}`);
      }
      if (input.type === 'select' && (!input.options || !Array.isArray(input.options))) {
        errors.push(`Select input "${input.id}" missing options array`);
      }
    }
  }

  if (template.cluster) {
    if (!template.cluster.roles || !Array.isArray(template.cluster.roles)) {
      errors.push('cluster.roles must be an array');
    } else {
      for (const role of template.cluster.roles) {
        if (!role.roleName) errors.push('Role missing roleName');
        if (!role.role) errors.push(`Role "${role.roleName}" missing role description`);
        if (!role.prompt) errors.push(`Role "${role.roleName}" missing prompt`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Load all templates from config/templates/*.json
 * Returns sorted array of template objects.
 */
export async function loadTemplates() {
  try {
    const files = await readdir(TEMPLATES_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const templates = [];
    for (const file of jsonFiles) {
      try {
        const content = await readFile(join(TEMPLATES_DIR, file), 'utf-8');
        const template = JSON.parse(content);
        const { valid, errors } = validateTemplate(template);
        if (valid) {
          templates.push(template);
        } else {
          console.warn(`Template ${file} skipped — validation errors:`, errors);
        }
      } catch (err) {
        console.warn(`Failed to load template ${file}:`, err.message);
      }
    }

    return templates.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.warn('Failed to read templates directory:', err.message);
    return [];
  }
}

/**
 * Load a single template by ID.
 * Returns template object or null.
 */
export async function getTemplate(id) {
  const templates = await loadTemplates();
  return templates.find(t => t.id === id) || null;
}

/**
 * Get templates filtered by category.
 */
export async function getTemplatesByCategory(category) {
  const templates = await loadTemplates();
  if (!category || category === 'all') return templates;
  return templates.filter(t => t.category === category);
}

/**
 * Get all unique categories from loaded templates.
 */
export async function getCategories() {
  const templates = await loadTemplates();
  const categories = [...new Set(templates.map(t => t.category).filter(Boolean))];
  return categories.sort();
}
