# Spec 002: Slack Pipeline Integration

**Status:** Draft
**Priority:** P1 (High)
**Estimated Effort:** 20 hours
**Dependencies:** Spec 001 (End User Portal — complete), Slack adapter (done), Pipeline approval system (done), File serving route (done)
**Sequence:** 3rd (after End User Portal is feature-complete)

---

## Overview

Enable full team pipeline interaction through Slack. Users send a task to a designated Slack channel, the pipeline runs, and each step's output is posted back to Slack with interactive buttons for review and approval. The entire workflow — from task submission to final output — happens within Slack.

## Goals

1. **Slack-initiated pipelines** — Send a message to a channel to start a team pipeline
2. **Output posting** — Post completed step output (files, summaries) to Slack with previews
3. **Interactive approval** — Slack Block Kit buttons for "Continue", "Revise", or picking a variation
4. **Full round-trip** — Button clicks trigger the next pipeline step with user feedback

## Non-Goals

- Replacing the web UI (Slack is an additional interface, not a replacement)
- Slack-based team creation (teams are created in the web UI, Slack controls execution)
- Real-time streaming of agent output to Slack (too noisy; post results on completion)

---

## Architecture

```
User (Slack)                  23 Systems                          Docker
    |                              |                                |
    |-- "Run one-pager for X" --->|                                |
    |                              |-- Start pipeline ------------->|
    |<-- "Starting pipeline..." ---|                                |
    |                              |          (role running)        |
    |                              |<-- Container exits (code 0) --|
    |<-- Output files + buttons ---|                                |
    |                              |                                |
    |-- [Pick Design 3] --------->|                                |
    |                              |-- Trigger next role ---------->|
    |<-- "Starting next step..." --|                                |
    |                              |          (role running)        |
    |                              |<-- Container exits (code 0) --|
    |<-- Final output + "Done" ----|                                |
```

## Existing Infrastructure

| Component | Status | Location |
|-----------|--------|----------|
| Slack adapter (inbound messages) | Done | `Clusters/lib/channels/slack.js` |
| Slack tools (send/react/verify) | Done | `Clusters/lib/tools/slack.js` |
| Slack webhook route | Done | `POST /api/slack/webhook` |
| Slack Bot Token + Signing Secret | Configured | `.env` |
| Pipeline approval system | Done | `lib/portal/components/pipeline-status.jsx` |
| `continueTeamPipeline()` action | Done | `lib/portal/actions.js` |
| File serving route | Done | `/team/[teamId]/file/[...filePath]/route.js` |
| `requiresApproval` flag on roles | Done | Stored in `triggerConfig` |

## Requirements

### Phase 1: Slack → Pipeline (Inbound)

**R1.1 — Channel-to-Team Binding**
- Configuration to bind a Slack channel to a specific team
- Stored in cluster metadata or a new `slack_channel_id` field
- Settable in team dashboard settings
- One channel can be bound to one team (1:1 mapping for clarity)

**R1.2 — Message Parsing**
- Messages in the bound channel (mentioning the bot or in a DM) trigger `runTeamTask(teamId, messageText)`
- Strip bot mention prefix from the message text
- Acknowledge receipt with a threaded reply: "Starting [Team Name] pipeline..."
- Store the Slack thread timestamp (`ts`) for all subsequent replies

**R1.3 — Thread Context**
- All pipeline status updates and outputs post as threaded replies to the original message
- This keeps the channel clean and groups all pipeline activity together

### Phase 2: Pipeline → Slack (Outbound)

**R2.1 — Step Completion Notification**
- When a role completes (container exits with code 0), post a summary to the Slack thread
- Include: role name, completion status, time elapsed
- For text output (markdown, txt): post content as a Slack code block or formatted text
- For HTML files: post a link to the file serving route (`APP_URL/team/{id}/file/{path}`)

