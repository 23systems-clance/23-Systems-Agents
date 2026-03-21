# Quickstart: Multi-Provider Waterfall Enrichment

**Feature**: 27-waterfall-enrichment
**Date**: 2026-03-14
**Phase**: Phase 1 (Design)

## Overview

This guide provides setup instructions for the multi-provider waterfall enrichment feature. **IMPORTANT**: Per Constitution Principle XV, this service runs **exclusively on AWS ECS Fargate**. There is NO local development server.

---

## Prerequisites

### Required Accounts
- [ ] **Wiza.co account** with API access enabled
- [ ] **AI Ark account** with API access enabled
- [ ] **Apollo.io account** (existing)
- [ ] **Findymail account** with API access enabled (for email verification)
- [ ] **AWS account** with ECS, RDS, ElastiCache, and S3 access

### Required Tools
- [ ] AWS CLI configured
- [ ] Node.js 18+ (for local build testing only)
- [ ] Prisma CLI (`npm install -g prisma`)
- [ ] Git with `developerlabsai` GitHub account configured

---

## Environment Variables

### Provider API Keys

Add to ECS task definition via AWS CLI or CloudFormation:

```bash
# Wiza
WIZA_API_KEY=your_wiza_bearer_token_here

# AI Ark
AI_ARK_API_KEY=your_aiark_x_token_here

# Apollo (existing)
APOLLO_API_KEY=your_apollo_api_key_here

# Findymail (email verification)
FINDYMAIL_API_KEY=your_findymail_bearer_token_here
```

### Webhook Configuration

```bash
# Webhook base URL (ECS ALB endpoint)
WEBHOOK_BASE_URL=https://prod-slp-alb-2025872532.us-east-1.elb.amazonaws.com

# Webhook secrets (for signature verification)
WIZA_WEBHOOK_SECRET=sha256_of_wiza_api_key
AI_ARK_WEBHOOK_SECRET=your_aiark_webhook_secret_here
```

### Provider Configuration

```bash
# Waterfall settings
MAX_CONTACTS_PER_JOB=2000
PROVIDER_TIMEOUT_MS=5000
WEBHOOK_TIMEOUT_MS=300000  # 5 minutes

# Cache settings
ENRICHMENT_CACHE_TTL=2592000  # 30 days in seconds
```

---

## Database Setup

### 1. Create Prisma Migration

**IMPORTANT**: Never run migrations locally. Apply via ECS task or AWS RDS console.

```bash
# Generate migration file (local build verification only)
cd /Users/developerlabsai/Projects/SLACK\ -\ Create\ Lists
npx prisma migrate dev --name add_waterfall_enrichment --create-only

# Review generated migration at:
# prisma/migrations/YYYYMMDDHHMMSS_add_waterfall_enrichment/migration.sql
```

### 2. Apply Migration to AWS RDS

**Option A: Via ECS Task** (Recommended)
```bash
# SSH into running ECS task
aws ecs execute-command \
  --cluster prod-slack-list-processor \
  --task <task-id> \
  --container slack-list-processor \
  --command "/bin/bash" \
  --interactive

# Inside container
npx prisma migrate deploy
```

**Option B: Via Bastion Host**
```bash
# Connect to bastion host
ssh -i ~/.ssh/aws-bastion.pem ec2-user@<bastion-ip>

# Connect to RDS
psql -h <rds-endpoint> -U <username> -d slack_list_processor

# Manually run migration SQL from prisma/migrations/...
```

### 3. Seed Provider Pricing

```bash
# Inside ECS task or bastion host
npx ts-node scripts/seed-provider-pricing.ts
```

