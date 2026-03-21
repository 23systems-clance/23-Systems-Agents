# Tasks: Staging Environment

**Input**: Design documents from `/specs/40-staging-environment/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: Not requested — no test tasks generated.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Manual Prerequisites)

**Purpose**: Manual steps that must be completed before any automation tasks. These are human-performed actions in external systems.

- [ ] T001 Create "List Processor - Staging" Slack app at api.slack.com/apps using the same manifest/scopes as the production app. Install to the same workspace. Record: Bot Token (xoxb-...), App-Level Token (xapp-... with connections:write scope), Signing Secret, Client ID, Client Secret.
- [ ] T002 Create GitHub Environments in repo Settings > Environments: (1) `staging` environment restricted to `develop` branch with AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY secrets, (2) `production` environment restricted to `main` branch with same secret names.
- [ ] T003 Create Slack Incoming Webhook for #deployments channel. Add the webhook URL as `SLACK_WEBHOOK_URL` repository-level secret in GitHub repo Settings > Secrets.
- [ ] T004 Create `develop` branch from `main` and push to origin: `git checkout main && git pull && git checkout -b develop && git push -u origin develop`

---

## Phase 2: Foundational (CloudFormation Template Modifications)

**Purpose**: Modify the shared CloudFormation template to support cost-optimized staging via conditional NAT Gateway. These changes must be deployed before the staging stack can be created.

**CRITICAL**: No staging infrastructure can be deployed until this phase is complete.

- [x] T005 Add `IsProduction` condition to `infra/cloudformation.yaml` based on `EnvironmentName` parameter: `IsProduction: !Equals [!Ref EnvironmentName, 'prod']`. This condition will gate resources that should only exist in production (second NAT Gateway).
- [x] T006 Make the second NAT Gateway conditional in `infra/cloudformation.yaml`: Add `Condition: IsProduction` to the `NATElasticIP2`, `NATGateway2`, `PrivateRouteTable2`, and `PrivateRoute2` resources. Do NOT modify `PrivateSubnet2RouteAssoc` here — T007 handles the route association change separately.
- [x] T007 Update `PrivateSubnet2RouteAssoc` in `infra/cloudformation.yaml` to conditionally associate PrivateSubnet2 with either PrivateRouteTable2 (production, 2 NATs) or PrivateRouteTable (staging, 1 NAT). Remove the existing `PrivateSubnet2RouteAssoc` resource and replace with two conditional resources: `PrivateSubnet2RouteAssocProd` (Condition: IsProduction, routes via PrivateRouteTable2) and `PrivateSubnet2RouteAssocStaging` (Condition: !IsProduction, routes via PrivateRouteTable).
- [x] T008 Add subnet CIDR parameterization to `infra/cloudformation.yaml`: Add parameters `PublicSubnet1Cidr` (default 10.0.1.0/24), `PublicSubnet2Cidr` (default 10.0.2.0/24), `PrivateSubnet1Cidr` (default 10.0.10.0/24), `PrivateSubnet2Cidr` (default 10.0.11.0/24). Replace hardcoded CIDR values in the four subnet resources with `!Ref` to these parameters. This enables staging to use different CIDR ranges (10.1.x.x) when deployed with VpcCidr=10.1.0.0/16.

**Checkpoint**: CloudFormation template now supports both staging (1 NAT, smaller instances) and production (2 NATs, larger instances) from the same template.

---

## Phase 3: User Story 1 + 2 - Deploy to Staging & Isolated Infrastructure (Priority: P1) MVP

**Goal**: Deploy a fully isolated staging CloudFormation stack and configure CI/CD to auto-deploy on push to `develop`. US1 and US2 are combined because deploying the staging stack inherently creates the isolated infrastructure.

**Independent Test**: Push a commit to `develop`. Verify staging ECS deploys. Message the staging Slack bot with "ENRICH" and verify it responds. Confirm production bot still works independently. Run a staging enrichment job and verify production data is untouched.

### Implementation

- [x] T009 [US1] Parameterize `infra/deploy.sh` to accept environment via CLI args: Add `--env` flag (default: `prod`) that sets `ENV_NAME`, `STACK_NAME` (`${ENV_NAME}-slack-list-processor` for staging, `slack-list-processor` for prod), and `SECRET_NAME`. Update the script to read from `.env.staging` when `--env staging` is passed instead of `.env`. Keep backward compatibility (no args = production behavior).
- [x] T010 [US1] Create `.env.staging.example` at repository root with the same structure as `.env.example` but with placeholder comments indicating which values differ for staging (SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET, SLACK_CLIENT_ID, SLACK_CLIENT_SECRET) and which are shared (BUILTWITH_API_KEY, APOLLO_API_KEY, ANTHROPIC_API_KEY, all other API keys). Also update `.env.example` to add comments documenting which variables are environment-specific (Slack tokens) vs shared (API keys) — this eliminates the need for a separate T028 task.
- [ ] T011 [US1] Deploy staging CloudFormation stack by running `./infra/deploy.sh --env staging` with a populated `.env.staging` file containing the staging Slack app credentials from T001. Use parameters: `EnvironmentName=staging`, `VpcCidr=10.1.0.0/16`, `PublicSubnet1Cidr=10.1.1.0/24`, `PublicSubnet2Cidr=10.1.2.0/24`, `PrivateSubnet1Cidr=10.1.10.0/24`, `PrivateSubnet2Cidr=10.1.11.0/24`, `DBInstanceClass=db.t4g.micro`, `ContainerCpu=256`, `ContainerMemory=512`. The subnet CIDRs must match the VPC CIDR range (10.1.x.x). Record stack outputs (ALB DNS, RDS endpoint, Redis endpoint, ECR URI, S3 bucket).
- [ ] T012 [US1] Populate staging Secrets Manager secret (`staging-slack-list-processor-secrets`) with staging Slack tokens from T001, shared API keys (copy from production secret), and staging DATABASE_URL constructed from the staging RDS endpoint. Use AWS CLI: `aws secretsmanager put-secret-value`.
- [ ] T013 [US1] Run Prisma migrations on the staging database using a one-off ECS task: `aws ecs run-task --cluster staging-slack-list-processor --task-definition staging-slack-list-processor --network-configuration <from-stack-outputs> --overrides '{"containerOverrides":[{"name":"app","command":["npx","prisma","migrate","deploy"]}]}'`. This avoids the `--interactive` flag which requires a TTY and won't work in automated CI/CD contexts.
- [x] T014 [US1] Create reusable GitHub Actions workflow in `.github/workflows/deploy-ecs.yml` with `workflow_call` trigger. Inputs: `environment` (string), `ecr-repo` (string), `ecs-cluster` (string), `ecs-service` (string). Secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SLACK_WEBHOOK_URL`. Steps: checkout, configure AWS credentials, ECR login, Docker build/tag/push (linux/amd64), force ECS deployment, wait for stability, Slack failure notification using `ravsamhq/notify-slack-action@v2` with `if: failure()`.
- [x] T015 [US1] Update `.github/workflows/deploy.yml` to: (1) trigger on push to both `main` and `develop` branches, (2) add `deploy-staging` job with `if: github.ref == 'refs/heads/develop'` calling the reusable workflow with `environment: staging`, `ecr-repo: staging-slack-list-processor`, `ecs-cluster: staging-slack-list-processor`, `ecs-service: staging-slack-list-processor`, (3) refactor existing production deploy to `deploy-production` job with `if: github.ref == 'refs/heads/main'` calling the same reusable workflow with production parameters, (4) pass secrets using `secrets: inherit`.
- [x] T016 [US1] Add Prisma migration step to the reusable workflow in `.github/workflows/deploy-ecs.yml`: After ECS service stabilizes, run migrations using `aws ecs run-task` with a command override (`["npx","prisma","migrate","deploy"]`) as a one-off task. Do NOT use `aws ecs execute-command --interactive` as it requires a TTY unavailable in CI/CD. Wait for the task to complete using `aws ecs wait tasks-stopped` and check the exit code. This ensures database schema stays in sync with each deployment.

