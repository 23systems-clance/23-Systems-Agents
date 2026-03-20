# Spec 003: AWS Cloud Deployment — Staging & Production

**Status:** Draft
**Priority:** P1 (High)
**Estimated Effort:** 50 hours
**Dependencies:** Spec 001 (End User Portal — complete), Spec 002 (Slack Integration — complete), Cluster system stable (current), AWS account with ECS access
**Sequence:** 4th (deploy a proven, feature-complete product)

> **PRODUCTION DEPLOY SAFEGUARD:** Production deployments (merges to main, ECS service updates, DNS cutover to production domain) MUST NOT proceed unless the user explicitly says **"DEPLOY PRODUCTION"**. Staging deployments are unrestricted. This applies to all agents, CI/CD pipelines, and manual operations. Pushing to staging, testing on staging, and all non-production work can proceed freely.

---

## Overview

Deploy the 23 Systems Workforce agent to AWS with two environments: a lightweight **staging** environment for testing and validation, and a full **production** environment for live operations. Staging runs on a single EC2 instance with Docker Compose (cheap, simple, close to local dev). Production runs on ECS Fargate with proper networking, load balancing, and auto-scaling workers.

## Environment Philosophy

| | Staging | Production |
|---|---------|-----------|
| **Purpose** | Test changes before production, validate cluster configs, develop new roles | Live agent operations, client-facing, reliable |
| **Architecture** | Single EC2 instance + Docker Compose | ECS Fargate + ALB + EFS |
| **Cluster workers** | Docker containers on same host (current architecture) | ECS Fargate tasks (cloud-native) |
| **Database** | SQLite on EBS volume | SQLite on EFS (or RDS if needed) |
| **Networking** | EC2 public IP + Caddy (auto-SSL) | ALB + ACM certificate + private subnets |
| **Cost** | ~$15–$25/mo | ~$72–$85/mo |
| **Deploy method** | `git pull && docker compose up -d` | GitHub Actions → ECR → ECS rolling deploy |
| **Monitoring** | Docker logs + basic CloudWatch | CloudWatch dashboards + alarms |

## Goals

1. **Staging:** Run the full system on a single cheap EC2 instance with Docker Compose — same architecture as local dev, just in the cloud with a public URL
2. **Production:** Run the event handler as an always-on ECS Fargate service with cluster workers as ephemeral Fargate tasks
3. **Shared codebase:** Both environments use the same code — staging uses Docker socket (current), production uses ECS adapter (`CLOUD_PROVIDER=aws`)
4. **Promote with confidence:** Test cluster configs, role prompts, and triggers on staging before enabling in production
5. **Keep costs proportional:** Staging is always cheap; production scales with usage

## Non-Goals

- Multi-region deployment or HA database
- Kubernetes / EKS (overengineered for this workload)
- Migrating off SQLite to RDS (unless production scale demands it)
- Changing the thepopebot package internals (all changes are in the user project layer)
- Staging/production database sync (they are independent environments)

---

## Staging Environment

### Architecture

```
┌───────────────────────────────────────────────────┐
│  EC2 Instance (t3.small — 2 vCPU / 2GB)          │
│                                                    │
│  ┌──────────────────────────────────────────┐     │
│  │  Caddy (reverse proxy, auto-SSL)         │     │
│  │  staging.23systems.ai → localhost:3000   │     │
│  └──────────────┬───────────────────────────┘     │
│                 │                                   │
│  ┌──────────────▼───────────────────────────┐     │
│  │  Docker Compose                           │     │
│  │  ┌─────────────────────────────────┐     │     │
│  │  │  Event Handler (Next.js)        │     │     │
│  │  │  Port 3000, SQLite on EBS       │     │     │
│  │  │  Docker socket mounted          │     │     │
│  │  └──────────────┬──────────────────┘     │     │
│  │                 │ docker run              │     │
│  │                 ▼                         │     │
│  │  ┌──────────────────────┐               │     │
│  │  │  Worker containers   │               │     │
│  │  │  (same as local dev) │               │     │
│  │  └──────────────────────┘               │     │
│  └──────────────────────────────────────────┘     │
│                                                    │
│  EBS Volume: /data (SQLite + cluster data + logs) │
└───────────────────────────────────────────────────┘
```

