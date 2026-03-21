# Quickstart: Power Dialer Setup

**Feature**: 22-power-dialer | **Date**: 2026-03-12

This guide covers all external service configuration required before implementation.

---

## 1. Twilio Account Setup

### 1.1 Create Twilio Account
1. Sign up at https://www.twilio.com/try-twilio
2. Verify phone number and email
3. Upgrade from trial account (trial has $15.50 credit, but calls show "trial" prefix)
4. Note your **Account SID** and **Auth Token** from the Twilio Console dashboard

### 1.2 Create API Key (for server-side token generation)
1. Console → Account → API keys & tokens → Create API Key
2. Type: **Standard**
3. Friendly name: `power-dialer-server`
4. Save the **API Key SID** (`SKxxxxxxxx`) and **API Key Secret** — secret is shown only once

### 1.3 Create TwiML App
1. Console → Voice → TwiML Apps → Create new TwiML App
2. Friendly name: `Power Dialer`
3. Voice Configuration:
   - **Request URL**: `https://{ALB_DOMAIN}/api/webhooks/twilio/voice` (POST)
   - **Status Callback URL**: `https://{ALB_DOMAIN}/api/webhooks/twilio/status` (POST)
4. Save the **TwiML App SID** (`APxxxxxxxx`)

### 1.4 Provision Phone Numbers
1. Console → Phone Numbers → Buy a Number
2. Search by area code (e.g., 415 for San Francisco)
3. Select numbers with Voice capability
4. Purchase — cost: $1.00-1.15/month per number
5. Repeat for top 20-50 area codes covering your target markets
6. **Alternative (API-based provisioning)**: Use the admin dashboard phone pool management page (built in this feature)

### 1.5 Configure Webhook URLs
All Twilio webhooks point to your ALB domain. Configure in the TwiML App and per-number settings:

| Webhook | URL | Method |
|---------|-----|--------|
| TwiML App Voice Request | `https://{ALB}/api/webhooks/twilio/voice` | POST |
| TwiML App Status Callback | `https://{ALB}/api/webhooks/twilio/status` | POST |
| AMD Result Callback | `https://{ALB}/api/webhooks/twilio/amd` | POST |
| Recording Status Callback | `https://{ALB}/api/webhooks/twilio/recording` | POST |

### 1.6 A2P/10DLC Registration (Required for US Business Calling)
1. Console → Messaging → Trust Hub → Business Profiles
2. Register your business (company name, EIN, address)
3. Create a Campaign Use Case: "Sales Outreach"
4. Assign your phone numbers to the campaign
5. Vetting takes 2-4 weeks — numbers may have reduced deliverability until approved
6. **Without registration**: Carriers may flag/block calls, reduced answer rates

---

## 2. Deepgram Account Setup

### 2.1 Create Deepgram Account
1. Sign up at https://console.deepgram.com/signup
2. Free tier includes $200 credit (good for ~46,000 minutes of Nova-2)

### 2.2 Create API Key
1. Console → API Keys → Create Key
2. Permissions: **Member** (read/write)
3. Save the **API Key** — shown only once

### 2.3 Configure Webhook Callback
No console-side webhook configuration needed — the callback URL is passed per-request as a query parameter:
```
POST https://api.deepgram.com/v1/listen?callback=https://{ALB}/api/webhooks/deepgram/transcript&diarize=true&utterances=true&punctuate=true&model=nova-2
```

### 2.4 Test Transcription
```bash
curl -X POST "https://api.deepgram.com/v1/listen?model=nova-2&diarize=true&utterances=true&punctuate=true" \
  -H "Authorization: Token YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://static.deepgram.com/examples/interview_speech-analytics.wav"}'
```

---

## 3. S3 Recording Bucket Setup

### 3.1 Create S3 Bucket
Use the existing S3 infrastructure or create a dedicated recordings bucket:

**Bucket name**: `{prefix}-call-recordings` (e.g., `slk-call-recordings`)
**Region**: Same as ECS cluster (us-east-1)

### 3.2 Bucket Policy
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowECSTaskAccess",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::{ACCOUNT_ID}:role/{ECS_TASK_ROLE}"
      },
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::{BUCKET_NAME}",
        "arn:aws:s3:::{BUCKET_NAME}/*"
      ]
    }
  ]
}
```

### 3.3 CORS Configuration (for browser audio playback)
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET"],
    "AllowedOrigins": [
      "https://dt9zhghz3mtx8.cloudfront.net",
      "https://app.hubspot.com"
    ],
    "ExposeHeaders": ["Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

### 3.4 Lifecycle Policy
```json
{
  "Rules": [
    {
      "ID": "RecordingLifecycle",
      "Status": "Enabled",
      "Filter": { "Prefix": "recordings/" },
      "Transitions": [
        { "Days": 30, "StorageClass": "INTELLIGENT_TIERING" },
        { "Days": 90, "StorageClass": "GLACIER_IR" },
        { "Days": 365, "StorageClass": "DEEP_ARCHIVE" }
      ]
    }
  ]
}
```

### 3.5 Encryption
Enable default encryption: **SSE-S3 (AES-256)**

---

## 4. Environment Variables

Add these to the ECS task definition (via CloudFormation parameters or Secrets Manager):

```env
# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY_SID=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_TWIML_APP_SID=APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Deepgram
DEEPGRAM_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# S3 Recordings
RECORDINGS_S3_BUCKET=slk-call-recordings
RECORDINGS_S3_REGION=us-east-1

# Webhook Base URL (ALB domain for Twilio/Deepgram callbacks)
WEBHOOK_BASE_URL=https://{ALB_DOMAIN}
```

**Store sensitive values in AWS Secrets Manager** (Twilio Auth Token, API Key Secret, Deepgram API Key). Reference from ECS task definition via `secrets` block.

---

## 5. Prisma Schema Migration

After implementing the data model:
1. Add new models/enums to `prisma/schema.prisma`
2. Push schema changes: `npx prisma db push` (runs automatically via entrypoint.sh on ECS deploy)
3. Generate Prisma Client: `npx prisma generate` (runs during Docker build)

---

## 6. NPM Dependencies

```bash
# Backend (root package.json)
npm install twilio @deepgram/sdk

# Frontend (admin-dashboard/package.json)
cd admin-dashboard && npm install @twilio/voice-sdk
```

---

## 7. Verification Checklist

After setup, verify each integration:

- [ ] Twilio Account SID and Auth Token work: `curl -u {SID}:{TOKEN} https://api.twilio.com/2010-04-01/Accounts/{SID}.json`
- [ ] Twilio API Key can generate tokens: test AccessToken generation in a script
- [ ] TwiML App SID resolves: check Console → Voice → TwiML Apps
- [ ] At least 1 phone number provisioned: check Console → Phone Numbers
- [ ] Deepgram API Key works: run test transcription (section 2.4)
- [ ] S3 bucket accessible from ECS task role: test PutObject + GetObject
- [ ] S3 CORS allows admin dashboard origin
- [ ] Webhook URLs reachable from internet (ALB health check passes)
- [ ] A2P/10DLC registration submitted (not blocking, but start early)
