#!/usr/bin/env node

/**
 * Slack notification utility for automation pattern failure alerts.
 *
 * Usage:
 *   node notify-slack.js --pattern "Watcher" --name "Revenue anomaly" --owner "clance" --message "34% drop detected"
 *   node notify-slack.js --message "Simple alert message"
 *
 * Environment:
 *   SLACK_BOT_TOKEN          - Slack bot token (xoxb-...)
 *   SLACK_ALERT_CHANNEL_ID   - Channel to send alerts to
 */

const SLACK_API = 'https://slack.com/api/chat.postMessage';

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      parsed[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return parsed;
}

function formatAlert({ pattern, name, owner, message, data }) {
  const lines = [];

  if (pattern && name) {
    lines.push(`:rotating_light: *[${pattern}] ${name}* — ALERT`);
  } else {
    lines.push(`:rotating_light: *Alert*`);
  }

  lines.push('');

  if (message) lines.push(message);
  if (owner) lines.push(`\n*Owner:* @${owner}`);
  if (data) lines.push(`\n*Data:*\n\`\`\`${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}\`\`\``);

  lines.push(`\n_${new Date().toISOString()}_`);

  return lines.join('\n');
}

async function sendSlackAlert(text) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_ALERT_CHANNEL_ID;

  if (!token || !channel) {
    console.error('[notify-slack] Missing SLACK_BOT_TOKEN or SLACK_ALERT_CHANNEL_ID');
    process.exit(1);
  }

  const res = await fetch(SLACK_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, text }),
  });

  const result = await res.json();
  if (!result.ok) {
    console.error('[notify-slack] Failed:', result.error);
    process.exit(1);
  }

  console.log('[notify-slack] Alert sent successfully');
}

// CLI entry point
const args = parseArgs(process.argv.slice(2));
const text = formatAlert(args);
sendSlackAlert(text);

export { formatAlert, sendSlackAlert };
