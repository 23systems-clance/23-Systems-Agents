import { execSync } from 'child_process';

/**
 * Auto-merge logic ported from .github/workflows/auto-merge.yml.
 * Merges PRs when all changed files fall within ALLOWED_PATHS.
 *
 * @param {number} prNumber
 * @param {string[]} changedFiles
 * @returns {Promise<string>} 'merged' | 'not_merged' | 'skipped'
 */
export async function autoMerge(prNumber, changedFiles) {
  const { GH_OWNER, GH_REPO } = process.env;
  const repo = `${GH_OWNER}/${GH_REPO}`;

  // Check AUTO_MERGE setting
  const autoMergeEnabled = (process.env.AUTO_MERGE || 'true').toLowerCase() !== 'false';
  if (!autoMergeEnabled) {
    console.log('[auto-merge] Disabled via AUTO_MERGE=false');
    return 'skipped';
  }

  // Parse ALLOWED_PATHS (default: /logs)
  const allowedPathsRaw = process.env.ALLOWED_PATHS || '/logs';
  const allowedPaths = allowedPathsRaw
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => p.startsWith('/') ? p : '/' + p);

  // Check if "/" is in allowed paths (allow everything)
  const allowAll = allowedPaths.includes('/');

  if (!allowAll) {
    // Validate each changed file
    for (const file of changedFiles) {
      const filePath = file.startsWith('/') ? file : '/' + file;
      const allowed = allowedPaths.some(prefix => filePath.startsWith(prefix));
      if (!allowed) {
        console.log(`[auto-merge] Blocked: ${file} is outside ALLOWED_PATHS`);
        return 'not_merged';
      }
    }
  }

  // Check if PR is mergeable
  try {
    const mergeableJson = execSync(
      `gh pr view ${prNumber} --repo ${repo} --json mergeable`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    const { mergeable } = JSON.parse(mergeableJson);

    if (mergeable === 'CONFLICTING') {
      console.log('[auto-merge] PR has conflicts — leaving open');
      return 'not_merged';
    }
  } catch {}

  // Squash merge and delete branch
  try {
    execSync(
      `gh pr merge ${prNumber} --repo ${repo} --squash --delete-branch`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    console.log(`[auto-merge] Merged PR #${prNumber}`);
    return 'merged';
  } catch (err) {
    console.warn(`[auto-merge] Failed to merge PR #${prNumber}: ${err.message}`);
    return 'not_merged';
  }
}
