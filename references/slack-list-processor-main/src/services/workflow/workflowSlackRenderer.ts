/**
 * Slack Block Kit renderer for workflow nodes.
 *
 * Converts workflow node configurations into Slack Block Kit payloads
 * for rendering interactive messages and modals. Used by the Slack action
 * handler and file upload handler to render workflow nodes as Slack messages.
 */

import type { KnownBlock } from '@slack/types';
import type { WorkflowNode } from './types.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Replaces `{{variableName}}` placeholders in a string with values from the
 * context object. If a variable is not found in context, the placeholder is
 * left as-is.
 *
 * @param text    - Template string with `{{var}}` placeholders.
 * @param context - Key-value map of variable substitutions.
 * @returns The interpolated string.
 */
export function interpolateVariables(
  text: string,
  context: Record<string, unknown>,
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
    const value = context[varName];
    if (value === undefined || value === null) {
      return `{{${varName}}}`;
    }
    return String(value);
  });
}

// ---------------------------------------------------------------------------
// Node renderer
// ---------------------------------------------------------------------------

/**
 * Converts a workflow node into Slack Block Kit blocks based on node type.
 *
 * Returns `null` for node types that don't produce a visible Slack message
 * (TRIGGER, CONDITION) or that are rendered via a separate mechanism
 * (FORM_MODAL returns a placeholder message; use {@link renderFormModal}
 * to build the actual modal view).
 *
 * @param node        - The workflow node to render.
 * @param executionId - The current workflow execution ID (used in action_ids).
 * @param context     - Variable context for template interpolation.
 * @returns A `{ text, blocks }` payload for `chat.postMessage`, or `null`.
 */
export function renderNodeToSlackBlocks(
  node: WorkflowNode,
  executionId: string,
  context: Record<string, unknown>,
): { text: string; blocks: KnownBlock[] } | null {
  const cfg = node.data as Record<string, unknown>;
  const nodeType = cfg.type ?? node.type;

  switch (nodeType) {
    // ----- TRIGGER: entry point, nothing to render -----
    case 'TRIGGER':
      return null;

    // ----- CONDITION: auto-advance, nothing to render -----
    case 'CONDITION':
      return null;

    // ----- MESSAGE -----
    case 'MESSAGE': {
      const raw = (cfg.text || cfg.prompt || '') as string;
      const interpolated = interpolateVariables(raw, context);

      const blocks: KnownBlock[] = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: interpolated },
        },
      ];

      return { text: interpolated, blocks };
    }

    // ----- BUTTON_CHOICE -----
    case 'BUTTON_CHOICE': {
      const prompt = interpolateVariables((cfg.prompt || '') as string, context);
      const buttons = (cfg.buttons ?? []) as Array<{ id: string; label: string; value: string; style?: string }>;

      const blocks: KnownBlock[] = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: prompt },
        },
        {
          type: 'actions',
          elements: buttons.map((btn) => ({
            type: 'button' as const,
            text: { type: 'plain_text' as const, text: btn.label, emoji: true },
            action_id: `wf:${executionId}:${node.id}:${btn.id}`,
            value: btn.value,
            ...(btn.style ? { style: btn.style } : {}),
          })),
        } as KnownBlock,
      ];

      return { text: prompt, blocks };
    }

    // ----- FORM_MODAL: opened separately, show placeholder message -----
    case 'FORM_MODAL': {
      const title = (cfg.title || 'Form') as string;
      const text = `Opening form: ${title}...`;

      const blocks: KnownBlock[] = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `_Opening form..._` },
        },
      ];

      return { text, blocks };
    }

    // ----- ENRICHMENT -----
    case 'ENRICHMENT': {
      const enrichType = (cfg.enrichmentType || 'combined') as string;
      const text = `Starting ${enrichType} enrichment...`;

      const blocks: KnownBlock[] = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text },
        },
      ];

      return { text, blocks };
    }

    // ----- ACTION -----
    case 'ACTION': {
      const actionType = (cfg.actionType || 'action') as string;
      const text = `Performing action: *${actionType}*...`;

      const blocks: KnownBlock[] = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text },
        },
      ];

      return { text, blocks };
    }

    // ----- DELAY -----
    case 'DELAY': {
      const text = 'Processing, please wait...';

      const blocks: KnownBlock[] = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text },
        },
      ];

      return { text, blocks };
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Modal renderer
// ---------------------------------------------------------------------------

/**
 * Creates a Slack modal view object for FORM_MODAL workflow nodes.
 *
 * Returns `null` if the node is not a FORM_MODAL type. The returned object
 * can be passed directly to `views.open` or `views.push`.
 *
 * @param node        - The FORM_MODAL workflow node.
 * @param executionId - The current workflow execution ID (encoded in callback_id).
 * @param context     - Variable context for template interpolation.
 * @returns A Slack modal view object, or `null` if not a FORM_MODAL node.
 */
