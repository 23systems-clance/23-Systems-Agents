#!/usr/bin/env node

/**
 * [Loop] Stale PR follow-up
 *
 * Checks for open PRs older than --stale-days. Posts a reminder comment
 * on each stale PR. After --max-iterations days of reminders, escalates
 * via Slack alert.
 *
 * Pattern: repeat until condition met, then explicitly break
 *
 * Usage: node loop-stale-prs.js --max-iterations 5 --stale-days 3
 */

import { execSync } from 'child_process';
import { formatAlert, sendSlackAlert } from './lib/notify-slack.js';

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

const args = parseArgs(process.argv.slice(2));
const MAX_ITERATIONS = parseInt(args['max-iterations'] || '5', 10);
const STALE_DAYS = parseInt(args['stale-days'] || '3', 10);
const OWNER = process.env.ALERT_OWNER || 'clance';

try {
  // Find open PRs
  const prsJson = execSync(
    `gh pr list --state open --json number,title,createdAt,updatedAt --limit 50`,
    { encoding: 'utf-8' }
  ).trim();

  const prs = JSON.parse(prsJson || '[]');
  const now = Date.now();
  const staleCutoff = now - (STALE_DAYS * 24 * 60 * 60 * 1000);

  const stalePRs = prs.filter(pr => new Date(pr.updatedAt).getTime() < staleCutoff);

  if (stalePRs.length === 0) {
    console.log('[loop] No stale PRs found');
    process.exit(0);
  }

  console.log(`[loop] Found ${stalePRs.length} stale PR(s)`);

  for (const pr of stalePRs) {
    const daysSinceUpdate = Math.round((now - new Date(pr.updatedAt).getTime()) / (1000 * 60 * 60 * 24));
    const iteration = Math.min(Math.ceil(daysSinceUpdate / STALE_DAYS), MAX_ITERATIONS);

    if (iteration >= MAX_ITERATIONS) {
      // Escalate — max iterations reached
      const text = formatAlert({
        pattern: 'Loop',
        name: 'Stale PR follow-up',
        owner: OWNER,
        message: `PR #${pr.number} "${pr.title}" has been stale for ${daysSinceUpdate} days (max iterations reached). Requires manual intervention.`,
        data: { prNumber: pr.number, title: pr.title, daysSinceUpdate },
      });
      await sendSlackAlert(text);
      console.log(`[loop] PR #${pr.number} escalated (iteration ${iteration}/${MAX_ITERATIONS})`);
    } else {
      // Post reminder comment
      try {
        execSync(
          `gh pr comment ${pr.number} --body "Reminder: This PR has been inactive for ${daysSinceUpdate} days. (Follow-up ${iteration}/${MAX_ITERATIONS})"`,
          { stdio: 'pipe' }
        );
        console.log(`[loop] PR #${pr.number} reminded (iteration ${iteration}/${MAX_ITERATIONS})`);
      } catch (err) {
        console.warn(`[loop] Failed to comment on PR #${pr.number}: ${err.message}`);
      }
    }
  }
} catch (err) {
  const text = formatAlert({
    pattern: 'Loop',
    name: 'Stale PR follow-up',
    owner: OWNER,
    message: `Script failed: ${err.message}`,
  });
  await sendSlackAlert(text).catch(() => {});
  process.exit(1);
}