**Script content** (`scripts/seed-provider-pricing.ts`):
```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedProviderPricing() {
  const pricing = [
    { provider: 'APOLLO', dataType: 'EMAIL', costPerUnit: 0.05 },
    { provider: 'WIZA', dataType: 'EMAIL', costPerUnit: 0.05, creditsPerUnit: 2 },
    { provider: 'WIZA', dataType: 'PHONE', costPerUnit: 0.125, creditsPerUnit: 5 },
    { provider: 'AI_ARK', dataType: 'EMAIL', costPerUnit: 0.14 },
    { provider: 'AI_ARK', dataType: 'PHONE', costPerUnit: 0.27 },
  ];

  for (const p of pricing) {
    await prisma.providerCost.upsert({
      where: {
        provider_dataType_effectiveDate: {
          provider: p.provider as any,
          dataType: p.dataType as any,
          effectiveDate: new Date('2026-03-14'),
        },
      },
      create: {
        provider: p.provider as any,
        dataType: p.dataType as any,
        costPerUnit: p.costPerUnit,
        creditsPerUnit: p.creditsPerUnit,
        notes: 'Initial waterfall enrichment pricing',
      },
      update: {},
    });
  }

  console.log('Provider pricing seeded successfully');
}

seedProviderPricing()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

---

## Webhook Configuration

### Wiza Webhook Setup

1. Log into Wiza account
2. Navigate to **Settings → API**
3. Configure default webhook URL:
   ```
   https://prod-slp-alb-2025872532.us-east-1.elb.amazonaws.com/api/webhooks/wiza/enrichment-results
   ```
4. Enable "Send All Callbacks"
5. Copy API key for `WIZA_API_KEY` environment variable

**Signature Verification**:
- Wiza sends `x-auth-key` header
- Value is SHA256 hash of API key
- Verify: `SHA256(WIZA_API_KEY).hexdigest() === req.headers['x-auth-key']`

### AI Ark Webhook Setup

1. Log into AI Ark account
2. Navigate to **Settings → Webhooks**
3. Add webhook URL:
   ```
   https://prod-slp-alb-2025872532.us-east-1.elb.amazonaws.com/api/webhooks/aiark/enrichment-results
   ```
4. Save webhook secret for `AI_ARK_WEBHOOK_SECRET` environment variable
5. Copy API key for `AI_ARK_API_KEY` environment variable

**Signature Verification**:
- AI Ark sends `x-webhook-signature` header
- HMAC-SHA256: `HMAC-SHA256(timestamp.payload, secret).hexdigest()`
- Include `x-webhook-timestamp` header for replay attack prevention

---

## Build & Deploy

### 1. Build Docker Image

```bash
# From repository root
cd /Users/developerlabsai/Projects/SLACK\ -\ Create\ Lists

# Build TypeScript
npm run build

# Build Docker image
docker build -t slack-list-processor:27-waterfall-enrichment .
```

### 2. Push to ECR

```bash
# Authenticate with ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Tag image
docker tag slack-list-processor:27-waterfall-enrichment <account-id>.dkr.ecr.us-east-1.amazonaws.com/slack-list-processor:27-waterfall-enrichment

# Push to ECR
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/slack-list-processor:27-waterfall-enrichment
```

### 3. Update ECS Task Definition

```bash
# Update task definition with new image
aws ecs register-task-definition \
  --cli-input-json file://infra/ecs-task-definition.json

# Force new deployment
aws ecs update-service \
  --cluster prod-slack-list-processor \
  --service slack-list-processor-service \
  --force-new-deployment
```

**OR** use GitHub Actions CI/CD (preferred):
```bash
# Just push to branch
git push origin 27-waterfall-enrichment

# GitHub Actions will:
# 1. Build Docker image
# 2. Push to ECR
# 3. Update ECS task definition
# 4. Force new deployment
```

---

## Testing

### Unit Tests

```bash
# Run locally (tests only, not the app)
npm run test

# Run specific test file
npm run test -- src/services/enrichment/waterfall.test.ts

# Watch mode
npm run test:watch
```

### Integration Tests (AWS ECS)

**IMPORTANT**: All integration testing must be against deployed AWS service.

#### 1. Test Email Waterfall

```bash
# Upload a contact list CSV to Slack channel
# Contains: Full Name, Company Domain
# Example: John Doe, company.com

# Trigger enrichment in Slack:
ENRICH
→ Select "Contact List"
→ Select "Email Only"
→ Wait for completion

# Verify CloudWatch logs:
aws logs tail /ecs/prod-slack-list-processor --follow

# Expected logs:
# - "Waterfall enrichment started: email_only"
# - "Apollo enrichment: 60/100 found"
# - "Wiza enrichment: 30/40 found" (for Apollo misses)
# - "AI Ark enrichment: 5/10 found" (for Wiza misses)
# - "Waterfall complete: 95/100 total emails found"
```

#### 2. Test Phone Waterfall (Async)

```bash
# Upload a contact list CSV with emails
# Trigger enrichment in Slack:
ENRICH
→ Select "Contact List"
→ Select "Mobile Number"
→ Wait for initial completion (emails delivered)
→ Wait 5-15 minutes for phone webhooks

# Verify webhook delivery:
# Check CloudWatch logs for:
# - "Wiza webhook received: request_id=123"
# - "Phone data processed: 40 phones via Wiza"
# - "AI Ark webhook received: request_id=456"
# - "Phone data processed: 15 phones via AI Ark"
# - "File regenerated with phone numbers"
```

#### 3. Test Cost Tracking

```bash
# After enrichment completes, query database:
SELECT
  p.provider,
  p.dataType,
  COUNT(*) as attempts,
  SUM(p.cost) as total_cost