**R2.2 — File Attachments**
- Upload small files directly to Slack via `files.upload` API
- For HTML files, post a clickable link (Slack can't render HTML inline)
- For images (PNG, JPG), upload as Slack image attachments for inline preview

**R2.3 — Approval Buttons (Block Kit)**
When the team has `requiresApproval` and a role completes with output files:

```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Researcher finished* — 4 design variations ready for review"
      }
    },
    {
      "type": "actions",
      "block_id": "pipeline_approval_<teamId>_<nextRoleId>",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "design-1-bold-dark.html" },
          "action_id": "pick_file_0",
          "value": "Use design-1-bold-dark.html and finalize it"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "design-2-clean-white.html" },
          "action_id": "pick_file_1",
          "value": "Use design-2-clean-white.html and finalize it"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Continue (no changes)" },
          "action_id": "continue_pipeline",
          "style": "primary"
        }
      ]
    }
  ]
}
```

### Phase 3: Slack → Pipeline (Interactive)

**R3.1 — Interactivity Webhook**
- New route: `POST /api/slack/interactions`
- Receives Slack Block Kit interaction payloads (button clicks, menu selections)
- Verify signature using existing `verifySlackSignature()`
- Parse `block_id` to extract `teamId` and `nextRoleId`
- Parse `action_id` + `value` to determine user's choice

**R3.2 — Button Click → Continue Pipeline**
- On button click, call `continueTeamPipeline(teamId, nextRoleId, feedback)`
- `feedback` is the button's `value` field (e.g., "Use design-3-split-editorial.html and finalize it")
- Acknowledge the interaction (replace buttons with "Continuing..." message)
- Post a threaded reply: "Starting [Next Role Name]..."

**R3.3 — Custom Feedback**
- Add a text input option for custom feedback (Slack modal or message shortcut)
- Opens a Slack modal with a textarea → submit triggers the pipeline with custom feedback

**R3.4 — Pipeline Completion**
- When all roles complete, post a final summary to the thread
- Include links to all output files
- Mark the thread with a checkmark reaction

---

## Technical Design

### New Files

| File | Purpose |
|------|---------|
| `Clusters/api/slack-interactions.js` | Handler for Slack Block Kit interactions |
| `lib/portal/slack-pipeline.js` | Slack pipeline posting and button building |

### Modified Files

| File | Change |
|------|--------|
| `Clusters/api/index.js` | Add `/api/slack/interactions` route |
| `Clusters/lib/channels/slack.js` | Add `postBlocks()` method for Block Kit messages |
| `Clusters/lib/tools/slack.js` | Add `uploadFile()`, `updateMessage()` functions |
| `Clusters/lib/cluster/execute.js` | Add post-completion hook for Slack notification |
| `Clusters/lib/db/schema.js` | Add `slack_channel_id` + `slack_thread_ts` columns (optional) |
| `lib/portal/actions.js` | Add `bindSlackChannel()` action |

### Slack App Configuration

Required Slack app capabilities (configured in Slack App Dashboard):

| Feature | Scope | Purpose |
|---------|-------|---------|
| Event Subscriptions | `message.channels`, `app_mention` | Receive messages |
| Interactivity | Request URL: `{APP_URL}/api/slack/interactions` | Receive button clicks |
| Bot Token Scopes | `chat:write`, `files:write`, `reactions:write`, `channels:read` | Post messages and files |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Already configured |
| `SLACK_SIGNING_SECRET` | Yes | Already configured |
| `SLACK_ALERT_CHANNEL_ID` | No | Default channel for alerts (from Spec 001) |

---

## Implementation Plan

### Phase 1 (4 hours)
1. Add `slackChannelId` field to clusters (migration or metadata)
2. Add "Connect Slack Channel" UI in team dashboard settings
3. Parse inbound Slack messages and match to bound team
4. Trigger `runTeamTask()` with message text
5. Store thread `ts` for reply context

### Phase 2 (8 hours)
1. Build `postStepCompletion()` function in `slack-pipeline.js`
2. Post output files as links + summaries to Slack thread
3. Build Block Kit button payloads for approval steps
4. Hook into container exit detection (SSE poll or event listener)

### Phase 3 (8 hours)
1. Build `/api/slack/interactions` route handler
2. Parse Block Kit interaction payloads
3. Map button clicks to `continueTeamPipeline()` calls
4. Replace buttons with confirmation message after click
5. Add custom feedback modal for freeform input
6. Post final completion summary

---

## Security Considerations

- All Slack webhooks verified via HMAC-SHA256 signature (existing `verifySlackSignature()`)
- Replay protection: 5-minute timestamp window (already implemented)
- Channel binding is per-team, per-user — only the team owner can bind a channel
- File serving route already requires session auth; Slack links will need either:
  - Public file URLs (via Slack file upload — preferred)
  - Or a time-limited token-based URL for unauthenticated access from Slack

## Open Questions

1. **Thread vs. Channel**: Should all pipeline output go in a thread, or should variation previews be top-level messages?
2. **Multi-user**: If multiple people are in the Slack channel, should anyone be able to approve, or only the team owner?
3. **File previews**: Should HTML files be screenshotted (via Puppeteer/Playwright) for inline Slack image previews, or just linked?
4. **Rate limiting**: If a team has many steps, how do we avoid flooding the channel?
