# Research: Slack Agent Integration

**Phase 0 Output** | **Date**: 2026-03-06

## R1: Socket Mode vs HTTP Mode for Multi-Workspace Distribution

**Decision**: Hybrid approach — Socket Mode for event delivery + Express OAuth endpoints for install flow.

**Rationale**:
- Socket Mode is already working and handles all Slack events (messages, file uploads, actions)
- Socket Mode supports multi-workspace via custom `authorize` function (looks up bot token per team ID)
- Socket Mode supports up to 10 concurrent WebSocket connections (sufficient for initial scale)
- HTTP mode would require replacing the entire event delivery mechanism, adding request verification, and URL configuration
- OAuth install flow only needs two HTTP endpoints (`/slack/install`, `/slack/oauth_redirect`) which run on the existing Express server

**Alternatives Considered**:
- Full HTTP mode: Maximum flexibility, required for Slack Marketplace listing. Rejected for initial release — Socket Mode is simpler and already proven.
- Socket Mode only (no OAuth): Would limit distribution to manual token sharing. Rejected — OAuth is required for self-service workspace installation.

**Future Migration Path**: If Marketplace listing is pursued, migrate from Socket Mode to HTTP mode. The `authorize` function and `InstallationStore` patterns are identical — only the event delivery transport changes.

## R2: Assistant Class Integration Pattern

**Decision**: Use `@slack/bolt` v4.6.0's built-in `Assistant` class with custom Redis-backed `ThreadContextStore`.

**Rationale**:
- `Assistant` class available since Bolt v4.0.0; current v4.6.0 includes all needed features
- Three handlers map cleanly to our requirements: `threadStarted` (greeting + prompts), `threadContextChanged` (channel awareness), `userMessage` (conversation + orchestration)
- Default `ThreadContextStore` saves context as message metadata — insufficient for our needs (need turn history, job references)
- Custom Redis-backed store allows richer context with 7-day DB persistence

**Alternatives Considered**:
- Raw event listeners (`app.event('assistant_thread_started')`) instead of Assistant class: More control but loses utility methods (`setSuggestedPrompts`, `setStatus`, `setTitle`). Rejected.
- Database-only context store (no Redis): Higher latency for every message. Rejected — Redis as hot cache, DB as durable store.

## R3: Chat Streaming Implementation

**Decision**: Use Bolt v4.5.0+ `chatStream()` helper for LLM response streaming. Use raw `chat.appendStream` with chunk arrays for task card updates.

**Rationale**:
- `chatStream()` helper wraps start/append/stop lifecycle — simplifies LLM text streaming
- Task card updates require `chunks` array with `task_update` type — easier via raw API calls
- Rate limits are generous: `appendStream` is Tier 4 (100+/min), sufficient for real-time updates
- `task_display_mode: 'plan'` groups all tasks into a single visual block — matches our pipeline view

**Key Technical Details**:
- `chat.startStream`: Tier 2 (20+/min) — called once per response
- `chat.appendStream`: Tier 4 (100+/min) — called per chunk/update
- `chat.stopStream`: Tier 2 (20+/min) — called once to finalize
- Max 12,000 chars per append call
- Task card statuses: `pending`, `in_progress`, `complete`, `error`
- Plan blocks: Group tasks under a title, rendered as a unified view

**Alternatives Considered**:
- Standard message posting with periodic updates (`chat.update`): No progressive text rendering, higher rate limit pressure on updates. Rejected.
- WebSocket direct streaming to client: Not possible in Slack — must use their streaming API.

## R4: Multi-Turn Conversation Architecture

**Decision**: Hybrid state management — Redis for hot session state (extended to 24-hour TTL for agent threads), PostgreSQL for conversation turn persistence (7-day retention).

**Rationale**:
- Existing `ConversationState` in Redis works well for single-flow state (file upload → enrichment)
- Agent conversations need richer state: turn history, accumulated parameters, job references
- Redis provides fast read/write for active conversations; DB provides durability
- On each user message: read turns from Redis (cache hit) or DB (cache miss), append new turn, persist to both
- 7-day DB retention with audit summary generation before purge

**State Structure** (new `AgentThreadState` extending existing patterns):
```typescript
interface AgentThreadState {
  threadTs: string;
  channelId: string;  // DM channel
  userId: string;
  teamId: string;

  // Channel context (from threadContextChanged)
  viewingChannelId?: string;
  viewingChannelName?: string;

  // Accumulated enrichment parameters
  enrichmentParams: {
    listType?: 'company' | 'contact';
    enrichIntent?: 'technographic' | 'contact' | 'combined';
    purpose?: string;
    fileId?: string;
    fileName?: string;
    technology?: string;  // for tech reports
  };

  // Job references in this thread
  jobIds: string[];
  activeJobId?: string;

  // Conversation turns (last N for context window)
  turns: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    intent?: string;
    confidence?: number;
  }>;
}
```