FROM "ProviderAttempt" p
WHERE p.jobId = '<job-id>'
GROUP BY p.provider, p.dataType;

# Expected output:
# provider | dataType | attempts | total_cost
# ---------|----------|----------|------------
# APOLLO   | EMAIL    | 100      | 3.00 (60 found × $0.05)
# WIZA     | EMAIL    | 40       | 1.50 (30 found × $0.05)
# WIZA     | PHONE    | 100      | 5.00 (40 found × $0.125)
# AI_ARK   | EMAIL    | 10       | 0.70 (5 found × $0.14)
# AI_ARK   | PHONE    | 60       | 4.05 (15 found × $0.27)
```

#### 4. Test Email Verification (Findymail)

```bash
# Upload a contact list CSV to Slack channel
# Trigger enrichment in Slack:
ENRICH
→ Select "Contact List"
→ Select "Email Only"
→ Wait for email waterfall to complete
→ When prompted, click "Verify Emails"
→ Wait for verification to complete

# Verify CloudWatch logs:
aws logs tail /ecs/prod-slack-list-processor --follow

# Expected logs:
# - "Email waterfall complete: 95/100 emails found"
# - "Email verification quality gate: presenting prompt"
# - "User selected: Verify Emails"
# - "Email verification started: 95 emails via Findymail"
# - "Findymail verification: 80/95 verified, 15/95 unverified"
# - "Verification complete, generating file with Email Verified column"

# Verify output file contains:
# - "Email Verified" column with "true"/"false" values
# - "Email Provider" column with provider names (Google, Microsoft, etc.)
```

#### 5. Test Email Verification Skip

```bash
# Same as above but click "Do Not Verify"
# Expected:
# - No Findymail API calls
# - File generated immediately without verification columns
# - CloudWatch log: "User skipped email verification"
```

#### 6. Test Provider Fallback

```bash
# Test scenario: Apollo fails, Wiza succeeds

# Temporarily break Apollo API key:
aws ecs update-service \
  --cluster prod-slack-list-processor \
  --task-definition <task-def-arn> \
  --environment-overrides APOLLO_API_KEY=invalid_key \
  --force-new-deployment

# Trigger enrichment
# Expected behavior:
# - Apollo attempts fail (100% failures)
# - Wiza picks up all 100 contacts
# - CloudWatch logs show "Apollo failed, continuing to Wiza"

# Restore Apollo API key afterward
```

---

## Monitoring

### CloudWatch Logs

```bash
# Follow live logs
aws logs tail /ecs/prod-slack-list-processor --follow

# Filter for waterfall events
aws logs filter-log-events \
  --log-group-name /ecs/prod-slack-list-processor \
  --filter-pattern "waterfall"

# Filter for webhook events
aws logs filter-log-events \
  --log-group-name /ecs/prod-slack-list-processor \
  --filter-pattern "webhook"
```

### Key Log Events

```json
// Waterfall start
{
  "event": "waterfall_started",
  "jobId": "uuid",
  "mode": "email_only",
  "contacts": 100
}

// Provider attempt
{
  "event": "provider_attempt",
  "jobId": "uuid",
  "provider": "apollo",
  "dataType": "email",
  "contactId": "uuid",
  "status": "success",
  "cost": 0.05
}

// Webhook received
{
  "event": "webhook_received",
  "provider": "wiza",
  "requestId": "123",
  "webhookId": "abc",
  "phoneCount": 5
}

// Waterfall complete
{
  "event": "waterfall_complete",
  "jobId": "uuid",
  "totalCost": 14.25,
  "emailsFound": 95,
  "phonesFound": 55
}
```

### Metrics to Track

- **Provider success rate**: `(SUCCESS attempts / total attempts) per provider`
- **Cost per job**: `SUM(ProviderAttempt.cost) WHERE jobId = X`
- **Webhook latency**: `ProviderWebhook.processedAt - ProviderWebhook.receivedAt`
- **Waterfall efficiency**: `Contacts enriched by 1st provider / total contacts` (higher is better)

---

## Troubleshooting

### Webhooks Not Arriving

**Symptom**: Job stuck in `AWAITING_PHONES` status

**Diagnosis**:
```bash
# Check if webhooks are configured
aws elbv2 describe-rules \
  --listener-arn <alb-listener-arn>

# Verify ALB security group allows inbound HTTPS
aws ec2 describe-security-groups \
  --group-ids <alb-security-group-id>
