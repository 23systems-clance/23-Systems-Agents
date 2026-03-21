# Slack List Processor - Setup Guide

## Prerequisites

- Node.js 22+
- PostgreSQL 16
- Redis
- AWS CLI (for deployment)
- Docker (for deployment)
- Homebrew (macOS)

---

## Step 1: Create the Slack App

1. Go to **https://api.slack.com/apps**
2. Click **"Create New App"**
3. Choose **"From scratch"**
4. Name it: `List Processor` (or whatever you want)
5. Pick your workspace from the dropdown
6. Click **"Create App"**

You're now on the app settings page. Don't close this tab.

---

## Step 2: Enable Socket Mode

1. In the left sidebar, click **"Socket Mode"**
2. Toggle it **ON**
3. It will ask you to name a token. Type: `list-processor-socket`
4. Click **"Generate"**
5. **Copy the token that starts with `xapp-`** -- this is your `SLACK_APP_TOKEN`

---

## Step 3: Set Bot Token Scopes (Permissions)

1. In the left sidebar, click **"OAuth & Permissions"**
2. Scroll down to **"Scopes" > "Bot Token Scopes"**
3. Click **"Add an OAuth Scope"** and add these one by one:
   - `chat:write` (post messages)
   - `files:read` (read uploaded files)
   - `channels:history` (read messages in channels)
   - `groups:history` (read messages in private channels)
   - `im:history` (read DMs)
   - `mpim:history` (read group DMs)
   - `users:read` (look up user info)
   - `files:write` (upload result files)

---

## Step 4: Enable Events

1. In the left sidebar, click **"Event Subscriptions"**
2. Toggle it **ON**
3. Under **"Subscribe to bot events"**, click **"Add Bot User Event"** and add:
   - `message.channels`
   - `message.groups`
   - `message.im`
   - `message.mpim`
   - `file_shared`
4. Click **"Save Changes"** at the bottom

---

## Step 5: Enable Interactivity (for buttons)

1. In the left sidebar, click **"Interactivity & Shortcuts"**
2. Toggle it **ON**
3. For the Request URL, enter any placeholder (e.g. `https://placeholder.com`) -- Socket Mode doesn't actually use this URL, but Slack requires the field
4. Click **"Save Changes"**

---

## Step 6: Install the App to Your Workspace

1. In the left sidebar, click **"Install App"**
2. Click **"Install to Workspace"**
3. Click **"Allow"**
4. **Copy the "Bot User OAuth Token"** that starts with `xoxb-` -- this is your `SLACK_BOT_TOKEN`

---

## Step 7: Get the Signing Secret

1. In the left sidebar, click **"Basic Information"**
2. Scroll to **"App Credentials"**
3. Under **"Signing Secret"**, click **"Show"**
4. **Copy it** -- this is your `SLACK_SIGNING_SECRET`

---

## Step 8: Create Your .env File

Now you have 3 Slack values. Create your `.env` file:

```bash
cp .env.example .env
```

Then fill in these values:

```
SLACK_BOT_TOKEN=xoxb-your-token-from-step-6
SLACK_APP_TOKEN=xapp-your-token-from-step-2
SLACK_SIGNING_SECRET=your-secret-from-step-7

BUILTWITH_API_KEY=your-builtwith-key
APOLLO_API_KEY=your-apollo-key
ANTHROPIC_API_KEY=your-anthropic-key

# Generate random strings for these:
APOLLO_WEBHOOK_SECRET=<run: openssl rand -hex 32>
API_KEY=<run: openssl rand -hex 32>
```

Generate random secrets:

```bash
openssl rand -hex 32
```

---

## Step 9: Test Locally First (Before AWS)

Start PostgreSQL and Redis:

```bash
brew services start postgresql@16
brew services start redis
```

Create the database:

```bash
createdb list_processor
```

Run migrations:

```bash
npx prisma migrate dev
```

Build and start:

```bash
npm run build
npm start
```

You should see:

```
Slack Bolt app started in Socket Mode
HTTP server listening on port 3000
BullMQ workers started
Slack List Processor is running
```

