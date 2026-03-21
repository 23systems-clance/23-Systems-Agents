# Data Model: Staging Environment

**Feature**: 40-staging-environment
**Date**: 2026-03-19

## Overview

This feature is infrastructure-focused. No new database entities, tables, or schema changes are required. The existing Prisma schema is deployed as-is to the staging database. The staging database starts empty and is populated organically through test enrichment jobs.

## Environment Configuration Model

The "data model" for this feature is the environment configuration — the set of parameters and secrets that differentiate staging from production.

### Entity: Environment Configuration

| Attribute | Staging Value | Production Value | Storage Location |
|-----------|--------------|-----------------|-----------------|
| EnvironmentName | `staging` | `prod` | CloudFormation parameter |
| VpcCidr | `10.1.0.0/16` | `10.0.0.0/16` | CloudFormation parameter |
| DBInstanceClass | `db.t4g.micro` | `db.t4g.small` | CloudFormation parameter |
| RedisNodeType | `cache.t4g.micro` | `cache.t4g.micro` | CloudFormation parameter |
| ContainerCpu | `256` | `512` | CloudFormation parameter |
| ContainerMemory | `512` | `1024` | CloudFormation parameter |
| NatGatewayCount | 1 (conditional) | 2 | CloudFormation condition |
| SLACK_BOT_TOKEN | Staging app token | Production app token | Secrets Manager |
| SLACK_APP_TOKEN | Staging app token | Production app token | Secrets Manager |
| SLACK_SIGNING_SECRET | Staging app secret | Production app secret | Secrets Manager |
| DATABASE_URL | Staging RDS endpoint | Production RDS endpoint | Secrets Manager |
| BUILTWITH_API_KEY | Shared | Shared | Secrets Manager |
| APOLLO_API_KEY | Shared | Shared | Secrets Manager |
| ANTHROPIC_API_KEY | Shared | Shared | Secrets Manager |
| All other API keys | Shared | Shared | Secrets Manager |

### Entity: CloudFormation Stack

| Attribute | Staging | Production |
|-----------|---------|------------|
| Stack Name | `staging-slack-list-processor` | `slack-list-processor` |
| ECR Repository | `staging-slack-list-processor` | `prod-slack-list-processor` |
| ECS Cluster | `staging-slack-list-processor` | `prod-slack-list-processor` |
| ECS Service | `staging-slack-list-processor` | `prod-slack-list-processor` |
| RDS Identifier | `staging-list-processor` | `prod-list-processor` |
| Redis Replication Group | `staging-slp-redis` | `prod-slp-redis` |
| S3 Bucket | `staging-slack-list-processor-files-{account}` | `prod-slack-list-processor-files-{account}` |
| Log Group | `/ecs/staging-slack-list-processor` | `/ecs/prod-slack-list-processor` |
| Secrets Manager | `staging-slack-list-processor-secrets` | `prod-slack-list-processor-secrets` |

### Entity: Admin Dashboard Distribution

| Attribute | Staging | Production |
|-----------|---------|------------|
| S3 Bucket | `staging-slkadmin-developerlabs-ai` | `slkadmin-developerlabs-ai` |
| CloudFront Distribution | New (to be created) | `E30ZVBVU06GFUV` |
| API Origin | Staging ALB DNS | `prod-slp-alb-*.elb.amazonaws.com` |

## State Transitions

No state machines. The deployment pipeline follows a linear flow:

```
Push to develop → Build Docker image → Push to staging ECR → Force ECS deployment → Wait for stability
Push to main → Build Docker image → Push to prod ECR → Force ECS deployment → Wait for stability
```

## Data Isolation

- Staging and production have completely separate databases (different RDS instances)
- Staging and production have completely separate Redis instances
- Staging and production have completely separate S3 buckets
- No cross-environment data access is possible (different VPCs, different security groups)
- Prisma migrations run independently per environment during deployment
