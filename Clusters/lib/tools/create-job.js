import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { githubApi } from './github.js';
import { createModel } from '../ai/model.js';

/**
 * Generate a short descriptive title for a job using the LLM.
 * Uses structured output to avoid thinking-token leaks with extended-thinking models.
 * @param {string} jobDescription - The full job description
 * @returns {Promise<string>} ~10 word title
 */
async function generateJobTitle(jobDescription) {
  try {
    const model = await createModel({ maxTokens: 100 });
    const response = await model.withStructuredOutput(z.object({ title: z.string() })).invoke([
      ['system', 'Generate a descriptive ~10 word title for this agent job. The title should clearly describe what the job will do.'],
      ['human', jobDescription],
    ]);
    return response.title.trim() || jobDescription.slice(0, 80);
  } catch {
    // Fallback: first line, truncated
    const firstLine = jobDescription.split('\n').find(l => l.trim()) || jobDescription;
    return firstLine.replace(/^#+\s*/, '').trim().split(/\s+/).slice(0, 10).join(' ');
  }
}

/**
 * Create a new job branch with job.config.json
 * @param {string} jobDescription - The job description
 * @param {Object} [options] - Optional overrides
 * @param {string} [options.llmProvider] - LLM provider override (e.g. 'openai', 'anthropic')
 * @param {string} [options.llmModel] - LLM model override (e.g. 'gpt-4o', 'claude-sonnet-4-5-20250929')
 * @param {string} [options.agentBackend] - Agent backend override ('pi' or 'claude-code')
 * @returns {Promise<{job_id: string, branch: string, title: string}>} - Job ID, branch name, and title
 */
async function createJob(jobDescription, options = {}) {
  const { GH_OWNER, GH_REPO } = process.env;
  const jobId = uuidv4();
  const branch = `job/${jobId}`;
  const repo = `/repos/${GH_OWNER}/${GH_REPO}`;

  // Generate a short descriptive title
  const title = await generateJobTitle(jobDescription);

  // 1. Get main branch SHA and its tree SHA
  const mainRef = await githubApi(`${repo}/git/ref/heads/main`);
  const mainSha = mainRef.object.sha;
  const mainCommit = await githubApi(`${repo}/git/commits/${mainSha}`);
  const baseTreeSha = mainCommit.tree.sha;

  // 2. Build job.config.json — single source of truth for job metadata
  const config = { title, job: jobDescription };
  if (options.llmProvider) config.llm_provider = options.llmProvider;
  if (options.llmModel) config.llm_model = options.llmModel;
  if (options.agentBackend) config.agent_backend = options.agentBackend;

  const treeEntries = [
    {
      path: `logs/${jobId}/job.config.json`,
      mode: '100644',
      type: 'blob',
      content: JSON.stringify(config, null, 2),
    },
  ];

  // 3. Create tree (base_tree preserves all existing files)
  const tree = await githubApi(`${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries,
    }),
  });

  // 4. Create a single commit with job config
  const commit = await githubApi(`${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: `🤖 Agent Job: ${title}`,
      tree: tree.sha,
      parents: [mainSha],
    }),
  });

  // 5. Create branch pointing to the commit (triggers run-job.yml)
  await githubApi(`${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    }),
  });

  return { job_id: jobId, branch, title };
}

export { createJob };