### Staging Infrastructure

| Resource | Configuration | Monthly Cost |
|----------|--------------|-------------|
| EC2 `t3.small` | 2 vCPU / 2GB RAM, on-demand | ~$15 |
| EBS Volume | 20GB gp3 | ~$1.60 |
| Elastic IP | Static public IP | Free (attached) |
| **Total** | | **~$17/mo** |

**With Reserved Instance (1yr):** EC2 drops to ~$9/mo → **~$11/mo total**

### Staging Setup

**1. EC2 Instance**
- Amazon Linux 2023 or Ubuntu 22.04
- Security group: 80, 443 (Caddy), 22 (SSH, restricted to your IP)
- IAM role: none needed (no AWS services used)
- EBS volume: 20GB gp3, mounted at `/data`

**2. Docker Compose**
```yaml
# docker-compose.staging.yml
services:
  app:
    image: ghcr.io/23systems/event-handler:staging
    ports:
      - "3000:3000"
    volumes:
      - /data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
      - ./config:/app/config
      - ./skills:/app/skills
    env_file: .env.staging
    restart: unless-stopped
```

**3. Caddy (Auto-SSL)**
```
staging.23systems.ai {
    reverse_proxy localhost:3000
}
```

**4. Deploy Process**
```bash
ssh staging
cd /opt/23systems
git pull origin staging
docker compose -f docker-compose.staging.yml pull
docker compose -f docker-compose.staging.yml up -d
```

### What Staging Doesn't Have
- No load balancer (Caddy handles SSL directly)
- No private subnets (single instance with security group)
- No EFS (local EBS volume)
- No CloudWatch alarms (check Docker logs manually)
- No zero-downtime deploys (brief downtime on restart is acceptable)
- No ECS — workers use Docker socket exactly like local dev

---

## Production Environment

## Requirements

### Functional Requirements

#### FR-0: Staging Environment Setup
**Priority:** P0 (deploy staging first)

**0.1 EC2 Instance Provisioning**
- Launch `t3.small` instance with Amazon Linux 2023
- Attach 20GB gp3 EBS volume, mount at `/data`
- Elastic IP for stable DNS
- Security group: 443/80 (public), 22 (restricted)
- Install Docker, Docker Compose, Caddy, Git

**0.2 Staging Docker Compose**
- Create `docker-compose.staging.yml` (event handler + Docker socket mount)
- Create `.env.staging` with staging-specific values (separate API keys, `APP_URL=https://staging.23systems.ai`)
- Worker containers spawn via Docker socket (no adapter changes needed)

**0.3 Caddy Reverse Proxy**
- Auto-SSL via Let's Encrypt for staging domain
- Reverse proxy to event handler on port 3000
- WebSocket/SSE pass-through for console streaming

**0.4 DNS**
- `staging.23systems.ai` → EC2 Elastic IP (A record)
- Register Telegram webhook and GitHub webhook to staging URL

**0.5 Deploy Script**
- Simple `deploy-staging.sh` script: pull, rebuild, restart
- No CI/CD pipeline needed — manual SSH deploy is fine for staging

**Acceptance Criteria:**
- [ ] Staging accessible at `https://staging.23systems.ai`
- [ ] Login, chat, crons, triggers, clusters all functional
- [ ] Cluster workers spawn and execute via Docker socket
- [ ] SSE console streaming works through Caddy proxy
- [ ] Total monthly cost < $25

---

#### FR-1: Production AWS Infrastructure (Terraform/CDK)
**Priority:** P0

Provision the following AWS resources:

**1.1 Networking**
- VPC with 2 public subnets (ALB) and 2 private subnets (ECS tasks)
- NAT Gateway for outbound internet from private subnets (workers need Anthropic API access)
- Security groups: ALB (443 inbound), event handler (ALB only), workers (egress only)

**1.2 ECS Cluster**
- Single ECS cluster for both event handler service and worker tasks
- Fargate capacity provider (no EC2 instances to manage)

