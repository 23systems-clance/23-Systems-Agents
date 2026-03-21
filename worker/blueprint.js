import { spawnContainer, killContainer } from './container.js';
import { validateOutput } from './validate.js';
import { autoMerge } from './auto-merge.js';
import { notifyJobComplete } from './notify.js';
import { updateJob, getJob, getCapabilities } from './db.js';
import fs from 'fs';
import path from 'path';

const MAX_TIME_MS = parseInt(process.env.MAX_JOB_TIME_MS || '1800000', 10); // 30 min
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '1', 10);
const MAX_CONTAINER_MEMORY = process.env.MAX_CONTAINER_MEMORY || '2g';

/**
 * Run the 7-step job blueprint state machine.
 */
export async function runBlueprint(job) {
  const { jobId, title, config, branch } = job.data;
  let exitCode = null;
  let prUrl = null;
  let prNumber = null;
  let changedFiles = [];
  let mergeResult = 'skipped';
  let resourceBreach = null; // Set if killed due to resource limits

  const emit = async (step, status) => {
    await job.updateProgress({ step, status, ts: Date.now() });
    await updateJob(jobId, { currentStep: step, status: status === 'failed' ? 'failed' : 'active' });
  };

  try {
    // ─── Step 1: Resolve & Prepare ───────────────────────────────
    await emit('resolve', 'active');

    const capabilities = await getCapabilities();
    const image = resolveImage(config);
    const isHeartbeat = detectHeartbeat(title, config);
    const env = buildContainerEnv(jobId, branch, config, { isHeartbeat });
    const limits = { maxTimeMs: MAX_TIME_MS, maxMemory: MAX_CONTAINER_MEMORY };

    if (isHeartbeat) {
      console.log(`[blueprint] Job ${jobId} detected as heartbeat — using lightweight prompt`);
    }

    await updateJob(jobId, { status: 'active', startedAt: Date.now() });
    await emit('resolve', 'completed');

    // ─── Step 2: Spawn Container ─────────────────────────────────
    await emit('spawn', 'active');

    const { containerId, exitPromise } = await spawnContainer(image, env, limits);
    const timeout = setTimeout(() => {
      resourceBreach = `exceeded max_time (${MAX_TIME_MS}ms)`;
      console.log(`[blueprint] Job ${jobId}: ${resourceBreach}`);
      killContainer(containerId, 'timeout');
    }, limits.maxTimeMs);

    await emit('spawn', 'completed');

    // ─── Step 3: Agent Execution ─────────────────────────────────
    await emit('execute', 'active');

    exitCode = await exitPromise;
    clearTimeout(timeout);

    await updateJob(jobId, { exitCode });

    if (resourceBreach) {
      // Resource limit breach — fail immediately, no retry
      await updateJob(jobId, { error: resourceBreach });
      await emit('execute', 'failed');
    } else if (exitCode !== 0) {
      await updateJob(jobId, { error: `Container exited with code ${exitCode}` });
      await emit('execute', 'failed');
    } else {
      await emit('execute', 'completed');
    }

    // ─── Step 4: Validate Output ─────────────────────────────────
    // Skip validation and retry on resource breach
    if (exitCode === 0 && !resourceBreach) {
      await emit('validate', 'active');

      const validation = await validateOutput(jobId, branch);
      prUrl = validation.prUrl;
      prNumber = validation.prNumber;
      changedFiles = validation.changedFiles;

      await updateJob(jobId, {
        prUrl,
        prNumber,
        changedFiles: JSON.stringify(changedFiles),
        validationErrors: validation.passed ? null : JSON.stringify(validation.errors),
      });

      if (!validation.passed) {
        // ─── Step 5: Retry ─────────────────────────────────────
        const jobRecord = await getJob(jobId);
        const retryCount = jobRecord?.retry_count || 0;

        if (retryCount < MAX_RETRIES) {
          await emit('retry', 'active');
          await updateJob(jobId, { retryCount: retryCount + 1 });

          // Re-spawn with validation errors as additional context
          const retryEnv = [
            ...env,
            `VALIDATION_ERRORS=${JSON.stringify(validation.errors)}`,
          ];

          let retryBreach = null;
          const retry = await spawnContainer(image, retryEnv, limits);
          const retryTimeout = setTimeout(() => {
            retryBreach = `exceeded max_time on retry (${MAX_TIME_MS}ms)`;
            killContainer(retry.containerId, 'timeout');
          }, limits.maxTimeMs);
          exitCode = await retry.exitPromise;
          clearTimeout(retryTimeout);

          if (retryBreach) {
            resourceBreach = retryBreach;
            await updateJob(jobId, { error: retryBreach });
            await emit('retry', 'failed');
          } else {
            const revalidation = await validateOutput(jobId, branch);
            if (!revalidation.passed) {
              if (revalidation.prNumber) {
                await labelPR(revalidation.prNumber, 'needs-review');
              }
              await emit('retry', 'failed');
            } else {
              prUrl = revalidation.prUrl;
              prNumber = revalidation.prNumber;
              changedFiles = revalidation.changedFiles;
              await emit('retry', 'completed');
            }
          }
        } else {
          if (prNumber) await labelPR(prNumber, 'needs-review');
        }
      }

      await emit('validate', 'completed');
    }

    // ─── Step 6: Auto-Merge ──────────────────────────────────────
    if (exitCode === 0 && prNumber && !resourceBreach) {
      await emit('merge', 'active');

      mergeResult = await autoMerge(prNumber, changedFiles);
      await updateJob(jobId, { mergeResult });

      await emit('merge', 'completed');
    }

    // ─── Step 7: Notify + Meter ──────────────────────────────────
    await emit('notify', 'active');

    const completedAt = Date.now();
    const startedAt = (await getJob(jobId))?.started_at;
    const durationMs = startedAt ? completedAt - startedAt : null;

    const finalStatus = resourceBreach ? 'failed' : (exitCode === 0 ? 'completed' : 'failed');

    await updateJob(jobId, {
      status: finalStatus,
      completedAt,
      durationMs,
    });

    await notifyJobComplete({
      jobId,
      title,
      branch,
      status: finalStatus,
      exitCode,
      prUrl,
      prNumber,
      changedFiles,
      mergeResult,
      error: resourceBreach || undefined,
    });

    await emit('notify', 'completed');

  } catch (err) {
    await updateJob(jobId, {
      status: 'failed',
      error: err.message,
      completedAt: Date.now(),
    });
    throw err;
  }
}

