# Quickstart: Smart Reply Assistant

**Branch**: `29-smart-reply-assistant` | **Date**: 2026-03-17

## Prerequisites

- AWS ECS cluster `prod-slack-list-processor` running
- PostgreSQL (RDS) accessible
- Redis (ElastiCache) accessible
- Anthropic API key configured (`ANTHROPIC_API_KEY`)
- AI Ark API key configured (`AI_ARK_API_KEY`)
- HubSpot OAuth connection active (for CRM sync features)

## Environment Variables

No new environment variables required. All API keys reuse existing config:
- `ANTHROPIC_API_KEY` — already used by agent-intent-classifier
- `AI_ARK_API_KEY` — already used by AI Ark phone finder + personality analysis
- `HUBSPOT_*` — already used by HubSpot sync features

## Setup Steps

### 1. Apply Prisma Migration

```bash
# Generate migration (do NOT run locally — push via CI/CD)
npx prisma migrate dev --name add-smart-reply-draft-fields
```

This adds:
- `SmartReplyDraftStatus` enum (GENERATING, READY, SENT, REJECTED, FAILED)
- 7 fields to `unibox_replies` table (draft_body, draft_status, draft_intent, etc.)
- 2 fields to `campaign_contacts` table (personality_data, personality_enriched_at)
- Index on `draft_status`

### 2. Deploy Backend

Push to GitHub — CI/CD handles ECR build + ECS deployment:
```bash
git push origin 29-smart-reply-assistant
```

### 3. Deploy Admin Dashboard

```bash
cd admin-dashboard && npm run build
aws s3 sync dist/ s3://slkadmin-developerlabs-ai/ --delete
aws cloudfront create-invalidation --distribution-id E30ZVBVU06GFUV --paths "/*"
```

## Verification Checklist

### Smart Reply (US1-US3)
- [ ] Send a test reply via Instantly webhook -> verify UniboxReply created with draftStatus=GENERATING
- [ ] Wait ~10-30s -> verify draftStatus=READY, draftBody populated, draftIntent set
- [ ] Open UniBox in dashboard -> verify draft panel appears on the reply
- [ ] Click "Accept & Send" -> verify reply sent via Instantly, draftStatus=SENT
- [ ] Click "Dismiss" on another draft -> verify draftStatus=REJECTED
- [ ] Click "Regenerate" with tone selection -> verify new draft generated

### On-Demand Enrichment (US4)
- [ ] Navigate to contact detail page -> click "Enrich" button -> verify personality data loads
- [ ] Run `/enrich personality <contactId>` in Slack -> verify confirmation message with archetype
- [ ] Try enriching a contact without LinkedIn URL -> verify error message

### Contact Details Page (US5)
- [ ] Navigate to `/contacts/:contactId` -> verify contact info, personality visualization, conversation history
- [ ] Test with contact that has no personality data -> verify personality sections hidden

### Slack Notifications (US6)
- [ ] Trigger a reply webhook -> verify DM sent to assigned BDRs
- [ ] Verify channel notification in campaign's originating channel

### CRM Export (US7)
- [ ] Click "Push to HubSpot" -> verify custom properties created + values written
- [ ] Click "Export CSV" -> verify CSV download with personality fields

## Key Files Modified

### Backend (`src/`)
| File | Change |
|------|--------|
| `prisma/schema.prisma` | SmartReplyDraftStatus enum + UniboxReply/CampaignContact fields |
| `src/services/ai/smartReplyGenerator.ts` | NEW — AI draft generation + intent classification |
| `src/services/ai/defaultPrompts.ts` | Add smart-reply-generator prompt |
| `src/services/queue/queues.ts` | Add smartReplyQueue |
| `src/services/queue/workers/smartReplyWorker.ts` | NEW — BullMQ worker |
| `src/services/campaign/personalityCrmSync.ts` | NEW — HubSpot push + CSV export |
| `src/routes/webhooks/instantly.ts` | Enqueue smart reply + Slack notifications |
| `src/routes/bdr/unibox.ts` | Draft accept/dismiss/regenerate endpoints |
| `src/routes/bdr/personality.ts` | Add JSON enrichment endpoint |
| `src/routes/admin/contacts.ts` | NEW — contact detail API |
| `src/routes/admin/campaigns.ts` | CRM sync + CSV export endpoints |
| `src/listeners/commands/enrich.ts` | Add `personality` subcommand |
| `src/app.ts` | Register smart reply worker |

### Frontend (`admin-dashboard/src/`)
| File | Change |
|------|--------|
| `components/bdr/SmartReplyDraft.tsx` | NEW — draft review panel |
| `pages/bdr/unibox.tsx` | Integrate SmartReplyDraft panel |
| `pages/contact-detail.tsx` | NEW — personality visualization |
| `services/bdr-unibox.ts` | Add draft API functions |
| `services/contact-detail.ts` | NEW — contact detail API service |
| `router.tsx` | Add contact detail route |
