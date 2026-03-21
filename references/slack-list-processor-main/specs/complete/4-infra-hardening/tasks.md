# Tasks: AWS Infrastructure Hardening & Gap Resolution

**Input**: Design documents from `/specs/4-infra-hardening/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: No test tasks included (not requested in feature specification).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. Infrastructure (CloudFormation) tasks are split across user stories by concern.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Add missing dependencies and prepare build tooling

- [X] T001 Add `pg` runtime dependency to package.json (`npm install pg`)
- [X] T002 [P] Add build-time version injection to Dockerfile (`ARG APP_VERSION`, `ENV APP_VERSION`)

**Checkpoint**: Project builds successfully with explicit `pg` dependency and version injection support

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Application code fixes that MUST be complete before CloudFormation changes can be deployed safely

**CRITICAL**: No CloudFormation user story work should be deployed until this phase is complete, as the application must handle TLS connections, graceful shutdown, and health check tolerance for the hardened infrastructure to function correctly.

- [X] T003 Fix health endpoint startup tolerance and version reporting in src/routes/health.ts — always return HTTP 200, use `status: 'healthy' | 'degraded'` in body, read version from `APP_VERSION` env var falling back to package.json
- [X] T004 [P] Restrict CORS in production in src/server.ts — disable or restrict CORS when `NODE_ENV=production` (all consumers are server-to-server), keep permissive in development
- [X] T005 [P] Add graceful shutdown handler in src/app.ts — register `process.on('SIGTERM')` and `process.on('SIGINT')`, shutdown sequence: close BullMQ workers (`.close()`), close HTTP server (`.close()`), disconnect Prisma (`prisma.$disconnect()`), disconnect Redis

**Checkpoint**: Application handles TLS Redis URLs, survives health check without DB/Redis, shuts down gracefully on SIGTERM, and restricts CORS in production

---

## Phase 3: User Story 1 - Secure Secrets Management (Priority: P1)

**Goal**: Move all secrets from plain-text CloudFormation parameters/environment variables to AWS Secrets Manager with `valueFrom` references

**Independent Test**: Deploy the stack and confirm: (1) no secrets in CF outputs, (2) ECS task definition shows `valueFrom` references not plain text, (3) deploy script prints no secrets to stdout

### Implementation for User Story 1

- [X] T006 [US1] Add `AWS::SecretsManager::Secret` resource to infra/cloudformation.yaml — create a JSON-structured secret with keys for all app secrets (SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN, ANTHROPIC_API_KEY, BUILTWITH_API_KEY, APOLLO_API_KEY, WEBHOOK_SECRET)
- [X] T007 [US1] Update ECS container definition in infra/cloudformation.yaml — change secret environment variables from `Environment` entries with `Value` to `Secrets` entries with `valueFrom` referencing Secrets Manager ARN with JSON key syntax (`!Sub '${Secret}:KEY_NAME::'`)
- [X] T008 [US1] Add `secretsmanager:GetSecretValue` permission to ECS Task Execution Role in infra/cloudformation.yaml — add IAM policy statement scoped to the Secrets Manager secret ARN
- [X] T009 [US1] Remove `DatabaseUrl` output from infra/cloudformation.yaml Outputs section (FR-003)
- [X] T010 [US1] Remove DB password printing from infra/deploy.sh — delete the `info "Stack deployed. DB password: $DB_PASSWORD"` line (FR-004)

**Checkpoint**: All secrets flow through Secrets Manager. No secrets visible in CF outputs, ECS console, or deploy logs.

---

## Phase 4: User Story 2 - Encrypted Communications & Data Protection (Priority: P1)

**Goal**: Enable TLS everywhere — HTTPS on ALB, encryption in transit and at rest on Redis

**Independent Test**: Confirm ALB redirects HTTP to HTTPS, `rediss://` connection works, and ElastiCache resource shows encryption enabled

### Implementation for User Story 2

