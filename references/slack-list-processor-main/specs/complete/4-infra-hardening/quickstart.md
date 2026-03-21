# Quickstart: AWS Infrastructure Hardening & Gap Resolution

**Branch**: `4-infra-hardening`
**Estimated changes**: 5 files modified, 0 files created (excluding spec artifacts)

## Prerequisites

- AWS CLI configured with appropriate permissions
- Docker installed (for testing container builds)
- Access to the `.env` file with all credentials
- Node.js 22+ and npm

## Implementation Order

Changes are ordered by dependency - later steps depend on earlier ones.

### Step 1: Fix package.json - Add missing `pg` dependency

```bash
npm install pg
```

**Files**: `package.json`, `package-lock.json`
**Validates**: FR-012 (explicit runtime dependencies)
**Risk**: Low - adds explicit dependency that was previously transitive

### Step 2: Fix health endpoint - Startup tolerance + version reporting

**File**: `src/routes/health.ts`

Changes:
- Always return HTTP 200 (remove 503 for degraded)
- Read version from `package.json` at startup instead of `process.env.npm_package_version`
- Keep `status: 'healthy' | 'degraded'` in response body

**Validates**: FR-014 (no restart loops), FR-022 (actual version)
**Risk**: Low - health check consumers must check `status` field, not HTTP code

### Step 3: Fix CORS - Restrict origins in production

**File**: `src/server.ts`

Changes:
- In production: restrict CORS to webhook-only pattern (or disable CORS since all consumers are server-to-server)
- In development: keep permissive CORS

**Validates**: FR-020 (restrict cross-origin requests)
**Risk**: Low - primary consumers (Slack Socket Mode, Apollo webhooks) are server-to-server and not subject to CORS

### Step 4: Add graceful shutdown handler

**File**: `src/app.ts`

Changes:
- Add SIGTERM/SIGINT handlers
- Shutdown sequence: close BullMQ workers -> close HTTP server -> disconnect Prisma -> disconnect Redis
- Log shutdown progress

**Validates**: FR-013 (graceful termination)
**Risk**: Medium - must verify BullMQ workers properly return in-flight jobs to queue on close

### Step 5: Update Redis client for TLS support

**File**: `src/lib/redis.ts`

Changes:
- ioredis auto-detects TLS from `rediss://` URL scheme, no code changes needed if URL is correct
- Verify connection works with both `redis://` (local dev) and `rediss://` (production)

**Validates**: FR-007 (cache encryption in transit)
**Risk**: Low - ioredis handles TLS transparently from URL scheme

### Step 6: Update Dockerfile - Build-time version injection

**File**: `Dockerfile`

Changes:
- Add `ARG APP_VERSION=1.0.0` in build stage
- Set `ENV APP_VERSION=$APP_VERSION` in production stage
- Health endpoint reads `APP_VERSION` env var

**Validates**: FR-022 (actual version in health response)
**Risk**: Low - additive change

### Step 7: Major CloudFormation overhaul

**File**: `infra/cloudformation.yaml`

This is the largest change. Apply in this order within the template:

1. **Secrets Manager secret** (new resource):
   - `AWS::SecretsManager::Secret` with all app secrets as JSON
   - Move secret values from CF parameters to Secrets Manager
   - Update container definition: change `Environment` entries to `Secrets` entries with `valueFrom`
   - Add `secretsmanager:GetSecretValue` to ECS Task Execution Role

2. **Redis migration** (resource replacement):
   - Replace `AWS::ElastiCache::CacheCluster` with `AWS::ElastiCache::ReplicationGroup`
   - Set `TransitEncryptionEnabled: true`, `AtRestEncryptionEnabled: true`
   - Single node: `ReplicasPerNodeGroup: 0`, `NumNodeGroups: 1`
   - Update REDIS_URL construction to use `rediss://` and ReplicationGroup endpoint

3. **HTTPS on ALB** (new resources + modified listener):
   - Add `ACMCertificateArn` parameter (optional)
   - Add Condition `HasCertificate`
   - Add HTTPS listener on 443 (conditional)
   - Modify HTTP listener: redirect to HTTPS when cert present, forward when not
   - Use `ELBSecurityPolicy-TLS13-1-2-2021-06`

4. **WAFv2** (new resources):
   - `AWS::WAFv2::WebACL` with rate-based rule (2000/5min per IP)
   - `AWS::WAFv2::WebACLAssociation` linked to ALB

5. **Multi-AZ NAT** (new resources):
   - Second EIP, second NAT Gateway in PublicSubnet2
   - Second private route table for PrivateSubnet2
   - Reassociate PrivateSubnet2 to new route table

6. **ECS Exec** (service modification):
   - Add `EnableExecuteCommand: true` to ECS Service
   - Add SSM permissions to Task Role

7. **Auto Scaling** (new resources):
   - `AWS::ApplicationAutoScaling::ScalableTarget` (min 1, max 4)
   - `AWS::ApplicationAutoScaling::ScalingPolicy` (CPU 70% target tracking)

