/**
 * Bolt action and view handlers for HubSpot import flow.
 *
 * Handles:
 * - `hubspot_file_selected` — User selects a file from the import dropdown
 * - `hubspot_import_naming` — User submits the naming modal (client + campaign name)
 * - `hubspot_import_confirm` — User confirms auto-detected column mapping
 * - `hubspot_import_map_columns` — User requests manual column mapping
 * - `hubspot_column_mapping` — User submits manual column mapping modal
 * - `hubspot_import_from_enrichment` — Inline "Import to HubSpot" button on completion
 * - `hubspot_import_cancel` / `hubspot_import_cancel_inline` — Cancel buttons
 * - `hubspot_disconnect_confirm` / `hubspot_disconnect_cancel` — Disconnect buttons
 */

import type { App } from '@slack/bolt';
import { requireFeature } from '../../services/featureToggle/featureGate.js';
import { prisma } from '../../models/index.js';
import * as hubspotOAuth from '../../services/hubspot/hubspotOAuth.js';
import { autoDetectMapping, getContactProperties } from '../../services/hubspot/hubspotPropertyMapping.js';
import { startImport } from '../../services/hubspot/hubspotImport.js';
import redis from '../../lib/redis.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// HubSpot import state (separate from enrichment ConversationState)
// ---------------------------------------------------------------------------

const HUBSPOT_STATE_PREFIX = 'hubspot-import';
const STATE_TTL_SECONDS = 900; // 15 minutes

/** State shape for the HubSpot import flow. */
interface HubSpotImportState {
  jobId: string;
  fileUrl: string;
  fileName: string;
  rowCount: number;
  headers: string[];
  channelId: string;
  threadTs?: string;
  enrichmentJobId?: string;
  clientName?: string;
  campaignName?: string;
  listName?: string;
  mapping?: Record<string, string>;
}

async function setHubSpotState(key: string, state: HubSpotImportState): Promise<void> {
  await redis.set(key, JSON.stringify(state), 'EX', STATE_TTL_SECONDS);
}

