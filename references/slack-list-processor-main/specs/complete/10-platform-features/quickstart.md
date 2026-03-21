# Quickstart: Platform Features

**Feature**: 10-platform-features

## Files to Create

### Backend
| File | Purpose |
| ---- | ------- |
| `src/lib/credentialResolver.ts` | Resolve active API key for service+client with dual-key fallback |
| `src/routes/admin/apiCredentials.ts` | CRUD endpoints for API key rotation |
| `src/routes/admin/licensing.ts` | License activation, status, and renewal endpoints |
| `src/services/retention/contactDataPurge.ts` | Batch purge of contact PII by retention policy |
| `src/services/licensing/licenseService.ts` | License lifecycle management (activate, validate, enforce) |
| `src/services/licensing/fingerprintGenerator.ts` | SHA-256 deployment fingerprint generation |
| `src/lib/licenseValidator.ts` | Ed25519 license key signature verification |
| `src/middleware/licenseGuard.ts` | Express middleware to enforce license validity |

### Frontend
| File | Purpose |
| ---- | ------- |
| `admin-dashboard/src/components/credentials/ApiKeyRotationPanel.tsx` | Key rotation UI with status badges and actions |
| `admin-dashboard/src/components/presets/PresetTagFilter.tsx` | Tag filter bar for enrichment presets list |
| `admin-dashboard/src/services/api-credentials.ts` | Frontend API service for credential rotation |
| `admin-dashboard/src/services/licensing.ts` | Frontend API service for license status |

## Files to Modify

### Schema
| File | Change |
| ---- | ------ |
| `prisma/schema.prisma` | Add `ApiCredentialStatus`, `ApiServiceType`, `LicenseStatus` enums. Add `ApiCredential`, `PresetTag`, `License` models. Extend `ManagedClient` (slackTeamId, apolloApiKey, builtwithApiKey), `EnrichmentPreset` (isEnabled, tags relation), `RetentionConfig` (clientId, composite unique). |

### Backend
| File | Change |
| ---- | ------ |
| `src/routes/admin/clientManagement.ts` | Add workspace fields (slackTeamId, apolloApiKey, builtwithApiKey) to create/update endpoints |
| `src/routes/admin/enrichmentPresets.ts` | Add tag management (assign/remove tags), enable/disable toggle, tag filter on list endpoint |
| `src/routes/admin/retention.ts` | Add per-client retention overrides (clientId parameter) |
| `src/routes/admin/index.ts` | Register new routes: apiCredentials, licensing |
| `src/lib/clientApiService.ts` | Update to use `credentialResolver.ts` for key lookups instead of direct ManagedClient fields |

### Frontend
| File | Change |
| ---- | ------ |
| `admin-dashboard/src/pages/managed-clients.tsx` | Add workspace fields to edit form, API credential rotation panel, per-client retention slider |
| `admin-dashboard/src/pages/enrichment-presets.tsx` | Add tag filter bar, enable/disable toggle per preset row, greyed-out visual for disabled |
| `admin-dashboard/src/pages/settings.tsx` | Add global retention settings section, license status section |
| `admin-dashboard/src/services/managed-clients.ts` | Add workspace fields to types and API calls |
| `admin-dashboard/src/services/enrichment-presets.ts` | Add tag and enable/disable fields to types and API calls |

## Key Patterns to Follow

- **Encryption**: Use `encrypt()` / `decrypt()` from `src/lib/tokenEncryption.ts` for all API keys (AES-256-GCM, format: `iv:authTag:ciphertext`)
- **Audit logging**: Use `logAudit()` from `src/lib/auditLogger.ts` for all mutations (key rotation, retention changes, license events)
- **Dialog pattern**: Follow `managed-bdrs.tsx` and `managed-clients.tsx` for edit/delete dialogs
- **AlertDialog**: Use for destructive actions (key revocation, data purge confirmation)
- **Service calls**: All API calls via `admin-dashboard/src/services/` with typed responses
- **Error display**: `actionError` pattern from existing detail pages
- **Batch deletion**: Follow `conversationPurge.ts` pattern for batch processing with stats tracking
- **Retention routes**: Follow existing `retention.ts` patterns (locked types, min retention days)
- **Tag normalization**: Lowercase, alphanumeric + hyphens, max 30 characters

## Schema Migration Steps

```bash
# 1. Update prisma/schema.prisma with all changes
# 2. Generate migration
npx prisma migrate dev --name platform-features

# 3. Generate Prisma client
npx prisma generate

# 4. Verify migration in local/staging before production
```

## Verification

### Phase 1: Workspace & Client Assignment
1. Create a client with `slackTeamId` set -> verify saved in DB
2. Add apolloApiKey and builtwithApiKey via edit form -> verify encrypted in DB
3. Deactivate a client -> verify assigned workflows do not execute
4. Filter clients by workspace -> verify list filters correctly

### Phase 2: API Key Rotation
1. Add a new API key for Instantly on a client -> verify both keys are ACTIVE
2. Trigger a workflow -> verify it uses the newest ACTIVE key
3. Simulate new key auth failure -> verify fallback to previous key
4. Deprecate old key -> verify it shows DEPRECATED status
5. Revoke deprecated key -> verify it shows REVOKED and cannot be reused
6. Try to revoke the last ACTIVE key -> verify error prevents it

### Phase 3: Enrichment Preset Tags
1. Create a preset with tags "it-leaders", "enterprise" -> verify tags saved
2. Filter presets by "it-leaders" tag -> verify only tagged presets shown
3. Disable a preset -> verify it disappears from workflow builder dropdown
4. Verify disabled preset still works in existing workflows
5. Re-enable preset -> verify it reappears in dropdown

### Phase 4: Data Retention
1. Set global retention to 30 days -> verify saved
2. Set per-client override to 60 days -> verify override takes precedence
3. Create test data older than retention period -> wait for purge cycle
4. Verify contact PII is deleted but job metadata remains
5. Verify audit log entry records purge stats

### Phase 5: Self-Hosted Licensing
1. Generate a test license key -> activate on deployment
2. Verify user count enforcement at limit
3. Set license to expire -> verify renewal reminder appears
4. Let grace period expire -> verify read-only mode
5. Reactivate with new license -> verify full access restored
