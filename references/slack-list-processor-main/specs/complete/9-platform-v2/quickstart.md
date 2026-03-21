# Quickstart: Platform V2 - Workflow Builder Node Extensions

**Feature Branch**: `9-platform-v2`
**Date**: 2026-03-10

---

## Prerequisites

### Environment
- Node.js 18+ and npm 9+
- AWS CLI configured with appropriate credentials
- Access to the project's AWS resources (RDS, ElastiCache, S3, ECS)
- GitHub CLI (`gh`) authenticated as `developerlabsai`

### Accounts & API Keys
- HubSpot private app access token (stored in `.env` as `HUBSPOT_API_KEY`)
- HubSpot portal ID (stored in `.env` as `HUBSPOT_PORTAL_ID`)
- Existing Slack bot token and app-level token (already configured)

### Key Environment Variables
```bash
# Existing (already in .env)
HUBSPOT_API_KEY=pat-xxx
HUBSPOT_PORTAL_ID=12345678
REDIS_URL=redis://...
DATABASE_URL=postgresql://...

# No new env vars required for this feature.
# Webhook secrets are generated per-endpoint and stored in the database.
```

---

## Setup

### 1. Install New Dependencies

```bash
cd /Users/developerlabsai/Projects/SLACK\ -\ Create\ Lists
npm install jaro-winkler
```

### 2. Run Database Migration

After updating `prisma/schema.prisma` with the new enums, models, and fields:

```bash
npx prisma migrate dev --name add_platform_v2_webhook_nodes
```

This creates:
- `WebhookEndpoint` table
- `WebhookLog` table
- `WEBHOOK` value in `WorkflowTriggerType` enum
- `HUBSPOT`, `PARSER`, `API_CALL` values in `WorkflowNodeType` enum
- `nodeProgress` and `webhookToken` columns on `workflow_executions`

### 3. Generate Prisma Client

```bash
npx prisma generate
```

### 4. Build and Deploy

Since the app cannot run locally (Socket Mode single-connection constraint), all testing is done through the deployed ECS service.

```bash
# Push to GitHub, CI/CD handles ECS deployment
git add .
git commit -m "feat(workflow): add platform v2 node extensions"
git push origin 9-platform-v2
```

### 5. Deploy Admin Dashboard (if frontend changes)

```bash
cd admin-dashboard && npm run build
aws s3 sync dist/ s3://slkadmin-developerlabs-ai/ --delete
aws cloudfront create-invalidation --distribution-id E30ZVBVU06GFUV --paths "/*"
```

---

## Testing Each New Node Type

### Testing the WEBHOOK Trigger

**1. Create a webhook-triggered workflow:**

In the admin dashboard (`https://dt9zhghz3mtx8.cloudfront.net`):
- Navigate to Workflows
- Create a new workflow
- Set the TRIGGER node type to "Webhook"
- Add downstream nodes (e.g., a MESSAGE node)
- Publish the workflow
- Note the generated webhook URL and HMAC secret displayed in the trigger config panel

**2. Send a valid webhook request:**

```bash
# Variables
WEBHOOK_URL="https://your-alb-url/api/webhooks/workflow/TOKEN_HERE"
WEBHOOK_SECRET="SECRET_HERE"
PAYLOAD='{"contacts":[{"email":"test@example.com","name":"Jane Doe"}]}'

# Compute HMAC signature
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

# Send request
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: sha256=$SIGNATURE" \
  -d "$PAYLOAD"
```

Expected response: `200 OK` with `{"executionId": "uuid", "status": "started"}`

**3. Send an invalid signature:**

```bash
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: sha256=invalidsignature" \
  -d "$PAYLOAD"
```

Expected response: `401 Unauthorized`

**4. Verify logs:**
- Check `WebhookLog` entries in the database
- Check CloudWatch logs for `webhook` entries

---

### Testing the HUBSPOT Node

**Import Mode:**

1. In the workflow builder, add a HUBSPOT node after a trigger
2. Set mode to "Import from HubSpot"
3. Enter a HubSpot list ID (get from HubSpot UI: Contacts > Lists > click list > ID in URL)
4. Publish and trigger the workflow
5. Verify: Execution context contains the imported contacts

```bash
# Check execution context via admin API
curl -s "https://your-alb-url/api/admin/workflows/executions/EXECUTION_ID" \
  -H "Authorization: Bearer YOUR_API_KEY" | jq '.context'
```

**Sync Mode:**

1. Add a HUBSPOT node set to "Sync to HubSpot" after an enrichment node
2. Configure field mapping (e.g., `firstName -> firstname`, `email -> email`)
3. Set fuzzy match threshold (default 85%)
4. Trigger workflow with enriched data
5. Verify in HubSpot:
   - New contacts are created for unmatched records
   - Existing contacts are updated for matched records
   - No duplicates created for known contacts

**Identity Resolution Test:**

1. Create a contact in HubSpot: `jane@acme.com`, company `Acme Inc`
2. Trigger workflow with data: `jane@acme.com`, company `ACME Inc.`
3. Verify: Existing contact is updated (not duplicated)
4. Trigger with: `john@acme.com`, company `Acme, Incorporated`
5. Verify: New contact created, associated with existing `Acme` company via fuzzy match