/**
 * Resolve the Docker image based on agent backend and version.
 */
function resolveImage(config) {
  const backend = config.agent_backend || process.env.AGENT_BACKEND || 'pi';
  const jobImageUrl = process.env.JOB_IMAGE_URL;

  if (jobImageUrl) return jobImageUrl;

  // Read version from Clusters/package.json
  let version = 'latest';
  try {
    const pkg = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'node_modules', '23wf', 'package.json'), 'utf-8'
    ));
    version = pkg.version || 'latest';
  } catch {}

  if (backend === 'claude-code') {
    return `23systems/23wf:claude-code-job-${version}`;
  }
  return `23systems/23wf:pi-coding-agent-job-${version}`;
}

/**
 * Detect if a job is a heartbeat/lightweight monitoring task.
 * Heartbeat jobs get a lighter system prompt (SOUL.md + HEARTBEAT.md only).
 */
function detectHeartbeat(title, config) {
  const t = (title || '').toLowerCase();
  if (t.includes('heartbeat')) return true;
  if (config.job_type === 'heartbeat') return true;
  return false;
}

/**
 * Build environment variables for the agent container.
 * Matches what run-job.yml passes.
 */
function buildContainerEnv(jobId, branch, config, options = {}) {
  const { GH_OWNER, GH_REPO, GH_TOKEN } = process.env;

  const env = [
    `REPO_URL=https://github.com/${GH_OWNER}/${GH_REPO}`,
    `BRANCH=${branch}`,
    `GH_TOKEN=${GH_TOKEN}`,
  ];

  // Heartbeat jobs use a lighter system prompt
  if (options.isHeartbeat) {
    env.push('SYSTEM_FILES_OVERRIDE=SOUL.md,HEARTBEAT.md');
  }

  // LLM config
  const llmProvider = config.llm_provider || process.env.LLM_PROVIDER || '';
  const llmModel = config.llm_model || process.env.LLM_MODEL || '';
  const openaiBaseUrl = process.env.OPENAI_BASE_URL || '';
  const agentBackend = config.agent_backend || process.env.AGENT_BACKEND || 'pi';

  if (llmProvider) env.push(`LLM_PROVIDER=${llmProvider}`);
  if (llmModel) env.push(`LLM_MODEL=${llmModel}`);
  if (openaiBaseUrl) env.push(`OPENAI_BASE_URL=${openaiBaseUrl}`);
  env.push(`AGENT_BACKEND=${agentBackend}`);

  // Collect AGENT_* secrets (strip prefix)
  const secrets = {};
  const llmSecrets = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('AGENT_LLM_')) {
      llmSecrets[key.replace('AGENT_LLM_', '')] = value;
    } else if (key.startsWith('AGENT_')) {
      secrets[key.replace('AGENT_', '')] = value;
    }
  }
  env.push(`SECRETS=${JSON.stringify(secrets)}`);
  env.push(`LLM_SECRETS=${JSON.stringify(llmSecrets)}`);

  return env;
}

/**
 * Label a PR using gh CLI.
 */
async function labelPR(prNumber, label) {
  const { GH_OWNER, GH_REPO } = process.env;
  const { execSync } = await import('child_process');
  try {
    execSync(
      `gh pr edit ${prNumber} --repo ${GH_OWNER}/${GH_REPO} --add-label "${label}"`,
      { stdio: 'pipe' }
    );
  } catch (err) {
    console.warn(`[blueprint] Failed to label PR #${prNumber}: ${err.message}`);
  }
}