**Alternatives Considered**:
- Redis only (no DB persistence): Loses conversation on Redis restart or TTL expiry. Rejected — 7-day retention requirement.
- DB only (no Redis cache): Every message requires DB read. Rejected — latency impact on streaming start time.
- Slack message history as source of truth: Would require reading back message history on each turn. Rejected — expensive API calls, no structured metadata.

## R5: Multi-Workspace OAuth & Token Management

**Decision**: Prisma-backed `InstallationStore` implementing Bolt's interface. Bot tokens encrypted at rest. Custom `authorize` function for Socket Mode multi-workspace.

**Rationale**:
- Bolt's `InstallationStore` interface is well-defined: `storeInstallation`, `fetchInstallation`, `deleteInstallation`
- PostgreSQL via Prisma provides durable, queryable token storage with workspace metadata
- `authorize` function called on every event — must be fast (Redis cache for hot tokens)
- OAuth endpoints (`/slack/install`, `/slack/oauth_redirect`) added to existing Express server

**Token Flow**:
1. Admin clicks install link → Express `/slack/install` redirects to Slack OAuth
2. Slack redirects back to `/slack/oauth_redirect` with auth code
3. Bolt exchanges code for tokens, calls `storeInstallation`
4. `WorkspaceInstallation` record created in DB with encrypted bot token
5. On every subsequent event: `authorize({ teamId })` looks up token from Redis cache → DB fallback

**Alternatives Considered**:
- AWS Secrets Manager for token storage: Overkill for bot tokens; adds latency and cost. Rejected.
- Environment variables per workspace: Doesn't scale. Rejected.
- Separate OAuth service: Unnecessary complexity for HTTP endpoints on existing Express server. Rejected.

## R6: Usage Metering Architecture

**Decision**: Extend existing `ApiUsageLog` with mandatory `slackTeamId`. Add `WorkspaceUsageLimit` model for caps. Check limits before job submission (not per-API-call).

**Rationale**:
- `ApiUsageLog` already tracks service, tokens, estimatedCostUsd per job
- Adding `slackTeamId` (already on Job model) enables per-workspace aggregation
- Limit checking at job submission (not per-API-call) avoids hot-path latency
- Monthly aggregation via existing DailyAggregate pattern (extend with team scoping)
- 80% and 100% notifications via Slack DM to workspace admins

**Metering Flow**:
1. User requests enrichment via agent
2. System checks `WorkspaceUsageLimit` vs current month's aggregated spend
3. If under limit: proceed. If at 80%: warn + proceed. If at 100%: block + notify
4. During enrichment: each API call logged to `ApiUsageLog` with `slackTeamId`
5. Post-job: DailyAggregate updated (already runs at 00:30 UTC)

**Alternatives Considered**:
- Real-time per-call limit checking: Too expensive — every BuiltWith/Apollo call would need a DB read. Rejected.
- Separate metering service: Unnecessary complexity for current scale. Rejected.
- Pre-paid credits system: Adds billing complexity out of scope. Rejected.

## R7: Conversation Purge & Audit Summary

**Decision**: Scheduled BullMQ cron job (daily at 02:00 UTC). Generates audit summary per thread, then deletes conversation turns older than 7 days.

**Rationale**:
- Follows existing pattern: `dailyAggregate` runs at 00:30 UTC, `retentionPurge` at 01:00 UTC
- Audit summary captures: thread ID, workspace, user, actions taken (intents + jobs), timestamps
- Summary stored in new `AgentThreadAudit` model (permanent retention)
- Conversation turns in `ConversationTurn` model deleted after summary generation

**Alternatives Considered**:
- Application-level TTL (delete on read if expired): Race condition risk, no audit summary generation. Rejected.
- S3 archival instead of delete: Adds storage costs without clear benefit. Rejected.

## R8: User Authentication Model

**Decision**: No per-user authentication. Slack workspace membership = authentication. Slack admin/owner role = authorization for admin features.

**Rationale**:
- Every Slack event contains user ID and team ID — identity is provided by Slack
- `users.info` API returns `is_admin` and `is_owner` fields for role checking
- No separate login flow, no custom user accounts, no password management
- This matches how Anthropic's Claude, Perplexity, and other Slack agents work

**Alternatives Considered**:
- `/login` slash command with custom auth: Unnecessary — Slack already authenticates users. Rejected.
- Per-user API keys: Out of scope for initial release (centrally managed keys). Rejected.
- OAuth user tokens (not just bot tokens): Only needed if accessing user-specific Slack data (e.g., reading their DMs). Not required for our use case. Rejected.
