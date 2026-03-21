/**
 * Upload API routes for config document management.
 *
 * All routes require a valid upload JWT token via `?token=` query param.
 * Mounted at `/api/v1/upload` in server.ts.
 */

import { Router } from 'express';
import multer from 'multer';
import { uploadAuth, getUploadContext } from '../../lib/uploadAuth.js';
import { prisma } from '../../models/index.js';
import type { ConfigDocType } from '@prisma/client';
import {
  upsertConfigDoc,
  getAllConfigDocs,
  deleteConfigDocById,
  DOC_TYPE_LABELS,
} from '../../services/analyze/configDocService.js';
import { convertToMarkdown } from '../../services/document/converter.js';
import { uploadFile, downloadFile } from '../../lib/storage.js';
import { generateLabel } from '../../services/upload/labelGenerator.js';
import { notifyConfigDocUpload, notifyConfigDocDelete } from '../../services/upload/slackNotifier.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Multer config (10 MB limit, memory storage)
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ---------------------------------------------------------------------------
// Allowed file types
// ---------------------------------------------------------------------------

const ALLOWED_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const VALID_DOC_TYPES = new Set<string>(['ICP', 'USE_CASES', 'CAMPAIGNS', 'SETTINGS']);

const ALL_DOC_TYPES: ConfigDocType[] = ['ICP', 'USE_CASES', 'CAMPAIGNS', 'SETTINGS'];

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const uploadRouter = Router();

// All routes require upload token auth
uploadRouter.use(uploadAuth);

// ---------------------------------------------------------------------------
// POST /validate-token — validate JWT and return channel context
// ---------------------------------------------------------------------------

uploadRouter.post('/validate-token', async (req, res) => {
  const ctx = getUploadContext(req);

  // Look up channel name via Slack API if we had it, but for now return IDs
  // Also look up client mapping
  const mapping = await prisma.channelClientMapping.findUnique({
    where: {
      slackTeamId_slackChannelId: {
        slackTeamId: ctx.teamId,
        slackChannelId: ctx.channelId,
      },
    },
    include: { client: true },
  });

  res.json({
    valid: true,
    teamId: ctx.teamId,
    channelId: ctx.channelId,
    userId: ctx.userId,
    clientName: mapping?.client.name ?? null,
    clientId: mapping?.clientId ?? null,
  });
});

// ---------------------------------------------------------------------------
// GET /docs — return all 4 doc slots with status
// ---------------------------------------------------------------------------

uploadRouter.get('/docs', async (req, res) => {
  const ctx = getUploadContext(req);
  const docs = await getAllConfigDocs(ctx.teamId, ctx.channelId);
  const docsMap = new Map(docs.map((d) => [d.docType, d]));
  const token = req.query.token as string;

  const slots = ALL_DOC_TYPES.map((docType) => {
    const doc = docsMap.get(docType);
    if (doc) {
      return {
        id: doc.id,
        docType,
        displayLabel: doc.displayLabel,
        originalFileName: doc.originalFileName,
        version: doc.version,
        contentPreview: doc.content.slice(0, 500),
        uploadedByUserId: doc.uploadedByUserId,
        uploadedAt: doc.updatedAt.toISOString(),
        s3DownloadUrl: doc.s3Key ? `/api/v1/upload/docs/${doc.id}/download?token=${token}` : null,
        contentSizeBytes: doc.contentSizeBytes,
        clientId: doc.clientId ?? null,
      };
    }
    return {
      id: null,
      docType,
      displayLabel: null,
      originalFileName: null,
      version: 0,
      contentPreview: null,
      uploadedByUserId: null,
      uploadedAt: null,
      s3DownloadUrl: null,
      contentSizeBytes: null,
      clientId: null,
    };
  });

  // Get client name
  const mapping = await prisma.channelClientMapping.findUnique({
    where: {
      slackTeamId_slackChannelId: {
        slackTeamId: ctx.teamId,
        slackChannelId: ctx.channelId,
      },
    },
    include: { client: true },
  });

  res.json({
    channelId: ctx.channelId,
    clientName: mapping?.client.name ?? null,
    docs: slots,
  });
});

