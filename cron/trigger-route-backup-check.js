#!/usr/bin/env node

/**
 * [Trigger-Route] Daily backup check
 *
 * Verifies that the latest git push happened within the last 24 hours.
 * Sends a Slack alert if the repo appears stale.
 *
 * Pattern: one event → one linear path → one outcome
 */

import { execSync } from 'child_process';
import { formatAlert, sendSlackAlert } from './lib/notify-slack.js';

const STALE_HOURS = 24;
const OWNER = process.env.ALERT_OWNER || 'clance';

try {
  const lastCommitDate = execSync('git log -1 --format=%ci', { encoding: 'utf-8' }).trim();
  const lastCommit = new Date(lastCommitDate);
  const hoursAgo = (Date.now() - lastCommit.getTime()) / (1000 * 60 * 60);

  if (hoursAgo > STALE_HOURS) {
    const text = formatAlert({
      pattern: 'Trigger-Route',
      name: 'Daily backup check',
      owner: OWNER,
      message: `Last commit was ${Math.round(hoursAgo)} hours ago (threshold: ${STALE_HOURS}h).`,
      data: { lastCommit: lastCommitDate, hoursAgo: Math.round(hoursAgo) },
    });
    await sendSlackAlert(text);
  } else {
    console.log(`[trigger-route] Backup OK — last commit ${Math.round(hoursAgo)}h ago`);
  }
} catch (err) {
  const text = formatAlert({
    pattern: 'Trigger-Route',
    name: 'Daily backup check',
    owner: OWNER,
    message: `Script failed: ${err.message}`,
  });
  await sendSlackAlert(text).catch(() => {});
  process.exit(1);
}
