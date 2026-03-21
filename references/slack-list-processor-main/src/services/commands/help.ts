/**
 * Help text builder for the /enrich slash command.
 */

/**
 * Returns mrkdwn-formatted usage instructions for the /enrich slash command.
 */
export function getHelpText(): string {
  return [
    '*Enrichment Bot Commands*',
    '',
    '`/enrich help` — Show this help message',
    '`/enrich history` — Show your last 10 enrichment jobs',
    '`/enrich stop` — Cancel your most recent active job',
    '`/enrich report <technology>` — Generate a tech report (e.g., `/enrich report Salesforce`)',
    '',
    '*File-Based Enrichment:*',
    'Upload a CSV or XLSX file to any channel, then follow the interactive prompts.',
    'The bot will walk you through selecting enrichment type, purpose, and options.',
    '',
    '*Natural Language:*',
    '`/enrich find companies using HubSpot` — Start a tech report via AI intent classification',
  ].join('\n');
}