**1.3 Event Handler Service**
```
Task Definition:
  CPU: 512 (0.5 vCPU)
  Memory: 1024 MB
  Container: event handler image (from GHCR or ECR)
  Port: 3000
  EFS mount: /app/data (database + cluster data)
  Environment: all .env variables via Secrets Manager
  Health check: /api/ping

Service:
  Desired count: 1
  Load balancer: ALB target group
  Auto-restart on failure
```

**1.4 Worker Task Definition**
```
Task Definition:
  CPU: 1024 (1 vCPU)
  Memory: 2048-4096 MB (configurable per role)
  Container: claude-code-cluster-worker image
  EFS mount: /home/claude-code/workspace (same EFS, cluster data path)
  Environment: injected per-run (SYSTEM_PROMPT, PROMPT, tokens, etc.)
  No load balancer (ephemeral, no inbound traffic)

Task:
  Launch type: FARGATE
  Network: private subnet + NAT
  Auto-remove on exit
```

**1.5 Storage**
- EFS filesystem with two access points:
  - `/data` → mounted by event handler at `/app/data`
  - `/clusters` → mounted by both event handler and workers at their respective paths
- Lifecycle policy: transition to IA after 30 days for logs

**1.6 Load Balancer**
- Application Load Balancer with HTTPS listener (ACM certificate)
- HTTP → HTTPS redirect
- Target group pointing to event handler service on port 3000
- WebSocket/SSE support (sticky sessions, extended idle timeout: 300s)

**1.7 Secrets**
- AWS Secrets Manager for all sensitive env vars:
  - `AUTH_SECRET`, `GH_TOKEN`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `GH_WEBHOOK_SECRET`
  - `SLACK_BOT_TOKEN`
- Non-sensitive config as ECS task definition environment variables

**Acceptance Criteria:**
- [ ] All infrastructure defined as IaC (Terraform or CDK)
- [ ] Event handler accessible via HTTPS at custom domain
- [ ] Workers can reach Anthropic API and GitHub API from private subnets
- [ ] EFS mounts verified — data persists across task restarts
- [ ] Health check passing at `/api/ping`

#### FR-2: ECS Execution Adapter
**Priority:** P0

Create an ECS adapter that replaces Docker socket calls with AWS SDK ECS API calls. This is the core refactoring — everything else stays the same.

**2.1 New file: `lib/cloud/ecs-adapter.js`**

Implements the same interface as `lib/tools/docker.js` but targets ECS:

| Docker Socket Function | ECS Equivalent | Notes |
|----------------------|----------------|-------|
| `runClusterWorkerContainer({ containerName, env, binds, workingDir })` | `ecs.RunTask()` | Launches Fargate task with env vars, EFS mount |
| `listContainers(prefix)` | `ecs.ListTasks()` + `ecs.DescribeTasks()` | Filter by `startedBy` tag or family prefix |
| `stopContainer(name)` | `ecs.StopTask()` | Graceful stop with reason |
| `removeContainer(name)` | N/A | Fargate auto-removes stopped tasks |
| `resolveHostPath(path)` | Returns EFS path directly | No Docker-in-Docker path translation needed |

**2.2 Modify `Clusters/lib/cluster/execute.js`**

Replace direct Docker imports with a runtime adapter selection:

```javascript
// At top of execute.js
const adapter = process.env.CLOUD_PROVIDER === 'aws'
  ? await import('../cloud/ecs-adapter.js')
  : await import('../tools/docker.js');

const { runClusterWorkerContainer, listContainers, stopContainer, removeContainer, resolveHostPath } = adapter;
```

This keeps local Docker development working unchanged.

**2.3 ECS Task Launch Parameters**

When `runClusterRole()` calls the adapter:

```javascript
// ecs-adapter.js — runClusterWorkerContainer()
await ecs.runTask({
  cluster: process.env.ECS_CLUSTER_ARN,
  taskDefinition: process.env.ECS_WORKER_TASK_DEF,
  launchType: 'FARGATE',
  networkConfiguration: {
    awsvpcConfiguration: {
      subnets: JSON.parse(process.env.ECS_PRIVATE_SUBNETS),
      securityGroups: [process.env.ECS_WORKER_SG],
      assignPublicIp: 'DISABLED'
    }
  },
  overrides: {
    containerOverrides: [{
      name: 'worker',
      environment: env.map(e => {
        const [key, ...val] = e.split('=');
        return { name: key, value: val.join('=') };
      }),
    }]
  },
  startedBy: containerName,  // used for listing/filtering
  tags: [
    { key: 'cluster', value: clusterId },
    { key: 'role', value: roleId },
    { key: 'worker', value: workerUuid }
  ]
});
```

