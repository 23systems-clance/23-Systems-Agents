# Quickstart: Vertical Pack Platform

**Feature**: 39-vertical-pack-platform
**Date**: 2026-03-18

## Prerequisites

- [ ] Access to admin dashboard (`https://dt9zhghz3mtx8.cloudfront.net`)
- [ ] Admin login credentials
- [ ] At least one workspace installed with an active billing profile
- [ ] Prisma migration applied (`prisma migrate deploy`)
- [ ] ECS task redeployed with platform code

## 1. Create Your First Agent

### Via Admin Dashboard

1. Navigate to **Platform > Agent Registry**
2. Click **Create Agent**
3. Fill in:
   - **Name**: `Intent Classifier`
   - **Slug**: `intent-classifier`
   - **Model**: `claude-haiku-4-5-20251001`
   - **Max Tokens**: `1024`
   - **Credit Cost**: `0.5`
   - **System Prompt**: (paste your classification prompt)
   - **Input Schema**: `{ "type": "object", "properties": { "text": { "type": "string" } } }`
   - **Output Schema**: `{ "type": "object", "properties": { "intent": { "type": "string" }, "confidence": { "type": "number" } } }`
4. Click **Save** (agent is in DRAFT status)

### Via API

```bash
curl -X POST https://your-alb/api/admin/agents \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=YOUR_SESSION" \
  -d '{
    "name": "Intent Classifier",
    "slug": "intent-classifier",
    "modelId": "claude-haiku-4-5-20251001",
    "systemPrompt": "You are an intent classifier...",
    "maxTokens": 1024,
    "creditCost": 0.5,
    "inputSchema": { "type": "object", "properties": { "text": { "type": "string" } } },
    "outputSchema": { "type": "object", "properties": { "intent": { "type": "string" } } }
  }'
```

### Verify

- [ ] Agent appears in the registry with DRAFT status
- [ ] Agent version 1 is created automatically

## 2. Test the Agent

1. On the Agent Detail page, click **Test in Sandbox**
2. Enter sample input: `{ "text": "enrich this list of companies" }`
3. Click **Run Test**
4. Verify:
   - [ ] Output matches expected schema
   - [ ] Token count is within max_tokens limit
   - [ ] Cost estimate is displayed

## 3. Publish the Agent

1. Click **Publish** on the Agent Detail page
2. Verify:
   - [ ] Agent status changes to PUBLISHED
   - [ ] Version 1 status is PUBLISHED
   - [ ] Agent appears in the tool picker when creating skills

## 4. Register an MCP Server

1. Navigate to **Platform > MCP Servers**
2. Click **Register Server**
3. Fill in:
   - **Name**: `Apollo`
   - **Slug**: `apollo`
   - **Provider**: `apollo`
   - **Base URL**: `https://api.apollo.io/v1`
   - **Auth Type**: `API_KEY`
   - **Credentials**: `{ "apiKey": "your-key" }`
   - **BYOK Enabled**: `true`
   - **Rate Limit**: `100` RPM
4. Click **Save**
5. Add tools:
   - **Tool Name**: `people_search`
   - **Input Schema**: `{ "type": "object", "properties": { "domain": { "type": "string" }, "titles": { "type": "array" } } }`
   - **Credit Cost**: `1.0`

### Verify

- [ ] MCP server appears in the registry
- [ ] Health check runs automatically (status shows HEALTHY or ERROR)
- [ ] Tools are listed under the server

## 5. Create a Skill

1. Navigate to **Platform > Skills**
2. Click **Create Skill**
3. Fill in:
   - **Name**: `Contact Lookup`
   - **Slug**: `contact-lookup`
   - **Agent**: Select `Intent Classifier` (pinned to version 1)
   - **MCP Tools**: Select `Apollo > people_search`
   - **Trigger Type**: `API_CALL`
   - **Delivery**: `SLACK_THREAD`
   - **Credit Cost**: `2.0`
4. Click **Save** (DRAFT status)

### Test the Skill

1. Click **Test Skill**
2. Enter input: `{ "domain": "example.com", "titles": ["CTO"] }`
3. Verify:
   - [ ] Full execution trace shows: trigger → agent invocation → tool call → output delivery
   - [ ] Credits not deducted (sandbox mode)

### Publish

1. Click **Publish**
2. Verify: skill status changes to PUBLISHED

## 6. Create a Vertical Pack

1. Navigate to **Platform > Packs**
2. Click **Create Pack**
3. Fill in:
   - **Name**: `Enrichment Pack`
   - **Slug**: `enrichment-pack`
   - **Category**: `SALES`
   - **Tier**: `STARTER`
   - **Monthly Price**: `49.00`
   - **Credits Included**: `500`
   - **Overage Rate**: `0.15`
4. Assign skills: select `Contact Lookup`
5. Click **Save**, then **Publish**

### Verify

- [ ] Pack appears in the catalog with skills listed
- [ ] Pack is visible to client workspaces

## 7. Subscribe a Workspace

### Via Client Dashboard

1. Log in as a workspace admin
2. Navigate to **Pack Catalog**
3. Click **Subscribe** on the Enrichment Pack
4. Complete payment via Stripe

### Verify

- [ ] PackSubscription record created with `creditsIncluded: 500`, `creditsUsed: 0`
- [ ] Workspace can now invoke skills in the pack

## 8. Invoke a Skill

### Via API

```bash
curl -X POST https://your-alb/api/client/skills/SKILL_ID/invoke \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=YOUR_SESSION" \
  -d '{ "input": { "domain": "stripe.com", "titles": ["CTO", "VP Engineering"] } }'
```

### Verify

- [ ] Returns `202` with `executionId`
- [ ] Execution appears in logs with status COMPLETED
- [ ] Credits deducted from pack subscription
- [ ] Full execution trace available within 5 seconds

## 9. Check Daily Spend Limit

1. Set a workspace daily spend limit to `$1.00` via admin dashboard
2. Run multiple skill invocations
3. Verify:
   - [ ] When daily spend reaches limit, next invocation returns `429 SPEND_LIMIT_BLOCKED`
   - [ ] Workspace admin receives notification

## 10. Verify Analytics

1. Navigate to **Platform > Analytics**
2. Verify:
   - [ ] Per-skill: total invocations, success rate, avg duration, total credits
   - [ ] Per-pack: subscriber count, credit usage vs included, overage revenue
   - [ ] Per-workspace: active packs, total executions, daily spend

## Smoke Test Checklist

- [ ] Create agent → test → publish lifecycle works
- [ ] MCP server registration with health check works
- [ ] Skill creation composing agent + MCP tool works
- [ ] Skill test execution produces full trace
- [ ] Pack creation with skill assignment works
- [ ] Pack subscription creates isolated credit allocation
- [ ] Skill invocation checks credits before execution
- [ ] Credits deducted from correct pack subscription
- [ ] Multi-pack skill routes credits to pack with most remaining
- [ ] Daily spend limit blocks execution when exceeded
- [ ] Agent version pinning prevents silent changes
- [ ] Version upgrade notification appears when newer agent version exists
- [ ] Execution logs capture full trace for 100% of invocations
- [ ] BYOK credentials used when workspace provides own API key