- [X] T011 [US2] Replace `AWS::ElastiCache::CacheCluster` with `AWS::ElastiCache::ReplicationGroup` in infra/cloudformation.yaml — set `ReplicasPerNodeGroup: 0`, `NumNodeGroups: 1`, `TransitEncryptionEnabled: true`, `AtRestEncryptionEnabled: true`, `Engine: redis`, `EngineVersion: '7.1'`, `CacheNodeType` from parameter
- [X] T012 [US2] Update Redis URL construction in infra/cloudformation.yaml — change from `redis://` to `rediss://` and update endpoint reference from `CacheCluster.RedisEndpoint` to `ReplicationGroup.PrimaryEndPoint.Address` and `PrimaryEndPoint.Port`
- [X] T013 [US2] Add `ACMCertificateArn` parameter (Type: String, Default: '') and `HasCertificate` condition (`!Not [!Equals [!Ref ACMCertificateArn, '']]`) to infra/cloudformation.yaml
- [X] T014 [US2] Add HTTPS listener on port 443 in infra/cloudformation.yaml — conditional on `HasCertificate`, forward to existing target group, use `SslPolicy: ELBSecurityPolicy-TLS13-1-2-2021-06`, reference `ACMCertificateArn`
- [X] T015 [US2] Modify existing HTTP listener (port 80) in infra/cloudformation.yaml — when `HasCertificate` is true, change action to redirect to HTTPS (StatusCode 301); when false, keep existing forward action
- [X] T016 [US2] Update `WEBHOOK_BASE_URL` in container definition environment in infra/cloudformation.yaml — use `https://` when certificate is present, `http://` when not

**Checkpoint**: Redis uses TLS, ALB serves HTTPS with HTTP redirect, all data encrypted in transit and at rest

---

## Phase 5: User Story 3 - Safe & Reliable Deployments (Priority: P1)

**Goal**: Fix deploy script parameter persistence, enable ECS Exec for migrations and debugging

**Independent Test**: Run deploy script in update mode and confirm all parameters persist. Run `aws ecs execute-command` to get a shell in the container.

### Implementation for User Story 3

- [X] T017 [US3] Refactor infra/deploy.sh parameter building — extract all CloudFormation parameter overrides into a reusable shell function, ensure both initial deploy and update invocations pass ALL parameters (secrets from .env + DockerImageUri + ACMCertificateArn)
- [X] T018 [US3] Add Secrets Manager secret creation step to infra/deploy.sh — before CloudFormation deployment, create or update the Secrets Manager secret with values from .env file using AWS CLI (`aws secretsmanager create-secret` / `put-secret-value`)
- [X] T019 [P] [US3] Enable ECS Exec on the ECS Service in infra/cloudformation.yaml — add `EnableExecuteCommand: true` to `AWS::ECS::Service` properties
- [X] T020 [P] [US3] Add SSM permissions to ECS Task Role in infra/cloudformation.yaml — add IAM policy with `ssmmessages:CreateControlChannel`, `ssmmessages:CreateDataChannel`, `ssmmessages:OpenControlChannel`, `ssmmessages:OpenDataChannel` actions
- [X] T021 [US3] Add `stopTimeout: 25` to container definition in infra/cloudformation.yaml — gives 25s for graceful shutdown before SIGKILL (5s buffer within ECS 30s window)

**Checkpoint**: Deploy script is idempotent across updates, ECS Exec enables shell access, container has proper shutdown timeout

---

## Phase 6: User Story 4 - Application Resilience & Graceful Lifecycle (Priority: P2)

**Goal**: Add auto-scaling to ECS service for resilience and load handling

**Independent Test**: Confirm `ScalableTarget` and `ScalingPolicy` resources exist in the template. Deploy and verify ECS service auto-scales at 70% CPU.

**Note**: Graceful shutdown (T005) and health check tolerance (T003) were implemented in Phase 2 (Foundational) as they are blocking prerequisites.

### Implementation for User Story 4

- [X] T022 [US4] Add `AWS::ApplicationAutoScaling::ScalableTarget` to infra/cloudformation.yaml — set `MinCapacity: 1`, `MaxCapacity: 4`, `ResourceId` referencing ECS service, `ScalableDimension: ecs:service:DesiredCount`, `ServiceNamespace: ecs`
- [X] T023 [US4] Add `AWS::ApplicationAutoScaling::ScalingPolicy` to infra/cloudformation.yaml — `TargetTrackingScaling` type, `PredefinedMetricSpecification` with `ECSServiceAverageCPUUtilization`, `TargetValue: 70`, `ScaleOutCooldown: 60`, `ScaleInCooldown: 180`