export function renderFormModal(
  node: WorkflowNode,
  executionId: string,
  context: Record<string, unknown>,
): object | null {
  const cfg = node.data as Record<string, unknown>;
  const nodeType = cfg.type ?? node.type;
  if (nodeType !== 'FORM_MODAL') {
    return null;
  }

  const title = interpolateVariables((cfg.title || 'Form') as string, context);
  const fields = (cfg.fields ?? []) as Array<{
    id: string;
    label: string;
    type: string;
    required?: boolean;
    placeholder?: string;
    options?: Array<{ label: string; value: string }>;
  }>;
  const submitLabel = (cfg.submitLabel || 'Submit') as string;

  const inputBlocks = fields.map((field) => {
    const blockId = `wf_field_${field.id}`;
    const actionId = `wf_input_${field.id}`;
    const label = interpolateVariables(field.label, context);
    const isRequired = field.required ?? false;

    let element: Record<string, unknown>;

    switch (field.type) {
      case 'text':
        element = {
          type: 'plain_text_input',
          action_id: actionId,
          ...(field.placeholder
            ? { placeholder: { type: 'plain_text', text: field.placeholder } }
            : {}),
        };
        break;

      case 'textarea':
        element = {
          type: 'plain_text_input',
          action_id: actionId,
          multiline: true,
          ...(field.placeholder
            ? { placeholder: { type: 'plain_text', text: field.placeholder } }
            : {}),
        };
        break;

      case 'number':
        element = {
          type: 'number_input',
          action_id: actionId,
          is_decimal_allowed: true,
          ...(field.placeholder
            ? { placeholder: { type: 'plain_text', text: field.placeholder } }
            : {}),
        };
        break;

      case 'select':
      case 'multi_select': {
        const options = (field.options ?? []).map((opt) => ({
          text: { type: 'plain_text' as const, text: opt.label },
          value: opt.value,
        }));

        if (field.type === 'multi_select') {
          element = {
            type: 'multi_static_select',
            action_id: actionId,
            options,
            ...(field.placeholder
              ? { placeholder: { type: 'plain_text', text: field.placeholder } }
              : {}),
          };
        } else {
          element = {
            type: 'static_select',
            action_id: actionId,
            options,
            ...(field.placeholder
              ? { placeholder: { type: 'plain_text', text: field.placeholder } }
              : {}),
          };
        }
        break;
      }

      case 'date':
        element = {
          type: 'datepicker',
          action_id: actionId,
          ...(field.placeholder
            ? { placeholder: { type: 'plain_text', text: field.placeholder } }
            : {}),
        };
        break;

      case 'checkbox':
        element = {
          type: 'checkboxes',
          action_id: actionId,
          options: (field.options ?? []).map((opt) => ({
            text: { type: 'plain_text' as const, text: opt.label },
            value: opt.value,
          })),
        };
        break;

      default:
        // Fallback to plain_text_input for unknown types
        element = {
          type: 'plain_text_input',
          action_id: actionId,
          ...(field.placeholder
            ? { placeholder: { type: 'plain_text', text: field.placeholder } }
            : {}),
        };
        break;
    }

    return {
      type: 'input',
      block_id: blockId,
      optional: !isRequired,
      label: { type: 'plain_text', text: label, emoji: true },
      element,
    };
  });

  return {
    type: 'modal',
    callback_id: `wf-form:${executionId}:${node.id}`,
    title: {
      type: 'plain_text',
      text: title.slice(0, 24), // Slack modal titles max 24 chars
      emoji: true,
    },
    submit: {
      type: 'plain_text',
      text: submitLabel,
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
      emoji: true,
    },
    blocks: inputBlocks,
  };
}

// ---------------------------------------------------------------------------
// Status messages
// ---------------------------------------------------------------------------

/**
 * Returns a message indicating the workflow has expired.
 *
 * @returns A `{ text, blocks }` payload for Slack.
 */
export function renderExpiredMessage(): { text: string; blocks: KnownBlock[] } {
  const text = 'This workflow has expired. Please start a new one by uploading a file.';

  return {
    text,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text },
      },
    ],
  };
}

/**
 * Returns a formatted error message for display in Slack.
 *
 * @param error - The error description to display.
 * @returns A `{ text, blocks }` payload for Slack.
 */
export function renderErrorMessage(error: string): { text: string; blocks: KnownBlock[] } {
  const text = `Something went wrong: ${error}`;

  return {
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Error:* ${error}`,
        },
      },
    ],
  };
}
