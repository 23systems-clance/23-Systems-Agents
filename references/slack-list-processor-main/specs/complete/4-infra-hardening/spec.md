# Feature Specification: AWS Infrastructure Hardening & Gap Resolution

**Feature Branch**: `4-infra-hardening`
**Created**: 2026-03-05
**Status**: Draft
**Input**: Resolve all 20 issues identified in the AWS infrastructure audit covering secrets management, encryption, networking, deployment safety, application resilience, and operational readiness. Align with AWS Well-Architected Framework best practices across Security, Reliability, Operational Excellence, and Performance Efficiency pillars.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Secure Secrets Management (Priority: P1)

As an operations engineer, I need all sensitive credentials (API keys, database passwords, webhook secrets) to be stored and delivered securely so that secrets are never exposed in configuration files, deployment logs, console views, or stack outputs.

**Why this priority**: Exposed secrets are the highest-severity security risk. Plain-text credentials in infrastructure definitions, deployment outputs, and terminal logs can lead to full system compromise. Aligns with AWS Well-Architected Security Pillar (SEC02-BP02, SEC09-BP02).

**Independent Test**: Deploy the stack and confirm no secret values appear in CloudFormation outputs, ECS task definition environment variables (visible in console), deployment script stdout, or CloudTrail logs. Secrets should only be resolvable at container runtime via the secrets management service.

**Acceptance Scenarios**:

1. **Given** a deployed infrastructure stack, **When** an operator views the CloudFormation stack outputs, **Then** no database passwords, API keys, or tokens are visible in any output value.
2. **Given** a running ECS task, **When** an operator views the task definition in the AWS Console, **Then** all sensitive values show as references to the secrets store, not plain text.
3. **Given** a deployment execution, **When** the deploy script runs to completion, **Then** no secrets are printed to stdout or stderr at any point during the process.
4. **Given** the infrastructure template, **When** it is reviewed for secret handling, **Then** all sensitive values use secure secret references in container definitions.

---

### User Story 2 - Encrypted Communications & Data Protection (Priority: P1)

As a security-conscious operator, I need all data in transit and at rest to be encrypted so that sensitive enrichment data (company information, contact details, phone numbers) is protected from interception or unauthorized access.

**Why this priority**: Unencrypted data in transit (HTTP webhooks carrying contact data) and at rest (Redis conversation state and job queue data) violates security best practices and compliance requirements. Aligns with AWS Well-Architected Security Pillar (SEC09-BP01, SEC09-BP02).

**Independent Test**: Confirm the load balancer only serves HTTPS traffic, the webhook endpoint URL uses HTTPS, and the cache cluster has encryption enabled for both data at rest and in transit.

**Acceptance Scenarios**:

1. **Given** the load balancer, **When** a client makes an HTTP request on port 80, **Then** the request is redirected to HTTPS on port 443.
2. **Given** the Apollo webhook integration, **When** Apollo sends phone result data, **Then** the data is transmitted over HTTPS to a TLS-secured endpoint.
3. **Given** the Redis cache cluster, **When** the ECS application connects to Redis, **Then** the connection uses TLS encryption in transit.
4. **Given** the Redis cache cluster, **When** data is persisted to disk, **Then** it is encrypted at rest.

---

### User Story 3 - Safe & Reliable Deployments (Priority: P1)

As a DevOps engineer, I need the deployment process to be idempotent, non-destructive, and handle all configuration consistently so that deployments never accidentally wipe secrets, fail silently, or leave the system in a broken state.

**Why this priority**: The deploy script currently drops all secrets on update operations and has no migration strategy for the production database. A bad deployment could take down the entire service. Aligns with AWS Well-Architected Operational Excellence Pillar (OPS06-BP01).

**Independent Test**: Run the deploy script in both initial and update modes and confirm all parameters persist across updates, database schema changes can be applied, and the application starts successfully.

**Acceptance Scenarios**:

1. **Given** an existing deployed stack, **When** the deploy script runs in update mode, **Then** all secret parameters retain their values (none revert to empty defaults).
2. **Given** a new application version with schema changes, **When** the operator needs to apply database migrations, **Then** there is a documented mechanism to run migrations against the production database in the private subnet.
3. **Given** the ECS service, **When** an operator needs to debug a running container, **Then** interactive shell access is available without requiring a bastion host or VPN.
4. **Given** the application runtime, **When** the database driver is needed, **Then** it is explicitly declared as a production dependency and available in the built container image.

---

### User Story 4 - Application Resilience & Graceful Lifecycle (Priority: P2)

As a platform operator, I need the application to handle infrastructure events gracefully (deployments, scaling, AZ failures) so that in-flight enrichment jobs are not lost and the service recovers automatically from transient failures.

