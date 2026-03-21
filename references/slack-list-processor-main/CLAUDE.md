# Slack List Processor - Project Rules

## Deployment Rules (MANDATORY)

### Backend (ECS Fargate) - GitHub Actions CI/CD
- **NEVER deploy backend manually** - GitHub Actions handles ECS deployment on push/merge
- **NEVER run `./infra/deploy.sh --update`** - this is deprecated; CI/CD does it automatically
- **NEVER run the app locally** - only ONE Socket Mode connection allowed
- Just commit, push, and let GitHub Actions build, push to ECR, and redeploy ECS

### Admin Dashboard Frontend (CloudFront + S3)
- Frontend is a separate React/Vite app in `admin-dashboard/`
- S3 bucket: `slkadmin-developerlabs-ai`
- CloudFront distribution: `E30ZVBVU06GFUV`

**CRITICAL: After every commit/push to GitHub, you MUST redeploy the admin dashboard frontend if ANY of these changed:**
- `admin-dashboard/` (any file)
- `src/routes/` or `src/server.ts` (API contract changes)

**Frontend deploy steps (all 3 required):**
```bash
cd admin-dashboard && npm run build
aws s3 sync dist/ s3://slkadmin-developerlabs-ai/ --delete
aws cloudfront create-invalidation --distribution-id E30ZVBVU06GFUV --paths "/*"
```

## Staging Environment

### Branch-Based Deployments
- `develop` branch → auto-deploys to **staging** ECS cluster
- `main` branch → auto-deploys to **production** ECS cluster
- Workflow: feature-branch → PR to develop → staging deploy → test → PR to main → prod deploy

### Staging Resources
- ECS cluster: `staging-slack-list-processor`
- CloudWatch logs: `/ecs/staging-slack-list-processor`
- Staging admin dashboard S3: `staging-slkadmin-developerlabs-ai`
- Staging admin dashboard CloudFront: (record distribution ID after T019)
- Staging Slack bot: "List Processor - Staging" (separate app in same workspace)

### Staging Admin Dashboard Deploy
```bash
cd admin-dashboard && npm run build
aws s3 sync dist/ s3://staging-slkadmin-developerlabs-ai/ --delete
aws cloudfront create-invalidation --distribution-id <STAGING_DIST_ID> --paths "/*"
```

### Deploy Script (Initial Stack Setup Only)
- Production: `./infra/deploy.sh` (reads `.env`)
- Staging: `./infra/deploy.sh --env staging` (reads `.env.staging`)
- **Day-to-day deployments are handled by GitHub Actions CI/CD, not deploy.sh**

## GitHub Account
- ALWAYS use `developerlabsai` GitHub account
- Run `gh auth switch --user developerlabsai` if needed
- Check with `gh auth status` before any git push/PR operations
