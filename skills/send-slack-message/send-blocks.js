#!/usr/bin/env node

/**
 * Send interactive Slack messages using Block Kit.
 * Supports buttons, dropdowns, context blocks, and raw Block Kit JSON.
 *
 * Usage:
 *   send-blocks.js <channel> --text "Message" --buttons "Label=value,Label2=value2"
 *   send-blocks.js <channel> --text "Pick one" --dropdown "Opt A=a,Opt B=b"
 *   send-blocks.js <channel> --blocks '[{...}]'
 *   echo '[{...}]' | send-blocks.js <channel> --blocks -
 */

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
if (!SLACK_BOT_TOKEN) {
  console.error('Error: SLACK_BOT_TOKEN environment variable is required');
  process.exit(1);
}

const args = process.argv.slice(2);
const channel = args[0];
if (!channel || channel.startsWith('--')) {
  console.error('Usage: send-blocks.js <channel> [options]');
  console.error('  --text <text>         Header text (mrkdwn)');
  console.error('  --buttons <l=v,...>    Button definitions');
  console.error('  --dropdown <l=v,...>   Dropdown options');
  console.error('  --placeholder <text>   Dropdown placeholder');
  console.error('  --context <text>       Context line');
  console.error('  --thread-ts <ts>       Thread timestamp');
  console.error('  --blocks <json|->      Raw Block Kit JSON');
  console.error('  --action-id <prefix>   Action ID prefix');
  process.exit(1);
}

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1 || !args[idx + 1]) return null;
  return args[idx + 1];
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function main() {
  const text = getArg('--text');
  const buttonsRaw = getArg('--buttons');
  const dropdownRaw = getArg('--dropdown');
  const placeholder = getArg('--placeholder') || 'Select an option';
  const context = getArg('--context');
  const threadTs = getArg('--thread-ts');
  const blocksRaw = getArg('--blocks');
  const actionIdPrefix = getArg('--action-id') || 'slack_blocks';

  let blocks;

  if (blocksRaw) {
    // Raw blocks JSON — from arg or stdin
    const json = blocksRaw === '-' ? await readStdin() : blocksRaw;
    blocks = JSON.parse(json);
  } else {
    // Build blocks from options
    blocks = [];

    if (text) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text },
      });
    }

    if (buttonsRaw) {
      const buttons = buttonsRaw.split(',').map((pair, i) => {
        const [label, value] = pair.split('=');
        return {
          type: 'button',
          text: { type: 'plain_text', text: label.trim(), emoji: true },
          value: (value || label).trim(),
          action_id: `${actionIdPrefix}_btn_${i}`,
        };
      });
      blocks.push({ type: 'actions', elements: buttons });
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
        type: 'actions',
        elements: [
          {
            type: 'static_select',
            placeholder: { type: 'plain_text', text: placeholder },
            options,
            action_id: `${actionIdPrefix}_select`,
          },
        ],
      });
    }

    if (context) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: context }],
      });
    }
  }

  if (!blocks || blocks.length === 0) {
    console.error('Error: No blocks to send. Use --text, --buttons, --dropdown, or --blocks.');
    process.exit(1);
  }

  const body = {
    channel,
    blocks,
    // Fallback text for notifications
    text: text || 'Interactive message',
    ...(threadTs && { thread_ts: threadTs }),
  };

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!data.ok) {
    console.error(`Slack API error: ${data.error}`);
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    channel: data.channel,
    ts: data.ts,
    message_ts: data.ts,
  }, null, 2));
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
