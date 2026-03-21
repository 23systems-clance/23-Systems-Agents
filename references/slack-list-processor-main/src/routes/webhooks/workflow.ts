/**
 * Workflow webhook trigger HTTP route.
 *
 * Receives inbound webhook calls, validates HMAC-SHA256 signatures,
 * logs the call, and triggers workflow execution via the engine.
 * Webhook-triggered workflows run without Slack context.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getEndpointByToken, recordCall } from '../../services/webhook/webhookEndpointService.js';
import { validateSignature } from '../../services/webhook/hmacValidator.js';
import { startExecution } from '../../services/workflow/workflowEngine.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import crypto from 'crypto';

const router = Router();

/**
 * POST /api/webhooks/workflow/:token
 *
 * Receives an inbound webhook call and triggers the associated workflow.
 * 1. Looks up the endpoint by token.
 * 2. Validates HMAC-SHA256 signature from X-Hub-Signature-256 header.
 * 3. Responds 200 immediately.
 * 4. Fires workflow execution asynchronously.
 */
router.post('/:token', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const sourceIp = forwardedIp?.split(',')[0]?.trim() || req.ip || 'unknown';

  // 1. Look up endpoint
  const endpoint = await getEndpointByToken(token);
  if (!endpoint) {
    logger.warn('Workflow webhook: unknown token', { token: token.slice(0, 8) + '...' });
    res.status(404).json({ error: 'Endpoint not found' });
    return;
  }

  // 2. Validate HMAC signature
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const rawBody = JSON.stringify(req.body);
  const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');

  let validated = false;
  if (signature) {
    validated = validateSignature(endpoint.hmacSecret, rawBody, signature);
  }

  // Log the webhook call
  const logEntry = await prisma.webhookLog.create({
    data: {
      endpointId: endpoint.id,
      sourceIp,
      validated,
      payloadHash,
      responseStatus: validated || !signature ? 200 : 401,
    },
  });

  if (signature && !validated) {
    logger.warn('Workflow webhook: HMAC validation failed', { endpointId: endpoint.id });
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // 3. Respond 200 immediately
  res.status(200).json({ received: true, logId: logEntry.id });

  // 4. Record the call and trigger execution asynchronously
  processWebhookTrigger(endpoint, req.body, logEntry.id).catch((err) => {
    logger.error('Workflow webhook: async execution failed', {
      endpointId: endpoint.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });
});

/**
 * Processes the webhook trigger asynchronously.
 * Creates a workflow execution with the webhook payload as initial context.
 */
async function processWebhookTrigger(
  endpoint: Awaited<ReturnType<typeof getEndpointByToken>> & {},
  payload: unknown,
  logId: string,
): Promise<void> {
  await recordCall(endpoint.id);

  const template = (endpoint as any).template;
  if (!template) {
    logger.error('Workflow webhook: template not found on endpoint', { endpointId: endpoint.id });
    return;
  }

  const result = await startExecution({
    triggerType: 'WEBHOOK',
    slackTeamId: template.slackTeamId,
    slackUserId: 'webhook',
    slackChannelId: 'webhook',
    initialContext: {
      _webhookPayload: payload,
      _webhookEndpointId: endpoint.id,
      _webhookLogId: logId,
      ...(typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : {}),
    },
  });

  if (result) {
    // Link execution to webhook log
    await prisma.webhookLog.update({
      where: { id: logId },
      data: { executionId: result.execution.id },
    });

    logger.info('Workflow execution triggered via webhook', {
      executionId: result.execution.id,
      endpointId: endpoint.id,
      templateId: template.id,
    });
  }
}

export { router as workflowWebhookRouter };