**Checkpoint**: Pushing to `develop` auto-deploys to staging. Pushing to `main` auto-deploys to production. Both environments are fully isolated with separate VPCs, databases, Redis, S3, and Slack bots. Deployment failures notify #deployments channel.

---

## Phase 4: User Story 3 - Staging Admin Dashboard (Priority: P2)

**Goal**: Deploy a separate admin dashboard for staging on its own CloudFront + S3 distribution, pointing to the staging ALB for API requests.

**Independent Test**: Visit the staging dashboard URL. Verify it shows staging data only. Run a staging enrichment job and confirm it appears in the staging dashboard.

### Implementation

- [ ] T017 [US3] Create staging S3 bucket for admin dashboard: `aws s3 mb s3://staging-slkadmin-developerlabs-ai --region us-east-1`.
- [x] T018 [US3] Create `infra/staging-cloudfront-config.json` by copying `infra/cloudfront-config.json` and modifying: (1) S3 origin DomainName to `staging-slkadmin-developerlabs-ai.s3.us-east-1.amazonaws.com`, (2) ALB origin DomainName to the staging ALB DNS from T011 stack outputs, (3) CallerReference to a unique value (e.g., `staging-slkadmin-2026-03-19`), (4) Comment to `Staging Admin Dashboard`.
- [ ] T019 [US3] Create staging CloudFront distribution: `aws cloudfront create-distribution --distribution-config file://infra/staging-cloudfront-config.json`. Record the distribution ID and domain name.
- [ ] T020 [US3] Configure S3 bucket policy for staging admin dashboard bucket to allow CloudFront OAC access (same pattern as production bucket policy). Use the staging CloudFront distribution's OAC.
- [ ] T021 [US3] Build and deploy staging admin dashboard: `cd admin-dashboard && npm run build && aws s3 sync dist/ s3://staging-slkadmin-developerlabs-ai/ --delete && aws cloudfront create-invalidation --distribution-id <STAGING_DIST_ID> --paths "/*"`.
- [x] T022 [US3] Create GitHub Actions workflow `.github/workflows/deploy-admin.yml` for admin dashboard deployment. Trigger on push to `main` and `develop` when `admin-dashboard/**` files change. For `develop` branch: build and sync to `staging-slkadmin-developerlabs-ai`, invalidate staging CloudFront. For `main` branch: build and sync to `slkadmin-developerlabs-ai`, invalidate production CloudFront (`E30ZVBVU06GFUV`). Use GitHub Environments for distribution ID secrets.

