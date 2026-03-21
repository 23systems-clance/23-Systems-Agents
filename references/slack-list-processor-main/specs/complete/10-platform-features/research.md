# Research: Platform Features

**Feature**: 10-platform-features
**Date**: 2026-03-10

## R-001: Workspace Isolation Model

**Decision**: Extend the existing `ManagedClient` model with workspace-level fields rather than creating a separate `Workspace` table.

**Rationale**: `ManagedClient` already serves as the client container with `instantlyApiKey`, `heyreachApiKey`, `hubspotApiKey`, and `isActive`. Adding workspace isolation fields (slug, slackTeamId scope) to `ManagedClient` avoids a join table and keeps the foreign key relationships (`Campaign.clientId`, `BdrClient.clientId`, `ChannelClientMapping.clientId`) intact. The existing `ChannelClientMapping` already maps Slack channels to clients, providing the channel-level isolation foundation.

**New fields on ManagedClient**:
- `slackTeamId` (optional String) - Scope client to a workspace installation. Null means global/unscoped.
- `apolloApiKey` (optional encrypted String) - Apollo credential per client (currently global only).
- `builtwithApiKey` (optional encrypted String) - BuiltWith credential per client (currently global only).

**Alternatives considered**:
- New `Workspace` table with `ManagedClient` as child: Rejected - introduces unnecessary indirection. ManagedClient IS the workspace concept. Adding a parent table would require migrating all existing FKs and breaking the Campaign/BdrClient relationships.
- Many-to-many workspace-to-client: Rejected - each client belongs to exactly one workspace context. One-to-one mapping is sufficient.

## R-002: API Key Rotation Strategy (Dual-Key Pattern)

**Decision**: Create a new `ApiCredential` table with multi-key per service per workspace, using a status lifecycle of `ACTIVE -> DEPRECATED -> REVOKED`.

**Rationale**: The current pattern stores API keys directly on `ManagedClient` as single encrypted fields (`instantlyApiKey`, `heyreachApiKey`, `hubspotApiKey`). This does not support rotation without downtime. A separate `ApiCredential` table allows multiple keys per service, with the newest `ACTIVE` key used by default and automatic fallback to the previous `ACTIVE` key if the newest fails.

**Dual-key rotation flow**:
```
1. Admin adds new key for service X → status = ACTIVE
2. Both old and new keys are ACTIVE simultaneously (transition period)
3. System uses newest ACTIVE key for all new requests
4. If newest key fails auth → fallback to previous ACTIVE key, alert admin
5. Admin deprecates old key → status = DEPRECATED (no longer used)
6. Admin revokes old key → status = REVOKED (permanent, cannot be reactivated)
```

**Guard rail**: The system prevents revoking the last `ACTIVE` key for any service. At least one `ACTIVE` key must remain.

**Encryption**: Reuse existing `encrypt()` / `decrypt()` from `src/lib/tokenEncryption.ts` (AES-256-GCM). The `ApiCredential.encryptedKey` field stores the same `iv:authTag:ciphertext` format.

**Migration path**: Existing keys on `ManagedClient` (`instantlyApiKey`, `heyreachApiKey`, `hubspotApiKey`) will be migrated to `ApiCredential` records during a one-time migration. The old fields remain for backward compatibility but are deprecated.

**Alternatives considered**:
- Rotate in-place on ManagedClient fields: Rejected - no transition period, no fallback, no audit trail of previous keys.
- External secrets manager (AWS Secrets Manager): Rejected - adds latency and cost. The existing AES-256-GCM encryption in the database is sufficient for the current scale. Can be revisited for SOC 2 Type II certification.

## R-003: Tag Storage Model (Many-to-Many vs JSON Array)

**Decision**: Use a many-to-many relationship with a junction table (`EnrichmentPresetTag` + `_EnrichmentPresetToTag` junction).

**Rationale**: Tags need to be queryable for filtering (FR-012: "filter presets list by tag"). A many-to-many with a `Tag` table allows:
- `SELECT DISTINCT tag FROM tags` for tag autocomplete
- Efficient `WHERE preset.tags.some(tag => tag.name === X)` Prisma queries
- Tag normalization (no duplicates like "IT Leaders" vs "it-leaders")
- Tag deletion cascades properly

The `ContentLibraryItem` model already uses `categoryTags String[]` (JSON array), but that model does not require tag-based filtering across entities. For presets, where filtering is a primary use case, a relational model is superior.

**Tag normalization rules**:
- Lowercased, trimmed
- Special characters replaced with hyphens
- Max 30 characters
- Alphanumeric + hyphens only

**Alternatives considered**:
- JSON array on EnrichmentPreset (`tags String[]`): Rejected - cannot efficiently query "all presets with tag X" without full table scan. No tag normalization or deduplication.
- Separate `Tag` table with global scope: Selected approach uses preset-scoped tags. A global tag registry is overkill for the current use case.

