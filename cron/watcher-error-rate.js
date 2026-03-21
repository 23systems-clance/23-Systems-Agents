#!/usr/bin/env node

/**
 * [Watcher] Error rate monitor
 *
 * Scans recent job logs for failures. Alerts when the error rate
 * exceeds --threshold percent within --lookback window.
 *
 * Pattern: passive continuous monitor → fires only when threshold crossed
 *
 * Usage: node watcher-error-rate.js --threshold 10 --lookback 4h
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
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

function parseLookback(str) {
  const match = str.match(/^(\d+)(h|d|m)$/);
  if (!match) return 4 * 60 * 60 * 1000; // default 4h
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 'h') return value * 60 * 60 * 1000;
  if (unit === 'd') return value * 24 * 60 * 60 * 1000;
  if (unit === 'm') return value * 60 * 1000;
  return 4 * 60 * 60 * 1000;
}

const args = parseArgs(process.argv.slice(2));
const THRESHOLD = parseInt(args.threshold || '10', 10);
const LOOKBACK_MS = parseLookback(args.lookback || '4h');
const OWNER = process.env.ALERT_OWNER || 'clance';

try {
  const logsDir = path.join(process.cwd(), 'logs');

  if (!fs.existsSync(logsDir)) {
    console.log('[watcher] No logs/ directory found — nothing to check');
    process.exit(0);
  }

  const cutoff = Date.now() - LOOKBACK_MS;
  const jobDirs = fs.readdirSync(logsDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  let total = 0;
  let failed = 0;
  const failures = [];

  for (const dir of jobDirs) {
    const jobMd = path.join(logsDir, dir.name, 'job.md');
    if (!fs.existsSync(jobMd)) continue;

    const stat = fs.statSync(jobMd);
    if (stat.mtimeMs < cutoff) continue;

    total++;

    // Check for failure markers in the job directory
    const configPath = path.join(logsDir, dir.name, 'job.config.json');
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        if (content.includes('"failed"') || content.includes('(failed)')) {
          failed++;
          failures.push(dir.name);
        }
      } catch {}
    }

    // Also check git log for failed commits
    try {
      const commitMsg = execSync(
        `git log --oneline -1 -- "logs/${dir.name}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      if (commitMsg.includes('(failed)')) {
        if (!failures.includes(dir.name)) {
          failed++;
          failures.push(dir.name);
        }
      }
    } catch {}
  }

  if (total === 0) {
    console.log(`[watcher] No jobs found within lookback window`);
    process.exit(0);
  }

  const errorRate = Math.round((failed / total) * 100);
  console.log(`[watcher] ${failed}/${total} jobs failed (${errorRate}%) — threshold: ${THRESHOLD}%`);

  if (errorRate >= THRESHOLD) {
    const text = formatAlert({
      pattern: 'Watcher',
      name: 'Error rate monitor',
      owner: OWNER,
      message: `Error rate ${errorRate}% exceeds ${THRESHOLD}% threshold (${failed}/${total} jobs failed).`,
      data: { errorRate, failed, total, recentFailures: failures.slice(0, 5) },
    });
    await sendSlackAlert(text);
  }
} catch (err) {
  const text = formatAlert({
    pattern: 'Watcher',
    name: 'Error rate monitor',
    owner: OWNER,
    message: `Script failed: ${err.message}`,
  });
  await sendSlackAlert(text).catch(() => {});
  process.exit(1);
}