**Acceptance Criteria:**
- [ ] ECS adapter implements all 5 functions from Docker interface
- [ ] `execute.js` selects adapter based on `CLOUD_PROVIDER` env var
- [ ] Workers launch as Fargate tasks with correct env vars
- [ ] `canRunRole()` correctly counts running Fargate tasks
- [ ] `stopRoleContainers()` stops Fargate tasks
- [ ] Local Docker development still works when `CLOUD_PROVIDER` is unset

#### FR-3: Log Streaming Adapter
**Priority:** P1

Replace Docker container log streaming with CloudWatch Logs for the SSE console.

**3.1 Modify `Clusters/lib/cluster/stream.js`**

When on AWS, use CloudWatch Logs `FilterLogEvents` or `GetLogEvents` API instead of Docker container log attachment:

| Local (Docker) | AWS (CloudWatch) |
|----------------|-----------------|
| Attach to container stdout | `FilterLogEvents` with log group + task ID |
| Stream via Docker API | Poll CloudWatch every 1-2s or use `filterLogEvents` with `startFromHead` |
| Container name lookup | Task ARN from `startedBy` tag |

**3.2 Worker Log Configuration**

Worker task definition includes `awslogs` log driver:
```json
{
  "logConfiguration": {
    "logDriver": "awslogs",
    "options": {
      "awslogs-group": "/ecs/cluster-workers",
      "awslogs-region": "us-east-1",
      "awslogs-stream-prefix": "worker"
    }
  }
}
```

**Acceptance Criteria:**
- [ ] SSE console page streams worker logs on AWS via CloudWatch
- [ ] Log group auto-created with 30-day retention
- [ ] Local Docker streaming still works unchanged

#### FR-4: Container Image Registry
**Priority:** P0

Push both container images to Amazon ECR (or continue using GHCR with cross-account pull).

**Option A: ECR (recommended)**
- Create ECR repositories: `23systems/event-handler`, `23systems/cluster-worker`
- GitHub Actions pushes images to ECR on merge to main
- ECS task definitions reference ECR image URIs

**Option B: GHCR (simpler)**
- Keep existing GHCR image builds
- ECS pulls from GHCR (requires NAT gateway, no ECR auth needed for public images)

**Acceptance Criteria:**
- [ ] Both images accessible to ECS tasks
- [ ] Image updates trigger rolling deployment of event handler service
- [ ] Worker task definition uses latest image tag or pinned version

#### FR-5: Domain & SSL
**Priority:** P1

- Route53 hosted zone (or external DNS) with A/AAAA record pointing to ALB
- ACM certificate for the domain (auto-renewed)
- `APP_URL` env var set to `https://<domain>`
- Telegram webhook and GitHub webhook URLs updated to new domain

**Acceptance Criteria:**
- [ ] HTTPS access at custom domain
- [ ] Telegram bot webhook registered to new URL
- [ ] GitHub Actions webhook secret configured for new URL

---

### Non-Functional Requirements

#### NFR-1: Cost Controls
- CloudWatch alarm on ECS task count > 20 (runaway spawning protection)
- EFS lifecycle policy moves logs to Infrequent Access after 30 days
- NAT Gateway is the biggest fixed cost (~$32/mo) — consider NAT instances for lower cost
- CloudWatch log retention: 30 days (configurable)

#### NFR-2: Security
- All secrets in AWS Secrets Manager (not plaintext env vars in task definitions)
- Workers run in private subnets with no inbound internet access
- EFS encrypted at rest
- IAM roles: event handler gets `ecs:RunTask`, `ecs:StopTask`, `ecs:ListTasks`, `ecs:DescribeTasks`, `logs:FilterLogEvents`; workers get no AWS permissions
- No SSH access to containers (use ECS Exec for debugging if needed)

