#!/usr/bin/env node

/**
 * Update an existing Slack message — replace interactive elements with results.
 *
 * Usage:
 *   update-message.js <channel> <message_ts> --text "You selected: X"
 *   update-message.js <channel> <message_ts> --text "Done" --context "Processed at 09:30"
 *   update-message.js <channel> <message_ts> --blocks '[{...}]'
 */

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
if (!SLACK_BOT_TOKEN) {
  console.error('Error: SLACK_BOT_TOKEN environment variable is required');
  process.exit(1);
}

const args = process.argv.slice(2);
const channel = args[0];
const messageTs = args[1];

if (!channel || !messageTs || channel.startsWith('--') || messageTs.startsWith('--')) {
  console.error('Usage: update-message.js <channel> <message_ts> [options]');
  console.error('  --text <text>      Updated message text (mrkdwn)');
  console.error('  --context <text>   Context line');
  console.error('  --blocks <json>    Raw Block Kit JSON');
  process.exit(1);
}

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1 || !args[idx + 1]) return null;
  return args[idx + 1];
}

async function main() {
  const text = getArg('--text');
  const context = getArg('--context');
  const blocksRaw = getArg('--blocks');

  let blocks;

  if (blocksRaw) {
    blocks = JSON.parse(blocksRaw);
  } else {
    blocks = [];
    if (text) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text },
      });
    }
    if (context) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: context }],
      });
    }
  }

  const body = {
    channel,
    ts: messageTs,
    blocks,
    text: text || 'Message updated',
  };

  const res = await fetch('https://slack.com/api/chat.update', {
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

  console.log(JSON.stringify({ ok: true, channel: data.channel, ts: data.ts }, null, 2));
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
