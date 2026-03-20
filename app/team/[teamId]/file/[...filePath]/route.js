import { auth } from 'thepopebot/auth';
import { getClusterById } from '../../../../../Clusters/lib/db/clusters.js';
import { clusterDir } from '../../../../../Clusters/lib/cluster/execute.js';
import fs from 'fs';
import path from 'path';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

export async function GET(request, { params }) {
  const session = await auth();
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { teamId, filePath } = await params;
  const cluster = getClusterById(teamId);
  if (!cluster || cluster.userId !== session.user.id) {
    return new Response('Not found', { status: 404 });
  }

  // Reconstruct the relative path from the catch-all segments
  const relativePath = path.normalize(filePath.join('/'));

  // Prevent directory traversal
  if (relativePath.includes('..')) {
    return new Response('Invalid path', { status: 400 });
  }

  const sharedDir = path.join(clusterDir(cluster), 'shared');
  const fullPath = path.join(sharedDir, relativePath);

  // Ensure the resolved path is still within the shared directory
  if (!fullPath.startsWith(sharedDir)) {
    return new Response('Invalid path', { status: 400 });
  }

  if (!fs.existsSync(fullPath)) {
    return new Response('File not found', { status: 404 });
  }

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
  const content = fs.readFileSync(fullPath);

  return new Response(content, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    },
  });
}