#### NFR-3: Observability
- CloudWatch metrics: task count, CPU/memory utilization, task failures
- CloudWatch alarms: event handler unhealthy, worker task failure rate > 10%
- All worker logs in CloudWatch log group `/ecs/cluster-workers`
- Event handler logs in `/ecs/event-handler`

#### NFR-4: Zero-Downtime Deploys
- Event handler uses ECS rolling deployment (min healthy 100%, max 200%)
- New image pushed → ECS drains old task, starts new task behind ALB
- Worker task definition updates don't affect running workers (new definition used for next launch)

---

## Technical Design

### Production Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  AWS Cloud                                                          │
│                                                                     │
│  ┌──────────────┐    ┌──────────────────────────────────────┐      │
│  │   Route53     │───▶│  ALB (HTTPS, ACM cert)               │      │
│  └──────────────┘    └──────────┬───────────────────────────┘      │
│                                  │                                   │
│                                  ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │  ECS Fargate Service: Event Handler                      │      │
│  │  ┌────────────────────────────────────────────┐          │      │
│  │  │  Next.js server (0.5 vCPU / 1GB)           │          │      │
│  │  │  - Web UI, chat, cron scheduler            │          │      │
│  │  │  - Trigger runtime (webhooks, file watch)  │          │      │
│  │  │  - Cluster role management                 │          │      │
│  │  │  - SSE log streaming                       │          │      │
│  │  └───────────┬────────────────────────────────┘          │      │
│  │              │ EFS mount: /app/data                       │      │
│  └──────────────┼───────────────────────────────────────────┘      │
│                 │                                                    │
│                 │ ecs.RunTask() ──────────────────┐                 │
│                 │                                  │                 │
│                 ▼                                  ▼                 │
│  ┌────────────────────────┐    ┌────────────────────────────┐      │
│  │  ECS Fargate Task      │    │  ECS Fargate Task          │      │
│  │  Worker A (1vCPU/2GB)  │    │  Worker B (1vCPU/4GB)      │      │
│  │  Claude Code + prompt  │    │  Claude Code + prompt      │      │
│  │  EFS: /workspace       │    │  EFS: /workspace           │      │
│  └────────────────────────┘    └────────────────────────────┘      │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │  Amazon EFS                                               │      │
│  │  ├── /data          (SQLite DB, settings)                │      │
│  │  └── /clusters      (cluster data, role dirs, logs)      │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │  Supporting Services                                      │      │
│  │  - Secrets Manager (API keys, tokens)                    │      │
│  │  - CloudWatch Logs (/ecs/event-handler, /ecs/workers)    │      │
│  │  - ECR (container images)                                │      │
│  │  - NAT Gateway (outbound internet for private subnets)   │      │
│  └──────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

### Adapter Pattern

The execution layer uses a runtime adapter so the same codebase works locally (Docker) and in production (ECS):

```
execute.js
  │
  ├── CLOUD_PROVIDER=aws  ──▶  lib/cloud/ecs-adapter.js  ──▶  AWS ECS API
  │
  └── (default)           ──▶  lib/tools/docker.js       ──▶  Docker Socket
```

Functions abstracted by the adapter:

| Function | Purpose |
|----------|---------|
| `runClusterWorkerContainer()` | Launch a worker |
| `listContainers(prefix)` | Count running workers for concurrency |
| `stopContainer(name)` | Stop a worker |
| `removeContainer(name)` | Clean up (no-op on Fargate) |
| `resolveHostPath(path)` | Translate mount paths |

### EFS Mount Strategy

Both the event handler and workers mount the same EFS filesystem but at different paths:

| Service | EFS Access Point | Container Mount | Purpose |
|---------|-----------------|-----------------|---------|
| Event handler | `/` | `/app/data` | SQLite DB, cluster data dirs, logs |
| Worker | `/clusters/{cluster-shortId}` | `/home/claude-code/workspace` | Role dirs, shared folders, worker work dirs |

Workers see only their cluster's data directory — not the database or other clusters' data. This preserves isolation.

### Environment Variables (AWS-Specific)