**Checkpoint**: ECS service auto-scales between 1-4 tasks based on CPU utilization

---

## Phase 7: User Story 5 - Network Resilience & High Availability (Priority: P2)

**Goal**: Eliminate single-AZ NAT Gateway failure point, tune target group deregistration

**Independent Test**: Confirm two NAT Gateways in separate AZs with independent route tables. Verify target group deregistration delay is 60s.

### Implementation for User Story 5

- [X] T024 [P] [US5] Add second NAT Gateway resources to infra/cloudformation.yaml — create `NATElasticIP2` (AWS::EC2::EIP) and `NATGateway2` (AWS::EC2::NatGateway) in PublicSubnet2
- [X] T025 [US5] Add second private route table in infra/cloudformation.yaml — create `PrivateRouteTable2` with route to `NATGateway2`, reassociate `PrivateSubnet2` from shared `PrivateRouteTable` to `PrivateRouteTable2`
- [X] T026 [P] [US5] Set `DeregistrationDelay` to 60 on ALB target group in infra/cloudformation.yaml — add `TargetGroupAttributes` with `deregistration_delay.timeout_seconds: 60`

**Checkpoint**: Each private subnet routes through its local AZ NAT Gateway; target group drains in 60s

---

## Phase 8: User Story 6 - Webhook Endpoint Protection (Priority: P2)

**Goal**: Protect ALB with WAFv2 rate limiting

**Independent Test**: Confirm WAF WebACL is associated with ALB. Verify rate-based rule blocks >2000 req/5min per IP.

**Note**: CORS restriction (T004) was implemented in Phase 2 (Foundational).

### Implementation for User Story 6

- [X] T027 [US6] Add `AWS::WAFv2::WebACL` to infra/cloudformation.yaml — scope `REGIONAL`, default action `Allow`, add rate-based rule with `Limit: 2000` per 5-minute window per IP, include CloudWatch metric configuration
- [X] T028 [US6] Add `AWS::WAFv2::WebACLAssociation` to infra/cloudformation.yaml — associate WebACL with ALB ARN
- [X] T029 [US6] Add WAF WebACL ARN to CloudFormation Outputs in infra/cloudformation.yaml

**Checkpoint**: WAF protects ALB endpoint, rate limiting active, WAF ARN exported for monitoring

---

## Phase 9: User Story 7 - Operational Visibility & Configuration Completeness (Priority: P3)

**Goal**: Add missing cost-tracking env vars, document log retention

**Independent Test**: Confirm all 4 cost-tracking env vars are in the ECS task definition. Health endpoint returns actual version.

**Note**: Version reporting fix (T003) was implemented in Phase 2, Dockerfile version injection (T002) in Phase 1.

### Implementation for User Story 7

- [X] T030 [US7] Add cost-tracking environment variables to ECS container definition in infra/cloudformation.yaml — add `BUILTWITH_COST_PER_CREDIT`, `APOLLO_COST_PER_CREDIT`, `AI_COST_PER_1K_INPUT_TOKENS`, `AI_COST_PER_1K_OUTPUT_TOKENS` with default values from .env.example
- [X] T031 [US7] Add CloudFormation parameters for cost-tracking values in infra/cloudformation.yaml — add parameters with sensible defaults so they can be overridden at deploy time
- [X] T032 [US7] Update Redis endpoint output in infra/cloudformation.yaml — change output reference from CacheCluster to ReplicationGroup primary endpoint

**Checkpoint**: All cost-tracking config present, Redis output updated, log retention documented

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Validation and verification across all user stories

