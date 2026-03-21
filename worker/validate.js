import { execSync } from 'child_process';

/**
 * Validate the output of a completed agent job.
 * Finds the PR, checks changed files, runs lint, detects anomalies.
 *
 * @param {string} jobId
 * @param {string} branch
 * @returns {Promise<{ passed: boolean, errors: string[], prUrl: string|null, prNumber: number|null, changedFiles: string[] }>}
 */
export async function validateOutput(jobId, branch) {
  const { GH_OWNER, GH_REPO } = process.env;
  const repo = `${GH_OWNER}/${GH_REPO}`;
  const errors = [];
  let prUrl = null;
  let prNumber = null;
  let changedFiles = [];

  // Find PR for this job branch
  try {
    const prJson = execSync(
      `gh pr list --repo ${repo} --head ${branch} --json number,url --limit 1`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    const prs = JSON.parse(prJson);
    if (prs.length > 0) {
      prNumber = prs[0].number;
      prUrl = prs[0].url;
    }
  } catch (err) {
    errors.push(`Failed to find PR: ${err.message}`);
  }

  // Get changed files from the PR diff
  if (prNumber) {
    try {
      const diffOutput = execSync(
        `gh pr diff ${prNumber} --repo ${repo} --name-only`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      changedFiles = diffOutput.split('\n').filter(Boolean);
    } catch {
      try {
        const viewJson = execSync(
          `gh pr view ${prNumber} --repo ${repo} --json files`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim();
        const files = JSON.parse(viewJson).files || [];
        changedFiles = files.map(f => f.path);
      } catch {}
    }
  }

  // Anomaly: empty commits
  if (changedFiles.length === 0 && prNumber) {
    errors.push('Anomaly: PR has no changed files (empty commit)');
  }

  // Anomaly: file size spikes (>1MB)
  for (const file of changedFiles) {
    try {
      const sizeStr = execSync(
        `gh api repos/${repo}/contents/${encodeURIComponent(file)}?ref=${branch} --jq '.size'`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      const size = parseInt(sizeStr, 10);
      if (size > 1048576) {
        errors.push(`Anomaly: ${file} is ${(size / 1048576).toFixed(1)}MB (>1MB threshold)`);
      }
    } catch {}
  }

  // Lint changed JS files
  const jsFiles = changedFiles.filter(f => /\.(js|jsx|mjs|ts|tsx)$/.test(f));
  if (jsFiles.length > 0) {
    try {
      execSync(`npx eslint ${jsFiles.join(' ')} --no-error-on-unmatched-pattern 2>&1`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
      });
    } catch (err) {
      if (err.stdout) {
        errors.push(`Lint errors:\n${err.stdout.slice(0, 2000)}`);
      }
    }
  }

  return { passed: errors.length === 0, errors, prUrl, prNumber, changedFiles };
}
