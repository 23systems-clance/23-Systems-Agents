# Quickstart: Performance Audit & Optimization

**Feature**: 30-performance-audit
**Date**: 2026-03-17

## Prerequisites

- AWS ECS Fargate cluster: `prod-slack-list-processor`
- AWS RDS PostgreSQL (existing)
- AWS ElastiCache Redis (existing)
- GitHub Actions CI/CD pipeline (existing)
- ECS task role with `logs:PutLogEvents` permission (for CloudWatch EMF)

## New Dependencies

```bash
npm install aws-embedded-metrics exceljs
```

| Package | Version | Purpose |
|---------|---------|---------|
| `aws-embedded-metrics` | ^4.x | CloudWatch Embedded Metric Format for zero-latency custom metrics |
| `exceljs` | ^4.x | Streaming Excel generation (replaces SheetJS for writing) |

**Note**: `xlsx` (SheetJS) is retained for file parsing (reading uploaded files). Only the write path changes to ExcelJS.

## Environment Variables

Add to ECS task definition (via CloudFormation or deploy script):

```env
# CloudWatch EMF configuration
AWS_EMF_ENVIRONMENT=ECS
AWS_EMF_NAMESPACE=SlackListProcessor
AWS_EMF_LOG_GROUP_NAME=/ecs/prod-slack-list-processor

# Stale job detection (optional — defaults shown)
STALE_JOB_THRESHOLD_MS=1800000
STALE_JOB_CHECK_INTERVAL_MS=300000
```

## Database Migration

Run after deployment:

```bash
npx prisma migrate deploy
```

The migration adds 11 composite indexes across 6 models. This is a non-destructive, additive change. Index creation on existing tables may take a few seconds depending on data volume.

## Implementation Order

### Phase 1: Foundation (no behavior change)
1. Add `aws-embedded-metrics` and `exceljs` to `package.json`
2. Create `src/services/metrics/cloudwatch.ts` — CloudWatch EMF utility
3. Create `src/lib/retryHelper.ts` — shared retry-with-backoff utility
4. Add Prisma `$extends` query timing to `src/lib/prisma.ts`
5. Run Prisma migration for composite indexes

### Phase 2: Core Pipeline Optimization
6. Refactor file generation to use ExcelJS streaming + chunked DB reads
7. Add partial result delivery on file generation failure (FR-014)
8. Add job priority tiers to enrichment queue (FR-008)
9. Wrap batch DB operations in transactions (FR-007)
10. Add domain deduplication within batches (FR-006)

### Phase 3: Reliability
11. Add Slack message retry with backoff (FR-004)
12. Create stale job detector worker + maintenance queue (FR-003)
13. Add cache validation checks (FR-012)

### Phase 4: Dashboard & Observability
14. Replace error trends in-memory aggregation with DB-side GROUP BY
15. Enforce pagination limits on admin API endpoints (FR-009)
16. Add cache effectiveness metrics to dashboard (FR-010)
17. Instrument enrichment pipeline with CloudWatch metrics (FR-013)

## Verification

After deployment, verify via:

1. **CloudWatch Metrics**: Check `SlackListProcessor` namespace in CloudWatch console for new metrics appearing
2. **Stale Job Detection**: Check CloudWatch Logs for `detect-stale-jobs` worker activity every 5 minutes
3. **Job Priority**: Submit a small job (<500 rows) and a large job (>2000 rows) — small job should process first if both are queued
4. **Dashboard Performance**: Load admin dashboard pages and verify <3s load times
5. **File Generation**: Submit a 5,000-row combined enrichment and verify output file delivered without memory errors

## Rollback

All changes are additive. To rollback:
1. Revert the Git commit and push — CI/CD redeploys previous version
2. Indexes remain (harmless) — remove via a separate migration if needed
3. Maintenance queue scheduler is idempotent — stops producing jobs when worker is not deployed
