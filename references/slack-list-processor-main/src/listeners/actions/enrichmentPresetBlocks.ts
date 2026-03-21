/**
 * Block Kit builders for enrichment preset selection and customization.
 *
 * Provides:
 * - `buildContactFilterSelectionBlocks` — Two-button message (Use Defaults / Customize)
 * - `buildContactFilterModal` — Slack modal for filter customization
 * - `formatFilterSummary` — Human-readable mrkdwn summary of selected filters
 */

import type { KnownBlock, View } from '@slack/types';
import type { ApolloContactFilters } from '../../types/enrichmentFilters.js';
import { APOLLO_SENIORITY_OPTIONS } from '../../types/enrichmentFilters.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal preset shape for populating the modal dropdown. */
export interface PresetOption {
  id: string;
  name: string;
  isDefault: boolean;
  scope: string;
  personSeniorities: string[];
  personTitles: string[];
  personDepartments: string[];
  personFunctions: string[];
  perPage: number;
}

// ---------------------------------------------------------------------------
// Block Kit message builder
// ---------------------------------------------------------------------------

/**
 * Builds Block Kit blocks for the contact filter selection prompt.
 *
 * Shows the current default filters and presents two buttons:
 * "Use Defaults" and "Customize".
 *
 * @param defaultFilters - The current default filter configuration.
 * @returns Block Kit blocks array.
 */
