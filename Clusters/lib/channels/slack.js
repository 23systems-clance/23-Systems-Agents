import { ChannelAdapter } from './base.js';
import {
  verifySlackSignature,
  sendMessage,
  addReaction,
  downloadFile,
} from '../tools/slack.js';
import { isWhisperEnabled, transcribeAudio } from '../tools/openai.js';

class SlackAdapter extends ChannelAdapter {
  constructor(botToken) {
    super();
    this.botToken = botToken;
  }

  /**
   * Parse a Slack Events API webhook into normalized message data.
   * Handles: text messages, file uploads (images/documents), audio (transcribed).
   * Returns null if the event should be ignored.
   *
   * NOTE: The raw body and headers must be attached to the request as
   * `request._rawBody`, `request._timestamp`, `request._signature`
   * by the route handler (needed for signature verification before JSON parsing).
   */
  async receive(request) {
    const { SLACK_SIGNING_SECRET, SLACK_CHANNEL_ID } = process.env;

    if (!SLACK_SIGNING_SECRET) {
      console.error('[slack] SLACK_SIGNING_SECRET not configured — rejecting webhook');
      return null;
    }

    // Signature is verified by the route handler before calling receive(),
    // since we need the raw body string for verification.
    // By the time we get here, the request is already trusted.

    const body = request._parsedBody;
    if (!body) return null;

    // Handle Slack URL verification challenge
    if (body.type === 'url_verification') {
      return { _challenge: body.challenge };
    }

    // Only process event callbacks
    if (body.type !== 'event_callback') return null;

    const event = body.event;
    if (!event) return null;

    // Ignore bot messages (prevent loops)
    if (event.bot_id || event.subtype === 'bot_message') return null;

    // Only handle direct messages and app mentions
    if (event.type !== 'message' && event.type !== 'app_mention') return null;

    // For regular messages, only handle DMs (im) and group DMs (mpim)
    if (event.type === 'message' && event.channel_type !== 'im' && event.channel_type !== 'mpim') {
      return null;
    }

    // Ignore message subtypes (edits, deletes, etc.) except file_share
    if (event.subtype && event.subtype !== 'file_share') return null;

    const channel = event.channel;

    // Optional: restrict to a specific channel
    if (SLACK_CHANNEL_ID && channel !== SLACK_CHANNEL_ID) return null;

    let text = event.text || '';
    const attachments = [];

    // Strip bot mention from app_mention events (e.g., "<@U12345> hello" → "hello")
    if (event.type === 'app_mention') {
      text = text.replace(/^<@[A-Z0-9]+>\s*/i, '');
    }

    // Process file uploads
    if (event.files && event.files.length > 0) {
      for (const file of event.files) {
        try {
          const isImage = file.mimetype && file.mimetype.startsWith('image/');
          const isAudio = file.mimetype && (
            file.mimetype.startsWith('audio/') ||
            file.mimetype === 'video/webm' // voice messages in Slack
          );

          if (isAudio) {
            // Transcribe audio files
            if (isWhisperEnabled()) {
              const { buffer } = await downloadFile(
                this.botToken, file.url_private_download || file.url_private, file.name, file.mimetype
              );
              const transcription = await transcribeAudio(buffer, file.name);
              text = text ? `${text}\n\n[Voice message]: ${transcription}` : transcription;
            }
          } else if (isImage) {
            const { buffer } = await downloadFile(
              this.botToken, file.url_private_download || file.url_private, file.name, file.mimetype
            );
            attachments.push({ category: 'image', mimeType: file.mimetype, data: buffer });
          } else {
            const { buffer } = await downloadFile(
              this.botToken, file.url_private_download || file.url_private, file.name, file.mimetype
            );
            attachments.push({ category: 'document', mimeType: file.mimetype || 'application/octet-stream', data: buffer });
          }
        } catch (err) {
          console.error('[slack] Failed to process file:', err);
        }
      }
    }

    // Nothing actionable
    if (!text && attachments.length === 0) return null;

    return {
      threadId: channel,
      text,
      attachments,
      metadata: {
        channel,
        messageTs: event.ts,
        threadTs: event.thread_ts || event.ts,
        userId: event.user,
      },
    };
  }

  async acknowledge(metadata) {
    await addReaction(this.botToken, metadata.channel, metadata.messageTs).catch(() => {});
  }

  startProcessingIndicator(metadata) {
    // Slack doesn't have a persistent typing indicator API like Telegram.
    // We just no-op here — the eyes reaction from acknowledge() signals receipt.
    return () => {};
  }

  async sendResponse(threadId, text, metadata) {
    await sendMessage(this.botToken, threadId, text, {
      threadTs: metadata.threadTs,
    });
  }

  get supportsStreaming() {
    return false;
  }
}

export { SlackAdapter };