| Variable | Description | Set By |
|----------|-------------|--------|
| `CLOUD_PROVIDER` | `aws` — switches to ECS adapter | Task definition |
| `ECS_CLUSTER_ARN` | ARN of the ECS cluster | Task definition |
| `ECS_WORKER_TASK_DEF` | Worker task definition family | Task definition |
| `ECS_PRIVATE_SUBNETS` | JSON array of subnet IDs | Task definition |
| `ECS_WORKER_SG` | Security group ID for workers | Task definition |
| `AWS_REGION` | AWS region | Task definition |

---

## Cost Estimate

### Staging vs. Production — Side by Side

| | Staging | Production |
|---|---------|-----------|
| **Infra cost** | ~$17/mo | ~$72–$85/mo |
| **Worker compute** | $0 (runs on same EC2) | ~$0.007–$0.015 per 10-min run |
| **Max concurrent workers** | 2-3 (limited by EC2 RAM) | 50+ (Fargate scales independently) |
| **Deploy** | SSH + restart (~30s downtime) | Rolling deploy (zero downtime) |
| **SSL** | Caddy (free, auto-renew) | ACM (free, auto-renew) |
| **Monitoring** | Docker logs | CloudWatch dashboards + alarms |
| **Best for** | Testing, dev, low-volume | Client-facing, reliability, scale |

### Staging Monthly Costs

| Resource | Configuration | Monthly Cost |
|----------|--------------|-------------|
| EC2 `t3.small` (on-demand) | 2 vCPU / 2GB | ~$15 |
| EBS Volume | 20GB gp3 | ~$1.60 |
| Elastic IP | Attached to instance | Free |
| **Total** | | **~$17/mo** |

*With 1-year Reserved Instance: ~$11/mo total*

### Production Fixed Monthly Costs

| Resource | Configuration | Monthly Cost |
|----------|--------------|-------------|
| ECS Fargate (event handler) | 0.5 vCPU / 1GB, 24/7 | ~$15 |
| Application Load Balancer | Always-on | ~$16 |
| NAT Gateway | Always-on + data processing | ~$32 + data |
| EFS Storage | 5-20 GB standard | ~$1.50–$6 |
| Secrets Manager | 5-10 secrets | ~$2 |
| CloudWatch Logs | Ingestion + storage | ~$3–$10 |
| ECR | Image storage | ~$1 |
| Route53 | Hosted zone | $0.50 |
| **Fixed total** | | **~$71–$83/mo** |

### Variable Costs (Per Worker Run)

| Worker Size | Fargate Cost/Hour | 5 min run | 10 min run | 30 min run |
|-------------|------------------|-----------|------------|------------|
| 1 vCPU / 2 GB | $0.044 | $0.004 | $0.007 | $0.022 |
| 1 vCPU / 4 GB | $0.071 | $0.006 | $0.012 | $0.036 |
| 2 vCPU / 4 GB | $0.089 | $0.007 | $0.015 | $0.044 |

### LLM API Costs (The Dominant Factor)

| Model | Typical Worker Run (10 min) | 50 runs/day | 200 runs/day |
|-------|---------------------------|-------------|-------------|
| Claude Sonnet 4 | $0.10–$0.50 | $150–$750/mo | $600–$3,000/mo |
| Claude Opus 4 | $0.50–$5.00 | $750–$7,500/mo | $3,000–$30,000/mo |

### Total Monthly Scenarios

| Scenario | Runs/Day | Infra Cost | LLM Cost (Sonnet) | LLM Cost (Opus) |
|----------|---------|------------|-------------------|-----------------|
| Starter | 5 | ~$72 | ~$15–$75 | ~$75–$750 |
| Light | 20 | ~$74 | ~$60–$300 | ~$300–$3,000 |
| Medium | 50 | ~$78 | ~$150–$750 | ~$750–$7,500 |
| Heavy | 200 | ~$95 | ~$600–$3,000 | ~$3,000–$30,000 |

**Key takeaway:** Infrastructure is $72–$95/mo regardless of scale. LLM API is 2x–300x the infra cost. Optimize model selection per role, not infrastructure.

### Cost Optimization Strategies

