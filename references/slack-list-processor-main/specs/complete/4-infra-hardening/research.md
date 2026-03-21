# Research: AWS Infrastructure Hardening & Gap Resolution

**Date**: 2026-03-05
**Sources**: AWS Documentation MCP, AWS Knowledge MCP, AWS CloudFormation Template Reference

## R1: Secrets Storage - Secrets Manager vs SSM Parameter Store

**Decision**: AWS Secrets Manager

**Rationale**: Secrets Manager supports native ECS integration via `Secrets` + `valueFrom` in container definitions. It handles JSON-structured secrets (can bundle multiple values in one secret), supports automatic rotation, and the ECS task execution role can be granted `secretsmanager:GetSecretValue` with a single IAM statement. SSM Parameter Store SecureString is cheaper ($0 vs $0.40/secret/month) but lacks rotation and requires separate parameters per secret.

**Alternatives considered**:
- SSM Parameter Store SecureString: Cheaper but no rotation, less structured. Would work but Secrets Manager is the AWS-recommended approach per ECS best practices documentation.

**Implementation approach**:
- Create one Secrets Manager secret per environment with all app secrets as JSON keys
- Reference individual keys in ECS task definition: `valueFrom: !Sub '${SecretArn}:SLACK_BOT_TOKEN::'`
- Add `secretsmanager:GetSecretValue` to ECS Task Execution Role
- Deploy script creates the secret via AWS CLI before stack deployment
- Remove all `NoEcho` parameter-based secrets from CloudFormation parameters

**Source**: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html

## R2: Redis Encryption - CacheCluster vs ReplicationGroup

**Decision**: Migrate from `AWS::ElastiCache::CacheCluster` to `AWS::ElastiCache::ReplicationGroup`

**Rationale**: `TransitEncryptionEnabled` and `AtRestEncryptionEnabled` are only available on `ReplicationGroup` resources, not standalone `CacheCluster`. The current template uses `CacheCluster` which cannot support encryption. A ReplicationGroup with a single node provides identical functionality to a CacheCluster but adds encryption capabilities.

**Alternatives considered**:
- Keep CacheCluster without encryption: Fails FR-007/FR-008.
- ElastiCache Serverless: More expensive for consistent workloads, overkill for this use case.

**Implementation approach**:
- Replace `AWS::ElastiCache::CacheCluster` with `AWS::ElastiCache::ReplicationGroup`
- Set `ReplicasPerNodeGroup: 0` (single node, same as current CacheCluster)
- Enable `TransitEncryptionEnabled: true` and `AtRestEncryptionEnabled: true`
- Connection URL changes from `redis://` to `rediss://` (TLS)
- No code changes needed in `src/lib/redis.ts` - ioredis automatically detects TLS from the `rediss://` URL scheme and enables TLS transparently
- CloudFormation output changes from `RedisCluster.RedisEndpoint` to `RedisReplicationGroup.PrimaryEndPoint`

**Breaking change**: This is a replacement operation. Existing Redis data (BullMQ queue state, conversation state) will be lost. This is acceptable since Redis data is ephemeral - no in-flight jobs should be active during deployment.

**Source**: https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticache-replicationgroup.html

## R3: HTTPS on ALB - ACM Certificate + Listener Configuration

**Decision**: Add ACM certificate ARN as CloudFormation parameter, create HTTPS listener on 443, redirect HTTP 80 to HTTPS

**Rationale**: AWS Well-Architected Security Pillar requires encryption in transit. The ALB currently only has an HTTP listener. ACM certificates are free and auto-renew when DNS-validated. The certificate must be provisioned before stack deployment.

**Alternatives considered**:
- Create ACM certificate in CloudFormation: Requires DNS validation which blocks stack creation. Better to provision separately.
- Self-signed certificate: Not trusted by Apollo webhooks or monitoring tools.

**Implementation approach**:
- Add `ACMCertificateArn` parameter (optional, with Condition)
- When provided: Create HTTPS listener on 443 forwarding to target group, modify HTTP listener to redirect to HTTPS
- When not provided: Keep current HTTP-only behavior (for initial setup before cert is ready)
- Use TLS policy `ELBSecurityPolicy-TLS13-1-2-2021-06` (current AWS recommendation)
- Update `WEBHOOK_BASE_URL` to use `https://` when cert is present

**Source**: https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html

## R4: WAFv2 WebACL with Rate-Based Rule

**Decision**: AWS WAFv2 WebACL with IP-based rate limiting rule, associated with ALB

**Rationale**: AWS Well-Architected Security Pillar (SEC05-BP02) recommends controlling traffic at all layers. A rate-based rule protects the webhook endpoint from volumetric abuse without affecting legitimate traffic.

**Implementation approach**:
- Create `AWS::WAFv2::WebACL` with scope `REGIONAL` (for ALB)
- Add rate-based rule: 2000 requests per 5-minute window per IP (matches spec FR-019)
- Default action: Allow (only rate-exceeded IPs are blocked)
- Create `AWS::WAFv2::WebACLAssociation` linking WebACL to ALB
- Add CloudWatch metric for WAF blocks

**Source**: https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-wafv2-webacl-ratebasedstatement.html

