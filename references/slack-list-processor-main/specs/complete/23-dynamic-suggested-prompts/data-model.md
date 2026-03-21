# Data Model: Dynamic Suggested Prompts

**Date**: 2026-03-13
**Phase**: Phase 1 - Design
**Status**: ✅ COMPLETE

---

## Entity Overview

This feature introduces **one new persistent entity** (PromptClickEvent) and **one ephemeral entity** (PromptContext). All other data comes from existing models.

---

## New Entities

### 1. PromptClickEvent (Persistent)

**Purpose**: Track when users click suggested prompts for analytics and optimization

**Schema** (Prisma):
```prisma
model PromptClickEvent {
  id            String   @id @default(uuid())
  userId        String   // Slack user ID (U...)
  teamId        String   // Slack workspace/team ID (T...)
  channelId     String?  // Channel ID where prompt was clicked (C... or null for DM)
  threadTs      String   // Message timestamp of assistant thread

  promptTitle    String   // Title of clicked prompt (e.g., "Check your running job")
  promptPosition Int      // Position in list (1-4)
  contextType    String   // 'default' | 'channel' | 'activity' | 'workspace'

  metadata      Json?    // Optional: Additional context (job type, enrichment type, etc.)

  clickedAt     DateTime @default(now())
  createdAt     DateTime @default(now())

  @@index([teamId, clickedAt])
  @@index([userId, clickedAt])
  @@index([contextType, clickedAt])
  @@map("prompt_click_events")
}
```

**Fields:**
- **id**: UUID primary key
- **userId**: Slack user ID who clicked (for per-user analytics)
- **teamId**: Workspace isolation (multi-tenancy)
- **channelId**: Where click occurred (nullable for DMs)
- **threadTs**: Thread identifier for correlation
- **promptTitle**: Which prompt was clicked (e.g., "Retry your failed enrichment")
- **promptPosition**: Position in the 4-prompt list (1 = top, 4 = bottom)
- **contextType**: How prompt was generated (`default`, `channel`, `activity`, `workspace`)
- **metadata**: JSON blob for additional context (e.g., `{ "jobType": "technographic", "jobId": "123" }`)
- **clickedAt**: When user clicked (for time-series analysis)

**Indexes:**
- `(teamId, clickedAt)`: Workspace-level analytics queries
- `(userId, clickedAt)`: Per-user analytics
- `(contextType, clickedAt)`: Context-type performance comparison

**Retention**: 90 days (purged by existing retention worker)

**Validation Rules:**
- `promptPosition` must be 1-4
- `contextType` must be one of: `default`, `channel`, `activity`, `workspace`
- `teamId`, `userId`, `promptTitle`, `contextType` are required
- `channelId` is nullable (DM threads have no channel)

**State Transitions**: N/A (immutable event log)

---

### 2. PromptContext (Ephemeral)

**Purpose**: Aggregated context used to generate prompts (not persisted to database)

**TypeScript Interface**:
```typescript
interface PromptContext {
  // User identity
  userId: string;
  teamId: string;
  channelId?: string;
  threadTs: string;

  // User activity (recent jobs)
  activeJobs: JobSummary[];           // Currently running
  completedJobs: JobSummary[];        // Completed within 48h
  failedJobs: JobSummary[];           // Failed within 24h
  totalEnrichmentCount: number;       // All-time job count (for power user detection)

  // Channel context (if channelId present)
  channelEnrichmentHistory?: ChannelHistory;
  channelDocuments?: DocumentSummary[];
  channelPresets?: PresetSummary[];

  // Workspace configuration
  workspaceConfig: WorkspaceConfig;

  // Meta
  generatedAt: Date;
}

interface JobSummary {
  id: string;
  type: 'technographic' | 'contact' | 'combined' | 'tech_report';
  status: 'active' | 'completed' | 'failed';
  createdAt: Date;
  rowCount?: number;
}

interface ChannelHistory {
  totalJobs: number;
  mostCommonType: 'technographic' | 'contact' | 'combined';
  lastJobAt: Date;
}

interface DocumentSummary {
  id: string;
  documentType: 'icp' | 'use_cases';
  slug: string;
  uploadedAt: Date;
}

interface PresetSummary {
  id: string;
  name: string;
  enrichmentType: 'technographic' | 'contact' | 'combined';
}

interface WorkspaceConfig {
  apolloEnabled: boolean;
  apolloCreditsRemaining: number;
  builtWithEnabled: boolean;
  usagePercentage: number; // 0-100 (e.g., 85 = 85% of monthly cap)
}
```

