'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { statusColor } from '../status.js';
import { continueTeamPipeline, getTeamOutputFiles } from '../actions.js';
import { readOutputFile } from '../output.js';

/**
 * Real-time pipeline status visualization with human-in-the-loop approval.
 *
 * Connects to the existing cluster SSE stream and translates
 * container events into plain-English status updates.
 *
 * When a role completes and the next role is waiting, shows an
 * approval UI so the user can review output and provide feedback
 * before the next step starts.
 */
export function PipelineStatus({ clusterId, roles, initialStatus }) {
  const [roleStates, setRoleStates] = useState(() =>
    buildInitialStates(roles, initialStatus)
  );
  const eventSourceRef = useRef(null);

  // Approval state
  const [reviewFiles, setReviewFiles] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [continuing, setContinuing] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewContent, setPreviewContent] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    const url = `/stream/cluster/${clusterId}/logs`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener('status', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.roles) {
          setRoleStates(prev => mergeRoleStates(prev, roles, data));
        }
      } catch {}
    });

    es.addEventListener('log', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.containerName) {
          setRoleStates(prev => markRoleActive(prev, roles, data.containerName));
        }
      } catch {}
    });

    es.onerror = () => {};

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [clusterId]);

  // Detect review state: a role is "done" and the next role is "waiting"/"idle"
  const reviewStep = findReviewStep(roleStates, roles);

  // Load output files when entering review
  const prevReviewRef = useRef(null);
  useEffect(() => {
    const reviewId = reviewStep?.completedRole?.roleId;
    if (reviewId && reviewId !== prevReviewRef.current) {
      prevReviewRef.current = reviewId;
      getTeamOutputFiles(clusterId).then(result => {
        if (result?.files) setReviewFiles(result.files);
      });
    }
    if (!reviewStep) {
      prevReviewRef.current = null;
      setReviewFiles([]);
      setFeedback('');
      setPreviewFile(null);
      setPreviewContent(null);
    }
  }, [reviewStep?.completedRole?.roleId, clusterId]);

  const handleContinue = useCallback(async () => {
    if (!reviewStep) return;
    setContinuing(true);
    try {
      await continueTeamPipeline(clusterId, reviewStep.nextRole.roleId, feedback);
      setFeedback('');
      setPreviewFile(null);
      setPreviewContent(null);
    } catch (err) {
      console.error('Continue failed:', err);
    }
    setContinuing(false);
  }, [clusterId, reviewStep, feedback]);

  const handlePreview = useCallback(async (file) => {
    if (previewFile?.relativePath === file.relativePath) {
      setPreviewFile(null);
      setPreviewContent(null);
      return;
    }
    setPreviewFile(file);
    setLoadingPreview(true);
    try {
      const result = await readOutputFile(clusterId, file.relativePath);
      setPreviewContent(result);
    } catch {
      setPreviewContent({ content: 'Failed to load file', type: 'text' });
    }
    setLoadingPreview(false);
  }, [clusterId, previewFile]);

  // Compute overall progress
  const total = roleStates.length;
  const done = roleStates.filter(r => r.status === 'done').length;
  const working = roleStates.filter(r => r.status === 'working' || r.status === 'starting').length;
  const failed = roleStates.filter(r => r.status === 'failed').length;

  let overallLabel = 'Ready to run';
  if (failed > 0) overallLabel = 'Failed';
  else if (working > 0) overallLabel = `Working — ${done} of ${total} complete`;
  else if (reviewStep) overallLabel = `Review — ${reviewStep.completedRole.roleName} finished`;
  else if (done === total && total > 0) overallLabel = 'All done';

  return (
    <div>
      {/* Overall Status */}
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-2.5 h-2.5 rounded-full ${
          failed > 0 ? 'bg-red-500' :
          working > 0 ? 'bg-blue-500 animate-pulse' :
          reviewStep ? 'bg-amber-500 animate-pulse' :
          done === total && total > 0 ? 'bg-green-500' :
          'bg-muted-foreground'
        }`} />
        <span className="text-sm font-medium">{overallLabel}</span>
      </div>

      {/* Pipeline Steps */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {roleStates.map((roleState, i) => (
          <div key={roleState.roleId} className="flex items-center gap-2">
            <div className={`rounded-xl border p-4 min-w-[150px] transition-colors ${
              roleState.status === 'working' || roleState.status === 'starting'
                ? 'border-blue-500 bg-blue-500/5'
                : roleState.status === 'done'
                ? 'border-green-500 bg-green-500/5'
                : roleState.status === 'failed'
                ? 'border-red-500 bg-red-500/5'
                : roleState.status === 'waiting'
                ? 'border-yellow-500/50 bg-yellow-500/5'
                : 'border-border'
            }`}>
              <div className="text-sm font-medium mb-1">{roleState.roleName}</div>
              <div className={`text-xs ${statusColor(roleState.status)}`}>
                {roleState.status === 'working' && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse mr-1.5" />
                )}
                {roleState.label}
              </div>
              {roleState.detail && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {roleState.detail}
                </div>
              )}
            </div>
            {i < roleStates.length - 1 && (
              <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9,18 15,12 9,6" />
              </svg>
            )}
          </div>
        ))}
      </div>

      {/* Approval Panel — shown between pipeline steps */}
      {reviewStep && (
        <ApprovalPanel
          clusterId={clusterId}
          completedRole={reviewStep.completedRole}
          nextRole={reviewStep.nextRole}
          files={reviewFiles}
          feedback={feedback}
          setFeedback={setFeedback}
          continuing={continuing}
          onContinue={handleContinue}
          previewFile={previewFile}
          previewContent={previewContent}
          loadingPreview={loadingPreview}
          onPreview={handlePreview}
        />
      )}
    </div>
  );
}

/**
 * Approval panel shown between completed and waiting pipeline steps.
 */
function ApprovalPanel({
  clusterId,
  completedRole,
  nextRole,
  files,
  feedback,
  setFeedback,
  continuing,
  onContinue,
  previewFile,
  previewContent,
  loadingPreview,
  onPreview,
}) {
  return (
    <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg className="w-4 h-4 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold">
            {completedRole.roleName} finished — review before continuing
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Review the output below, then provide feedback or instructions for {nextRole.roleName}.
          </p>
        </div>
      </div>

      {/* Output Files */}
      {files.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
            Output Files
          </h4>
          <div className="space-y-1">
            {files.map((file, i) => {
              const fileUrl = `/team/${clusterId}/file/${file.relativePath}`;
              return (
                <div
                  key={i}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    previewFile?.relativePath === file.relativePath
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted/50 text-foreground'
                  }`}
                >
                  <FileTypeIcon type={file.type} />
                  <button
                    onClick={() => onPreview(file)}
                    className="flex-1 text-left truncate"
                  >
                    {file.name}
                  </button>
                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                    title="Open in new tab"
                  >
                    Open
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15,3 21,3 21,9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* File Preview */}
      {previewFile && (
        <div className="mb-4 rounded-lg border border-border overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5 bg-muted/30">
            <span className="text-xs font-medium">{previewFile.name}</span>
            <button
              onClick={() => onPreview(previewFile)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
          {loadingPreview ? (
            <div className="p-4 text-sm text-muted-foreground">Loading...</div>
          ) : previewContent?.type === 'html' ? (
            <iframe
              srcDoc={previewContent.content}
              className="w-full h-[400px] bg-white"
              sandbox="allow-same-origin"
              title={previewFile.name}
            />
          ) : (
            <pre className="p-4 text-xs whitespace-pre-wrap font-mono leading-relaxed max-h-[300px] overflow-auto">
              {previewContent?.content || 'Unable to load file.'}
            </pre>
          )}
        </div>
      )}

      {/* Feedback Input + Continue Button */}
      <div className="flex gap-2">
        <input
          type="text"
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          placeholder={`Instructions for ${nextRole.roleName} (e.g., "Use design-3-split-editorial.html")`}
          className="flex-1 rounded-lg border border-border bg-input px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onContinue();
            }
          }}
        />
        <button
          onClick={onContinue}
          disabled={continuing}
          className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {continuing ? 'Starting...' : `Continue`}
        </button>
      </div>
    </div>
  );
}