## R5: ECS Exec Configuration

**Decision**: Enable `EnableExecuteCommand: true` on ECS Service, add SSM permissions to Task Role

**Rationale**: ECS Exec uses AWS Systems Manager Session Manager to establish secure shell sessions with running containers. Required for running database migrations and debugging in production. No bastion host needed.

**Implementation approach**:
- Add `EnableExecuteCommand: true` to `AWS::ECS::Service` properties
- Add SSM permissions to ECS Task Role: `ssmmessages:CreateControlChannel`, `ssmmessages:CreateDataChannel`, `ssmmessages:OpenControlChannel`, `ssmmessages:OpenDataChannel`
- Operator can then run: `aws ecs execute-command --cluster X --task Y --container app --interactive --command "/bin/sh"`
- For migrations: `aws ecs execute-command ... --command "npx prisma migrate deploy"`

**Source**: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-exec.html

## R6: Application Auto Scaling for ECS

**Decision**: Target tracking scaling policy on CPU utilization (70%) with min 1, max 4 tasks

**Rationale**: Single-task deployment has no redundancy. Auto-scaling adds resilience during enrichment spikes and provides a spare task during rolling deployments.

**Implementation approach**:
- Add `AWS::ApplicationAutoScaling::ScalableTarget` for ECS service (min: 1, max: 4)
- Add `AWS::ApplicationAutoScaling::ScalingPolicy` with `TargetTrackingScaling`
- Use predefined metric `ECSServiceAverageCPUUtilization` with target 70%
- Scale-out cooldown: 60s, scale-in cooldown: 180s

**Source**: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/quickref-application-auto-scaling.html

## R7: Multi-AZ NAT Gateway

**Decision**: Add second NAT Gateway in PublicSubnet2 with dedicated route table for PrivateSubnet2

**Rationale**: AWS Well-Architected Reliability Pillar (REL10-BP01) recommends deploying workloads across multiple locations. A single NAT Gateway creates a cross-AZ dependency that fails if the NAT's AZ is impaired.

**Cost impact**: ~$32/month additional (NAT Gateway hourly + data processing). Total NAT cost ~$64/month.

**Alternative considered**: Regional NAT Gateway (new AWS feature) - automatically expands across AZs. However, it requires VPC-level configuration changes and is newer/less documented. The two-zonal-NAT pattern is well-established and simpler to reason about.

**Implementation approach**:
- Add `NATElasticIP2` and `NATGateway2` in PublicSubnet2
- Add `PrivateRouteTable2` with route to NATGateway2
- Re-associate PrivateSubnet2 from shared PrivateRouteTable to PrivateRouteTable2
- Each private subnet now routes outbound through its local AZ NAT Gateway

**Source**: https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html

## R8: ECS Graceful Shutdown (SIGTERM Handling)

**Decision**: Add Node.js process signal handlers for SIGTERM and SIGINT in `app.ts`

**Rationale**: ECS Fargate sends SIGTERM 30 seconds before SIGKILL during deployments and scale-in. Without handling, in-flight BullMQ jobs are interrupted and may produce corrupt output or leave jobs in a stuck state.

**Implementation approach**:
- Register `process.on('SIGTERM')` and `process.on('SIGINT')` handlers in `app.ts`
- Shutdown sequence: (1) Close BullMQ workers (`.close()` drains in-flight jobs), (2) Close HTTP server (`.close()` stops new connections), (3) Disconnect Prisma (`prisma.$disconnect()`), (4) Disconnect Redis
- Set `stopTimeout: 25` in ECS container definition (25s timeout before SIGKILL, giving 5s buffer)

**Source**: https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html (stopTimeout property)

## R9: Health Check Startup Tolerance

**Decision**: Always return HTTP 200 from health check, use response body `status` field to indicate `healthy` vs `degraded`

**Rationale**: The ALB health check only looks at HTTP status code. If the health endpoint returns 503 when DB/Redis is unreachable, the ALB marks the target unhealthy and ECS restarts the task, creating an infinite loop on fresh deployments. Returning 200 with a `degraded` status in the body lets the task stay running while operators can inspect the status via the response JSON.

**Implementation approach**:
- Change `src/routes/health.ts` to always return HTTP 200
- Keep the `status: 'healthy' | 'degraded'` field in the JSON body
- Keep `redis_connected` and `database_connected` booleans for visibility
- The Docker HEALTHCHECK and ALB both check for HTTP 200, so the task stays alive

## R10: Deploy Script Parameter Persistence

**Decision**: Refactor deploy.sh to pass all parameters on every `cloudformation deploy` invocation

**Rationale**: CloudFormation `deploy` with `--parameter-overrides` replaces ALL parameters. Any parameter not specified reverts to its `Default` value. The second invocation in deploy.sh only passes `DockerImageUri`, causing all secret parameters to revert to empty strings.

**Implementation approach**:
- Extract parameter building into a shell function used by both initial and update invocations
- Always include all secrets from `.env` plus `DockerImageUri` in every `cloudformation deploy` call
- Remove DB password printing from stdout
- Remove `DatabaseUrl` from CloudFormation outputs