**Checkpoint**: Staging admin dashboard is accessible at its own CloudFront URL, shows staging-only data, and auto-deploys when `admin-dashboard/` changes are pushed.

---

## Phase 5: User Story 4 - Promote Staging to Production (Priority: P2)

**Goal**: Validate the end-to-end promotion workflow: feature branch → develop (staging) → main (production).

**Independent Test**: Merge `develop` to `main` via PR. Verify production deploys the same code that was tested in staging. Confirm staging continues to run independently.

### Implementation

- [ ] T023 [US4] Verify the GitHub Actions workflow supports the promotion workflow by testing: (1) push a test commit to `develop`, confirm staging deploys, (2) create PR from `develop` to `main`, (3) merge PR, confirm production deploys, (4) verify staging still runs with its last deployed code. Document any issues found and fix them.
- [ ] T024 [US4] Add optional required reviewers to the `production` GitHub Environment in repo Settings > Environments > production > Environment protection rules. This creates an approval gate before production deployments.

**Checkpoint**: Full workflow tested: feature → develop → staging → main → production. Approval gate optional.

---

## Phase 6: User Story 5 - Cost-Efficient Staging Resources (Priority: P3)

**Goal**: Verify staging is running on minimum viable instance sizes and document the actual monthly cost.

**Independent Test**: Review the deployed staging CloudFormation stack parameters and confirm smaller instance sizes vs production.

### Implementation

