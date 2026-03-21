/**
 * Bolt action handlers for the /rename-list flow.
 *
 * Handles:
 *   1. `rename_select_file` — user picks a file → opens a modal
 *   2. `rename_list_modal:*` — user submits the modal → performs the rename
 */

import type { App } from '@slack/bolt';
import { parseClientFromChannelName } from '../../services/file/listNaming.js';
import { renameList } from '../../services/rename/renameService.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Registers action and view handlers for the rename-list flow.
 */
export function registerRenameListHandlers(app: App): void {
  // ---- Step 1: User clicks "Rename" on a file ----
  app.action('rename_select_file', async ({ ack, body, client }) => {
    await ack();

    try {
      const action = (body as any).actions?.[0];
      if (!action?.value) {
        logger.warn('rename_select_file: missing action value');
        return;
      }

      const { jobId, jobType, currentName, cosellProvider } = JSON.parse(action.value);
      const channelId = (body as any).channel?.id;
      const threadTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
      const triggerId = (body as any).trigger_id;

      if (!channelId || !triggerId) {
        logger.warn('rename_select_file: missing channelId or triggerId');
        return;
      }

      // Fetch channel name for client extraction
      let channelName = 'unknown';
      try {
        const channelInfo = await client.conversations.info({ channel: channelId });
        channelName = (channelInfo.channel as any)?.name ?? 'unknown';
      } catch (err) {
        logger.warn('rename_select_file: failed to fetch channel info', {
          channelId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const datePrefix = `${mm}${dd}`;
      const clientName = parseClientFromChannelName(channelName);

      // Open the rename modal
      await client.views.open({
        trigger_id: triggerId,
        view: {
          type: 'modal',
          callback_id: `rename_list_modal:${jobId}:${jobType}:${channelId}:${threadTs}:${channelName}`,
          title: {
            type: 'plain_text',
            text: 'Rename List',
          },
          submit: {
            type: 'plain_text',
            text: 'Rename',
          },
          close: {
            type: 'plain_text',
            text: 'Cancel',
          },
          blocks: [
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `*Current name:* ${currentName}`,
                },
              ],
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `*Date:* ${datePrefix}  |  *Client:* [${clientName}]`,
                },
              ],
            },
            { type: 'divider' },
            {
              type: 'input',
              block_id: 'campaign_name_block',
              element: {
                type: 'plain_text_input',
                action_id: 'campaign_name_input',
                placeholder: {
                  type: 'plain_text',
                  text: 'e.g. Q1 Outbound / Target List',
                },
              },
              label: {
                type: 'plain_text',
                text: 'Campaign Name / Target List',
              },
            },
            {
              type: 'input',
              block_id: 'cosell_name_block',
              optional: true,
              element: {
                type: 'plain_text_input',
                action_id: 'cosell_name_input',
                placeholder: {
                  type: 'plain_text',
                  text: 'e.g. AWS',
                },
                ...(cosellProvider
                  ? { initial_value: cosellProvider }
                  : {}),
              },
              label: {
                type: 'plain_text',
                text: 'Co-Sell Name (optional)',
              },
            },
          ],
        },
      });
    } catch (error) {
      logger.error('Error in rename_select_file action', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ---- Step 2: User submits the rename modal ----
  app.view(/^rename_list_modal:/, async ({ ack, view, client }) => {
    await ack();

    try {
      // Parse metadata from callback_id
      const parts = view.callback_id.split(':');
      const jobId = parts[1];
      const jobType = parts[2] as 'enrichment' | 'filter';
      const channelId = parts[3];
      const threadTs = parts[4];
      const channelName = parts.slice(5).join(':'); // channel names can't contain colons, but be safe

      // Extract form values
      const values = view.state?.values ?? {};
      const campaignName =
        values.campaign_name_block?.campaign_name_input?.value?.trim() ?? '';
      const cosellName =
        values.cosell_name_block?.cosell_name_input?.value?.trim() || null;

      if (!campaignName) {
        logger.warn('rename_list_modal: empty campaign name', { jobId });
        return;
      }

      // Perform the rename
      const result = await renameList({
        jobId,
        jobType,
        campaignName,
        cosellName,
        channelName,
        slackClient: client,
        channelId,
        threadTs,
      });

      // Post confirmation in the thread
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `List renamed successfully!\n\`${result.oldFileName}\` → \`${result.newFileName}\``,
      });

      logger.info('List rename completed via modal', {
        jobId,
        oldFileName: result.oldFileName,
        newFileName: result.newFileName,
      });
    } catch (error) {
      logger.error('Error in rename_list_modal submission', {
        error: error instanceof Error ? error.message : String(error),
        callbackId: view.callback_id,
      });
    }
  });
}
