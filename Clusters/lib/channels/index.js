import { TelegramAdapter } from './telegram.js';
import { SlackAdapter } from './slack.js';

let _telegramAdapter = null;
let _slackAdapter = null;

/**
 * Get the Telegram channel adapter (lazy singleton).
 * @param {string} botToken - Telegram bot token
 * @returns {TelegramAdapter}
 */
export function getTelegramAdapter(botToken) {
  if (!_telegramAdapter || _telegramAdapter.botToken !== botToken) {
    _telegramAdapter = new TelegramAdapter(botToken);
  }
  return _telegramAdapter;
}

/**
 * Get the Slack channel adapter (lazy singleton).
 * @param {string} botToken - Slack bot token (xoxb-...)
 * @returns {SlackAdapter}
 */
export function getSlackAdapter(botToken) {
  if (!_slackAdapter || _slackAdapter.botToken !== botToken) {
    _slackAdapter = new SlackAdapter(botToken);
  }
  return _slackAdapter;
}
