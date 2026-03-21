# Research: Client Config Document Upload via Dashboard

**Feature**: 13-client-doc-upload | **Date**: 2026-03-10

## R1: Token Mechanism for Upload Links

**Decision**: JWT signed with existing `config.session.secret`, 24-hour expiry

**Rationale**: The codebase already uses this exact pattern for BDR magic links (`src/lib/bdrAuth.ts` — `generateBdrToken()`). JWT is stateless (no DB lookup needed), the signing secret is already configured, and 24-hour expiry matches the BDR token precedent. Token payload includes `teamId`, `channelId`, `userId`, and `purpose: 'config-upload'` to distinguish from BDR tokens.

**Alternatives Considered**:
- **Opaque DB token**: Revocable but adds DB overhead for a low-risk, short-lived use case. Rejected — unnecessary complexity.
- **HMAC signed URL**: Simpler but no standard payload structure. Rejected — JWT provides structured claims and library support already in use (jsonwebtoken).

## R2: Markdown Conversion Pipeline

**Decision**: Reuse existing `convertToMarkdown()` from `src/services/document/converter.ts`

**Rationale**: Full pipeline already exists — PDF (pdf-parse), DOCX (mammoth → turndown), XLSX (SheetJS → GFM tables), TXT/MD (pass-through). The function accepts `(buffer, mimeType, fileName)` and returns `{ markdown, warnings }`. No new dependencies needed.

**Alternatives Considered**:
- **Client-side conversion**: Rejected — server-side conversion is more reliable and consistent.
- **New conversion library**: Rejected — existing pipeline covers all required formats.

## R3: Auto-Generated Display Labels

**Decision**: Use Claude 3.5 Haiku to summarize document content into a short label (10 words max)

**Rationale**: The codebase already uses Claude Haiku for AI classification (intent detection in the orchestrator). A single API call with a simple prompt ("Summarize this document in 5-10 words as a label, starting with the document type") is fast (~500ms) and cheap (~$0.001/call). Falls back to `"{DocType} - {original filename}"` if AI call fails.

**Alternatives Considered**:
- **Rule-based extraction**: Extract first heading or title — unreliable across file formats.
- **No auto-label**: Just use filename — poor UX for files like "Document (3).docx".

## R4: Channel-to-Client Mapping Storage

**Decision**: New `ChannelClientMapping` model in Prisma, managed via admin dashboard

**Rationale**: No existing table maps channels to ManagedClient entities. The BDR→Client relationship goes through `BdrClient` (user-level, not channel-level). A simple mapping table (`slackTeamId + slackChannelId → clientId`) with a unique constraint is the cleanest approach. Admin dashboard already has a clients management page that can be extended with a "Link Channel" action.

**Alternatives Considered**:
- **Infer from campaigns**: Campaigns link to clients, but a channel may have multiple campaigns for different clients. Rejected — ambiguous.
- **Store mapping in Redis**: Non-persistent, lost on cache flush. Rejected — must survive restarts.

## R5: File Upload to S3 for Original Retention

**Decision**: Use existing `uploadFile()` from `src/lib/storage.ts` with key pattern `config-docs/{teamId}/{channelId}/{docType}/v{version}/{originalFilename}`

**Rationale**: S3 upload utility already exists and is used for enrichment outputs and analysis PDFs. The key pattern provides clear organization and supports multiple versions if needed in the future. Content-Disposition header set on upload so downloads preserve the original filename.

**Alternatives Considered**:
- **Store original in database as BLOB**: Rejected — PostgreSQL not designed for large binary storage; S3 is already the standard.
- **Don't store original**: Rejected — user requirement to download the source file.

## R6: Upload API Route Authentication

**Decision**: Dedicated `uploadAuth` middleware that validates JWT from URL query parameter, separate from admin/BDR auth

**Rationale**: Upload pages are accessed by Slack users who may not have admin dashboard accounts. The token in the URL is the sole authorization. Middleware extracts token from `?token=` query param, validates JWT signature and expiry, and attaches `{ teamId, channelId, userId }` to the request. Pattern matches existing `bdrAuth` middleware.

**Alternatives Considered**:
- **Reuse bdrAuth**: Different payload structure (channel-scoped vs user-scoped). Rejected — would conflate concerns.
- **Session-based auth**: Requires login flow. Rejected — spec requires token-only access.

## R7: Slack Confirmation After Dashboard Upload

**Decision**: Backend API endpoint called after successful upload posts a message to the originating channel via Slack WebClient

**Rationale**: The upload API route has access to `teamId` and `channelId` from the token. After storing the document, the route handler uses the Slack WebClient (already initialized in `src/app.ts`) to post a confirmation message to the channel. No webhook or callback needed — it's a direct API call within the same request.

**Alternatives Considered**:
- **WebSocket from dashboard to Slack**: Over-engineered for a simple notification.
- **Polling from Slack**: Unreliable and delayed.

## R8: Frontend Route Strategy

**Decision**: Public route at `/upload/:token` in React Router, outside the `RequireAuth` guard

**Rationale**: The upload page must be accessible without admin login — the JWT token is the authorization. React Router already supports public routes (e.g., `/login`, `/bdr/auth-required`). The token is extracted from the URL path param, validated via API call on page load, and used for all subsequent API calls as a query parameter.

**Alternatives Considered**:
- **Separate mini-app**: Rejected — unnecessary infrastructure; the existing dashboard can host a public route.
- **Token in query string only**: Rejected — path param is cleaner and doesn't get stripped by some browsers.