// ---------------------------------------------------------------------------
// POST /docs — upload a config document (multipart/form-data)
// ---------------------------------------------------------------------------

uploadRouter.post('/docs', upload.single('file'), async (req, res) => {
  const ctx = getUploadContext(req);
  const file = req.file;
  const docType = req.body?.docType as string;

  if (!file) {
    res.status(400).json({ error: 'No file provided.' });
    return;
  }

  if (!docType || !VALID_DOC_TYPES.has(docType)) {
    res.status(400).json({ error: `Invalid docType. Must be one of: ${ALL_DOC_TYPES.join(', ')}` });
    return;
  }

  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    res.status(400).json({ error: 'Unsupported file type. Allowed: .txt, .md, .csv, .docx, .pdf, .xlsx' });
    return;
  }

  try {
    // Convert to Markdown
    const { markdown, warnings } = await convertToMarkdown(file.buffer, file.mimetype, file.originalname);
    if (!markdown || markdown.trim().length === 0) {
      res.status(400).json({ error: 'File is empty or could not be converted to readable text.' });
      return;
    }

    if (warnings.length > 0) {
      logger.warn('Document conversion warnings', { warnings, fileName: file.originalname });
    }

    // Upload original to S3
    // Determine version for S3 key
    const existing = await prisma.channelConfigDoc.findUnique({
      where: {
        slackTeamId_slackChannelId_docType: {
          slackTeamId: ctx.teamId,
          slackChannelId: ctx.channelId,
          docType: docType as ConfigDocType,
        },
      },
    });
    const newVersion = existing ? existing.version + 1 : 1;
    const s3Key = `config-docs/${ctx.teamId}/${ctx.channelId}/${docType}/v${newVersion}/${file.originalname}`;
    await uploadFile(s3Key, file.buffer, file.mimetype);

    // Generate AI label
    const { label } = await generateLabel(markdown, docType as ConfigDocType, file.originalname);

    // Lookup clientId from channel mapping
    let clientId: string | null = null;
    try {
      const mapping = await prisma.channelClientMapping.findUnique({
        where: {
          slackTeamId_slackChannelId: {
            slackTeamId: ctx.teamId,
            slackChannelId: ctx.channelId,
          },
        },
        select: { clientId: true },
      });
      clientId = mapping?.clientId ?? null;
    } catch (error) {
      logger.warn('Failed to lookup channel-client mapping for document upload', {
        teamId: ctx.teamId,
        channelId: ctx.channelId,
        error,
      });
      // Continue without clientId (non-fatal)
    }

    // Upsert config doc
    const doc = await upsertConfigDoc({
      teamId: ctx.teamId,
      channelId: ctx.channelId,
      docType: docType as ConfigDocType,
      clientId,
      content: markdown,
      uploadedByUserId: ctx.userId,
      originalFileName: file.originalname,
      displayLabel: label,
      s3Key,
      originalMimeType: file.mimetype,
      contentSizeBytes: file.size,
    });

    const token = req.query.token as string;
    res.status(201).json({
      id: doc.id,
      docType: doc.docType,
      displayLabel: doc.displayLabel,
      originalFileName: doc.originalFileName,
      version: doc.version,
      contentPreview: doc.content.slice(0, 500),
      uploadedByUserId: doc.uploadedByUserId,
      uploadedAt: doc.updatedAt.toISOString(),
      s3DownloadUrl: `/api/v1/upload/docs/${doc.id}/download?token=${token}`,
      contentSizeBytes: doc.contentSizeBytes,
      clientId: doc.clientId ?? null,
    });

    logger.info('Config doc uploaded via dashboard', {
      action: 'config_doc_upload',
      userId: ctx.userId,
      teamId: ctx.teamId,
      channelId: ctx.channelId,
      docType,
      docId: doc.id,
      version: doc.version,
      fileName: file.originalname,
    });

    // Fire-and-forget Slack notification
    notifyConfigDocUpload(
      ctx.channelId,
      doc.docType,
      doc.version,
      doc.displayLabel || doc.originalFileName || docType,
      ctx.userId,
    );
  } catch (err) {
    logger.error('Upload failed', { err, docType, fileName: file.originalname });
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /docs/:id/content — full markdown content for preview
// ---------------------------------------------------------------------------

uploadRouter.get('/docs/:id/content', async (req, res) => {
  const ctx = getUploadContext(req);
  const doc = await prisma.channelConfigDoc.findUnique({
    where: { id: req.params.id },
  });

  if (!doc || doc.slackTeamId !== ctx.teamId || doc.slackChannelId !== ctx.channelId) {
    res.status(404).json({ error: 'Document not found.' });
    return;
  }

  res.json({
    id: doc.id,
    docType: doc.docType,
    displayLabel: doc.displayLabel,
    markdownContent: doc.content,
  });
});

// ---------------------------------------------------------------------------
// GET /docs/:id/download — stream original file from S3
// ---------------------------------------------------------------------------

uploadRouter.get('/docs/:id/download', async (req, res) => {
  const ctx = getUploadContext(req);
  const doc = await prisma.channelConfigDoc.findUnique({
    where: { id: req.params.id },
  });

  if (!doc || doc.slackTeamId !== ctx.teamId || doc.slackChannelId !== ctx.channelId) {
    res.status(404).json({ error: 'Document not found.' });
    return;
  }

  if (!doc.s3Key) {
    res.status(404).json({ error: 'Original file not found.' });
    return;
  }

  try {
    const buffer = await downloadFile(doc.s3Key);
    res.setHeader('Content-Type', doc.originalMimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.originalFileName || 'download'}"`);
    res.send(buffer);
  } catch (err) {
    logger.error('Download failed', { err, s3Key: doc.s3Key });
    res.status(404).json({ error: 'Original file not found.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /docs/:id/label — rename display label
// ---------------------------------------------------------------------------

uploadRouter.put('/docs/:id/label', async (req, res) => {
  const ctx = getUploadContext(req);
  const { displayLabel } = req.body || {};

  if (!displayLabel || typeof displayLabel !== 'string' || displayLabel.trim().length === 0) {
    res.status(400).json({ error: 'displayLabel is required and must be non-empty.' });
    return;
  }

  if (displayLabel.length > 100) {
    res.status(400).json({ error: 'displayLabel must be 100 characters or less.' });
    return;
  }

  const doc = await prisma.channelConfigDoc.findUnique({
    where: { id: req.params.id },
  });

  if (!doc || doc.slackTeamId !== ctx.teamId || doc.slackChannelId !== ctx.channelId) {
    res.status(404).json({ error: 'Document not found.' });
    return;
  }

  const updated = await prisma.channelConfigDoc.update({
    where: { id: doc.id },
    data: { displayLabel: displayLabel.trim() },
  });

  logger.info('Config doc label renamed', {
    action: 'config_doc_rename',
    userId: ctx.userId,
    teamId: ctx.teamId,
    channelId: ctx.channelId,
    docId: doc.id,
    docType: doc.docType,
    newLabel: displayLabel.trim(),
  });

  res.json({
    id: updated.id,
    docType: updated.docType,
    displayLabel: updated.displayLabel,
    version: updated.version,
  });
});

// ---------------------------------------------------------------------------
// DELETE /docs/:id — hard delete doc + S3 file
// ---------------------------------------------------------------------------

uploadRouter.delete('/docs/:id', async (req, res) => {
  const ctx = getUploadContext(req);
  const doc = await prisma.channelConfigDoc.findUnique({
    where: { id: req.params.id },
  });

  if (!doc || doc.slackTeamId !== ctx.teamId || doc.slackChannelId !== ctx.channelId) {
    res.status(404).json({ error: 'Document not found.' });
    return;
  }

  const deleted = await deleteConfigDocById(doc.id);
  if (!deleted) {
    res.status(404).json({ error: 'Document not found.' });
    return;
  }

  logger.info('Config doc deleted via dashboard', {
    action: 'config_doc_delete',
    userId: ctx.userId,
    teamId: ctx.teamId,
    channelId: ctx.channelId,
    docId: doc.id,
    docType: doc.docType,
  });

  res.json({ deleted: true, docType: doc.docType });

  // Fire-and-forget Slack notification
  notifyConfigDocDelete(ctx.channelId, doc.docType, ctx.userId);
});
