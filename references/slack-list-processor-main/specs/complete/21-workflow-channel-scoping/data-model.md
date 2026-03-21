# Data Model: Workflow Channel Scoping

**Feature**: 21-workflow-channel-scoping
**Date**: 2026-03-11

## Schema Changes

### WorkflowTemplate (EXTEND existing model)

**File**: `prisma/schema.prisma`

Add nullable `clientId` FK and relation:

```prisma
model WorkflowTemplate {
  // ... existing fields unchanged ...
  clientId        String?             @map("client_id") @db.Uuid    // NEW

  // Relations
  client            ManagedClient?      @relation(fields: [clientId], references: [id], onDelete: SetNull)  // NEW
  versions          WorkflowVersion[]   // existing
  webhookEndpoints  WebhookEndpoint[]   // existing
  channelMappings   WorkflowChannelMapping[]  // NEW

  @@index([slackTeamId])                        // existing
  @@index([slackTeamId, triggerType])            // existing
  @@index([clientId])                            // NEW
  @@index([slackTeamId, triggerType, clientId])  // NEW - optimizes tier-2 lookup
  @@map("workflow_templates")
}
```

**onDelete: SetNull**: When a client is deleted, workflows become team-level fallbacks (clientId → null) rather than being cascade-deleted.

### WorkflowChannelMapping (NEW model)

```prisma
model WorkflowChannelMapping {
  id              String                @id @default(uuid()) @db.Uuid
  templateId      String                @map("template_id") @db.Uuid
  slackChannelId  String                @map("slack_channel_id")
  slackTeamId     String                @map("slack_team_id")
  triggerType     WorkflowTriggerType   @map("trigger_type")
  createdByUserId String                @map("created_by_user_id")
  createdAt       DateTime              @default(now()) @map("created_at")

  // Relations
  template WorkflowTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@unique([slackTeamId, slackChannelId, triggerType])  // one workflow per channel per trigger type
  @@index([templateId])                                  // fast lookup by workflow
  @@index([slackTeamId, slackChannelId])                 // fast tier-1 lookup
  @@map("workflow_channel_mappings")
}
```

**Key constraints**:
- `@@unique([slackTeamId, slackChannelId, triggerType])`: Enforces one workflow per channel per trigger type at the database level
- `onDelete: Cascade`: Deleting a workflow removes all its channel mappings
- `triggerType` is denormalized from the linked WorkflowTemplate to enforce the unique constraint

### ManagedClient (EXTEND existing model - relation only)

Add reverse relation to WorkflowTemplate:

```prisma
model ManagedClient {
  // ... existing fields and relations unchanged ...
  workflows          WorkflowTemplate[]    // NEW reverse relation
}
```

## Entity Relationship Changes

```
ManagedClient (1) ─── onDelete:SetNull ───→ (0..N) WorkflowTemplate
                                                        │
WorkflowTemplate (1) ── onDelete:Cascade ──→ (0..N) WorkflowChannelMapping
                                                        │
                                             @@unique(teamId, channelId, triggerType)
```

## Validation Rules

| Rule | Enforcement |
|------|-------------|
| One workflow per channel per trigger type | DB unique constraint on WorkflowChannelMapping |
| One active workflow per (triggerType, clientId) | Application-level check in publishVersion() |
| clientId must reference existing client | DB FK constraint (nullable) |
| triggerType on mapping must match template's triggerType | Application-level validation on create |
| Channel mapping's teamId must match template's teamId | Application-level validation on create |

## Migration Notes

- **Zero-data migration**: Adding nullable `clientId` column and new empty table requires no data backfill
- Existing WorkflowTemplate rows get `clientId = NULL` automatically (team-level fallbacks)
- New `WorkflowChannelMapping` table starts empty
- `prisma db push` applies changes; ECS entrypoint runs this on container startup
