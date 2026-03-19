'use server';

import fs from 'fs';
import path from 'path';

/**
 * Output Renderer — reads and renders output files from a team's shared directory.
 *
 * Scans the cluster's shared folders for output files (reports, analysis, etc.)
 * and returns them in a format the UI can display.
 */

/**
 * Get the latest output files from a team's shared directory.
 *
 * @param {string} clusterId
 * @returns {{ files: Array<{ name, path, type, size, modified }>, summary: string | null }}
 */
export async function getTeamOutput(clusterId) {
  try {
    const { auth } = await import('thepopebot/auth');
    const session = await auth();
    if (!session?.user?.id) return { files: [], summary: null };

    const { clusterDir } = await import('../Clusters/lib/cluster/execute.js');
    const { getClusterById } = await import('../Clusters/lib/db/clusters.js');

    const cluster = getClusterById(clusterId);
    if (!cluster || cluster.userId !== session.user.id) return { files: [], summary: null };

    const sharedDir = path.join(clusterDir(cluster), 'shared');
    if (!fs.existsSync(sharedDir)) return { files: [], summary: null };

    const files = scanDirectory(sharedDir, sharedDir);

    // Sort by modification time (newest first)
    files.sort((a, b) => b.modified - a.modified);

    // Try to find a summary from the most recent report/output file
    const summaryFile = files.find(f =>
      f.name.includes('report') ||
      f.name.includes('final') ||
      f.name.includes('output') ||
      f.name.includes('brief')
    );

    let summary = null;
    if (summaryFile) {
      try {
        const content = fs.readFileSync(summaryFile.fullPath, 'utf-8');
        summary = content.substring(0, 500);
        if (content.length > 500) summary += '...';
      } catch {}
    }

    // Strip fullPath from returned files (security)
    const safeFiles = files.map(({ fullPath, ...rest }) => rest);

    return { files: safeFiles, summary };
  } catch (err) {
    console.error('getTeamOutput error:', err);
    return { files: [], summary: null };
  }
}

/**
 * Read a specific output file's content.
 *
 * @param {string} clusterId
 * @param {string} relativePath - Path relative to the shared directory
 * @returns {{ content: string | null, type: string }}
 */
export async function readOutputFile(clusterId, relativePath) {
  try {
    const { auth } = await import('thepopebot/auth');
    const session = await auth();
    if (!session?.user?.id) return { content: null, type: 'unknown' };

    const { clusterDir } = await import('../Clusters/lib/cluster/execute.js');
    const { getClusterById } = await import('../Clusters/lib/db/clusters.js');

    const cluster = getClusterById(clusterId);
    if (!cluster || cluster.userId !== session.user.id) return { content: null, type: 'unknown' };

    // Sanitize path to prevent directory traversal
    const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(clusterDir(cluster), 'shared', normalized);
    const sharedDir = path.join(clusterDir(cluster), 'shared');

    if (!fullPath.startsWith(sharedDir)) {
      return { content: null, type: 'unknown' };
    }

    if (!fs.existsSync(fullPath)) return { content: null, type: 'unknown' };

    const content = fs.readFileSync(fullPath, 'utf-8');
    const type = detectFileType(fullPath);

    return { content, type };
  } catch (err) {
    console.error('readOutputFile error:', err);
    return { content: null, type: 'unknown' };
  }
}

/**
 * Recursively scan a directory for files.
 */
function scanDirectory(dir, baseDir, maxDepth = 3, currentDepth = 0) {
  if (currentDepth >= maxDepth) return [];

  const files = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...scanDirectory(fullPath, baseDir, maxDepth, currentDepth + 1));
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        files.push({
          name: entry.name,
          relativePath: path.relative(baseDir, fullPath),
          folder: path.relative(baseDir, dir),
          type: detectFileType(fullPath),
          size: stat.size,
          modified: stat.mtimeMs,
          fullPath,
        });
      }
    }
  } catch {}
  return files;
}

/**
 * Detect file type from extension.
 */
function detectFileType(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  switch (ext) {
    case '.md': return 'markdown';
    case '.json': return 'json';
    case '.csv': return 'csv';
    case '.txt': return 'text';
    case '.html': return 'html';
    case '.xml': return 'xml';
    case '.yaml':
    case '.yml': return 'yaml';
    default: return 'text';
  }
}