**Why this priority**: Without graceful shutdown, rolling deployments can interrupt multi-minute enrichment jobs. Without health check tolerance, fresh deployments enter restart loops. Without auto-scaling, the single task is a single point of failure. Aligns with AWS Well-Architected Reliability Pillar (REL11-BP01, REL11-BP04).

**Independent Test**: Deploy the service, send a SIGTERM signal, and confirm BullMQ workers drain cleanly. Observe a fresh deployment (before migrations) does not enter restart loops.

**Acceptance Scenarios**:

1. **Given** a running application processing enrichment jobs, **When** a SIGTERM signal is received, **Then** BullMQ workers stop accepting new jobs, in-flight jobs complete or are returned to the queue, the HTTP server stops accepting new connections, and database connections are released.
2. **Given** a fresh deployment with no database migrations applied, **When** the health check endpoint is called, **Then** the service returns a success status to prevent restart loops, while clearly indicating degraded backend connectivity.
3. **Given** the ECS service under load, **When** CPU utilization exceeds defined thresholds, **Then** additional tasks are launched automatically.
4. **Given** the ECS service after a load spike subsides, **When** utilization drops below thresholds, **Then** excess tasks are gracefully removed after a cooldown period.

---

### User Story 5 - Network Resilience & High Availability (Priority: P2)

As a platform operator, I need the network infrastructure to be resilient to single-AZ failures so that the service maintains internet connectivity (for Slack Socket Mode, external API calls) even when one availability zone is impaired.

**Why this priority**: A single NAT Gateway in one AZ means all outbound internet connectivity fails if that AZ has issues. Aligns with AWS Well-Architected Reliability Pillar (REL10-BP01).

**Independent Test**: Confirm the infrastructure template provisions NAT Gateways in multiple AZs with independent route tables.

**Acceptance Scenarios**:

1. **Given** private subnets in two availability zones, **When** the NAT Gateway in AZ-1 becomes unavailable, **Then** workloads in AZ-2 still have outbound internet connectivity through the AZ-2 NAT Gateway.
2. **Given** the load balancer target group, **When** a rolling deployment replaces an old container, **Then** the old container is drained within 60 seconds (not the default 300 seconds).

---

### User Story 6 - Webhook Endpoint Protection (Priority: P2)

As a security engineer, I need the public-facing webhook endpoint to be protected against abuse and volumetric attacks so that malicious actors cannot overwhelm the service.

**Why this priority**: The ALB exposes the webhook endpoint to the internet with no infrastructure-level protection. Aligns with AWS Well-Architected Security Pillar (SEC05-BP02).

**Independent Test**: Confirm a web application firewall is attached to the load balancer with rate-limiting rules, and that the application restricts cross-origin requests in production.

**Acceptance Scenarios**:

1. **Given** the public ALB endpoint, **When** a single IP sends more than 2000 requests in a 5-minute window, **Then** subsequent requests from that IP are blocked at the infrastructure level.
2. **Given** the application running in production, **When** a cross-origin request arrives from an unauthorized origin, **Then** the request is rejected by CORS policy.

---

### User Story 7 - Operational Visibility & Configuration Completeness (Priority: P3)

As an operator monitoring the system, I need accurate version reporting, complete cost-tracking configuration, and appropriate log retention so that I can effectively monitor, debug, and attribute costs.

**Why this priority**: Missing environment variables for cost tracking means hardcoded defaults that may drift from actual pricing. The version endpoint always returns a static value. Aligns with AWS Well-Architected Operational Excellence Pillar (OPS08-BP01).

**Independent Test**: Call the health endpoint and confirm it returns the actual application version. Check the ECS task definition includes all cost-tracking values.

**Acceptance Scenarios**:

1. **Given** the application running in a container, **When** the health endpoint is called, **Then** the response includes the actual application version (not a hardcoded fallback).
2. **Given** the ECS task definition, **When** reviewed for environment variables, **Then** all cost-tracking configuration values are present.
3. **Given** the CloudWatch log group, **When** log retention is configured, **Then** the retention period is explicitly set and documented.

---

### Edge Cases

- What happens when a secret rotation occurs? The application must pick up new secrets on the next task launch (ECS force-new-deployment).
- What happens when the HTTPS certificate expires? Auto-renewing certificates should be used.
- What happens during deployment when the database is unreachable? The health check must not cause restart loops.
- What happens when Redis is being patched? The application should tolerate brief disconnections via existing retry logic.
- What happens if the WAF blocks a legitimate Apollo webhook? Rate limits should be high enough that normal traffic is never blocked.
- What happens if the deploy script is interrupted mid-execution? The CloudFormation stack should be rollback-safe.

## Requirements _(mandatory)_

### Functional Requirements