**Source Data:**
- **activeJobs**: `EnrichmentJob.findMany({ where: { status: 'processing' } })`
- **completedJobs**: `EnrichmentJob.findMany({ where: { status: 'completed', createdAt: { gte: 48h_ago } } })`
- **failedJobs**: `EnrichmentJob.findMany({ where: { status: 'failed', createdAt: { gte: 24h_ago } } })`
- **totalEnrichmentCount**: `EnrichmentJob.count({ where: { slackUserId: userId } })`
- **channelEnrichmentHistory**: Aggregation query on `EnrichmentJob` by channel
- **channelDocuments**: `ConfigDocument.findMany({ where: { slackChannelId: channelId } })`
- **channelPresets**: `EnrichmentPreset.findMany({ where: { slackChannelId: channelId } })`
- **workspaceConfig**: `WorkspaceInstallation` + `ApiUsageLog` aggregation

**Caching**:
- Redis key: `{teamId}:prompt:{userId}:context`
- TTL: 5 minutes (sliding)
- Invalidate on: job state change, document upload, preset creation

---

## Prompt Categories (Enumeration)

**Prompt Type Taxonomy:**

| Category | Subcategories | Example Prompts |
|----------|---------------|-----------------|
| **Onboarding** | new_user, getting_started | "Upload a list to get started", "What can I help with?" |
| **Enrichment** | technographic, contact, combined, tech_report | "Enrich a company list", "Find contacts", "Generate tech report" |
| **Job Management** | check_status, cancel, download, retry | "Check your running job", "Download results", "Retry failed enrichment" |
| **Follow-Up** | filter, split, add_contacts | "Filter your last enrichment", "Add contacts to technographic list" |
| **Reporting** | usage, history | "Check workspace usage", "View enrichment history" |
| **Channel-Specific** | jobs_in_channel, use_preset, use_document | "View jobs in #channel", "Run [preset-name] enrichment", "Enrich using [doc-slug] settings" |

**Template Structure:**
```typescript
interface PromptTemplate {
  id: string;
  category: 'onboarding' | 'enrichment' | 'job_management' | 'follow_up' | 'reporting' | 'channel_specific';
  subcategory: string;
  priority: number; // Base priority score (see research.md scoring formula)
  applicabilityCheck: (context: PromptContext) => boolean;
  render: (context: PromptContext) => SuggestedPrompt;
}

interface SuggestedPrompt {
  title: string;   // Max 25 chars
  message: string; // Max 150 chars
}
```

---

## Existing Entities (Referenced)

### EnrichmentJob
**Used For**: User activity context (active/completed/failed jobs)
**Queries**:
- Active jobs: `status = 'processing'`
- Completed jobs: `status = 'completed' AND createdAt >= NOW() - INTERVAL '48 hours'`
- Failed jobs: `status = 'failed' AND createdAt >= INTERVAL '24 hours'`
- Job count: `COUNT(*) WHERE slackUserId = ?`

**Indexes Required** (check if exist):
- `(slackUserId, status, createdAt)` for activity queries
- `(slackChannelId, createdAt)` for channel history

### ConfigDocument
**Used For**: Channel-specific document prompts
**Queries**:
- Recent documents: `slackChannelId = ? ORDER BY uploadedAt DESC LIMIT 5`

