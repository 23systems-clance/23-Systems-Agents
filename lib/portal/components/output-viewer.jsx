'use client';

import { useState, useEffect } from 'react';
import { readOutputFile } from '../output.js';

/**
 * Output Viewer — displays rendered output from a team's shared directory.
 *
 * Shows a file list with preview, and renders markdown/text content inline.
 */
export function OutputViewer({ teamId, files, summary }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);

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

  if (!files || files.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No output yet. Run the team to see results here.
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

      {/* File List */}
      <div className="mb-4">
        <h3 className="text-sm font-medium mb-2">Output Files</h3>
        <div className="space-y-1">
          {files.map((file, i) => (
            <button
              key={i}
              onClick={() => loadFile(file)}
              className={`w-full text-left flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                selectedFile?.relativePath === file.relativePath
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-muted text-foreground'
              }`}
            >
              <FileIcon type={file.type} />
              <div className="flex-1 min-w-0">
                <div className="truncate">{file.name}</div>
                <div className="text-xs text-muted-foreground">{file.folder}</div>
              </div>
              <span className="text-xs text-muted-foreground">
                {formatFileSize(file.size)}
              </span>
            </button>
          ))}
        </div>
      </div>

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

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