export function buildContactFilterSelectionBlocks(
  defaultFilters: ApolloContactFilters,
): KnownBlock[] {
  const seniorityLabels = defaultFilters.personSeniorities
    .map((s) => {
      const opt = APOLLO_SENIORITY_OPTIONS.find((o) => o.value === s);
      return opt ? opt.label : s;
    })
    .join(', ');

  let summaryParts = [`*Seniorities:* ${seniorityLabels}`];
  if (defaultFilters.personTitles.length > 0) {
    summaryParts.push(`*Titles:* ${defaultFilters.personTitles.join(', ')}`);
  }
  if (defaultFilters.personDepartments.length > 0) {
    summaryParts.push(`*Departments:* ${defaultFilters.personDepartments.join(', ')}`);
  }
  if (defaultFilters.personFunctions.length > 0) {
    summaryParts.push(`*Functions:* ${defaultFilters.personFunctions.join(', ')}`);
  }
  summaryParts.push('*Location:* United States');

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Contact Extraction Filters*\n\nDefault preset:\n${summaryParts.join('\n')}`,
      },
    },
    {
      type: 'actions',
      block_id: 'contact_filter_selection',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Use Defaults' },
          action_id: 'contact_filter_use_defaults',
          value: 'defaults',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Customize' },
          action_id: 'contact_filter_customize',
          value: 'customize',
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Slack modal builder
// ---------------------------------------------------------------------------

/**
 * Builds the Slack modal view for contact filter customization.
 *
 * Includes:
 * - Preset selector dropdown
 * - Seniority checkboxes (pre-selected from default)
 * - Text inputs for titles, departments, functions (comma-separated)
 * - Read-only location display
 * - Save as preset option
 *
 * @param presets    - Available presets for the dropdown.
 * @param threadTs  - Thread timestamp for callback routing.
 * @param channelId - Channel ID for callback routing.
 * @param defaultFilters - Filters to pre-populate the form with.
 * @returns Slack modal view object.
 */
export function buildContactFilterModal(
  presets: PresetOption[],
  threadTs: string,
  channelId: string,
  defaultFilters: ApolloContactFilters,
): View {
  // Build preset dropdown options with scope/default badges
  const presetOptions = presets.map((p) => {
    const badges: string[] = [];
    if (p.isDefault) badges.push('Default');
    if (p.scope === 'private') badges.push('Private');
    const suffix = badges.length > 0 ? ` (${badges.join(', ')})` : '';
    return {
      text: { type: 'plain_text' as const, text: `${p.name}${suffix}` },
      value: p.id,
    };
  });

  // Build seniority checkbox options with initial selections
  const seniorityOptions = APOLLO_SENIORITY_OPTIONS.map((opt) => ({
    text: { type: 'plain_text' as const, text: opt.label },
    value: opt.value,
  }));

  const initialSeniorities = seniorityOptions.filter((opt) =>
    defaultFilters.personSeniorities.includes(opt.value),
  );

  const blocks: KnownBlock[] = [];

  // Preset selector (only show if there are presets)
  if (presetOptions.length > 0) {
    blocks.push({
      type: 'input',
      block_id: 'preset_selector',
      optional: true,
      label: { type: 'plain_text', text: 'Load Preset' },
      element: {
        type: 'static_select',
        action_id: 'preset_select',
        placeholder: { type: 'plain_text', text: 'Select a preset...' },
        options: presetOptions,
      },
    } as KnownBlock);
  }

  // Divider
  blocks.push({ type: 'divider' });

  // Seniority checkboxes
  blocks.push({
    type: 'input',
    block_id: 'seniorities',
    label: { type: 'plain_text', text: 'Seniority Levels' },
    element: {
      type: 'checkboxes',
      action_id: 'seniority_select',
      options: seniorityOptions,
      ...(initialSeniorities.length > 0 ? { initial_options: initialSeniorities } : {}),
    },
  } as KnownBlock);

  // Person titles (comma-separated)
  blocks.push({
    type: 'input',
    block_id: 'titles',
    optional: true,
    label: { type: 'plain_text', text: 'Job Titles' },
    hint: { type: 'plain_text', text: 'Comma-separated, e.g. CTO, VP of Engineering, IT Director' },
    element: {
      type: 'plain_text_input',
      action_id: 'titles_input',
      placeholder: { type: 'plain_text', text: 'CTO, VP of Engineering, IT Director' },
      ...(defaultFilters.personTitles.length > 0
        ? { initial_value: defaultFilters.personTitles.join(', ') }
        : {}),
    },
  } as KnownBlock);

  // Person departments (comma-separated)
  blocks.push({
    type: 'input',
    block_id: 'departments',
    optional: true,
    label: { type: 'plain_text', text: 'Departments' },
    hint: { type: 'plain_text', text: 'Comma-separated, e.g. engineering, sales, marketing' },
    element: {
      type: 'plain_text_input',
      action_id: 'departments_input',
      placeholder: { type: 'plain_text', text: 'engineering, sales, marketing' },
      ...(defaultFilters.personDepartments.length > 0
        ? { initial_value: defaultFilters.personDepartments.join(', ') }
        : {}),
    },
  } as KnownBlock);

  // Person functions (comma-separated)
  blocks.push({
    type: 'input',
    block_id: 'functions',
    optional: true,
    label: { type: 'plain_text', text: 'Job Functions' },
    hint: { type: 'plain_text', text: 'Comma-separated, e.g. human_resources, finance' },
    element: {
      type: 'plain_text_input',
      action_id: 'functions_input',
      placeholder: { type: 'plain_text', text: 'human_resources, finance' },
      ...(defaultFilters.personFunctions.length > 0
        ? { initial_value: defaultFilters.personFunctions.join(', ') }
        : {}),
    },
  } as KnownBlock);

  // Location (read-only context)
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: '*Location:* United States (locked)',
      },
    ],
  });

  // Divider before save option
  blocks.push({ type: 'divider' });

  // Save as preset name input (optional)
  blocks.push({
    type: 'input',
    block_id: 'save_preset',
    optional: true,
    label: { type: 'plain_text', text: 'Save as Preset' },
    hint: { type: 'plain_text', text: 'Enter a name to save these filters as a reusable preset' },
    element: {
      type: 'plain_text_input',
      action_id: 'preset_name_input',
      placeholder: { type: 'plain_text', text: 'My Custom Preset' },
    },
  } as KnownBlock);

  return {
    type: 'modal',
    callback_id: 'contact_filter_submit',
    notify_on_close: true,
    private_metadata: JSON.stringify({ threadTs, channelId }),
    title: { type: 'plain_text', text: 'Contact Filters' },
    submit: { type: 'plain_text', text: 'Apply Filters' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Summary formatter
// ---------------------------------------------------------------------------

/**
 * Formats a human-readable mrkdwn summary of the selected contact filters.
 *
 * @param filters - The selected Apollo contact filters.
 * @returns Formatted mrkdwn string.
 */
export function formatFilterSummary(filters: ApolloContactFilters): string {
  const parts: string[] = [];

  const seniorityLabels = filters.personSeniorities
    .map((s) => {
      const opt = APOLLO_SENIORITY_OPTIONS.find((o) => o.value === s);
      return opt ? opt.label : s;
    })
    .join(', ');
  parts.push(`Seniorities: ${seniorityLabels}`);

  if (filters.personTitles.length > 0) {
    parts.push(`Titles: ${filters.personTitles.join(', ')}`);
  }
  if (filters.personDepartments.length > 0) {
    parts.push(`Departments: ${filters.personDepartments.join(', ')}`);
  }
  if (filters.personFunctions.length > 0) {
    parts.push(`Functions: ${filters.personFunctions.join(', ')}`);
  }
  parts.push('Location: United States');

  return parts.join(' | ');
}