**Secrets Management (Critical)**
- **FR-001**: System MUST store all sensitive credentials in a dedicated secrets management service, not as plain-text values in infrastructure definitions.
- **FR-002**: System MUST deliver secrets to running containers at startup via secure secret references, not plain-text environment variables in task definitions.
- **FR-003**: System MUST NOT expose any secret values in infrastructure stack outputs.
- **FR-004**: System MUST NOT print any secret values to stdout, stderr, or log files during deployment.

**Encryption (Critical)**
- **FR-005**: System MUST serve all external HTTP traffic over TLS (HTTPS) with a valid certificate.
- **FR-006**: System MUST redirect all HTTP (port 80) requests to HTTPS (port 443).
- **FR-007**: System MUST encrypt all cache cluster data in transit using TLS.
- **FR-008**: System MUST encrypt all cache cluster data at rest.

**Deployment Safety (Critical)**
- **FR-009**: System MUST preserve all configuration parameters across deployment updates (no parameter value loss on update operations).
- **FR-010**: System MUST provide a mechanism to run database schema migrations against the production database in the private subnet.
- **FR-011**: System MUST enable interactive shell access to running containers for debugging and operational tasks.
- **FR-012**: System MUST declare all runtime dependencies explicitly in the package manifest.

**Application Resilience (High)**
- **FR-013**: System MUST handle termination signals by gracefully draining background job workers, stopping the HTTP server, and releasing database connections.
- **FR-014**: System MUST return a successful health check response during startup even when backend dependencies are not yet reachable, to prevent container restart loops.
- **FR-015**: System MUST automatically scale the number of running tasks based on resource utilization thresholds.
- **FR-016**: System MUST configure auto-scaling with a minimum of 1 task and a maximum appropriate to the workload.

**Network Resilience (High)**
- **FR-017**: System MUST provision NAT Gateways in multiple availability zones so that an AZ failure does not disrupt outbound connectivity for workloads in other AZs.
- **FR-018**: System MUST route private subnet traffic through the NAT Gateway in the same availability zone.

**Endpoint Protection (Medium)**
- **FR-019**: System MUST attach a web application firewall to the load balancer with rate-limiting rules.
- **FR-020**: System MUST restrict cross-origin requests in production to known origins (not wildcard allow-all).
- **FR-021**: System MUST set the load balancer target group deregistration delay to 60 seconds.

**Operational Completeness (Low)**
- **FR-022**: System MUST report the actual application version in health check responses.
- **FR-023**: System MUST include all cost-tracking environment variables in the production task definition.
- **FR-024**: System MUST set an appropriate log retention period and document the compliance rationale.

### Assumptions

- An ACM certificate will be provisioned separately (or as a parameter) for the HTTPS listener. DNS validation is assumed.
- The WAF rate limit of 2000 requests per 5-minute window is sufficient for normal Apollo webhook traffic and API usage.
- Auto-scaling maximum of 4 tasks is appropriate for current workload patterns. Adjustable as load characteristics become clearer.
- The graceful shutdown timeout of 30 seconds (ECS default SIGTERM-to-SIGKILL window) is sufficient for in-flight BullMQ jobs to complete or be returned to the queue.
- CORS allowed origins will be configured as an environment variable or restricted to the Slack workspace domain. Since primary consumers are Slack (Socket Mode) and Apollo (webhooks), strict CORS is primarily defensive.
- The existing S3 credential handling (IAM role in production, explicit keys for local dev) is correct and requires no changes.
- Log retention of 30 days is acceptable for operational needs. Audit-critical data is stored in the PostgreSQL audit_logs table with permanent retention.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Zero secrets are visible in CloudFormation outputs, ECS console task definitions, or deployment script output.
- **SC-002**: 100% of external HTTP traffic is served over TLS; HTTP requests are redirected to HTTPS.
- **SC-003**: All cache data is encrypted at rest and in transit, verifiable via infrastructure resource configuration.
- **SC-004**: The deployment script can run in both initial and update modes without losing any configuration parameters.
- **SC-005**: Database migrations can be executed against the production database using built-in container shell access (no bastion host required).
- **SC-006**: The application shuts down gracefully within 30 seconds of receiving a termination signal, with no orphaned in-flight jobs.
- **SC-007**: A fresh deployment (before migrations) does not enter health check restart loops; the task stays running and reports degraded status.
- **SC-008**: The service auto-scales from 1 to 4 tasks based on CPU utilization exceeding 70%.
- **SC-009**: Private subnets in both AZs maintain outbound internet connectivity independently via per-AZ NAT Gateways.
- **SC-010**: The WAF blocks requests from IPs exceeding the rate limit threshold, verifiable via WAF metrics.
- **SC-011**: The health endpoint returns the actual application version, not a hardcoded default.
- **SC-012**: All 20 audit findings are resolved with no regressions to existing functionality.
