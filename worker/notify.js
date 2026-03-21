/**
 * Notification after job completion.
 * Calls the event handler's notification API (same as notify-pr-complete.yml).
 */

/**
 * Send job completion notification to the event handler.
 * @param {Object} result - Job result data
 */
export async function notifyJobComplete(result) {
  const { APP_URL, GH_WEBHOOK_SECRET } = process.env;

  if (!APP_URL) {
    console.warn('[notify] APP_URL not set — skipping notification');
    return;
  }

  const payload = {
    job_id: result.jobId,
    branch: result.branch,
    status: result.status,
    job: result.title,
    pr_url: result.prUrl || '',
    pr_number: result.prNumber || 0,
    changed_files: (result.changedFiles || []).join(', '),
    commit_sha: result.commitSha || '',
    merge_result: result.mergeResult || 'skipped',
    exit_code: result.exitCode,
  };

  const url = `${APP_URL}/api/github/webhook`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(GH_WEBHOOK_SECRET ? { 'x-webhook-secret': GH_WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(`[notify] Notification failed: ${response.status} ${response.statusText}`);
    } else {
      console.log(`[notify] Notification sent for job ${result.jobId}`);
    }
  } catch (err) {
    console.warn(`[notify] Failed to send notification: ${err.message}`);
  }
}