- [ ] T025 [US5] Verify staging stack resource configurations by running: `aws cloudformation describe-stacks --stack-name staging-slack-list-processor --query 'Stacks[0].Parameters'`. Confirm: DBInstanceClass=db.t4g.micro, ContainerCpu=256, ContainerMemory=512, RedisNodeType=cache.t4g.micro, and only 1 NAT Gateway exists.
- [ ] T026 [US5] Document actual staging monthly cost estimate based on deployed resources. Compare against production configuration. Record in `specs/40-staging-environment/cost-analysis.md` with resource-by-resource breakdown.

**Checkpoint**: Staging confirmed running on cost-optimized resources.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final documentation, CLAUDE.md updates, and cleanup

- [x] T027 Update `CLAUDE.md` at repository root: Add staging deployment rules section covering (1) `develop` branch deploys to staging automatically, (2) staging CloudFront distribution ID and S3 bucket for admin dashboard, (3) staging CloudWatch log group path, (4) staging ECS cluster name. Also update `.specify/memory/constitution.md` Principle XV to acknowledge both `prod-slack-list-processor` and `staging-slack-list-processor` as valid runtime environments.
- [ ] T028 Run the full quickstart verification checklist from `specs/40-staging-environment/quickstart.md`: push test commits to both branches, verify both bots respond, verify both dashboards work, trigger a deployment failure to verify Slack notification. Additionally, validate FR-010 (staging isolation): deliberately break the staging environment (e.g., stop staging ECS service) and confirm production remains fully operational and unaffected.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — manual steps, can start immediately
- **Phase 2 (Foundational)**: No code dependencies, but should complete before Phase 3 for clean staging deployment
- **Phase 3 (US1+US2)**: Depends on Phase 1 (Slack app, GitHub environments) and Phase 2 (CloudFormation modifications)
- **Phase 4 (US3)**: Depends on Phase 3 (staging ALB must exist for CloudFront API origin)
- **Phase 5 (US4)**: Depends on Phase 3 (CI/CD workflows must exist to test promotion)
- **Phase 6 (US5)**: Depends on Phase 3 (staging stack must be deployed to verify)
- **Phase 7 (Polish)**: Depends on all prior phases

### User Story Dependencies

- **US1+US2 (P1)**: Combined — deploying the staging stack creates isolated infrastructure. Can start after Phase 1+2.
- **US3 (P2)**: Needs staging ALB DNS from US1+US2 deployment outputs.
- **US4 (P2)**: Can start after US1+US2 CI/CD is working. Independent of US3.
- **US5 (P3)**: Can start after US1+US2 stack is deployed. Independent of US3, US4.

### Parallel Opportunities

- T005, T006, T007, T008 (Phase 2 CloudFormation changes) are sequential — each modifies the same file. T006 handles NAT Gateway resources only; T007 handles route association (no overlap)
- T009, T010 can run in parallel (different files)
- T014, T015 are sequential (reusable workflow must exist before main workflow references it)
- T017, T018, T019, T020, T021 are sequential (each depends on the previous)
- US4 (Phase 5) and US3 (Phase 4) can run in parallel after US1+US2 is complete
- US5 (Phase 6) can run in parallel with US3 and US4

---

## Implementation Strategy

### MVP First (User Stories 1+2 Only)

1. Complete Phase 1: Manual setup (Slack app, GitHub environments, develop branch)
2. Complete Phase 2: CloudFormation template modifications (conditional NAT Gateway)
3. Complete Phase 3: Deploy staging stack + CI/CD workflows
4. **STOP and VALIDATE**: Push to `develop`, verify staging deploys, test Slack bot, verify production is unaffected
5. This delivers the core value: automated staging deployments with isolated infrastructure

### Incremental Delivery

1. Phase 1+2+3 → Staging deploys automatically, isolated from production (MVP!)
2. Phase 4 → Staging admin dashboard for monitoring staging jobs
3. Phase 5 → Full promotion workflow validated with optional approval gates
4. Phase 6 → Cost verification and documentation
5. Phase 7 → Documentation updates and full verification