1. **Use Sonnet for routine roles**, Opus only for roles that need deep reasoning
2. **NAT Instance instead of NAT Gateway** — saves ~$27/mo (use `t4g.nano` at ~$3/mo)
3. **Fargate Spot for workers** — 50-70% discount, acceptable for non-urgent roles (workers are already ephemeral and retry-safe)
4. **EFS Infrequent Access** — auto-tiering for logs older than 30 days cuts storage cost 90%
5. **Right-size worker memory** — most roles work fine with 2GB; only increase for heavy workloads

---

## Implementation Plan

### Phase 0: Staging Environment (6 hours)
**Deliverables:**
- [ ] EC2 instance running with Docker + Caddy
- [ ] `docker-compose.staging.yml` in project root
- [ ] `.env.staging` with staging credentials
- [ ] `deploy-staging.sh` script
- [ ] Staging accessible at HTTPS URL

**Tasks:**
1. Launch EC2 `t3.small`, attach EBS, assign Elastic IP
2. Install Docker, Docker Compose, Caddy on instance
3. Create `docker-compose.staging.yml` with event handler + socket mount
4. Create `.env.staging` with staging API keys and `APP_URL`
5. Configure Caddy with staging domain and auto-SSL
6. Set up DNS A record for staging domain
7. Deploy and verify: login, chat, cluster run, SSE streaming
8. Register Telegram/GitHub webhooks at staging URL
9. Create `deploy-staging.sh` (pull + rebuild + restart)

### Phase 1: Production Infrastructure (12 hours)
**Deliverables:**
- [ ] Terraform/CDK project in `infra/` directory
- [ ] VPC, subnets, NAT, security groups
- [ ] ECS cluster, task definitions, service
- [ ] EFS filesystem with access points
- [ ] ALB with HTTPS
- [ ] Secrets Manager entries
- [ ] ECR repositories

**Tasks:**
1. Create `infra/` directory with Terraform modules (or CDK stacks)
2. Define VPC with public/private subnets in 2 AZs
3. Create ECS cluster and Fargate capacity provider
4. Define event handler task definition and service
5. Define worker task definition (without service — launched on demand)
6. Create EFS filesystem with access points
7. Create ALB, target group, HTTPS listener
8. Migrate secrets from `.env` to Secrets Manager
9. Create ECR repositories and push initial images
10. Set up Route53 record (or configure external DNS)

### Phase 2: ECS Adapter (12 hours)
**Deliverables:**
- [ ] `lib/cloud/ecs-adapter.js` implementing Docker-compatible interface
- [ ] Modified `execute.js` with adapter selection
- [ ] Modified `stream.js` with CloudWatch log streaming
- [ ] `CLOUD_PROVIDER` env var support

**Tasks:**
1. Create `lib/cloud/ecs-adapter.js` with all 5 functions
2. Implement `runClusterWorkerContainer()` → `ecs.RunTask()`
3. Implement `listContainers()` → `ecs.ListTasks()` + `DescribeTasks()`
4. Implement `stopContainer()` → `ecs.StopTask()`
5. Modify `execute.js` to import adapter dynamically based on `CLOUD_PROVIDER`
6. Modify `stream.js` to use CloudWatch `FilterLogEvents` when on AWS
7. Add `@aws-sdk/client-ecs` and `@aws-sdk/client-cloudwatch-logs` dependencies
8. Test adapter locally with AWS credentials

### Phase 3: CI/CD Pipeline (8 hours)
**Deliverables:**
- [ ] GitHub Actions workflow for building and pushing images to ECR
- [ ] Automated ECS service deployment on image push
- [ ] Worker task definition update on image push