8. **Target group tuning**:
   - Add `DeregistrationDelay: 60` to ALB target group attributes

9. **Cost tracking env vars**:
   - Add `BUILTWITH_COST_PER_CREDIT`, `APOLLO_COST_PER_CREDIT`, `AI_COST_PER_1K_INPUT_TOKENS`, `AI_COST_PER_1K_OUTPUT_TOKENS` to container Environment

10. **Cleanup outputs**:
    - Remove `DatabaseUrl` output
    - Update Redis endpoint output for ReplicationGroup
    - Add WAF WebACL ARN output

**Validates**: FR-001 through FR-003, FR-005 through FR-009, FR-011, FR-015 through FR-019, FR-021, FR-023
**Risk**: High - largest change, must be tested carefully. Redis replacement loses data.

### Step 8: Fix deploy script

**File**: `infra/deploy.sh`

Changes:
- Extract parameter building into a reusable function
- Pass all parameters on both initial and update `cloudformation deploy` calls
- Remove `info "Stack deployed. DB password: $DB_PASSWORD"` line
- Add Secrets Manager secret creation step before CloudFormation deployment
- Add `--update` mode that properly handles all parameters

**Validates**: FR-004 (no secrets in stdout), FR-009 (parameter persistence)
**Risk**: Medium - must test both fresh deploy and update paths

## Testing Strategy

### Local verification (pre-deploy)
```bash
# Verify pg dependency resolves
npm ci && npm run build

# Run tests
npm test

# Verify Docker build succeeds
docker build --platform linux/amd64 -t test-build .

# Test health endpoint locally (should return 200 with degraded when DB/Redis down)
npm run dev &
curl http://localhost:3000/api/v1/health
```

### CloudFormation validation
```bash
# Validate template syntax
aws cloudformation validate-template --template-body file://infra/cloudformation.yaml

# Test deploy in staging first (if available)
```

### Post-deploy verification
```bash
# Health check
curl https://<alb-dns>/api/v1/health

# Verify ECS Exec works
aws ecs execute-command --cluster prod-slack-list-processor \
  --task <task-id> --container app --interactive --command "/bin/sh"

# Test migration capability
aws ecs execute-command ... --command "npx prisma migrate deploy"

# Verify WAF is attached
aws wafv2 get-web-acl-for-resource --resource-arn <alb-arn>

# Verify secrets are not in CF outputs
aws cloudformation describe-stacks --stack-name slack-list-processor \
  --query 'Stacks[0].Outputs'
```

## Operational Notes

### Log Retention (FR-024)

CloudWatch log retention is set to **30 days** (`RetentionInDays: 30` on the LogGroup). This is appropriate for operational logs because:
- Audit-critical data (user actions, API calls, data changes) is stored in the PostgreSQL `audit_logs` table with permanent retention
- CloudWatch logs contain application debug/info output for troubleshooting recent issues
- 30 days provides sufficient window for post-incident analysis
- Longer retention adds cost without compliance benefit since auditable events are in the database

### ACM Certificate (FR-005/FR-006)

The ACM certificate must be provisioned separately before enabling HTTPS:
- Use **DNS validation** (not email validation) so the certificate auto-renews without manual intervention
- The certificate must be in the **same region** as the ALB (us-east-1 by default)
- Pass the certificate ARN via `ACM_CERTIFICATE_ARN` in the `.env` file
- Without a certificate, the ALB operates HTTP-only. FR-005 (HTTPS) is only fully satisfied when the certificate is provided

### Infrastructure Cost Estimate (Post-Hardening)

| Resource | Monthly Cost (est.) |
|----------|-------------------|
| ECS Fargate (0.5 vCPU, 1 GB, 1 task) | ~$15 |
| RDS db.t4g.small (PostgreSQL) | ~$29 |
| ElastiCache cache.t4g.micro (ReplicationGroup) | ~$13 |
| ALB (fixed hourly + LCU) | ~$18 |
| NAT Gateway x2 (hourly + data) | ~$64 |
| WAFv2 WebACL (1 rule) | ~$6 |
| Secrets Manager (1 secret) | ~$0.40 |
| S3 (minimal storage) | ~$1 |
| CloudWatch Logs (30-day retention) | ~$2 |
| ECR (image storage) | ~$1 |
| **Total** | **~$149/month** |

Notes:
- Auto-scaling (max 4 tasks) adds ~$45/task when scaled out
- Second NAT Gateway adds ~$32/month vs. single-NAT (included above)
- Data transfer costs vary by usage volume

## Rollback Plan

- CloudFormation maintains stack rollback capability. If stack update fails, it auto-rolls back.
- For application code changes: revert the git commit and redeploy.
- Redis data migration is one-way (CacheCluster -> ReplicationGroup). Rollback would require recreating the CacheCluster resource.
- Secrets Manager secret is independent of the stack and persists across rollbacks.