- [X] T033 Validate CloudFormation template syntax — run `aws cloudformation validate-template --template-body file://infra/cloudformation.yaml`
- [X] T034 Run `npm run build` to verify TypeScript compilation succeeds with all changes
- [X] T035 Run `npm test` to verify no regressions in existing test suite (1 pre-existing test file failure: personaClassifier.test.ts missing DATABASE_URL — not caused by our changes, all 94 tests pass)
- [ ] T036 [P] Verify Docker build succeeds — run `docker build --platform linux/amd64 -t test-build .`
- [ ] T037 Run quickstart.md local verification checklist (npm ci, npm run build, npm test, Docker build, local health endpoint curl)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all CloudFormation deployments
- **US1 (Phase 3)**: Depends on Foundational — CF changes for secrets
- **US2 (Phase 4)**: Depends on Foundational — CF changes for encryption. Independent of US1.
- **US3 (Phase 5)**: Depends on US1 (deploy script needs to handle Secrets Manager). Partially parallel with US2 (ECS Exec tasks T019-T020 are independent).
- **US4 (Phase 6)**: Depends on Foundational — CF auto-scaling resources. Independent of US1-US3.
- **US5 (Phase 7)**: Depends on Foundational — CF NAT resources. Independent of US1-US4.
- **US6 (Phase 8)**: Depends on Foundational — CF WAF resources. Independent of US1-US5.
- **US7 (Phase 9)**: Depends on US2 (Redis output change). Independent of US1, US3-US6.
- **Polish (Phase 10)**: Depends on ALL user stories being complete

### User Story Dependencies

- **US1 (P1)**: Start after Phase 2 — No dependencies on other stories
- **US2 (P1)**: Start after Phase 2 — No dependencies on other stories
- **US3 (P1)**: Start after Phase 2 — T017-T018 depend on US1 (Secrets Manager creation in deploy script references the secret created in US1)
- **US4 (P2)**: Start after Phase 2 — No dependencies on other stories
- **US5 (P2)**: Start after Phase 2 — No dependencies on other stories
- **US6 (P2)**: Start after Phase 2 — No dependencies on other stories
- **US7 (P3)**: Start after US2 (T032 depends on Redis ReplicationGroup from T011)

### Within CloudFormation (infra/cloudformation.yaml)

All CF changes across US1-US7 target the same file. When implementing sequentially:
1. US1 tasks (T006-T009) first — adds Secrets Manager, updates container definition
2. US2 tasks (T011-T016) second — replaces Redis, adds HTTPS
3. US3 tasks (T019-T021) third — enables ECS Exec, adds stopTimeout
4. US4 tasks (T022-T023) — adds auto-scaling
5. US5 tasks (T024-T026) — adds second NAT, target group tuning
6. US6 tasks (T027-T029) — adds WAF
7. US7 tasks (T030-T032) — adds cost env vars, updates outputs

### Parallel Opportunities

Within each phase, tasks marked [P] can run in parallel:
- **Phase 1**: T001 and T002 (different files: package.json vs Dockerfile)
- **Phase 2**: T003, T004, T005 (different files: health.ts, server.ts, app.ts)
- **Phase 5**: T019 and T020 (both CF but different resource sections)
- **Phase 7**: T024 and T026 (different CF resource sections)

Across phases (if multiple implementers):
- US1, US2, US4, US5, US6 can all start simultaneously after Phase 2 (but CF file conflicts require coordination)
- Application code phases (1-2) are fully independent of CF phases (3-9)

---

## Implementation Strategy

### MVP First (US1 + US2 + US3 — Critical Security)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational (T003-T005)
3. Complete Phase 3: US1 - Secrets Management (T006-T010)
4. Complete Phase 4: US2 - Encryption (T011-T016)
5. Complete Phase 5: US3 - Deployment Safety (T017-T021)
6. **STOP and VALIDATE**: All CRITICAL issues resolved. Deploy and test.

### Incremental Delivery

1. Setup + Foundational → Application code hardened
2. US1 → Secrets secured → Deploy/Validate
3. US2 → Encryption enabled → Deploy/Validate (Redis replacement = data loss, coordinate timing)
4. US3 → Deploy script fixed, ECS Exec enabled → Deploy/Validate
5. US4 → Auto-scaling active → Deploy/Validate
6. US5 + US6 → Network resilience + WAF → Deploy/Validate
7. US7 → Operational completeness → Deploy/Validate
8. Polish → Full validation against all 20 audit findings

### Key Risk: Redis Migration (T011)

The Redis migration from CacheCluster to ReplicationGroup is a **replacement operation** that causes data loss. Schedule this during a maintenance window when:
- No enrichment jobs are in-flight
- No active Slack conversation flows
- BullMQ queues are empty

This is acceptable because Redis data is ephemeral, but operators should be aware.
