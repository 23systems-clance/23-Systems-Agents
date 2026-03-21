#!/usr/bin/env node

/**
 * Parse a Slack interaction payload into structured JSON.
 * Reads from stdin (piped from trigger body).
 *
 * Usage:
 *   echo '{"type":"block_actions",...}' | parse-interaction.js
 *   parse-interaction.js < payload.json
 */

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) {
    console.error('Error: No input received on stdin');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Slack sends interaction payloads as form-encoded with a "payload" field
    const params = new URLSearchParams(raw);
    const payloadStr = params.get('payload');
    if (payloadStr) {
      payload = JSON.parse(payloadStr);
    } else {
      console.error('Error: Could not parse input as JSON or form-encoded payload');
      process.exit(1);
    }
  }

  const result = { type: payload.type };

  if (payload.type === 'block_actions') {
    const action = payload.actions?.[0];
    result.action_id = action?.action_id || null;
    result.value = action?.value || action?.selected_option?.value || null;
    result.action_type = action?.type || null;
    // Include all actions if multiple
    if (payload.actions?.length > 1) {
      result.all_actions = payload.actions.map((a) => ({
        action_id: a.action_id,
        value: a.value || a.selected_option?.value || null,
        type: a.type,
      }));
    }
  } else if (payload.type === 'view_submission') {
    result.callback_id = payload.view?.callback_id || null;
    // Extract values from the nested state object
    const values = payload.view?.state?.values || {};
    result.values = {};
    for (const [blockId, block] of Object.entries(values)) {
      for (const [actionId, field] of Object.entries(block)) {
        result.values[blockId] = field.value || field.selected_option?.value || null;
      }
    }
  } else if (payload.type === 'view_closed') {
    result.callback_id = payload.view?.callback_id || null;
  }

  // Common fields
  result.user = payload.user
    ? { id: payload.user.id, username: payload.user.username, name: payload.user.name }
    : null;
  result.channel = payload.channel?.id || null;
  result.message_ts = payload.message?.ts || null;
  result.trigger_id = payload.trigger_id || null;
  result.response_url = payload.response_url || null;

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
