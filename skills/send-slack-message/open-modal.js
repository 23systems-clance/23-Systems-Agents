#!/usr/bin/env node

/**
 * Open a Slack modal (view) using a trigger_id from an interaction payload.
 *
 * Usage:
 *   open-modal.js <trigger_id> --title "Form Title" --inputs "Label=id,Label2=id2" --submit "Go"
 *   open-modal.js <trigger_id> --title "Pick" --dropdown "Opt A=a,Opt B=b"
 */

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
if (!SLACK_BOT_TOKEN) {
  console.error('Error: SLACK_BOT_TOKEN environment variable is required');
  process.exit(1);
}

const args = process.argv.slice(2);
const triggerId = args[0];
if (!triggerId || triggerId.startsWith('--')) {
  console.error('Usage: open-modal.js <trigger_id> [options]');
  console.error('  --title <text>          Modal title (max 24 chars)');
  console.error('  --inputs <label=id,...>  Text input fields');
  console.error('  --dropdown <l=v,...>     Static select options');
  console.error('  --submit <text>          Submit button text');
  console.error('  --callback-id <id>       Callback ID for submission');
  process.exit(1);
}

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1 || !args[idx + 1]) return null;
  return args[idx + 1];
}

async function main() {
  const title = getArg('--title') || 'Form';
  const inputsRaw = getArg('--inputs');
  const dropdownRaw = getArg('--dropdown');
  const submitText = getArg('--submit') || 'Submit';
  const callbackId = getArg('--callback-id') || 'slack_blocks_modal';

  const blocks = [];

  if (inputsRaw) {
    for (const pair of inputsRaw.split(',')) {
      const [label, blockId] = pair.split('=');
      blocks.push({
        type: 'input',
        block_id: (blockId || label).trim(),
        element: {
          type: 'plain_text_input',
          action_id: `${(blockId || label).trim()}_input`,
        },
        label: { type: 'plain_text', text: label.trim() },
      });
    }
  }

  if (dropdownRaw) {
    const options = dropdownRaw.split(',').map((pair) => {
      const [label, value] = pair.split('=');
      return {
        text: { type: 'plain_text', text: label.trim() },
        value: (value || label).trim(),
      };
    });
    blocks.push({
      type: 'input',
      block_id: 'dropdown_block',
      element: {
        type: 'static_select',
        placeholder: { type: 'plain_text', text: 'Select an option' },
        options,
        action_id: 'dropdown_select',
      },
      label: { type: 'plain_text', text: 'Selection' },
    });
  }

  const view = {
    type: 'modal',
    callback_id: callbackId,
    title: { type: 'plain_text', text: title.slice(0, 24) },
    submit: { type: 'plain_text', text: submitText },
    blocks,
  };

  const res = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trigger_id: triggerId, view }),
  });

  const data = await res.json();

  if (!data.ok) {
    console.error(`Slack API error: ${data.error}`);
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, view_id: data.view.id }, null, 2));
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
