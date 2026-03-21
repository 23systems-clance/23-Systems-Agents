# Data Model: Smart Reply Assistant

**Branch**: `29-smart-reply-assistant` | **Date**: 2026-03-17

## Schema Changes (Prisma Migration)

### New Enum: SmartReplyDraftStatus

```prisma
enum SmartReplyDraftStatus {
  GENERATING
  READY
  SENT
  REJECTED
  FAILED
}
```

### Extended Model: UniboxReply

Add 7 new fields for smart reply draft tracking:

```prisma
model UniboxReply {
  // ... existing fields ...

  // Smart Reply Draft fields (all nullable for backwards compatibility)
  draftBody        String?               @map("draft_body") @db.Text
  draftStatus      SmartReplyDraftStatus? @map("draft_status")
  draftIntent      String?               @map("draft_intent")
  draftGeneratedAt DateTime?             @map("draft_generated_at")
  draftTokensUsed  Int?                  @map("draft_tokens_used")
  draftCostUsd     Decimal?              @map("draft_cost_usd") @db.Decimal(10, 6)
  draftError       String?               @map("draft_error") @db.Text

  // ... existing relations ...

  @@index([draftStatus])
}
```

**Field descriptions**:
- `draftBody`: AI-generated reply text (or BDR-edited version before send)
- `draftStatus`: Lifecycle state — GENERATING → READY → SENT/REJECTED/FAILED
- `draftIntent`: Classified intent (interested, meeting_request, question, objection, not_interested, wrong_person, out_of_office, auto_reply, other)
- `draftGeneratedAt`: When the draft was generated (for latency tracking)
- `draftTokensUsed`: Total tokens consumed (input + output) for cost tracking
- `draftCostUsd`: USD cost of the generation call
- `draftError`: Error message if generation failed

### Extended Model: CampaignContact

Add 2 new fields for personality data storage on the contact record:

```prisma
model CampaignContact {
  // ... existing fields ...

  // Personality enrichment (populated via on-demand enrichment)
  personalityData       Json?     @map("personality_data") @db.JsonB
  personalityEnrichedAt DateTime? @map("personality_enriched_at")

  // ... existing relations ...
}
```

**Field descriptions**:
- `personalityData`: Full AI Ark personality analysis response as JSONB (DISC scores, OCEAN scores, archetype, communication style, key traits, email approach)
- `personalityEnrichedAt`: Timestamp of when personality data was populated

### Existing Model: CampaignBdr (NO CHANGES)

Already exists with the required structure for BDR-campaign assignment:

```prisma
model CampaignBdr {
  id          String   @id @default(uuid()) @db.Uuid
  campaignId  String   @map("campaign_id") @db.Uuid
  slackUserId String   @map("slack_user_id")
  slackTeamId String   @map("slack_team_id")
  displayName String   @map("display_name")
  createdAt   DateTime @default(now()) @map("created_at")

  campaign Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)

  @@unique([campaignId, slackUserId])
  @@index([campaignId])
  @@index([slackUserId])
  @@map("campaign_bdrs")
}
```

### Existing Model: PersonalityAnalysis (NO CHANGES)

Already exists as the global personality cache keyed by LinkedIn URL:

```prisma
model PersonalityAnalysis {
  id             String   @id @default(uuid()) @db.Uuid
  linkedinUrl    String   @unique @map("linkedin_url")
  contactName    String?  @map("contact_name")
  rawResponse    Json     @map("raw_response")
  archetypeName  String?  @map("archetype_name")
  archetypeScore Float?   @map("archetype_score")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@map("personality_analyses")
}
```

## State Transitions

### SmartReplyDraftStatus Lifecycle

```
[reply_received webhook]
    │
    ▼
GENERATING ──(AI call succeeds)──► READY
    │                                │
    │                                ├──(BDR accepts & sends)──► SENT
    │                                │
    │                                └──(BDR dismisses)──► REJECTED
    │
    └──(AI call fails)──► FAILED
                            │
                            └──(BDR retries)──► GENERATING
```

**Regeneration flow**: READY → GENERATING → READY (new draft replaces old)

## AI Ark Personality Profile Schema (JSONB)

Structure stored in `CampaignContact.personalityData` and `PersonalityAnalysis.rawResponse`:

```json
{
  "name": "string",
  "title": "string",
  "company": "string",
  "linkedin_url": "string",
  "email": "string",
  "archetype": {
    "name": "string",
    "score": 0.0
  },
  "disc": {
    "dominance": 0.0,
    "influence": 0.0,
    "steadiness": 0.0,
    "calculativeness": 0.0
  },
  "ocean": {
    "openness": 0.0,
    "conscientiousness": 0.0,
    "extraversion": 0.0,
    "agreeableness": 0.0,
    "emotional_stability": 0.0
  },
  "communication": {
    "types": ["string"],
    "adjectives": ["string"],
    "what_to_say": ["string"],
    "what_to_avoid": ["string"]
  },
  "key_traits": {
    "risk_tolerance": "string",
    "ability_to_say_no": "string",
    "decision_speed": "string",
    "decision_drivers": ["string"]
  },
  "email_approach": {
    "tone": "string",
    "length": "string",
    "greeting": "string",
    "subject": "string",
    "messaging": "string",
    "closing": "string"
  }
}
```

## Migration Notes

- All new fields on `UniboxReply` and `CampaignContact` are nullable — migration is backwards-compatible
- No data migration needed; existing rows will have `NULL` for new fields
- Index on `draftStatus` enables efficient filtering of replies by draft state in UniBox
- `CampaignBdr` and `PersonalityAnalysis` tables already exist — no changes needed
