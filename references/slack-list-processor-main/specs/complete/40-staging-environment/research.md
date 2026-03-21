# Research: Staging Environment

**Feature**: 40-staging-environment
**Date**: 2026-03-19

## Decision 1: GitHub Actions Multi-Environment Pattern

**Decision**: Use a reusable workflow (`.github/workflows/deploy-ecs.yml`) called by the main deploy workflow with separate jobs per environment. Use GitHub Environments for secret scoping.

**Rationale**:
- Reusable workflow eliminates code duplication between staging and production deploy steps
- `if: github.ref == 'refs/heads/develop'` / `refs/heads/main` cleanly gates which environment deploys
- GitHub Environments scope secrets per environment (staging gets staging AWS creds, Slack tokens; production gets production ones)
- Environment protection rules can require manual approval for production deploys
- Matrix strategy rejected — cannot conditionally filter matrix values by branch cleanly, and environment secret scoping has known issues with matrix

**Alternatives considered**:
- Separate workflow files per environment: rejected — too much duplication
- Matrix strategy: rejected — poor branch filtering, fragile `environment` field with matrix, can't gate individual matrix entries

## Decision 2: CloudFormation Stack Strategy

**Decision**: Deploy the same `cloudformation.yaml` template as two separate stacks with different stack names (`staging-slack-list-processor` and `slack-list-processor`).

**Rationale**:
- Template is already parameterized with `EnvironmentName` (prod/staging) — all resource names use `${EnvironmentName}` prefix
- Separate stacks have independent lifecycles, rollback, and deletion
- AWS-recommended approach per CloudFormation best practices

**Alternatives considered**:
- Nested stacks: rejected — unnecessary complexity for 2 environments
- AWS CDK: rejected — existing CloudFormation template works well, migration risk

## Decision 3: VPC CIDR Ranges

**Decision**: Use different CIDR ranges for staging (`10.1.0.0/16`) and production (`10.0.0.0/16`).

**Rationale**: While same-CIDR VPCs technically work, using different ranges enables future VPC peering or Transit Gateway if ever needed. Zero-effort change since `VpcCidr` is already a template parameter.

## Decision 4: Staging Cost Optimization

**Decision**: Use minimum viable instance sizes and single NAT Gateway for staging.

| Resource | Staging Config | Monthly Cost |
|----------|---------------|-------------|
| RDS PostgreSQL | db.t4g.micro, Single-AZ, 20GB | ~$14 |
| ElastiCache Redis | cache.t4g.micro, single-node | ~$12 |
| ECS Fargate | 256 CPU / 512 MB, 1 task | ~$10 |
| NAT Gateway | 1x (single AZ) | ~$33 |
| ALB | 1x (minimum) | ~$18 |
| **Total** | | **~$87/mo** |

**Note**: The $87 estimate exceeds the $75 target from the spec. The primary cost drivers are NAT Gateway ($33) and ALB ($18) — these are fixed AWS charges with no cheaper alternatives. Compute costs (RDS + Redis + Fargate) are already at minimum. The $75 target should be revised to ~$90.

**Rationale**:
- `db.t4g.micro` is cheapest RDS option (Graviton2, $0.016/hr) — adequate for staging
- `cache.t4g.micro` is cheapest ElastiCache option ($0.016/hr)
- 256 CPU / 512 MB is smallest Fargate task size
- Single NAT Gateway saves ~$33/mo vs dual; acceptable for non-production (brief outage if one AZ fails)

**Alternatives considered**:
- No NAT Gateway (VPC endpoints only): rejected — Slack Socket Mode requires outbound internet
- NAT Instance (t3.nano): rejected — added operational complexity for ~$5/mo savings
- No ALB: rejected — needed for Apollo webhooks, admin dashboard API, and health checks

## Decision 5: Deployment Failure Notifications

**Decision**: Use `ravsamhq/notify-slack-action@v2` in GitHub Actions with `if: failure()` condition.

**Rationale**: Lightweight, well-maintained action. Requires only a Slack Incoming Webhook URL stored as a repository secret. The `if: failure()` condition ensures notification only fires on actual failures.

**Alternatives considered**:
- AWS SNS + CloudWatch: rejected — adds infrastructure complexity for a CI/CD notification
- Custom script calling Slack API: rejected — unnecessary when a maintained action exists

## Decision 6: CloudFormation Template Modifications

**Decision**: Add a `NatGatewayCount` condition to the template so staging deploys 1 NAT Gateway and production deploys 2.

**Rationale**: NAT Gateway is $32.40/mo per gateway. Staging doesn't need AZ redundancy for internet egress. This is the single largest cost reduction available.

**Implementation**: Add a condition `IsSingleNat` based on a parameter or the `EnvironmentName` value. Conditionally create the second NAT Gateway, EIP, and route table only when not in staging.

## Decision 7: Admin Dashboard Staging

**Decision**: Create a separate S3 bucket and CloudFront distribution for the staging admin dashboard. Use the same CloudFront config pattern as production but pointing to the staging ALB for `/api/*` routes.

**Rationale**: Staging dashboard must display staging-only data, which requires it to point to the staging backend ALB.

**Implementation**: Create `infra/staging-cloudfront-config.json` with staging S3 bucket as origin and staging ALB as API origin. Add a GitHub Actions workflow for admin dashboard deployment targeting the correct S3 bucket per environment.