async function getHubSpotState(key: string): Promise<HubSpotImportState | null> {
  const raw = await redis.get(key);
  return raw ? (JSON.parse(raw) as HubSpotImportState) : null;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Registers all HubSpot import action and view handlers on the Bolt app.
 *
 * @param app - Slack Bolt application instance
 */
export function registerHubspotImportHandlers(app: App): void {
  // --- File selection from /hubspot import ---
  app.action('hubspot_file_selected', async ({ action, ack, body, client }) => {
    await ack();
    if (action.type !== 'static_select') return;

    const jobId = action.selected_option?.value;
    if (!jobId) return;

    const channelId = body.channel?.id;
    const userId = body.user.id;
    if (!channelId) return;

    try {
      // Load job details
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          resultFileUrl: true,
          resultFileName: true,
          sourceFileName: true,
          contactsFound: true,
          sourceRowCount: true,
          slackThreadTs: true,
        },
      });

      if (!job || !job.resultFileUrl) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: 'Could not find the selected file. Please try again.',
        });
        return;
      }

      // Parse CSV headers from S3 file
      const headers = await parseCsvHeaders(job.resultFileUrl);

      // Store state for the naming modal flow
      const stateKey = `${HUBSPOT_STATE_PREFIX}:${userId}:${channelId}`;
      await setHubSpotState(stateKey, {
        jobId: job.id,
        fileUrl: job.resultFileUrl,
        fileName: job.resultFileName || job.sourceFileName || 'import.csv',
        rowCount: job.contactsFound || job.sourceRowCount || 0,
        headers,
        channelId,
        threadTs: job.slackThreadTs,
      });

      // Open naming modal
      await client.views.open({
        trigger_id: (body as { trigger_id: string }).trigger_id,
        view: buildNamingModal(stateKey),
      });
    } catch (err) {
      logger.error('hubspot_file_selected error', { error: err });
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: 'An error occurred. Please try again.',
      });
    }
  });

  // --- Inline "Import to HubSpot" from enrichment completion ---
  app.action('hubspot_import_from_enrichment', requireFeature('workflows'), async ({ action, ack, body, client }) => {
    await ack();
    if (action.type !== 'button') return;

    const channelId = body.channel?.id;
    const userId = body.user.id;
    if (!channelId) return;

    try {
      const payload = JSON.parse(action.value || '{}');
      const jobId = payload.jobId;

      const job = await prisma.job.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          resultFileUrl: true,
          resultFileName: true,
          sourceFileName: true,
          contactsFound: true,
          sourceRowCount: true,
          slackThreadTs: true,
        },
      });

      if (!job || !job.resultFileUrl) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: 'Could not load the enrichment job file.',
        });
        return;
      }

      const headers = await parseCsvHeaders(job.resultFileUrl);

      const stateKey = `${HUBSPOT_STATE_PREFIX}:${userId}:${channelId}`;
      await setHubSpotState(stateKey, {
        jobId: job.id,
        fileUrl: job.resultFileUrl,
        fileName: job.resultFileName || job.sourceFileName || 'import.csv',
        rowCount: job.contactsFound || job.sourceRowCount || 0,
        headers,
        channelId,
        threadTs: job.slackThreadTs,
        enrichmentJobId: job.id,
      });

      await client.views.open({
        trigger_id: (body as { trigger_id: string }).trigger_id,
        view: buildNamingModal(stateKey),
      });
    } catch (err) {
      logger.error('hubspot_import_from_enrichment error', { error: err });
    }
  });

  // --- Naming modal submission ---
  app.view('hubspot_import_naming', async ({ ack, view, body, client }) => {
    await ack();

    const stateKey = view.private_metadata;
    const state = await getHubSpotState(stateKey);
    if (!state) {
      logger.warn('No conversation state for hubspot_import_naming');
      return;
    }

    const clientNameInput = view.state.values['client_name']?.['client_name_input']?.value || '';
    const campaignNameInput = view.state.values['campaign_name']?.['campaign_name_input']?.value || '';

    if (!clientNameInput || !campaignNameInput) return;

    // Run auto-detection on stored headers
    const mapping = autoDetectMapping(state.headers as string[]);
    const headers = state.headers as string[];

    // Check for email column
    const hasEmail = Object.values(mapping).includes('email');

    // Format mapping preview
    const mapped = Object.entries(mapping)
      .map(([csv, hs]) => `  ${csv} → \`${hs}\``)
      .join('\n');
    const unmapped = headers
      .filter((h: string) => !mapping[h])
      .map((h: string) => `  ${h}`)
      .join('\n');

    // Format list name
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const listName = `LIST : ${mm}${dd} [${clientNameInput.toUpperCase()}] ${campaignNameInput}`;

    // Store mapping + naming in state
    await setHubSpotState(stateKey, {
      ...state,
      clientName: clientNameInput,
      campaignName: campaignNameInput,
      listName,
      mapping,
    });

    // Post mapping preview to thread
    const channelId = state.channelId as string;
    const userId = body.user.id;

    let previewText = `*Column Mapping Preview*\n\n*List name:* \`${listName}\`\n*File:* ${state.fileName} (${state.rowCount} contacts)\n\n`;
    if (mapped) previewText += `*Auto-detected mappings:*\n${mapped}\n\n`;
    if (unmapped) previewText += `*Unmapped columns (will be ignored):*\n${unmapped}\n\n`;
    if (!hasEmail) previewText += `*Warning: No email column detected. Email is required for HubSpot import.*\n\n`;

    const actionValue = JSON.stringify({ stateKey });

    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: previewText,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: previewText },
        },
        {
          type: 'actions',
          elements: [
            ...(hasEmail
              ? [
                  {
                    type: 'button' as const,
                    text: { type: 'plain_text' as const, text: 'Confirm & Import' },
                    style: 'primary' as const,
                    action_id: 'hubspot_import_confirm',
                    value: actionValue,
                  },
                ]
              : []),
            {
              type: 'button' as const,
              text: { type: 'plain_text' as const, text: 'Map Columns' },
              action_id: 'hubspot_import_map_columns',
              value: actionValue,
            },
            {
              type: 'button' as const,
              text: { type: 'plain_text' as const, text: 'Cancel' },
              style: 'danger' as const,
              action_id: 'hubspot_import_cancel',
              value: actionValue,
            },
          ],
        },
      ],
    });
  });

  // --- Confirm & Import button ---
  app.action('hubspot_import_confirm', async ({ action, ack, body, client }) => {
    await ack();
    if (action.type !== 'button') return;

    const channelId = body.channel?.id;
    const userId = body.user.id;
    if (!channelId) return;

    try {
      const { stateKey } = JSON.parse(action.value || '{}');
      const state = await getHubSpotState(stateKey);
      if (!state) {
        await client.chat.postEphemeral({ channel: channelId, user: userId, text: 'Session expired. Please run `/hubspot import` again.' });
        return;
      }

      // Get connection
      const teamMapping = await prisma.channelClientMapping.findFirst({
        where: { slackChannelId: channelId },
      });
      if (!teamMapping) return;

      const connection = await prisma.hubSpotConnection.findUnique({
        where: { clientId: teamMapping.clientId },
      });
      if (!connection) return;

      // Start import
      const importJob = await startImport({
        connectionId: connection.id,
        sourceFile: {
          name: state.fileName as string,
          url: state.fileUrl as string,
          rowCount: state.rowCount as number,
        },
        clientName: state.clientName as string,
        campaignName: state.campaignName as string,
        columnMapping: state.mapping as Record<string, string>,
        enrichmentJobId: state.enrichmentJobId as string | undefined,
        slackContext: {
          channelId,
          threadTs: state.threadTs as string | undefined,
          userId,
        },
      });

      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `Import started! Job ID: \`${importJob.id}\`. List: \`${state.listName}\`. Progress updates will be posted in the thread.`,
      });
    } catch (err) {
      logger.error('hubspot_import_confirm error', { error: err });
      await client.chat.postEphemeral({ channel: channelId, user: userId, text: 'Failed to start import. Please try again.' });
    }
  });

  // --- Map Columns button → opens full mapping modal ---
  app.action('hubspot_import_map_columns', async ({ action, ack, body, client }) => {
    await ack();
    if (action.type !== 'button') return;

    const channelId = body.channel?.id;
    const userId = body.user.id;
    if (!channelId) return;

    try {
      const { stateKey } = JSON.parse(action.value || '{}');
      const state = await getHubSpotState(stateKey);
      if (!state) return;

      // Fetch HubSpot properties for dropdown options
      const teamMapping = await prisma.channelClientMapping.findFirst({
        where: { slackChannelId: channelId },
      });
      if (!teamMapping) return;

      const properties = await getContactProperties(teamMapping.clientId);
      const headers = state.headers as string[];
      const currentMapping = (state.mapping || {}) as Record<string, string>;

      // Build modal with one dropdown per CSV column
      const blocks = headers.slice(0, 25).map((header: string, idx: number) => {
        const propOptions = [
          { text: { type: 'plain_text' as const, text: '-- Ignore --' }, value: '__ignore__' },
          ...properties.slice(0, 99).map((p) => ({
            text: { type: 'plain_text' as const, text: `${p.label} (${p.name})`.slice(0, 75) },
            value: p.name,
          })),
        ];

        const currentValue = currentMapping[header];
        const initialOption = currentValue
          ? propOptions.find((o) => o.value === currentValue) || propOptions[0]
          : propOptions[0];

        return {
          type: 'input' as const,
          block_id: `map_col_${idx}`,
          label: { type: 'plain_text' as const, text: header.slice(0, 48) },
          element: {
            type: 'static_select' as const,
            action_id: `map_select_${idx}`,
            options: propOptions,
            initial_option: initialOption,
          },
        };
      });

      await client.views.open({
        trigger_id: (body as { trigger_id: string }).trigger_id,
        view: {
          type: 'modal' as const,
          callback_id: 'hubspot_column_mapping',
          title: { type: 'plain_text' as const, text: 'Map Columns' },
          submit: { type: 'plain_text' as const, text: 'Apply Mapping' },
          private_metadata: stateKey,
          blocks,
        },
      });
    } catch (err) {
      logger.error('hubspot_import_map_columns error', { error: err });
    }
  });

  // --- Manual column mapping modal submission ---
  app.view('hubspot_column_mapping', async ({ ack, view, body, client }) => {
    await ack();

    const stateKey = view.private_metadata;
    const state = await getHubSpotState(stateKey);
    if (!state) return;

    const headers = state.headers as string[];
    const newMapping: Record<string, string> = {};

    for (let i = 0; i < Math.min(headers.length, 25); i++) {
      const blockId = `map_col_${i}`;
      const actionId = `map_select_${i}`;
      const selected = view.state.values[blockId]?.[actionId]?.selected_option?.value;
      if (selected && selected !== '__ignore__') {
        newMapping[headers[i]] = selected;
      }
    }

    // Validate email mapping
    if (!Object.values(newMapping).includes('email')) {
      // Post error — email is required
      const channelId = state.channelId as string;
      const userId = body.user.id;
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: 'Email column mapping is required. Please run `/hubspot import` again and map at least one column to `email`.',
      });
      return;
    }

    // Update state with new mapping and start import
    await setHubSpotState(stateKey, { ...state, mapping: newMapping });

    const channelId = state.channelId as string;
    const userId = body.user.id;

    try {
      const teamMapping = await prisma.channelClientMapping.findFirst({
        where: { slackChannelId: channelId },
      });
      if (!teamMapping) return;

      const connection = await prisma.hubSpotConnection.findUnique({
        where: { clientId: teamMapping.clientId },
      });
      if (!connection) return;

      const importJob = await startImport({
        connectionId: connection.id,
        sourceFile: {
          name: state.fileName as string,
          url: state.fileUrl as string,
          rowCount: state.rowCount as number,
        },
        clientName: state.clientName as string,
        campaignName: state.campaignName as string,
        columnMapping: newMapping,
        enrichmentJobId: state.enrichmentJobId as string | undefined,
        slackContext: {
          channelId,
          threadTs: state.threadTs as string | undefined,
          userId,
        },
      });

      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `Import started with custom mapping! Job ID: \`${importJob.id}\`.`,
      });
    } catch (err) {
      logger.error('hubspot_column_mapping submission error', { error: err });
    }
  });

  // --- Cancel buttons ---
  app.action('hubspot_import_cancel', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const userId = body.user.id;
    if (channelId) {
      await client.chat.postEphemeral({ channel: channelId, user: userId, text: 'Import cancelled.' });
    }
  });

  app.action('hubspot_import_cancel_inline', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const userId = body.user.id;
    if (channelId) {
      await client.chat.postEphemeral({ channel: channelId, user: userId, text: 'Import cancelled.' });
    }
  });

  // --- Disconnect confirm/cancel ---
  app.action('hubspot_disconnect_confirm', async ({ action, ack, body, client }) => {
    await ack();
    if (action.type !== 'button') return;

    const channelId = body.channel?.id;
    const userId = body.user.id;
    const clientId = action.value;
    if (!channelId || !clientId) return;

    try {
      const managedClient = await prisma.managedClient.findUnique({
        where: { id: clientId },
        select: { name: true },
      });

      await hubspotOAuth.disconnect(clientId);

      await client.chat.postMessage({
        channel: channelId,
        text: `HubSpot disconnected for ${managedClient?.name || 'client'}.`,
      });
    } catch (err) {
      logger.error('HubSpot disconnect error', { error: err, clientId });
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: 'Failed to disconnect. Please try again.',
      });
    }
  });

  app.action('hubspot_disconnect_cancel', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const userId = body.user.id;
    if (channelId) {
      await client.chat.postEphemeral({ channel: channelId, user: userId, text: 'Disconnect cancelled.' });
    }
  });

  // --- OAuth link button (no-op — URL button opens in browser) ---
  app.action('hubspot_oauth_link', async ({ ack }) => {
    await ack();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds the naming modal view for HubSpot import.
 */
function buildNamingModal(stateKey: string) {
  return {
    type: 'modal' as const,
    callback_id: 'hubspot_import_naming',
    title: { type: 'plain_text' as const, text: 'Import to HubSpot' },
    submit: { type: 'plain_text' as const, text: 'Next' },
    private_metadata: stateKey,
    blocks: [
      {
        type: 'input' as const,
        block_id: 'client_name',
        label: { type: 'plain_text' as const, text: 'Client Name' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'client_name_input',
          placeholder: { type: 'plain_text' as const, text: 'e.g., Acme Corp' },
        },
      },
      {
        type: 'input' as const,
        block_id: 'campaign_name',
        label: { type: 'plain_text' as const, text: 'Campaign / Target List Name' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'campaign_name_input',
          placeholder: { type: 'plain_text' as const, text: 'e.g., Q1 ICP Outreach' },
        },
      },
      {
        type: 'section' as const,
        text: {
          type: 'mrkdwn' as const,
          text: '*List will be named:*\n`LIST : MMDD [CLIENT] Campaign Name / Target List`',
        },
      },
    ],
  };
}

/**
 * Downloads a CSV from S3 and parses just the header row.
 *
 * @param s3Url - Pre-signed or public S3 URL
 * @returns Array of header column names
 */
async function parseCsvHeaders(s3KeyOrUrl: string): Promise<string[]> {
  try {
    const { downloadFile } = await import('../../lib/storage.js');
    // Extract S3 key from URL if needed (e.g., "results/uuid/file.csv")
    const key = s3KeyOrUrl.includes('://') ? new URL(s3KeyOrUrl).pathname.slice(1) : s3KeyOrUrl;
    const buffer = await downloadFile(key);
    const content = buffer.toString('utf-8');

    // Parse just the first line
    const firstLine = content.split('\n')[0];
    if (!firstLine) return [];

    // Simple CSV header parsing (handles quoted fields)
    const headers: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of firstLine) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        headers.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    headers.push(current.trim().replace(/\r$/, ''));

    return headers;
  } catch (err) {
    logger.error('Failed to parse CSV headers', { error: err, s3KeyOrUrl });
    return [];
  }
}
