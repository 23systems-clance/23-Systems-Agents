# Slack Blocks — Setup Guide

## Prerequisites

- A Slack App with Bot Token Scopes: `chat:write`, `files:write`, `reactions:write`
- Your public APP_URL (not localhost)

## Step 1: Set Agent Secret for Docker Jobs

The `SLACK_BOT_TOKEN` is already in `.env` for local use. To make it available in Docker agent jobs:

```bash
npx 23wf set-agent-llm-secret SLACK_BOT_TOKEN xoxb-your-token-here
```

## Step 2: Configure Slack App Interactivity

1. Go to https://api.slack.com/apps → select your app
2. Navigate to **Interactivity & Shortcuts** → toggle **On**
3. Set **Request URL** to:
   ```
   https://<your-APP_URL>/webhook/slack-interact
   ```
4. Under **Select Menus** → set **Options Load URL** to the same URL (optional, for dynamic dropdowns)
5. Click **Save Changes**

## Step 3: Enable Triggers

In `config/TRIGGERS.json`, set `enabled: true` on these two triggers:

- **slack-block-actions** — handles button clicks and dropdown selections
- **slack-modal-submit** — handles modal form submissions

## Step 4: Invite the Bot

In Slack, invite the bot to any channel where it should post:

```
/invite @YourBotName
```

## Step 5: Test

Send a test message from the project root:

```bash
skills/send-slack-message/send-blocks.js C0123CHANNEL \
  --text "Slack Blocks skill is live!" \
  --buttons "It works=yes,Needs help=no"
```

Replace `C0123CHANNEL` with your actual channel ID (find it in Slack channel details → bottom of the About tab).

## Available Scripts

| Script | What it does |
|--------|-------------|
| `send-blocks.js` | Send messages with buttons, dropdowns, context blocks |
| `open-modal.js` | Open modal forms with text inputs and dropdowns |
| `update-message.js` | Update existing messages (swap buttons for results) |
| `parse-interaction.js` | Parse Slack interaction payloads into structured JSON |
| `upload-file.js` | Upload files (CSV, reports) to channels |

## How the Interaction Loop Works

```
1. Agent sends Block Kit message (buttons/dropdowns) → Slack channel
2. User clicks a button or selects from dropdown
3. Slack POSTs interaction payload → /webhook/slack-interact
4. Trigger fires a new agent job with action details
5. Agent parses the payload, processes the choice
6. Agent updates the original message + sends next step
7. Repeat from step 2 as needed
```

## Workflow Example: CSV Enrichment

```
User uploads CSV to Slack
  → Agent parses CSV, posts summary with buttons:
    [Technographics] [Contact Data] [Both]
  → User clicks [Both]
  → Slack POSTs to /webhook/slack-interact
  → New agent job fires, runs enrichment APIs
  → Agent uploads enriched CSV back to Slack
  → Agent sends follow-up buttons:
    [Export to CRM] [Filter by Tech Stack] [Download Report]
```

## Troubleshooting

- **"not_in_channel" error** — Bot needs to be invited to the channel (`/invite @bot`)
- **"invalid_auth" error** — Check `SLACK_BOT_TOKEN` is correct and not expired
- **Buttons don't trigger agent** — Verify Interactivity Request URL matches your APP_URL and triggers are enabled
- **Modal won't open** — Modals require a `trigger_id` from a recent interaction (expires after 3 seconds)
