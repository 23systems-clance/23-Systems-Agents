# Quickstart: Slack Agent Integration

**Phase 1 Output** | **Date**: 2026-03-06

## Prerequisites

- Existing Slack List Processor deployed on ECS Fargate
- AWS CLI configured with appropriate permissions
- Access to Slack app settings at api.slack.com/apps

## Step 1: Slack App Configuration

### Enable Agents & AI Apps
1. Go to [api.slack.com/apps](https://api.slack.com/apps) → select your app
2. Navigate to **Agents & AI Apps** in the sidebar
3. Toggle **ON**
4. Set assistant description: "Enrich company lists, find decision makers, and generate technology reports"

### Add OAuth Scopes
Add these scopes under **OAuth & Permissions** → **Bot Token Scopes**:
- `assistant:write` (auto-added when toggling Agents)
- `im:history`
- `channels:history` (if not already present)
- `groups:history` (if not already present)

### Subscribe to Events
Under **Event Subscriptions** → **Subscribe to bot events**, add:
- `assistant_thread_started`
- `assistant_thread_context_changed`
- `message.im`
- `app_uninstalled`

### Enable Public Distribution
Under **Manage Distribution**:
1. Complete the checklist items
2. Add **Redirect URL**: `{WEBHOOK_BASE_URL}/slack/oauth_redirect`
3. Click **Activate Public Distribution**

## Step 2: Environment Variables

Add to `.env` (used by deploy script):

```env
# OAuth (new)
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret
SLACK_STATE_SECRET=random-32-char-string
OAUTH_REDIRECT_URI=https://your-domain.com/slack/oauth_redirect
TOKEN_ENCRYPTION_KEY=random-32-byte-hex-key
```

## Step 3: Database Migration

```bash
# Generate and apply migration (run via deploy pipeline)
npx prisma migrate dev --name add_agent_models
```

New tables: `WorkspaceInstallation`, `AgentThread`, `ConversationTurn`, `AgentThreadAudit`, `AgentThreadJob`
Modified: `ApiUsageLog` (add `slackTeamId`), `Job` (add `sourceInterface`)

## Step 4: Seed Current Workspace

After migration, seed the current development workspace as the first installation:

```sql
INSERT INTO "WorkspaceInstallation" (
  id, "slackTeamId", "slackTeamName", "botToken",
  "botId", "botUserId", "appId", status, "onboardingComplete"
) VALUES (
  gen_random_uuid(),
  'YOUR_TEAM_ID',
  'Dev Labs',
  encrypt('YOUR_EXISTING_BOT_TOKEN'),
  'YOUR_BOT_ID',
  'YOUR_BOT_USER_ID',
  'YOUR_APP_ID',
  'ACTIVE',
  true
);
```

## Step 5: Deploy

```bash
./infra/deploy.sh --update
```

This builds the Docker image with the new agent code, pushes to ECR, and redeploys the ECS task.

## Step 6: Test

1. Open Slack → Click the AI/Agent icon in the top bar
2. Your agent should appear in the side-panel
3. Verify suggested prompts appear
4. Type "help" to confirm the agent responds
5. Upload a test CSV and request enrichment via conversation

## Verification Checklist

- [ ] Agent appears in Slack side-panel
- [ ] Suggested prompts display on thread start
- [ ] Intent classification works for enrichment requests
- [ ] File upload triggers validation flow
- [ ] Streaming responses appear progressively
- [ ] Task cards show during enrichment pipeline
- [ ] Job status queries return correct results
- [ ] Existing trigger-based flows still work (file upload in channel, /enrich command)
- [ ] OAuth install link works for test workspace

## Troubleshooting

**Agent doesn't appear in side-panel**:
- Verify "Agents & AI Apps" toggle is ON in app settings
- Check `assistant:write` scope is granted
- Reinstall the app to pick up new scopes

**Events not received**:
- Check CloudWatch logs for `assistant_thread_started` events
- Verify event subscriptions include all three assistant events
- Ensure Socket Mode connection is active (only one connection allowed)

**Streaming errors**:
- Check that bot token has `chat:write` scope
- Verify `recipient_user_id` and `recipient_team_id` are set in startStream
- Check rate limits in CloudWatch (Tier 4 for appendStream = 100+/min)
