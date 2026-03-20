'use client';

import { useState, useEffect } from 'react';
import { readOutputFile } from '../output.js';

/**
 * Output Viewer — displays rendered output from a team's shared directory.
 *
 * Shows a file list with preview, and renders markdown/text content inline.
 */
export function OutputViewer({ teamId, files, sessions, summary }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [collapsedSessions, setCollapsedSessions] = useState({});

  const loadFile = async (file) => {
    setSelectedFile(file);
    setLoading(true);
    try {
      const result = await readOutputFile(teamId, file.relativePath);
      setContent(result);
    } catch {
      setContent({ content: 'Failed to load file', type: 'text' });
    }
    setLoading(false);
  };

  const toggleSession = (folder) => {
    setCollapsedSessions(prev => ({ ...prev, [folder]: !prev[folder] }));
  };

  const hasSessions = sessions && sessions.length > 0;
  const hasFiles = files && files.length > 0;

  if (!hasFiles && !hasSessions) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <svg className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" />
        </svg>
        <p className="text-sm font-medium mb-1">No output yet</p>
        <p className="text-xs text-muted-foreground">
          Run the team and output files will appear here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Summary */}
      {summary && !selectedFile && (
        <div className="rounded-xl border border-border p-4 mb-4">
          <h3 className="text-sm font-medium mb-2">Latest Output</h3>
          <div className="text-sm text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
            {summary}
          </div>
        </div>
      )}

      {/* Session-grouped File List */}
      {hasSessions ? (
        <div className="space-y-3 mb-4">
          {sessions.map((session, si) => {
            const isCollapsed = collapsedSessions[session.folder || '_general'];
            const sessionKey = session.folder || '_general';
            const dateLabel = session.date
              ? `${session.date.slice(0, 2)}/${session.date.slice(2)}`
              : null;

            return (
              <div key={si} className="rounded-xl border border-border overflow-hidden">
                {/* Session Header */}
                <button
                  onClick={() => toggleSession(sessionKey)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                >
                  <FolderIcon />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{session.label}</div>
                    {dateLabel && (
                      <div className="text-xs text-muted-foreground">{dateLabel}</div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {session.files.length} file{session.files.length !== 1 ? 's' : ''}
                  </span>
                  <ChevronIcon collapsed={isCollapsed} />
                </button>

                {/* Session Files */}
                {!isCollapsed && (
                  <div className="border-t border-border">
                    <div className="space-y-0">
                      {session.files.map((file, fi) => {
                        const fileUrl = `/team/${teamId}/file/${file.relativePath}`;
                        return (
                          <div
                            key={fi}
                            className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                              selectedFile?.relativePath === file.relativePath
                                ? 'bg-primary/10 text-primary'
                                : 'hover:bg-muted/20 text-foreground'
                            }`}
                          >
                            <FileIcon type={file.type} />
                            <button
                              onClick={() => loadFile(file)}
                              className="flex-1 min-w-0 text-left"
                            >
                              <div className="truncate">{file.name}</div>
                            </button>
                            <span className="text-xs text-muted-foreground">
                              {formatFileSize(file.size)}
                            </span>
                            <a
                              href={fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                              title="Open in new tab"
                            >
                              Open
                              <ExternalLinkIcon />
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Fallback: flat file list (no sessions yet) */
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-2">Output Files</h3>
          <div className="space-y-1">
            {files.map((file, i) => {
              const fileUrl = `/team/${teamId}/file/${file.relativePath}`;
              return (
                <div
                  key={i}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    selectedFile?.relativePath === file.relativePath
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted text-foreground'
                  }`}
                >
                  <FileIcon type={file.type} />
                  <button
                    onClick={() => loadFile(file)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="truncate">{file.name}</div>
                    <div className="text-xs text-muted-foreground">{file.folder}</div>
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {formatFileSize(file.size)}
                  </span>
                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                    title="Open in new tab"
                  >
                    Open
                    <ExternalLinkIcon />
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* File Content */}
      {selectedFile && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/30">
            <span className="text-sm font-medium">{selectedFile.name}</span>
            <button
              onClick={() => { setSelectedFile(null); setContent(null); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
          <div className="p-4 max-h-[600px] overflow-auto">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : content?.content ? (
              <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed">
                {content.content}
              </pre>
            ) : (
              <div className="text-sm text-muted-foreground">Unable to load file content.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FileIcon({ type }) {
  const label = type === 'markdown' ? 'MD' :
                type === 'json' ? 'JS' :
                type === 'csv' ? 'CS' :
                'TX';

  const color = type === 'markdown' ? 'bg-blue-500/10 text-blue-600' :
                type === 'json' ? 'bg-yellow-500/10 text-yellow-600' :
                type === 'csv' ? 'bg-green-500/10 text-green-600' :
                'bg-muted text-muted-foreground';

  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded text-[10px] font-bold ${color}`}>
      {label}
    </span>
  );
}

function FolderIcon() {
  return (
    <svg className="w-5 h-5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ChevronIcon({ collapsed }) {
  return (
    <svg className={`w-4 h-4 text-muted-foreground transition-transform ${collapsed ? '-rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6,9 12,15 18,9" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15,3 21,3 21,9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