---

## Step 10: Test the Bot in Slack

1. Go to your Slack workspace
2. Invite the bot to a channel: type `/invite @List Processor`
3. Upload a CSV file with a `domain` column (e.g. `google.com`, `stripe.com`)
4. After the file uploads, type: **ENRICH find me their tech stack**
5. The bot should respond with the AI classification and start the flow

---

## Step 11: Deploy to AWS

Once local testing works:

```bash
# Install AWS CLI if needed
brew install awscli

# Configure AWS credentials
aws configure
# Enter: Access Key ID, Secret Access Key, Region (us-east-1), Output (json)

# Deploy everything (first time)
./infra/deploy.sh

# Subsequent deploys (image update only)
./infra/deploy.sh --update
```

This creates the full stack (~10-15 minutes first time):
- VPC with public/private subnets
- RDS PostgreSQL (private subnet)
- ElastiCache Redis (private subnet)
- ECS Fargate service (private subnet)
- Application Load Balancer (public subnet)
- S3 bucket for output files
- ECR repository for Docker images

---

## Step 12: Run Prisma Migrations on AWS

After deploy, run migrations against the RDS database:

```bash
# Get the DATABASE_URL from CloudFormation outputs
aws cloudformation describe-stacks \
  --stack-name slack-list-processor \
  --query 'Stacks[0].Outputs[?OutputKey==`DatabaseUrl`].OutputValue' \
  --output text

# Set it and run migrations
DATABASE_URL="postgresql://listprocessor:PASSWORD@endpoint:5432/list_processor" \
  npx prisma migrate deploy
```

> **Note:** You need network access to RDS. Either run from within the VPC
> (ECS exec, bastion host) or temporarily make RDS publicly accessible for
> the initial migration.

---

## Step 13: Configure Apollo Webhook URL

Get your ALB URL after deployment:

```bash
aws cloudformation describe-stacks \
  --stack-name slack-list-processor \
  --query 'Stacks[0].Outputs[?OutputKey==`WebhookUrl`].OutputValue' \
  --output text
```

Use that URL in Apollo's webhook settings (only needed if you enable phone lookups later).

---

## AWS Monthly Cost Estimate

| Service | Spec | Cost |
|---------|------|------|
| RDS PostgreSQL | db.t4g.small, 20GB gp3 | ~$13/mo |
| ElastiCache Redis | cache.t4g.micro | ~$12/mo |
| ECS Fargate | 0.5 vCPU / 1GB | ~$15/mo |
| NAT Gateway | single AZ | ~$32/mo |
| ALB | basic | ~$16/mo |
| S3 | minimal | ~$1/mo |
| CloudWatch Logs | 30-day retention | ~$1/mo |
| **Total** | | **~$90/mo** |

> **Cost-saving tip:** The NAT Gateway is the most expensive piece. If you
> want to reduce costs, you can assign a public IP to the Fargate task
> directly and skip the NAT Gateway (~$32/mo savings), but this is less
> secure.

---

## Troubleshooting

### Bot doesn't respond in Slack
- Check the bot is invited to the channel (`/invite @List Processor`)
- Verify `SLACK_APP_TOKEN` starts with `xapp-` (Socket Mode token)
- Verify `SLACK_BOT_TOKEN` starts with `xoxb-`
- Check Event Subscriptions are enabled (Step 4)
- Check logs: `docker logs` locally or CloudWatch on AWS

### "Can't reach database" error
- PostgreSQL not running: `brew services start postgresql@16`
- Database doesn't exist: `createdb list_processor`
- Wrong DATABASE_URL in `.env`

### Redis connection refused
- Redis not running: `brew services start redis`
- Wrong REDIS_URL in `.env`

### Buttons don't work (purpose selection, co-sell check)
- Interactivity must be enabled (Step 5)
- Socket Mode must be ON (Step 2)

### File upload not detected
- `file_shared` event must be subscribed (Step 4)
- `files:read` scope must be added (Step 3)
