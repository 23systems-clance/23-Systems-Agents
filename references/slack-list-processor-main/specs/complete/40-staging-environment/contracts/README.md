# Contracts: Staging Environment

No new API contracts are introduced by this feature. The staging environment exposes the same API endpoints as production (health check, webhooks, admin dashboard API) — just deployed to a different ALB and CloudFront distribution.

## Existing API endpoints deployed to staging (unchanged)

- `GET /api/v1/health` — Health check
- `POST /api/webhooks/apollo` — Apollo webhook receiver
- All admin dashboard API routes under `/api/*`

## CI/CD Contract

The GitHub Actions reusable workflow accepts these inputs:

| Input | Type | Description |
|-------|------|-------------|
| `environment` | string | `staging` or `production` |
| `ecr-repo` | string | ECR repository name |
| `ecs-cluster` | string | ECS cluster name |
| `ecs-service` | string | ECS service name |

Required secrets (from GitHub Environments):

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM access key for the target environment |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key for the target environment |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook for deploy notifications |
