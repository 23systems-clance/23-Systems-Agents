# Quickstart: Staging Environment

**Feature**: 40-staging-environment
**Date**: 2026-03-19

## Prerequisites

Before deploying the staging environment, complete these manual steps:

### 1. Create Staging Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App" → "From an app manifest"
3. Use the same manifest/scopes as the production "List Processor" app
4. Name it "List Processor - Staging"
5. Install to the same Slack workspace
6. Record the following values:
   - Bot Token (`xoxb-...`)
   - App-Level Token (`xapp-...`) — with `connections:write` scope
   - Signing Secret
   - Client ID
   - Client Secret

### 2. Set Up GitHub Environments

1. Go to the GitHub repo Settings → Environments
2. Create environment: **`staging`**
   - Deployment branches: restrict to `develop` only
   - Add secrets:
     - `AWS_ACCESS_KEY_ID` (same as production — same AWS account)
     - `AWS_SECRET_ACCESS_KEY` (same as production — same AWS account)
3. Create environment: **`production`**
   - Deployment branches: restrict to `main` only
   - Optionally add required reviewers for approval gates
   - Add secrets:
     - `AWS_ACCESS_KEY_ID`
     - `AWS_SECRET_ACCESS_KEY`
4. Add repository-level secret:
   - `SLACK_WEBHOOK_URL` — Slack incoming webhook for #deployments channel

### 3. Create `develop` Branch

```bash
git checkout main
git pull
git checkout -b develop
git push -u origin develop
```

### 4. Deploy Staging CloudFormation Stack

Run the deploy script with staging parameters:

```bash
# Create .env.staging with staging Slack app credentials
# Then run:
ENV_NAME=staging STACK_NAME=staging-slack-list-processor ./infra/deploy.sh
```

Or deploy via CLI directly:

```bash
aws cloudformation deploy \
  --template-file infra/cloudformation.yaml \
  --stack-name staging-slack-list-processor \
  --region us-east-1 \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    EnvironmentName=staging \
    VpcCidr=10.1.0.0/16 \
    PublicSubnet1Cidr=10.1.1.0/24 \
    PublicSubnet2Cidr=10.1.2.0/24 \
    PrivateSubnet1Cidr=10.1.10.0/24 \
    PrivateSubnet2Cidr=10.1.11.0/24 \
    DBInstanceClass=db.t4g.micro \
    ContainerCpu=256 \
    ContainerMemory=512 \
    DBMasterPassword=<generate-secure-password>
```

### 5. Set Up Staging Secrets Manager

Create and populate `staging-slack-list-processor-secrets` in AWS Secrets Manager with:
- Staging Slack app tokens (from step 1)
- Staging DATABASE_URL (from CloudFormation RDS output)
- Shared API keys (BuiltWith, Apollo, Anthropic — same as production)
- Other shared secrets

### 6. Run Prisma Migrations on Staging

```bash
# Run migrations as a one-off ECS task (no TTY/interactive flag needed)
aws ecs run-task \
  --cluster staging-slack-list-processor \
  --task-definition staging-slack-list-processor \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<private-subnet-1>,<private-subnet-2>],securityGroups=[<ecs-sg>]}" \
  --overrides '{"containerOverrides":[{"name":"app","command":["npx","prisma","migrate","deploy"]}]}'

# Wait for task to complete and check exit code
aws ecs wait tasks-stopped --cluster staging-slack-list-processor --tasks <task-arn>
```

### 7. Set Up Staging Admin Dashboard

```bash
# Create staging S3 bucket
aws s3 mb s3://staging-slkadmin-developerlabs-ai

# Create staging CloudFront distribution
aws cloudfront create-distribution \
  --distribution-config file://infra/staging-cloudfront-config.json

# Build and deploy
cd admin-dashboard && npm run build
aws s3 sync dist/ s3://staging-slkadmin-developerlabs-ai/ --delete
```

### 8. Create Slack Incoming Webhook

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → your workspace
2. Create or select a Slack app for notifications
3. Add "Incoming Webhooks" feature
4. Create a webhook for `#deployments` channel
5. Add the webhook URL as `SLACK_WEBHOOK_URL` repository secret in GitHub

## Verification Checklist

After completing all setup steps, verify:

- [ ] Push a test commit to `develop` → staging ECS deploys automatically
- [ ] Push a test commit to `main` → production ECS deploys automatically
- [ ] Message the staging Slack bot with "ENRICH" → bot responds
- [ ] Message the production Slack bot → bot responds independently
- [ ] Staging admin dashboard loads at staging CloudFront URL
- [ ] Production admin dashboard still works at `https://dt9zhghz3mtx8.cloudfront.net`
- [ ] Deliberately fail a staging deploy → Slack notification appears in #deployments
- [ ] Staging CloudWatch logs appear at `/ecs/staging-slack-list-processor`

## Edge Cases

- **Force-push to `develop`**: GitHub Actions natively triggers a new workflow run on force-push events. No special handling needed — staging will redeploy with the force-pushed code automatically.
- **Concurrent deploys**: If staging and production deploy simultaneously, they operate on completely separate stacks and will not interfere with each other.

## Daily Workflow

```
feature-branch → PR to develop → auto-deploy staging → test in Slack → PR to main → auto-deploy production
```
