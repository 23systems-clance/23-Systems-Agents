---
name: send-slack-message
description: Send interactive Slack messages using Block Kit — buttons, dropdowns, modals, file uploads. Build conversational workflows with back-and-forth user interaction.
---

# Send Slack Message

Send interactive Slack messages using Block Kit UI components. Build conversational agent workflows with buttons, dropdowns, modals, and file uploads.

## Setup

Requires a Slack App with these scopes: `chat:write`, `files:write`, `reactions:write`.

1. Create a Slack App at https://api.slack.com/apps
2. Add Bot Token Scopes: `chat:write`, `files:write`, `reactions:write`
3. For modals, also enable **Interactivity** and set Request URL to your agent's trigger endpoint (e.g., `https://your-app.com/webhook/slack-interact`)
4. Install the app to your workspace
5. Add the bot token:
   ```bash
   # For local development
   echo 'SLACK_BOT_TOKEN=xoxb-...' >> .env

   # For Docker agent jobs
   npx 23wf set-agent-llm-secret SLACK_BOT_TOKEN xoxb-...
   ```

## Send Interactive Messages (Block Kit)

```bash
# Simple buttons — ask user to choose
skills/send-slack-message/send-blocks.js <channel> --text "What enrichment do you want?" \
  --buttons "Technographics=techno,Contact Data=contacts,Both=both"

# Dropdown select menu
skills/send-slack-message/send-blocks.js <channel> --text "Pick a company:" \
  --dropdown "Acme Corp=acme,Globex=globex,Initech=initech" --placeholder "Select company"

# Section with context and buttons
skills/send-slack-message/send-blocks.js <channel> --text "Found 142 companies in CSV" \
  --context "Uploaded by @clance | 3 columns detected" \
  --buttons "Enrich All=enrich_all,Preview First 10=preview"

# Reply in a thread
skills/send-slack-message/send-blocks.js <channel> --text "Processing complete" \
  --thread-ts "1234567890.123456"

# Custom blocks JSON (full Block Kit flexibility)
skills/send-slack-message/send-blocks.js <channel> --blocks '[{"type":"section","text":{"type":"mrkdwn","text":"Custom block"}}]'

# Pipe blocks JSON from stdin
echo '[{"type":"section","text":{"type":"mrkdwn","text":"From pipe"}}]' | skills/send-slack-message/send-blocks.js <channel> --blocks -
```

### Options

- `--text <text>` — Header text (markdown supported)
- `--buttons <label=value,...>` — Comma-separated button definitions
- `--dropdown <label=value,...>` — Dropdown select menu options
- `--placeholder <text>` — Placeholder for dropdown (default: "Select an option")
- `--context <text>` — Context line below the main content
- `--thread-ts <ts>` — Reply in a thread
- `--blocks <json>` — Raw Block Kit JSON array (use `-` to read from stdin)
- `--action-id <id>` — Custom action_id prefix (default: "slack_blocks")

## Open Modal

```bash
# Open a modal with text inputs
skills/send-slack-message/open-modal.js <trigger_id> --title "Enrichment Settings" \
  --inputs "API Key=api_key,Max Results=max_results" \
  --submit "Start Enrichment"

# Modal with a dropdown
skills/send-slack-message/open-modal.js <trigger_id> --title "Select Options" \
  --dropdown "Output Format=csv,json,xlsx" \
  --submit "Generate"
```

### Options

- `--title <text>` — Modal title (max 24 chars)
- `--inputs <label=id,...>` — Text input fields
- `--dropdown <label=value,...>` — Static select options
- `--submit <text>` — Submit button text (default: "Submit")
- `--callback-id <id>` — Callback ID for identifying the modal submission

## Update Existing Message

```bash
# Replace buttons with a result after user clicks
skills/send-slack-message/update-message.js <channel> <message_ts> \
  --text "You selected: Technographics" \
  --context "Enrichment started at 2024-01-15 09:30"
```

Useful for replacing interactive elements with confirmation text after a user makes a choice.

## Parse Interaction Payload

```bash
# Parse a Slack interaction payload (from trigger body)
echo '{"type":"block_actions","actions":[...]}' | skills/send-slack-message/parse-interaction.js

# Parse from a file
skills/send-slack-message/parse-interaction.js < /path/to/payload.json
```

Outputs structured JSON with: `type`, `action_id`, `value`, `user`, `channel`, `message_ts`, `trigger_id`.

## Upload File

```bash
# Upload a file to a channel
skills/send-slack-message/upload-file.js <channel> /path/to/results.csv --title "Enrichment Results"

# Upload with a message
skills/send-slack-message/upload-file.js <channel> /path/to/report.csv \
  --title "Company Report" --message "Here are your enriched results"

# Upload content from stdin
echo "name,domain,tech_stack" | skills/send-slack-message/upload-file.js <channel> --stdin \
  --filename "results.csv" --title "Results"
```

## Trigger Configuration

To receive Slack interactions (button clicks, modal submissions), add triggers to `config/TRIGGERS.json`:

```json
[
  {
    "name": "Slack Block Actions",
    "watch_path": "/webhook/slack-interact",
    "enabled": true,
    "actions": [{
      "type": "agent",
      "job": "User clicked a Slack button. Action: {{body.actions.0.action_id}}, Value: {{body.actions.0.value}}, User: {{body.user.username}}, Channel: {{body.channel.id}}. Process their selection and respond."
    }]
  },
  {
    "name": "Slack Modal Submit",
    "watch_path": "/webhook/slack-modal",
    "enabled": true,
    "actions": [{
      "type": "agent",
      "job": "User submitted a Slack modal. Callback: {{body.view.callback_id}}, Values: {{body.view.state.values}}. Process the form submission."
    }]
  }
]
```

## Workflow Example: CSV Enrichment

```bash
# 1. Agent receives CSV, sends choice buttons
skills/send-slack-message/send-blocks.js C0123CHANNEL \
  --text "Found 142 companies in uploaded CSV" \
  --context "Columns: Company Name, Domain, Industry" \
  --buttons "Technographics=techno,Contact Data=contacts,Both=both"

# 2. User clicks "Both" → trigger fires new agent job
# 3. Agent processes enrichment, uploads results
skills/send-slack-message/upload-file.js C0123CHANNEL /tmp/enriched.csv \
  --title "Enriched Companies (142 rows)" \
  --message "Enrichment complete — technographics and contact data added"

# 4. Agent sends follow-up with next steps
skills/send-slack-message/send-blocks.js C0123CHANNEL \
  --text "What would you like to do next?" \
  --buttons "Export to CRM=export_crm,Filter by Tech Stack=filter,Download Full Report=download"
```