---

### Testing the PARSER Node

**JSON Parsing:**

1. Create workflow: Webhook trigger -> Parser -> Message
2. Configure Parser:
   - Parse mode: JSON
   - Root path: `data.contacts`
   - Field mapping: `email -> contactEmail`, `name -> fullName`
   - Transform: `properCase` on `fullName`, `normalizeDomain` on `domain`
   - Filter: `contactEmail is_not_empty`
3. Send webhook with payload:

```json
{
  "data": {
    "contacts": [
      {"email": "jane@acme.com", "name": "JANE DOE", "domain": "https://www.acme.com/"},
      {"email": "", "name": "orphan record", "domain": ""},
      {"email": "bob@test.com", "name": "bob smith", "domain": "test.com"}
    ]
  }
}
```

4. Verify execution context:
   - 2 records (orphan filtered out by `email is_not_empty`)
   - Names proper-cased: "Jane Doe", "Bob Smith"
   - Domains normalized: "acme.com", "test.com"

**CSV Parsing:**

1. Set parse mode to CSV
2. Provide CSV data in the upstream context variable
3. Verify headers are detected and rows are parsed correctly

---

### Testing the API_CALL Node

**Basic API Call:**

1. Create workflow: Webhook trigger -> API_CALL -> Message
2. Configure API_CALL:
   - Method: GET
   - URL: `https://jsonplaceholder.typicode.com/users/{{userId}}`
   - Auth: none
3. Send webhook with `{"userId": "1"}`
4. Verify: Response data is available in execution context

**Test Request (Schema Discovery):**

1. In the API_CALL config panel, click "Test Request"
2. Verify: Response JSON is displayed
3. Verify: Discovered schema shows available fields (e.g., `name`, `email`, `address.city`)
4. Map desired fields to context variables
5. Save and publish

**Retry Logic:**

1. Configure API_CALL with an intentionally unreachable URL
2. Trigger the workflow
3. Verify in logs: 3 retry attempts with exponential backoff
4. Verify: Node status is "failed" after exhausting retries

---

### Testing Enhanced Action Blocks

**Assign to Campaign:**

1. Create workflow: Trigger -> Enrichment -> Action (Assign to Campaign)
2. In Action config, select action type "Assign to Campaign"
3. Select an existing campaign from the dropdown
4. Trigger the workflow
5. Verify: Contacts appear in the campaign's contact list

**Get Email:**

1. Create workflow with Action type "Get Email"
2. Trigger with a contact that has no email
3. Verify: Enrichment job is queued to look up the email via Apollo

**Get Phone Numbers:**

1. Create workflow with Action type "Get Phone Numbers"
2. Trigger with a contact that has no phone
3. Verify: Async phone lookup is initiated via Apollo webhook pattern
4. Verify: PendingPhoneLookup record is created

---

### Testing Execution Progress Tracking

**Dashboard Progress:**

1. Create a workflow with a HUBSPOT Sync node processing 100+ contacts
2. Trigger the workflow
3. Open the execution detail page in the admin dashboard
4. Verify: Per-node progress bar updates in real time
5. Verify: Shows counts (processed/total, created, updated, failed)
6. Verify: Updates within 3 seconds of each batch completion

**Slack Progress:**

1. Trigger a workflow from Slack (via keyword or file upload)
2. During batch processing, check the Slack thread
3. Verify: Progress updates appear at least every 30 seconds
4. Verify: Final summary is posted when batch completes

**SSE Endpoint Test:**

```bash
curl -N "https://your-alb-url/api/admin/workflows/executions/EXECUTION_ID/progress" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Accept: text/event-stream"
```

Verify: Server-Sent Events stream with `data:` lines containing JSON progress objects.

---

## Verification Checklist

After each phase deployment, verify:

- [ ] Prisma migration applied successfully (`npx prisma migrate deploy`)
- [ ] No TypeScript compilation errors (`npm run build` succeeds)
- [ ] ECS service starts without errors (check CloudWatch logs)
- [ ] Admin dashboard loads without console errors
- [ ] New node types appear in the NodePalette
- [ ] Existing workflows continue to function (regression check)
- [ ] Webhook endpoints return correct HTTP status codes
- [ ] HubSpot operations respect rate limits (no 429 cascades)
- [ ] Progress bars render correctly in the dashboard
- [ ] Slack messages format correctly (no broken Block Kit)

## Debugging Tips

### CloudWatch Logs
```bash
# Tail ECS logs
aws logs tail /ecs/prod-slack-list-processor --follow --since 5m
```

### Database Inspection
```bash
# Check webhook endpoints
npx prisma studio
# Navigate to WebhookEndpoint table

# Or via psql
psql $DATABASE_URL -c "SELECT id, token, status, total_calls FROM webhook_endpoints;"
```

### Redis Inspection
```bash
# Check progress pub/sub channels
redis-cli PUBSUB CHANNELS "workflow:progress:*"
```

### HubSpot API Testing
```bash
# Verify HubSpot connectivity
curl -s "https://api.hubapi.com/crm/v3/objects/contacts?limit=1" \
  -H "Authorization: Bearer $HUBSPOT_API_KEY" | jq '.results | length'
```