### EnrichmentPreset
**Used For**: Channel-specific preset prompts
**Queries**:
- Active presets: `slackChannelId = ? AND isActive = true`

### WorkspaceInstallation
**Used For**: Workspace configuration (enabled services, billing)
**Fields Referenced**:
- `apolloEnabled`: Boolean flag for contact enrichment availability
- `apolloCreditsRemaining`: Remaining API credits
- `builtWithEnabled`: Boolean flag for tech stack enrichment

### ApiUsageLog
**Used For**: Usage percentage calculation
**Queries**:
- Monthly usage: `SUM(cost) WHERE teamId = ? AND createdAt >= START_OF_MONTH`

---

## Relationships

```
PromptClickEvent
  ├─→ WorkspaceInstallation (teamId)      # Many-to-one (implicit FK)
  └─→ EnrichmentJob (metadata.jobId)     # Many-to-one (optional, via JSON)

PromptContext (ephemeral)
  ├─→ EnrichmentJob (activeJobs, completedJobs, failedJobs)
  ├─→ ConfigDocument (channelDocuments)
  ├─→ EnrichmentPreset (channelPresets)
  └─→ WorkspaceInstallation (workspaceConfig)
```

**Notes**:
- PromptClickEvent has no formal foreign keys (analytics event log, not transactional data)
- PromptContext is never persisted (rebuilt on-demand from existing entities)

---

## Database Migration

**New Table:**
```sql
CREATE TABLE prompt_click_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  channel_id TEXT,
  thread_ts TEXT NOT NULL,
  prompt_title TEXT NOT NULL,
  prompt_position INTEGER NOT NULL CHECK (prompt_position BETWEEN 1 AND 4),
  context_type TEXT NOT NULL CHECK (context_type IN ('default', 'channel', 'activity', 'workspace')),
  metadata JSONB,
  clicked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prompt_clicks_team_time ON prompt_click_events(team_id, clicked_at);
CREATE INDEX idx_prompt_clicks_user_time ON prompt_click_events(user_id, clicked_at);
CREATE INDEX idx_prompt_clicks_context_time ON prompt_click_events(context_type, clicked_at);
```

**Existing Table Modifications**: None required

---

## Performance Considerations

**Query Optimization:**
- Limit recent job queries to 10 most recent per category (prevent full table scans)
- Use composite indexes for `(slackUserId, status, createdAt)` on EnrichmentJob
- Cache PromptContext in Redis with 5-min TTL to avoid repeated DB hits

**Redis Cache Keys:**
- `{teamId}:prompt:{userId}:context` - Full PromptContext object (JSON)
- `{teamId}:channel:{channelId}:history` - Channel enrichment history (aggregated)

**Expected Query Counts per Prompt Generation:**
- Cache HIT: 0 DB queries (serve from Redis)
- Cache MISS: ~5 DB queries (active jobs, completed jobs, failed jobs, channel context, workspace config)
- Total query time (cache miss): ~50ms (indexed queries, small result sets)

---

## Validation Rules Summary

**PromptClickEvent:**
- `promptPosition`: Must be 1-4
- `contextType`: Must be one of `default`, `channel`, `activity`, `workspace`
- `teamId`, `userId`, `promptTitle`, `threadTs`: Required
- `channelId`: Optional (null for DMs)
- `metadata`: Optional JSON

**PromptContext:**
- `activeJobs`, `completedJobs`, `failedJobs`: Limited to 10 most recent each
- `channelEnrichmentHistory`: Only if `channelId` present
- `workspaceConfig.usagePercentage`: Calculated as `(currentUsage / monthlyLimit) * 100`

---

## Next Steps

✅ **Data Model Complete**

**Continue Phase 1:**
- Create `contracts/` (TypeScript interfaces)
- Create `quickstart.md` (testing guide)
- Update agent context