**Tasks:**
1. Create `.github/workflows/deploy-aws.yml`
2. Build event handler image → push to ECR → update ECS service
3. Build worker image → push to ECR → update worker task definition
4. Add AWS credentials as GitHub secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`)
5. Test full deploy pipeline: push to main → image built → service updated

### Phase 4: Testing & Cutover (8 hours)
**Deliverables:**
- [ ] End-to-end verification of all features on AWS
- [ ] DNS cutover to new deployment
- [ ] Monitoring and alerting configured

**Tasks:**
1. Verify web UI login and chat
2. Verify cron jobs fire on schedule
3. Verify webhook triggers work with new URL
4. Verify cluster role manual run → worker launches → logs stream → worker exits
5. Verify concurrency control (`canRunRole` counts Fargate tasks correctly)
6. Verify SSE console streaming via CloudWatch
7. Verify Telegram webhook at new URL
8. Set up CloudWatch alarms (event handler health, worker failures, task count)
9. Update `APP_URL` and re-register Telegram webhook
10. Monitor for 48 hours before decommissioning local deployment

---

## Success Metrics

### Staging Metrics
- [ ] Staging accessible at HTTPS URL with auto-SSL
- [ ] Full feature parity with local dev (chat, clusters, crons, triggers)
- [ ] Deploy time < 2 minutes (pull + restart)
- [ ] Monthly cost < $25
- [ ] Workers spawn and execute on same EC2 host

### Production Functional Metrics
- [ ] Event handler accessible via HTTPS with <500ms response time
- [ ] Cluster workers launch within 30 seconds of trigger
- [ ] All 4 trigger types work (manual, webhook, cron, file_watch)
- [ ] SSE console streams worker logs in real-time
- [ ] Concurrency limits enforced correctly via ECS task counting
- [ ] Zero data loss on event handler restart (EFS persistence)

### Cost Metrics
- [ ] Fixed infrastructure cost < $85/mo
- [ ] Worker compute cost < $0.02 per 10-minute run
- [ ] No idle worker costs (Fargate tasks terminate on completion)

### Reliability Metrics
- [ ] Event handler uptime > 99.5%
- [ ] Worker task launch success rate > 99%
- [ ] Zero-downtime deploys verified

---

## Risks & Mitigation

### Risk 1: EFS Latency for SQLite
**Impact:** High — SQLite performs poorly on network filesystems
**Probability:** Medium — EFS is NFS-based, adds latency to every DB operation
**Mitigation:** Use EFS `maxIO` performance mode. If latency is unacceptable, migrate to RDS PostgreSQL (separate spec). SQLite with WAL mode helps. Benchmark before committing.

### Risk 2: Fargate Cold Start
**Impact:** Medium — workers take 30-60s to pull image and start vs. <5s locally
**Probability:** High — Fargate cold starts are well-documented
**Mitigation:** Keep worker image small (current `claude-code-cluster-worker` is already minimal). Use ECR in same region to minimize pull time. For latency-critical roles, consider Fargate Spot with provisioned concurrency.

### Risk 3: NAT Gateway Cost Creep
**Impact:** Low-Medium — NAT data processing charges ($0.045/GB) can add up with heavy API usage
**Probability:** Medium — LLM API calls involve large payloads
**Mitigation:** Monitor NAT Gateway data charges. Switch to NAT Instance (`t4g.nano`, ~$3/mo) if charges exceed $40/mo. Consider VPC endpoints for AWS services.

### Risk 4: File Watch Triggers on EFS
**Impact:** Medium — `chokidar` file watching may behave differently on EFS vs local filesystem
**Probability:** Medium — NFS file change notifications are unreliable
**Mitigation:** For AWS deployment, consider replacing file_watch triggers with S3 event notifications or polling. Document as a known limitation if file_watch is not commonly used.

### Risk 5: Concurrent EFS Access
**Impact:** Medium — multiple workers writing to shared directories simultaneously
**Probability:** Low — concurrency limits prevent most conflicts
**Mitigation:** EFS supports concurrent access natively. Worker directories are isolated by UUID. Shared folders should use append-only patterns. Document that shared folder writes should be atomic (write-then-rename).

---

## Future Considerations

- **RDS Migration:** If SQLite on EFS proves too slow, migrate to RDS PostgreSQL (Drizzle ORM already supports it — schema stays the same, change the connection string)
- **Multi-Region:** ALB + ECS supports multi-region with Route53 health checks, but adds significant complexity and cost
- **GPU Workers:** For roles needing GPU (e.g., image generation), switch specific role task definitions to `g4dn` or `g5` EC2 launch type
- **Autoscaling Event Handler:** If chat/webhook load increases, add ECS service auto-scaling based on CPU/memory metrics

---

**Spec Author:** 23 Systems
**Created:** 2026-03-20
**Status:** Draft — Ready for Review
