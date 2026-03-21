#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Slack List Processor - Deploy to AWS
#
# Usage:
#   ./infra/deploy.sh                    # First-time prod: creates stack + ECR, builds & pushes
#   ./infra/deploy.sh --update           # Update prod: rebuilds image and deploys
#   ./infra/deploy.sh --env staging      # First-time staging: uses .env.staging
#   ./infra/deploy.sh --env staging --update  # Update staging
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REGION="${AWS_REGION:-us-east-1}"

# Parse --env flag (default: prod)
ENV_NAME="prod"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV_NAME="$2"
      shift 2
      ;;
    --update)
      UPDATE_MODE="true"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# Derive names from environment
if [[ "$ENV_NAME" == "prod" ]]; then
  STACK_NAME="slack-list-processor"
else
  STACK_NAME="${ENV_NAME}-slack-list-processor"
fi
SECRET_NAME="${ENV_NAME}-slack-list-processor-secrets"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Build CloudFormation parameter overrides (reusable across deploys)
# ---------------------------------------------------------------------------
build_param_overrides() {
  local docker_image_uri="${1:-PLACEHOLDER}"

  # Look up the full Secrets Manager ARN (includes random suffix required by ECS)
  local secret_arn
  secret_arn=$(aws secretsmanager describe-secret \
    --secret-id "$SECRET_NAME" \
    --region "$REGION" \
    --query 'ARN' --output text 2>/dev/null) || secret_arn=""

  cat <<PARAMS
    EnvironmentName=${ENV_NAME}
    DBMasterPassword=${DB_PASSWORD}
    DockerImageUri=${docker_image_uri}
    SlackClientId=${SLACK_CLIENT_ID:-}
    OAuthRedirectUri=${OAUTH_REDIRECT_URI:-}
    CorsAllowedOrigins=${CORS_ALLOWED_ORIGINS:-}
    ACMCertificateArn=${ACM_CERTIFICATE_ARN:-}
    AppSecretArn=${secret_arn}
    PlatformOwnerTeamId=${PLATFORM_OWNER_TEAM_ID:-}
    BuiltWithCostPerCredit=${BUILTWITH_COST_PER_CREDIT:-0.05}
    ApolloCostPerCredit=${APOLLO_COST_PER_CREDIT:-0.05}
    AICostPer1kInputTokens=${AI_COST_PER_1K_INPUT_TOKENS:-0.0008}
    AICostPer1kOutputTokens=${AI_COST_PER_1K_OUTPUT_TOKENS:-0.004}
PARAMS
}

# ---------------------------------------------------------------------------
# Create or update Secrets Manager secret (includes DATABASE_URL)
# ---------------------------------------------------------------------------
upsert_secrets_manager() {
  info "Upserting Secrets Manager secret: $SECRET_NAME"

  # Query RDS endpoint from CloudFormation outputs to construct DATABASE_URL.
  local rds_endpoint db_name db_username database_url
  rds_endpoint=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='RDSEndpoint'].OutputValue" \
    --output text 2>/dev/null) || rds_endpoint=""

  db_name="${DB_NAME:-list_processor}"
  db_username="${DB_MASTER_USERNAME:-listprocessor}"

  if [[ -n "$rds_endpoint" ]]; then
    database_url="postgresql://${db_username}:${DB_PASSWORD}@${rds_endpoint}:5432/${db_name}"
  else
    warn "RDS endpoint not yet available — DATABASE_URL will be empty in secret until next deploy."
    database_url=""
  fi

  # Build new values from .env (only non-empty values will overwrite existing)
  local new_values
  new_values=$(cat <<EOF
{
  "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN:-}",
  "SLACK_APP_TOKEN": "${SLACK_APP_TOKEN:-}",
  "SLACK_SIGNING_SECRET": "${SLACK_SIGNING_SECRET:-}",
  "BUILTWITH_API_KEY": "${BUILTWITH_API_KEY:-}",
  "APOLLO_API_KEY": "${APOLLO_API_KEY:-}",
  "APOLLO_WEBHOOK_SECRET": "${APOLLO_WEBHOOK_SECRET:-}",
  "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY:-}",
  "API_KEY": "${API_KEY:-}",
  "SESSION_SECRET": "${SESSION_SECRET:-}",
  "SLACK_CLIENT_SECRET": "${SLACK_CLIENT_SECRET:-}",
  "SLACK_STATE_SECRET": "${SLACK_STATE_SECRET:-}",
  "TOKEN_ENCRYPTION_KEY": "${TOKEN_ENCRYPTION_KEY:-}",
  "DATABASE_URL": "${database_url}",
  "HUBSPOT_API_KEY": "${HUBSPOT_API_KEY:-}",
  "HUBSPOT_PORTAL_ID": "${HUBSPOT_PORTAL_ID:-}",
  "INSTANTLY_API_KEY": "${INSTANTLY_API_KEY:-}",
  "INSTANTLY_WEBHOOK_SECRET": "${INSTANTLY_WEBHOOK_SECRET:-}",
  "HEYREACH_API_KEY": "${HEYREACH_API_KEY:-}",
  "HEYREACH_WEBHOOK_SECRET": "${HEYREACH_WEBHOOK_SECRET:-}",
  "FINDYMAIL_API_KEY": "${FINDYMAIL_API_KEY:-}",
  "WIZA": "${WIZA:-}",
  "AI_ARK": "${AI_ARK:-}",
  "DNCSCRUB_API_KEY": "${DNCSCRUB_API_KEY:-}"
}
EOF
)

  local secret_json

  # If secret already exists, merge: keep existing non-empty values, only
  # overwrite with non-empty values from .env. This prevents deploy.sh
  # from wiping out secrets that were set manually or from a previous deploy.
  if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" &>/dev/null; then
    local existing_json
    existing_json=$(aws secretsmanager get-secret-value \
      --secret-id "$SECRET_NAME" \
      --region "$REGION" \
      --query 'SecretString' --output text 2>/dev/null) || existing_json="{}"

    # Merge: new non-empty values overwrite existing; empty new values keep existing
    secret_json=$(python3 -c "
import json, sys
existing = json.loads('''$existing_json''')
new = json.loads('''$new_values''')
for k, v in new.items():
    if v:  # Only overwrite if new value is non-empty
        existing[k] = v
    elif k not in existing:
        existing[k] = v  # Add new keys even if empty
print(json.dumps(existing))
")

    aws secretsmanager put-secret-value \
      --secret-id "$SECRET_NAME" \
      --secret-string "$secret_json" \
      --region "$REGION" \
      --no-cli-pager
    info "Secrets Manager secret updated (merged with existing values)."
  else
    secret_json="$new_values"
    aws secretsmanager create-secret \
      --name "$SECRET_NAME" \
      --secret-string "$secret_json" \
      --region "$REGION" \
      --no-cli-pager
    info "Secrets Manager secret created."
  fi
}