/**
 * Small file type icon for the approval panel file list.
 */
function FileTypeIcon({ type }) {
  const label = type === 'html' ? 'HTML' :
                type === 'markdown' ? 'MD' :
                type === 'json' ? 'JSON' :
                type === 'csv' ? 'CSV' :
                'TXT';

  const color = type === 'html' ? 'bg-purple-500/10 text-purple-600' :
                type === 'markdown' ? 'bg-blue-500/10 text-blue-600' :
                type === 'json' ? 'bg-yellow-500/10 text-yellow-600' :
                type === 'csv' ? 'bg-green-500/10 text-green-600' :
                'bg-muted text-muted-foreground';

  return (
    <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-bold ${color}`}>
      {label}
    </span>
  );
}

/**
 * Find a review step: where a role is "done", the next role is "waiting"/"idle",
 * and the roles have requiresApproval enabled in their triggerConfig.
 */
function findReviewStep(roleStates, roles) {
  // Check if any role has requiresApproval set
  const hasApproval = roles?.some(r => {
    const config = typeof r.triggerConfig === 'string'
      ? JSON.parse(r.triggerConfig)
      : r.triggerConfig;
    return config?.requiresApproval;
  });
  if (!hasApproval) return null;

  for (let i = 0; i < roleStates.length - 1; i++) {
    const current = roleStates[i];
    const next = roleStates[i + 1];
    if (current.status === 'done' && (next.status === 'waiting' || next.status === 'idle')) {
      return { completedRole: current, nextRole: next };
    }
  }
  return null;
}

/**
 * Build initial role states from server-provided status.
 */
function buildInitialStates(roles, initialStatus) {
  return roles.map(role => {
    const st = initialStatus?.[role.id];
    const running = st?.running || 0;

    if (running > 0) {
      return {
        roleId: role.id,
        roleName: role.roleName,
        status: 'working',
        label: 'Working...',
        detail: null,
      };
    }

    if (st?.hasCompleted) {
      return {
        roleId: role.id,
        roleName: role.roleName,
        status: 'done',
        label: 'Done',
        detail: null,
      };
    }

    if (st?.lastExitCode != null && st.lastExitCode !== 0) {
      return {
        roleId: role.id,
        roleName: role.roleName,
        status: 'failed',
        label: 'Failed',
        detail: translateExitCode(st.lastExitCode),
      };
    }

    const dependsOn = role.triggerConfig?.dependsOn || role.dependsOn;
    if (dependsOn) {
      return {
        roleId: role.id,
        roleName: role.roleName,
        status: 'waiting',
        label: `Waiting for ${dependsOn}`,
        detail: null,
      };
    }

    return {
      roleId: role.id,
      roleName: role.roleName,
      status: 'idle',
      label: 'Ready',
      detail: null,
    };
  });
}

/**
 * Merge SSE status data into role states.
 */
function mergeRoleStates(prevStates, roles, sseData) {
  const containersByRole = {};

  if (sseData.roles) {
    for (const [roleId, roleData] of Object.entries(sseData.roles)) {
      if (roleData.containers) {
        for (const container of roleData.containers) {
          const match = container.name?.match(/role-([a-f0-9]+)-/);
          if (match) {
            const rid = match[1];
            if (!containersByRole[rid]) containersByRole[rid] = [];
            containersByRole[rid].push(container);
          }
        }
      }
    }
  }

  return prevStates.map(state => {
    const role = roles.find(r => r.id === state.roleId);
    const rid = role?.id?.replace(/-/g, '').slice(0, 8);
    const containers = containersByRole[rid] || [];
    const running = containers.filter(c => c.state === 'running');

    if (running.length > 0) {
      return { ...state, status: 'working', label: 'Working...', detail: null };
    }

    const exited = containers.filter(c => c.state === 'exited');
    if (exited.length > 0) {
      const latest = exited[0];
      if (latest.exitCode === 0) {
        return { ...state, status: 'done', label: 'Done', detail: null };
      }
      const errorDetail = translateExitCode(latest.exitCode);
      return { ...state, status: 'failed', label: 'Failed', detail: errorDetail };
    }

    return state;
  });
}

/**
 * Mark a role as active based on a container name from a log event.
 */
function markRoleActive(prevStates, roles, containerName) {
  const match = containerName.match(/role-([a-f0-9]+)-/);
  if (!match) return prevStates;

  const rid = match[1];

  return prevStates.map(state => {
    const role = roles.find(r => r.id === state.roleId);
    const roleRid = role?.id?.replace(/-/g, '').slice(0, 8);

    if (roleRid === rid && state.status !== 'done' && state.status !== 'failed') {
      return { ...state, status: 'working', label: 'Working...' };
    }
    return state;
  });
}

/**
 * Translate container exit codes to plain-English error messages.
 */
function translateExitCode(code) {
  switch (code) {
    case 1: return 'The task encountered an error';
    case 124: return 'Timed out — the task took too long';
    case 125: return 'Container failed to start';
    case 126: return 'Permission denied';
    case 127: return 'Command not found';
    case 137: return 'Ran out of memory';
    case 143: return 'Task was stopped';
    default: return code ? `Exited with error (code ${code})` : null;
  }
}
