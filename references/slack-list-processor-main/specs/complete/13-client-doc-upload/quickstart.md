# Quickstart: Client Config Document Upload

**Feature**: 13-client-doc-upload | **Date**: 2026-03-10

## Prerequisites

- Feature branch `13-client-doc-upload` checked out
- AWS credentials configured (for S3, ECS deployment)
- GitHub account: `developerlabsai` active (`gh auth status`)

## Implementation Order

### Step 1: Database Migration

Add new fields to `ChannelConfigDoc` and create `ChannelClientMapping` model.

```bash
# After updating prisma/schema.prisma:
npx prisma migrate dev --name add-upload-fields-and-channel-client-mapping
```

**Files:**
- `prisma/schema.prisma` — Add `displayLabel`, `s3Key`, `originalMimeType`, `contentSizeBytes` to `ChannelConfigDoc`; add `ChannelClientMapping` model

### Step 2: Backend — Upload Token Service

Create JWT generation and validation for upload links.

**Files:**
- `src/services/upload/tokenService.ts` — `generateUploadToken()`, `validateUploadToken()`
- `src/lib/uploadAuth.ts` — Express middleware extracting/validating token from `?token=` query param

### Step 3: Backend — Upload API Routes

REST endpoints for config doc CRUD, file upload, download, label rename.

**Files:**
- `src/routes/upload/index.ts` — All `/api/v1/upload/*` routes
- `src/server.ts` — Mount upload router (before admin auth middleware)

### Step 4: Backend — /upload Slash Command

Register the Slack command handler.

**Files:**
- `src/listeners/commands/upload.ts` — Command handler generating token + ephemeral response
- `src/app.ts` — Register command: `registerUploadCommand(app)`

### Step 5: Backend — Update Config Doc Service

Extend existing service with new fields and S3 integration.

**Files:**
- `src/services/analyze/configDocService.ts` — Add `displayLabel`, `s3Key`, `originalMimeType`, `contentSizeBytes` handling in upsert/get/delete

### Step 6: Frontend — Upload Page

React page accessible at `/upload/:token` (public route, no admin auth).

**Files:**
- `admin-dashboard/src/pages/upload.tsx` — Main upload page component
- `admin-dashboard/src/services/upload.ts` — API client for upload endpoints
- `admin-dashboard/src/lib/query-keys.ts` — Add `upload` query keys
- `admin-dashboard/src/router.tsx` — Add public route `/upload/:token`

### Step 7: Admin — Channel-Client Mapping Management

Admin endpoints and UI for linking channels to clients.

**Files:**
- `src/routes/admin/channelMappings.ts` — CRUD routes for mappings
- `src/routes/admin/index.ts` — Mount channel-mappings router
- (Optional) Extend existing admin dashboard clients page with mapping UI

### Step 8: Deploy & Test

```bash
# Push to GitHub — CI/CD deploys to ECS
git push origin 13-client-doc-upload

# After ECS redeploy, deploy frontend:
cd admin-dashboard && npm run build
aws s3 sync dist/ s3://slkadmin-developerlabs-ai/ --delete
aws cloudfront create-invalidation --distribution-id E30ZVBVU06GFUV --paths "/*"
```

**Test Flow:**
1. Type `/upload` in a Slack channel
2. Click the link in the ephemeral message
3. Upload a file for each doc type
4. Verify Markdown preview, download original, rename label
5. Run `/analyze` and confirm it reads the uploaded config docs

## Key Dependencies

| Dependency | Already Installed | Purpose |
|------------|-------------------|---------|
| jsonwebtoken | Yes | JWT generation/validation |
| mammoth | Yes | DOCX → HTML conversion |
| pdf-parse | Yes | PDF text extraction |
| turndown | Yes | HTML → Markdown conversion |
| xlsx | Yes | XLSX parsing |
| multer | No — **must install** | Multipart file upload parsing for Express |
| @anthropic-ai/sdk | Yes | Claude Haiku for auto-labels |

## Environment Variables

No new environment variables needed. Existing config values used:
- `SESSION_SECRET` — Signs JWT tokens
- `S3_BUCKET` / AWS credentials — File storage
- `ANTHROPIC_API_KEY` — AI label generation
- `CORS_ALLOWED_ORIGINS` — Must include dashboard domain