## R-004: Data Retention Purge Strategy

**Decision**: Extend the existing `RetentionConfig` model with workspace scoping and implement batch deletion via a scheduled BullMQ job.

**Rationale**: The existing `RetentionConfig` model stores per-data-type retention periods (e.g., `conversation_turns` = 7 days). For platform features, we need per-workspace retention overrides. The existing `conversationPurge.ts` and `workspaceDisposal.ts` services demonstrate the batch deletion pattern.

**Purge scope** (FR-017 - contact-level data only):
- `JobContact` - PII fields (names, emails, phones, enrichment data)
- `CampaignContact` - PII fields (names, emails, phones)
- `Job.resultFileUrl` / `Job.resultFileName` - S3 result files containing contact data
- S3 objects for result files (delete from S3 bucket)

**Retained permanently** (FR-018):
- `Job` metadata (id, status, timestamps, row counts, error messages)
- `JobCompany` metadata (domain, company name, enrichment status)
- `AuditLog` entries
- `DailyAggregate` cost/usage data
- `ErrorLog` entries
- `AgentThreadAudit` summaries

**Batch strategy**:
- Process 100 records per batch to avoid long transactions
- Use `prisma.$transaction()` per batch for atomicity
- Rollback on failure; retry on next scheduled cycle
- Log purge stats to `AuditLog` after each run

**Schedule**: Daily at 02:00 UTC via BullMQ repeatable job (matches existing `conversationPurge` pattern).

**Per-workspace override**: Add optional `clientId` FK to `RetentionConfig`. When set, the retention period applies only to data associated with that client. Global config (no clientId) serves as default.

**Alternatives considered**:
- Immediate deletion on data age: Rejected - expensive to check every record on every operation. Batch is more efficient.
- PostgreSQL `pg_cron` for purge: Rejected - keeps purge logic outside the application, harder to test and audit.
- Soft delete (mark as purged): Rejected - defeats the purpose of data retention. SOC 2 requires actual deletion of PII after retention period.

## R-005: Cryptographic License Key Format (Self-Hosted)

**Decision**: Use Ed25519-signed JSON license tokens with offline validation.

**Rationale**: Self-hosted deployments must validate licenses without an internet connection after initial activation (FR-023). A cryptographic signature scheme allows the platform to verify license authenticity using only the embedded public key.

**License key format**:
```
LICENSE-v1.<base64url-encoded-payload>.<base64url-encoded-signature>
```

**Payload structure (JSON)**:
```json
{
  "lid": "uuid",
  "org": "Company Name",
  "users": 15,
  "exp": "2027-03-10T00:00:00Z",
  "iat": "2026-03-10T00:00:00Z",
  "fp": "sha256-deployment-fingerprint",
  "tier": "base"
}
```

**Validation flow**:
```
1. Parse license key → extract payload + signature
2. Verify Ed25519 signature using embedded public key
3. Check expiry date (exp) against current time
4. Compare deployment fingerprint (fp) against local machine fingerprint
5. If all checks pass → license is valid, store in License table
6. Grace period: 14 days past exp before read-only mode
```

**Deployment fingerprint**: SHA-256 hash of `hostname + MAC address + database connection string`. Generated during initial activation and stored in the License record. Prevents license key reuse across deployments.

**Key generation** (admin tooling, not in platform):
- Ed25519 keypair generated offline
- Private key held by Dev Labs (never deployed)
- Public key embedded in platform binary/config
- `src/lib/licenseValidator.ts` handles verification

**Alternatives considered**:
- RSA-2048 signatures: Rejected - Ed25519 keys and signatures are smaller (32 bytes vs 256 bytes), faster to verify, and equally secure.
- License server (phone-home): Rejected - FR-023 requires offline validation after activation. A license server adds a single point of failure.
- Time-limited JWT tokens: Rejected - JWTs are designed for short-lived auth tokens, not long-lived licenses. Custom format gives more control over payload structure and validation logic.
- Hardware dongle: Rejected - impractical for cloud/container deployments.

## R-006: Enrichment Preset Enable/Disable Strategy

**Decision**: Add `isEnabled` boolean field to `EnrichmentPreset` model with default `true`.

**Rationale**: Simple boolean toggle is sufficient. Disabled presets are excluded from workflow builder dropdowns (FR-014) but remain visible in the admin management page with a visual indicator (FR-011). Existing workflows referencing a disabled preset continue to function (FR-015) - the disable only affects new configurations.

**Query pattern**:
- Admin preset list: `findMany()` with no `isEnabled` filter (show all with visual indicator)
- Workflow builder dropdown: `findMany({ where: { isEnabled: true } })` (only show enabled)

**Alternatives considered**:
- Soft-delete (archive) pattern: Rejected - presets should be easily re-enabled, not archived.
- Status enum (ACTIVE/DISABLED/ARCHIVED): Rejected - overengineered for a binary toggle. Can be extended later if needed.