```

**Fix**:
1. Verify webhook URL is HTTPS (not HTTP)
2. Check ALB listener has HTTPS rule for `/api/webhooks/*`
3. Test webhook manually:
   ```bash
   curl -X POST https://prod-slp-alb-2025872532.us-east-1.elb.amazonaws.com/api/webhooks/wiza/enrichment-results \
     -H "Content-Type: application/json" \
     -H "x-auth-key: $(echo -n $WIZA_API_KEY | shasum -a 256 | cut -d' ' -f1)" \
     -d '{"status":{"code":200},"data":{"id":123,"status":"finished"}}'
   ```

### Provider API Failures

**Symptom**: High failure rate for specific provider

**Diagnosis**:
```sql
-- Check error distribution
SELECT
  provider,
  errorMessage,
  COUNT(*) as error_count
FROM "ProviderAttempt"
WHERE status = 'FAILED'
  AND createdAt > NOW() - INTERVAL '1 hour'
GROUP BY provider, errorMessage
ORDER BY error_count DESC;
```

**Fix**:
- **401 Unauthorized**: Check API key in ECS task definition
- **429 Too Many Requests**: Reduce concurrency or add rate limiting
- **500 Internal Server Error**: Provider outage - check status page

### High Costs

**Symptom**: Costs higher than expected

**Diagnosis**:
```sql
-- Cost breakdown by provider
SELECT
  provider,
  dataType,
  COUNT(*) as total_attempts,
  SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as successful_attempts,
  SUM(cost) as total_cost,
  AVG(cost) as avg_cost_per_attempt
FROM "ProviderAttempt"
WHERE createdAt > NOW() - INTERVAL '1 day'
GROUP BY provider, dataType;
```

**Fix**:
1. **Too many attempts**: Ensure cache is working (check Redis connectivity)
2. **Wrong waterfall order**: Verify AI Ark is last (most expensive)
3. **Duplicate contacts**: Confirm deduplication logic is working

---

## Security

### API Key Rotation

**Findymail**:
```bash
# Generate new API key in Findymail account (https://app.findymail.com)
# Update ECS task definition
aws ecs update-service \
  --cluster prod-slack-list-processor \
  --task-definition <task-def-arn> \
  --environment-overrides FINDYMAIL_API_KEY=new_key \
  --force-new-deployment
```

**Wiza**:
```bash
# Generate new API key in Wiza account
# Update ECS task definition
aws ecs update-service \
  --cluster prod-slack-list-processor \
  --task-definition <task-def-arn> \
  --environment-overrides WIZA_API_KEY=new_key \
  --force-new-deployment

# Update webhook signature verification
# (SHA256 hash of new key)
```

**AI Ark**:
```bash
# Same process as Wiza
# Also update AI_ARK_WEBHOOK_SECRET if webhook secret changes
```

### Webhook Signature Verification

**Always verify signatures** to prevent unauthorized webhook injection:

```typescript
// Wiza (SHA256 hash)
const expectedHash = crypto.createHash('sha256').update(WIZA_API_KEY).digest('hex');
const receivedHash = req.headers['x-auth-key'];
if (!crypto.timingSafeEqual(Buffer.from(expectedHash), Buffer.from(receivedHash))) {
  return res.status(401).send('Unauthorized');
}

// AI Ark (HMAC-SHA256)
const timestamp = req.headers['x-webhook-timestamp'];
const payload = req.body;
const expectedSig = crypto.createHmac('sha256', AI_ARK_WEBHOOK_SECRET)
  .update(`${timestamp}.${JSON.stringify(payload)}`)
  .digest('hex');
const receivedSig = req.headers['x-webhook-signature'];
if (!crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(receivedSig))) {
  return res.status(401).send('Unauthorized');
}
```

---

## Next Steps

1. **Update spec pricing**: Correct Wiza pricing in FR-011 ($0.05/email, $0.125/phone)
2. **Confirm AI Ark pricing**: Contact sales to verify $0.14/email, $0.27/phone estimates
3. **Confirm Findymail pricing**: Check Findymail account pricing page for per-verification cost
4. **Proceed to /speckit.tasks**: Generate implementation tasks from this plan
5. **Deploy to staging**: Test waterfall enrichment in non-production environment (if available)
6. **Monitor costs**: Track actual vs. expected costs for first 100 jobs

---

## Resources

- [Findymail API Docs](https://app.findymail.com/docs/)
- [Wiza API Docs](https://docs.wiza.co/)
- [AI Ark API Docs](https://docs.ai-ark.com/)
- [Apollo API Docs](https://www.apollo.io/api/)
- [Prisma Docs](https://www.prisma.io/docs/)
- [BullMQ Docs](https://docs.bullmq.io/)
- [AWS ECS Docs](https://docs.aws.amazon.com/ecs/)
