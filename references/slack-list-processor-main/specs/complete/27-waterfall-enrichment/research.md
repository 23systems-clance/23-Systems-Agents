# Research: Multi-Provider Waterfall Enrichment

**Feature**: 27-waterfall-enrichment
**Date**: 2026-03-14
**Research Phase**: Phase 0 (Pre-Design)

## Summary

Comprehensive research into Wiza.co and AI Ark APIs for contact enrichment, plus webhook best practices for async phone number delivery. Research confirms feasibility of waterfall enrichment with sequential provider fallback and identifies critical implementation requirements.

---

## 1. Wiza API Integration

### Authentication
**Decision**: Bearer Token authentication via `Authorization` header
**Rationale**: Industry-standard OAuth-style authentication, simple to implement
**Configuration**: API key obtained from Wiza account settings (Settings → API)

```typescript
headers: {
  'Authorization': `Bearer ${process.env.WIZA_API_KEY}`,
  'Content-Type': 'application/json'
}
```

### Email Enrichment
**Endpoint**: `POST https://wiza.co/api/individual_reveals`
**Enrichment Levels**:
- `partial`: Email only (2 credits if found)
- `phone`: Phone only (5 credits if found)
- `full`: Email + phone (7 credits total if both found)

**Request Format**:
```json
{
  "individual_reveal": {
    "full_name": "John Doe",
    "domain": "company.com"
  },
  "enrichment_level": "partial",
  "callback_url": "https://your-domain.com/webhooks/wiza"
}
```

**Response** (Async):
- Returns `{ data: { id: 32, status: "queued" } }`
- Results delivered via webhook when `status: "finished"`

### Phone Enrichment
**Same endpoint** with `enrichment_level: "phone"` or `"full"`
**Input options**:
1. LinkedIn URL: `profile_url`
2. Email: `email`
3. Name + domain: `full_name` + `domain`

**Phone Response**:
```json
{
  "mobile_phone": "+1 (555) 123-4567",
  "phone_status": "found",
  "phones": [
    {
      "number": "15551234567",
      "pretty_number": "+1 (555) 123-4567",
      "type": "mobile"
    }
  ]
}
```

### Webhook Configuration
**Method**: Per-request `callback_url` parameter (preferred) OR account-level default
**Security**: `x-auth-key` header with SHA256 hash of API key
**Payload**: Same structure as GET reveal response
**Retry Policy**: Up to 3 retries if non-2xx response

**Verification Pattern**:
```typescript
const crypto = require('crypto');
const receivedHash = req.headers['x-auth-key'];
const expectedHash = crypto.createHash('sha256').update(API_KEY).digest('hex');
const isValid = crypto.timingSafeEqual(Buffer.from(receivedHash), Buffer.from(expectedHash));
```

### Rate Limits
- **Individual Reveal**: 15 requests/second
- **HTTP 429** returned when exceeded
- **Handling**: Exponential backoff (2^attempt × 1000ms)

### Pricing (**CORRECTED**)
**CRITICAL**: Original spec pricing was **incorrect**. Actual Wiza pricing:
- **Email**: 2 credits × $0.025 = **$0.05/email** (NOT $0.15)
- **Phone**: 5 credits × $0.025 = **$0.125/phone** (NOT $0.35)
- **Credit cost**: $0.025 per credit
- **Minimum purchase**: 2,000 credits ($50)

**Action Required**: Update FR-011 in spec with corrected pricing before implementation.

### Alternatives Considered
- **Polling-based**: Could poll `GET /api/individual_reveals/{id}` but webhooks are more efficient
- **Batch API**: Wiza has batch endpoints but individual reveals better for waterfall (fail fast to next provider)

---

## 2. AI Ark API Integration

### Authentication
**Decision**: Custom `X-TOKEN` header (NOT standard Bearer)
**Rationale**: AI Ark uses proprietary auth header
**Configuration**: API key from AI Ark account settings

```typescript
headers: {
  'X-TOKEN': process.env.AI_ARK_API_KEY,
  'Content-Type': 'application/json'
}
```