# ---------------------------------------------------------------------------
# 1. Check prerequisites
# ---------------------------------------------------------------------------
info "Checking prerequisites..."

for cmd in aws docker; do
  if ! command -v "$cmd" &>/dev/null; then
    error "$cmd is not installed. Please install it first."
    exit 1
  fi
done

# Verify AWS credentials
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || {
  error "AWS credentials not configured. Run 'aws configure' first."
  exit 1
}
info "AWS Account: $ACCOUNT_ID | Region: $REGION | Environment: $ENV_NAME"
info "Stack: $STACK_NAME | Secret: $SECRET_NAME"

# ---------------------------------------------------------------------------
# 2. Load .env for stack parameters
# ---------------------------------------------------------------------------
if [[ "$ENV_NAME" == "prod" ]]; then
  ENV_FILE="$PROJECT_DIR/.env"
else
  ENV_FILE="$PROJECT_DIR/.env.${ENV_NAME}"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  error ".env file not found at $ENV_FILE"
  if [[ "$ENV_NAME" == "prod" ]]; then
    error "Copy .env.example to .env and fill in your credentials first."
  else
    error "Copy .env.${ENV_NAME}.example to .env.${ENV_NAME} and fill in your credentials first."
  fi
  exit 1
fi

# Source env file (handles quoted values)
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

info "Loaded .env file"

# Generate a random DB password if not set
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)}"

# ---------------------------------------------------------------------------
# 3. Deploy or update CloudFormation stack
# ---------------------------------------------------------------------------
ECR_REPO_NAME="${ENV_NAME}-slack-list-processor"
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO_NAME}"

if [[ "${UPDATE_MODE:-}" != "true" ]]; then
  info "Creating/updating CloudFormation stack: $STACK_NAME"

  # shellcheck disable=SC2046
  aws cloudformation deploy \
    --template-file "$SCRIPT_DIR/cloudformation.yaml" \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides \
      $(build_param_overrides "PLACEHOLDER") \
    --no-fail-on-empty-changeset

  info "Stack deployed successfully."
fi

# ---------------------------------------------------------------------------
# 4. Upsert Secrets Manager secret (AFTER CF deploy so RDS endpoint exists)
# ---------------------------------------------------------------------------
upsert_secrets_manager

# ---------------------------------------------------------------------------
# 5. Build & push Docker image
# ---------------------------------------------------------------------------
info "Logging into ECR..."
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

info "Building Docker image (linux/amd64 for ECS Fargate)..."
docker build --platform linux/amd64 -t "$ECR_REPO_NAME" "$PROJECT_DIR"

info "Tagging and pushing to ECR..."
docker tag "$ECR_REPO_NAME:latest" "$ECR_URI:latest"
docker push "$ECR_URI:latest"

# ---------------------------------------------------------------------------
# 6. Update ECS service with the new image (all params preserved)
# ---------------------------------------------------------------------------
info "Updating CloudFormation stack with Docker image URI..."
# shellcheck disable=SC2046
aws cloudformation deploy \
  --template-file "$SCRIPT_DIR/cloudformation.yaml" \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    $(build_param_overrides "${ECR_URI}:latest") \
  --no-fail-on-empty-changeset

info "Forcing new ECS deployment..."
aws ecs update-service \
  --cluster "${ENV_NAME}-slack-list-processor" \
  --service "${ENV_NAME}-slack-list-processor" \
  --force-new-deployment \
  --region "$REGION" \
  --no-cli-pager

# ---------------------------------------------------------------------------
# 7. Wait for stabilization
# ---------------------------------------------------------------------------
info "Waiting for ECS service to stabilize..."
aws ecs wait services-stable \
  --cluster "${ENV_NAME}-slack-list-processor" \
  --services "${ENV_NAME}-slack-list-processor" \
  --region "$REGION" 2>/dev/null || warn "Service may still be starting."

# ---------------------------------------------------------------------------
# 8. Print outputs
# ---------------------------------------------------------------------------
echo ""
info "=== Deployment Complete ==="
echo ""

OUTPUTS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs' \
  --output table 2>/dev/null) || true

echo "$OUTPUTS"
echo ""
info "Next steps:"
info "  1. Run Prisma migrations via ECS Exec:"
info "     aws ecs execute-command --cluster ${ENV_NAME}-slack-list-processor \\"
info "       --task <TASK_ID> --container app --interactive --command 'npx prisma migrate deploy'"
info "  2. Configure Apollo webhook URL (shown in outputs above)"
info "  3. Test health check endpoint"
echo ""
