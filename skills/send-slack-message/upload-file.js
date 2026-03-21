#!/usr/bin/env node

/**
 * Upload a file to a Slack channel.
 *
 * Usage:
 *   upload-file.js <channel> /path/to/file.csv --title "Results"
 *   upload-file.js <channel> --stdin --filename "output.csv" --title "Report"
 *   echo "data" | upload-file.js <channel> --stdin --filename "data.txt"
 */

import { readFileSync } from 'fs';
import { basename } from 'path';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
if (!SLACK_BOT_TOKEN) {
  console.error('Error: SLACK_BOT_TOKEN environment variable is required');
  process.exit(1);
}

const args = process.argv.slice(2);
const channel = args[0];

if (!channel || channel.startsWith('--')) {
  console.error('Usage: upload-file.js <channel> [filepath] [options]');
  console.error('  --title <text>       File title');
  console.error('  --message <text>     Initial comment');
  console.error('  --filename <name>    Override filename');
  console.error('  --stdin              Read file content from stdin');
  process.exit(1);
}

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1 || !args[idx + 1]) return null;
  return args[idx + 1];
}

function hasFlag(name) {
  return args.includes(name);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function main() {
  const fromStdin = hasFlag('--stdin');
  const filePath = !fromStdin ? args[1] : null;
  const title = getArg('--title');
  const message = getArg('--message');
  const filenameOverride = getArg('--filename');

  let content;
  let filename;

  if (fromStdin) {
    content = await readStdin();
    filename = filenameOverride || 'upload.txt';
  } else if (filePath && !filePath.startsWith('--')) {
    content = readFileSync(filePath);
    filename = filenameOverride || basename(filePath);
  } else {
    console.error('Error: Provide a file path or use --stdin');
    process.exit(1);
  }

  // Step 1: Get upload URL
  const uploadRes = await fetch('https://slack.com/api/files.getUploadURLExternal', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      filename,
      length: content.length.toString(),
    }),
  });

  const uploadData = await uploadRes.json();
  if (!uploadData.ok) {
    console.error(`Slack API error (getUploadURL): ${uploadData.error}`);
    process.exit(1);
  }

  // Step 2: Upload file content
  const putRes = await fetch(uploadData.upload_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: content,
  });

  if (!putRes.ok) {
    console.error(`Upload failed: ${putRes.status} ${putRes.statusText}`);
    process.exit(1);
  }

  // Step 3: Complete upload and share to channel
  const completeBody = {
    files: [{ id: uploadData.file_id, title: title || filename }],
    channel_id: channel,
  };
  if (message) completeBody.initial_comment = message;

  const completeRes = await fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(completeBody),
  });

  const completeData = await completeRes.json();
  if (!completeData.ok) {
    console.error(`Slack API error (completeUpload): ${completeData.error}`);
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    file_id: uploadData.file_id,
    channel,
    title: title || filename,
  }, null, 2));
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