### Mobile Phone Finder API
**Endpoint**: `POST https://api.ai-ark.com/api/developer-portal/v1/people/mobile-phone-finder`
**Request Format**:
```json
{
  "type": "mobile",
  "linkedin_url": "https://linkedin.com/in/profile"
  // OR
  "domain": "company.com",
  "first_name": "John",
  "last_name": "Doe"
}
```

**Response Format**:
```json
{
  "phone_number": "+1234567890",
  "type": "mobile",
  "confidence_score": 0.95
}
```

### Email Enrichment API
**Endpoint**: `POST https://api.ai-ark.com/api/developer-portal/v1/people/export-email`
**Pattern**: Async export with `track_id` for results retrieval
**Feature**: Emails verified and refreshed every 30 days

**Alternative**: Use Wiza for emails (better pricing at $0.05 vs AI Ark's credit model)

### Credit Fetch API
**Endpoint**: `GET https://api.ai-ark.com/api/developer-portal/v1/payments/credits`
**Purpose**: Check remaining credits before bulk operations
**Response** (inferred):
```json
{
  "total_credits": 10000,
  "used_credits": 2500,
  "remaining_credits": 7500
}
```

### Webhook Support
**Status**: ✅ Supported for async operations
**Endpoints**:
- Export People Webhook
- Find Emails Webhook

**Resend Capability**: `PATCH /webhooks/export/resend`

**Payload Format**: Documentation references exist but exact schema requires account access (assume Apollo-compatible format per spec FR-007)

### Rate Limits
- **5 requests/second**
- **300 requests/minute**
- **18,000 requests/hour**
- **HTTP 429** on exceeding limits

### Pricing (**ESTIMATES**)
**Note**: Exact per-lookup costs not publicly documented
**Estimated** (from spec):
- **Email**: ~$0.14/email (based on credit model)
- **Phone**: ~$0.27/phone (based on credit model)

**Credit System**:
- Different credit types: Export Credits vs Verified Email Credits
- Free trial: 100 credits
- Basic plan: 10,000 export credits

**Action Required**: Contact AI Ark sales to confirm exact per-lookup pricing for cost tracking (FR-011).

### Alternatives Considered
- **Synchronous API**: AI Ark could support sync but async webhooks align with Wiza pattern
- **MCP Server**: AI Ark offers MCP server but not suitable for bulk automation (see spec Out of Scope)

---

## 3. Webhook Best Practices

### Security Pattern: HMAC Signature Verification
**Decision**: Implement HMAC SHA-256 signature verification for all webhooks
**Rationale**: Industry best practice, prevents unauthorized webhook injection

**Implementation**:
```typescript
const verifySignature = (req, secret) => {
  const receivedSignature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];

  // Prevent replay attacks (5-minute window)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    throw new Error('Timestamp expired');
  }

  // Calculate HMAC using raw body
  const computed = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  // Constant-time comparison (prevent timing attacks)
  return crypto.timingSafeEqual(
    Buffer.from(receivedSignature),
    Buffer.from(computed)
  );
};
```

**Wiza Exception**: Wiza uses SHA256 hash of API key (not HMAC), handle separately.

### Timeout Strategy: Immediate Response + Queue
**Decision**: Respond to webhook within 5 seconds, process asynchronously via BullMQ
**Rationale**: Prevents provider timeout, allows retry handling, scales better

**Pattern**:
```typescript
app.post('/webhooks/wiza', async (req, res) => {
  // 1. Verify signature
  if (!verifyWizaSignature(req)) {
    return res.status(401).send('Unauthorized');
  }

  // 2. Acknowledge receipt immediately
  res.status(200).json({ received: true });

  // 3. Enqueue for async processing
  await phoneDataQueue.add('process-wiza-webhook', req.body, {
    jobId: req.body.data.id, // Idempotency
  });
});
```

### Idempotency: Job ID + DB Deduplication
**Decision**: Use webhook ID as BullMQ job ID + DB unique constraint
**Rationale**: Prevents duplicate processing if provider retries webhook

**Implementation**:
```typescript
// BullMQ idempotency
await queue.add('process-webhook', payload, {
  jobId: payload.metadata.webhookId, // Duplicate jobs ignored
});

// Database idempotency
await prisma.webhookEvent.upsert({
  where: { webhookId: payload.metadata.webhookId },
  create: { /* ... */ },
  update: {}, // No-op if already exists
});
```

### Retry Logic: Exponential Backoff with Jitter
**Decision**: BullMQ default retry with exponential backoff
**Rationale**: Prevents thundering herd, improves success rate

**Configuration**:
```typescript
defaultJobOptions: {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 2000, // Start with 2 seconds
  },
}
```

**Attempt delays**: 2s, 4s, 8s, 16s, 32s

### Payload Validation: JSON Schema + TypeScript
**Decision**: Use AJV for runtime validation with TypeScript types
**Rationale**: Catch malformed payloads early, type safety

**Pattern**:
```typescript
interface WizaWebhookPayload {
  status: { code: number; message: string };
  data: {
    id: number;
    status: 'finished' | 'failed';
    email?: string;
    mobile_phone?: string;
  };
}

const schema: JSONSchemaType<WizaWebhookPayload> = { /* ... */ };
const validate = ajv.compile(schema);

if (!validate(req.body)) {
  return res.status(400).json({ error: 'Invalid payload', details: validate.errors });
}
```

### Error Handling: Dead Letter Queue
**Decision**: Move failed jobs (after 5 retries) to DLQ for manual review
**Rationale**: Prevents lost data, enables debugging

**Implementation**:
```typescript
worker.on('failed', async (job, error) => {
  if (job.attemptsMade >= 5) {
    await prisma.webhookFailure.create({
      data: {
        webhookId: job.data.metadata.webhookId,
        payload: job.data,
        errorMessage: error.message,
        attempts: job.attemptsMade,
      },
    });
  }
});
```

### Monitoring: Structured Logging + SLO Tracking
**Decision**: Use Pino for structured logs, track error rate + queue depth SLOs
**Rationale**: SOC 2 compliance (Principle V), operational visibility

**SLO Targets**:
- Error rate: <5%
- Queue depth: <5,000 jobs
- Processing duration: p95 <500ms

**Logging Pattern**:
```typescript
logger.info({
  event: 'webhook_processed',
  webhookId: payload.metadata.webhookId,
  provider: 'wiza',
  duration: processingDuration,
  status: 'success',
});
```

---

## 4. Waterfall Orchestration Strategy

### Sequential Provider Fallback
**Decision**: Try providers sequentially, stop on success
**Rationale**: Cost efficiency (FR-003), simple logic, predictable behavior

**Email Waterfall**: Apollo → Wiza → AI Ark
**Phone Waterfall**: Wiza → AI Ark (Apollo excluded per spec assumptions)

**Algorithm**:
```typescript
async function enrichEmail(contact: Contact): Promise<string | null> {
  // Try Apollo first (cheapest at $0.05)
  const apolloEmail = await apolloClient.findEmail(contact);
  if (apolloEmail) return apolloEmail;

  // Try Wiza second (same price as Apollo after correction: $0.05)
  const wizaEmail = await wizaClient.findEmail(contact);
  if (wizaEmail) return wizaEmail;

  // Try AI Ark last (most expensive at ~$0.14)
  const aiArkEmail = await aiArkClient.findEmail(contact);
  return aiArkEmail;
}
```

### Skip Contacts with Existing Data
**Decision**: Check for existing email/phone before enrichment
**Rationale**: FR-026 - saves credits, respects existing data

**Implementation**:
```typescript
const contactsNeedingEmail = contacts.filter(c => !c.email);
const contactsNeedingPhone = contacts.filter(c => !c.directPhone && !c.businessPhone);
```

### Provider Cost Tracking
**Decision**: Track which provider found each data point in ProviderAttempt table
**Rationale**: FR-004 - accurate cost attribution for cost breakdown (FR-010)

**Schema** (preview):
```typescript
model ProviderAttempt {
  id          String   @id @default(uuid())
  jobId       String
  contactId   String
  provider    Provider // APOLLO, WIZA, AI_ARK
  dataType    DataType // EMAIL, PHONE
  status      AttemptStatus // SUCCESS, FAILED, SKIPPED
  cost        Float?
  createdAt   DateTime @default(now())
}
```

### Cache Strategy: Provider-Aware
**Decision**: Cache enriched data with provider metadata in Redis
**Rationale**: FR-015 - avoid re-enrichment, FR-023 - prioritize cached data

**Cache Key Pattern**: `enrichment:{email|phone}:{domain}:{name}`
**TTL**: 30 days (align with AI Ark email refresh cycle)

**Cache Entry**:
```json
{
  "email": "john@company.com",
  "provider": "apollo",
  "cost": 0.05,
  "timestamp": 1710412800,
  "ttl": 2592000
}
```

---

## 5. Implementation Decisions

### Webhook Endpoints
**Decision**: Create separate routes for each provider
**Rationale**: Different authentication methods, easier to debug

**Routes**:
- `/api/webhooks/apollo/phone-results` (existing)
- `/api/webhooks/wiza/enrichment-results` (new)
- `/api/webhooks/aiark/enrichment-results` (new)

### BullMQ Workers
**Decision**: Single `provider-enrichment` worker handles all waterfalls
**Rationale**: Shared logic, easier state management

**Queue**: `provider-enrichment` queue with job types:
- `email-waterfall`
- `phone-waterfall`

### Real-Time Status Updates
**Decision**: Update single Slack message in-place using `chat.update` API
**Rationale**: FR-020 - keeps thread clean, better UX

**Status Format**: `Apollo: ✓ 60 | Wiza: ⏳ processing | AI Ark: ⏸ standby`

### Error Handling: Partial Success
**Decision**: Continue waterfall even if one provider fails
**Rationale**: FR-016 - graceful degradation, maximize enrichment coverage

**Pattern**:
```typescript
try {
  email = await apolloClient.findEmail(contact);
} catch (error) {
  logger.warn({ provider: 'apollo', error }, 'Provider failed, continuing to Wiza');
  email = await wizaClient.findEmail(contact);
}
```

---

## 6. Open Questions & Actions

### Pricing Confirmation
- [ ] **Contact Wiza**: Confirm $0.05/email and $0.125/phone pricing (research shows $0.05 and $0.125, spec says $0.15 and $0.35)
- [ ] **Contact AI Ark**: Confirm exact per-lookup costs for email/phone (spec estimates $0.14/email, $0.27/phone)
- [ ] **Update spec FR-011**: Replace estimated pricing with confirmed rates

### Webhook Payload Format
- [ ] **Confirm Wiza webhook payload**: Matches GET reveal response format (research confirms this)
- [ ] **Confirm AI Ark webhook payload**: Should be Apollo-compatible per spec FR-007 (need account access to verify)

### Provider Selection Order
- [ ] **Email waterfall**: Apollo → Wiza → AI Ark (prices now equal after Wiza correction: both $0.05, AI Ark $0.14)
- [ ] **Consider**: Swap order to Wiza → Apollo → AI Ark? (Both same price, choose based on quality/speed)

### Wiza vs Apollo for Email
**New consideration** after pricing research: Wiza is **same price** as Apollo ($0.05/email), not more expensive. Should we:
- **Option A**: Keep Apollo first (existing integration, familiar)
- **Option B**: Try Wiza first (may have fresher data)
- **Option C**: Run both in parallel and take first response (costs more but faster)

**Recommendation**: Keep Apollo → Wiza → AI Ark order (Apollo already integrated, battle-tested).

---

## 6. Findymail Email Verification API (US6 Addition)

**Added**: 2026-03-15
**Purpose**: Email verification quality gate — optional deliverability check after email enrichment

### Authentication
**Decision**: Bearer Token authentication via `Authorization` header
**Rationale**: Standard REST API authentication pattern

```typescript
headers: {
  'Authorization': `Bearer ${process.env.FINDYMAIL_API_KEY}`,
  'Content-Type': 'application/json'
}
```

### Email Verification Endpoint
**Endpoint**: `POST https://app.findymail.com/api/verify`
**Type**: Synchronous (immediate response, no webhook needed)

**Request Format**:
```json
{
  "email": "john@company.com"
}
```

**Response Format**:
```json
{
  "email": "john@company.com",
  "verified": true,
  "provider": "Google"
}
```

**Response Fields**:
- `email`: The email address that was verified
- `verified`: Boolean — `true` if email is deliverable, `false` if not
- `provider`: String — email provider name (e.g., "Google", "Microsoft", "Yahoo")

### Rate Limits
- **300 concurrent requests** (default)
- Process in batches to stay within limits
- Recommended: 200 concurrent requests with 100 buffer

### Pricing
- **Cost per verification**: TBD (confirm from Findymail account pricing page)
- **Note**: Only charged when user opts into "Verify Emails" quality gate

### Integration Pattern
**Decision**: Quality gate pattern (same as DNC scrub for phones)
**Rationale**: User chooses whether to verify; follows existing established pattern

**Flow**:
```
Email waterfall completes → AWAITING_EMAIL_VERIFICATION
  → User clicks "Verify Emails" → Run verification → Add columns → File generation
  → User clicks "Do Not Verify" → Skip verification → File generation
```

**Key Differences from DNC Scrub**:
- DNC scrub **removes** flagged phones (nulls them out)
- Email verification **marks** unverified emails but keeps them in the file
- Email verification adds 2 columns: "Email Verified" (true/false) and "Email Provider" (Google, etc.)
- Verification results are NOT cached (always run fresh per FR clarification)

### Batch Processing Strategy
**Decision**: Process emails in concurrent batches of 200 (within 300 limit)
**Rationale**: Balances throughput vs rate limit safety margin

```typescript
const BATCH_SIZE = 200;
const emails = contacts.filter(c => c.email).map(c => c.email);

for (let i = 0; i < emails.length; i += BATCH_SIZE) {
  const batch = emails.slice(i, i + BATCH_SIZE);
  const results = await Promise.all(
    batch.map(email => findymailClient.verify(email))
  );
  // Update progress: "Verifying emails... X/Y complete"
  await updateSlackProgress(i + batch.length, emails.length);
}
```

### Error Handling
- **API key not configured**: Skip verification prompt entirely (FR-034)
- **API errors for individual emails**: Mark as "unknown" in Email Verified column
- **API down entirely**: Notify user of failure, proceed to file generation without verification

### Alternatives Considered
- **Batch verification API**: Findymail may offer batch endpoints but single-email endpoint is simpler and provides immediate per-email results
- **Alternative providers**: ZeroBounce, NeverBounce, Hunter.io — Findymail chosen by user preference
- **Automatic rejection**: Considered removing unverified emails automatically but decided to keep them marked false (user decides)

---

## 7. Sources

### Wiza API
- [Wiza API Documentation](https://docs.wiza.co/)
- [Wiza Individual Reveal API](https://docs.wiza.co/api-reference/individual-reveals/start-individual-reveal)
- [Wiza Webhooks](https://docs.wiza.co/using-the-api/webhooks)
- [Wiza Pricing & Credits](https://help.wiza.co/en/articles/13551713-how-to-purchase-api-credits)

### AI Ark API
- [AI Ark Mobile Phone Finder](https://docs.ai-ark.com/reference/people-mobile-phone-finder)
- [AI Ark Fetch Credit](https://docs.ai-ark.com/reference/fetch-credit)
- [AI Ark Enrichment API](https://ai-ark.com/platform/enrichment-api/)
- [AI Ark Pricing](https://ai-ark.com/pricing/)

### Findymail API
- [Findymail API Documentation](https://app.findymail.com/docs/)
- [Findymail API for Developers](https://www.findymail.com/api/)
- [Findymail Email Verifier](https://www.findymail.com/email-verifier/)

### Webhook Best Practices
- [Webhook Security Best Practices (Stytch)](https://stytch.com/blog/webhooks-security-best-practices/)
- [Webhook Retry Logic (Latenode)](https://latenode.com/blog/integration-api-management/webhook-setup-configuration/how-to-implement-webhook-retry-logic)
- [Idempotency in APIs (DEV Community)](https://dev.to/matt_frank_usa/idempotency-in-apis-designing-safe-retry-logic-1oal)
- [Implementing Webhooks with BullMQ (Taskforce)](https://blog.taskforce.sh/implementing-a-webhook-system-with-bullmq/)

---

## Next Steps

1. **Update spec FR-011** with corrected Wiza pricing ($0.05/email, $0.125/phone)
2. **Confirm AI Ark pricing** with sales team
3. **Proceed to Phase 1**: Generate data-model.md with Prisma schema
4. **Design webhook contracts** in `/contracts/webhooks.yaml`
5. **Create quickstart.md** with local development setup (noting AWS-only deployment per Constitution XV)
