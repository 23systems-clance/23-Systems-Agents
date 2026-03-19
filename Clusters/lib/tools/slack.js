import { createHmac } from 'crypto';

const MAX_LENGTH = 4000; // Slack block text limit

/**
 * Verify a Slack request signature.
 * @param {string} signingSecret - Slack signing secret
 * @param {string} timestamp - X-Slack-Request-Timestamp header
 * @param {string} rawBody - Raw request body string
 * @param {string} signature - X-Slack-Signature header
 * @returns {boolean}
 */
function verifySlackSignature(signingSecret, timestamp, rawBody, signature) {
  if (!signingSecret || !timestamp || !rawBody || !signature) return false;

  // Reject requests older than 5 minutes (replay protection)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const computed = 'v0=' + createHmac('sha256', signingSecret).update(baseString).digest('hex');

  // Timing-safe comparison
  if (computed.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Send a message to a Slack channel or thread.
 * @param {string} botToken - Slack bot token (xoxb-...)
 * @param {string} channel - Channel ID
 * @param {string} text - Message text (markdown)
 * @param {Object} [options]
 * @param {string} [options.threadTs] - Thread timestamp to reply in
 * @returns {Promise<Object>} Slack API response
 */
async function sendMessage(botToken, channel, text, options = {}) {
  const chunks = smartSplit(text, MAX_LENGTH);
  let lastResponse;

  for (const chunk of chunks) {
    const body = {
      channel,
      text: chunk,
      ...(options.threadTs && { thread_ts: options.threadTs }),
    };

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    lastResponse = await res.json();
    if (!lastResponse.ok) {
      console.error('[slack] Failed to send message:', lastResponse.error);
    }
  }

  return lastResponse;
}

/**
 * Add an emoji reaction to a message.
 * @param {string} botToken - Slack bot token
 * @param {string} channel - Channel ID
 * @param {string} timestamp - Message timestamp
 * @param {string} [emoji='eyes'] - Emoji name (without colons)
 */
async function addReaction(botToken, channel, timestamp, emoji = 'eyes') {
  const res = await fetch('https://slack.com/api/reactions.add', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, timestamp, name: emoji }),
  });

  const data = await res.json();
  if (!data.ok && data.error !== 'already_reacted') {
    console.error('[slack] Failed to add reaction:', data.error);
  }
}

/**
 * Download a file from Slack.
 * @param {string} botToken - Slack bot token
 * @param {string} urlPrivate - File's url_private from Slack
 * @param {string} [filename] - Original filename
 * @param {string} [mimeType] - File MIME type
 * @returns {Promise<{buffer: Buffer, filename: string, mimeType: string}>}
 */
async function downloadFile(botToken, urlPrivate, filename, mimeType) {
  const res = await fetch(urlPrivate, {
    headers: { 'Authorization': `Bearer ${botToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to download Slack file: ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, filename: filename || 'file', mimeType: mimeType || 'application/octet-stream' };
}

/**
 * Smart split text into chunks that fit Slack's limit.
 * Prefers splitting at paragraph > newline > sentence > space.
 * @param {string} text - Text to split
 * @param {number} maxLength - Maximum chunk length
 * @returns {string[]} Array of chunks
 */
function smartSplit(text, maxLength = MAX_LENGTH) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    const chunk = remaining.slice(0, maxLength);
    let splitAt = -1;

    for (const delim of ['\n\n', '\n', '. ', ' ']) {
      const idx = chunk.lastIndexOf(delim);
      if (idx > maxLength * 0.3) {
        splitAt = idx + delim.length;
        break;
      }
    }

    if (splitAt === -1) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

export {
  verifySlackSignature,
  sendMessage,
  addReaction,
  downloadFile,
  smartSplit,
};
