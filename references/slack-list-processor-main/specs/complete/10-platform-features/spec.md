# Feature Specification: Platform Features

**Feature Branch**: `10-platform-features`
**Created**: 2026-03-09
**Status**: Draft
**Input**: User description: "Platform Features - Workspace client assignment, API key rotation, enrichment preset tags and enable/disable, data retention policy, self-hosted SOC2 licensing"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Workspace & Client Assignment (Priority: P1)

As a platform administrator, I need to organize enrichment workflows and campaigns under specific client workspaces so that each client's data, API credentials, and usage are isolated and trackable.

**Why this priority**: Client isolation is foundational to multi-tenant operation. Without it, all workflows and campaigns share a single context, making it impossible to track per-client usage, apply client-specific API keys, or generate client-scoped reports.

**Independent Test**: Can be tested by creating two client workspaces, assigning workflows to each, and verifying that each workspace uses its own API credentials and shows only its own data.

**Acceptance Scenarios**:

1. **Given** the admin dashboard, **When** an administrator navigates to workspace settings, **Then** they can create, edit, and deactivate client workspaces.
2. **Given** a workspace with API credentials configured, **When** a workflow is assigned to that workspace, **Then** the workflow uses the workspace's API credentials (HubSpot, Apollo, BuiltWith, Instantly, HeyReach) for all operations.
3. **Given** multiple workspaces exist, **When** an administrator views the workflows list, **Then** they can filter by workspace to see only workflows assigned to a specific client.
4. **Given** a workspace is deactivated, **When** any workflow assigned to it is triggered, **Then** the workflow does not execute and a warning is logged.
5. **Given** a new workflow or campaign is created, **When** the creator selects a workspace, **Then** the workflow/campaign inherits that workspace's configuration and credentials.

---

### User Story 2 - API Key Rotation (Priority: P1)

As a platform administrator, I need to rotate API keys for external services (HubSpot, Apollo, BuiltWith, Instantly, HeyReach) without downtime so that security best practices are maintained and compromised keys can be replaced immediately.

**Why this priority**: API keys are shared across active workflows. A key change without rotation support would break all running workflows until the new key is manually updated everywhere.

**Independent Test**: Can be tested by adding a new API key for a service, marking the old key as deprecated, verifying active workflows switch to the new key, and then revoking the old key.

**Acceptance Scenarios**:

1. **Given** a workspace with an active API key for a service, **When** an administrator adds a new key for the same service, **Then** both keys are active simultaneously during a transition period.
2. **Given** two active keys for the same service (old and new), **When** a workflow executes, **Then** the system uses the newest active key.
3. **Given** an old key marked for deprecation, **When** the administrator confirms revocation, **Then** the old key is permanently disabled and cannot be used.
4. **Given** a key rotation in progress, **When** the new key fails authentication, **Then** the system falls back to the previous active key and alerts the administrator.
5. **Given** any key change, **When** the rotation occurs, **Then** an audit log entry records who changed the key, when, and for which service.

---

### User Story 3 - Enrichment Preset Tags & Enable/Disable (Priority: P2)

As a campaign manager, I need to tag enrichment presets with categories and enable/disable them so that I can organize presets by use case and control which ones are available for workflow configuration.

**Why this priority**: As the number of enrichment presets grows, managers need organization and control. Without tags, finding the right preset becomes difficult. Without enable/disable, outdated presets clutter the selection UI.

**Independent Test**: Can be tested by creating presets with tags, filtering by tag, disabling a preset, and verifying it no longer appears in workflow configuration dropdowns.

**Acceptance Scenarios**:

1. **Given** the enrichment presets management page, **When** a manager creates or edits a preset, **Then** they can assign one or more tags (e.g., "IT Leaders", "Enterprise", "Quick Scan").
2. **Given** presets with tags, **When** a manager filters the presets list by a tag, **Then** only presets with that tag are displayed.
3. **Given** a preset that is enabled, **When** a manager toggles it to disabled, **Then** the preset no longer appears as an option when configuring ENRICHMENT nodes in the workflow builder.
4. **Given** a disabled preset, **When** a manager views the presets management page, **Then** the disabled preset is shown with a visual indicator (e.g., greyed out) and can be re-enabled.
5. **Given** an ENRICHMENT node in an active workflow referencing a preset that is subsequently disabled, **When** the workflow executes, **Then** the execution uses the preset as configured (disable only affects new configurations, not existing workflows).

---

### User Story 4 - Data Retention Policy (Priority: P2)

As a platform administrator, I need configurable data retention policies so that client data flows through the system as a passthrough (30-90 day retention) while application logs are retained permanently, ensuring compliance with SOC 2 requirements.

**Why this priority**: Data retention is a compliance requirement for SOC 2 and a client trust issue. Without it, client contact data accumulates indefinitely, increasing liability and storage costs.

**Independent Test**: Can be tested by setting a 30-day retention policy, creating workflow executions with contact data, and verifying that data older than 30 days is automatically purged while application logs remain.

**Acceptance Scenarios**:

1. **Given** the platform settings page, **When** an administrator configures a data retention policy, **Then** they can set a retention period between 30 and 90 days for client contact data.
2. **Given** a 30-day retention policy, **When** a workflow execution's contact data reaches 30 days old, **Then** the system automatically purges the contact-level data (names, emails, phones, enrichment results).
3. **Given** data purge runs, **When** contact data is deleted, **Then** application logs (execution timestamps, node statuses, error messages, aggregate counts) are retained permanently.
4. **Given** a retention policy is changed from 90 days to 30 days, **When** the next purge cycle runs, **Then** all data older than 30 days is purged according to the new policy.
5. **Given** the data retention system, **When** a purge runs, **Then** an audit log entry records the number of records purged, the date range, and the workspace affected.

---

### User Story 5 - Self-Hosted SOC 2 Licensing (Priority: P3)

As a platform operator, I need a self-hosted licensing model so that the platform can be deployed on-premises for clients with strict data sovereignty requirements, with transparent pricing ($1,000/month for 15 users, $99/additional user).

**Why this priority**: Self-hosted deployment is a sales enabler for enterprise clients who cannot use cloud-hosted tools due to compliance requirements. Lower priority because it requires significant infrastructure work and has a smaller initial target market.

**Independent Test**: Can be tested by deploying the platform with a license key, verifying the user limit is enforced, and confirming the license validation does not require an internet connection after initial activation.

**Acceptance Scenarios**:

1. **Given** a self-hosted deployment, **When** an operator enters a valid license key during setup, **Then** the platform activates with the licensed user count (base: 15 users).
2. **Given** a licensed deployment with 15 user slots, **When** a 16th user is invited, **Then** the system displays a message indicating additional user licenses are required ($99/user/month).
3. **Given** a valid license, **When** the license expiry date is within 30 days, **Then** the platform displays a renewal reminder to administrators.
4. **Given** an expired license, **When** 14 days past expiry (grace period), **Then** the platform enters read-only mode - existing data is accessible but new workflows and executions are blocked.
5. **Given** a self-hosted deployment, **When** the platform validates the license, **Then** validation works offline after initial activation (no ongoing phone-home requirement).
6. **Given** a self-hosted deployment, **When** compared to the cloud-hosted version, **Then** all features are functionally identical (no feature gating between hosted and self-hosted).

---

### Edge Cases

- What happens when a workspace is deleted that has active workflows? The workspace must be deactivated first, which pauses all workflows. Deletion is only allowed after all workflows are archived or reassigned.
- What happens when all API keys for a service are revoked simultaneously? The system prevents revoking the last active key and requires at least one valid key to remain active.
- What happens when a data retention purge fails midway? The purge is transactional per-batch; partial purges are rolled back and retried on the next cycle.
- What happens when a self-hosted license key is used on multiple deployments? The license key includes a deployment fingerprint. A second deployment with the same key is rejected during activation.
- What happens when enrichment preset tags contain special characters? Tags are normalized to alphanumeric + hyphens, max 30 characters.
- What happens when a workspace's API credentials expire during a running workflow? The workflow execution marks the affected node as failed with a credentials-expired error and the administrator is notified.

## Requirements _(mandatory)_

### Functional Requirements

**Workspace & Client Assignment**
- **FR-001**: System MUST support creating, editing, and deactivating client workspaces with isolated configuration.
- **FR-002**: Each workspace MUST store its own set of API credentials for external services (HubSpot, Apollo, BuiltWith, Instantly, HeyReach).
- **FR-003**: Workflows and campaigns MUST be assignable to a workspace, inheriting that workspace's credentials.
- **FR-004**: The admin dashboard MUST support filtering workflows, campaigns, and executions by workspace.
- **FR-005**: Deactivating a workspace MUST prevent all assigned workflows from executing.

**API Key Rotation**
- **FR-006**: System MUST support adding multiple API keys per service per workspace, with one designated as active.
- **FR-007**: System MUST support a transition period where both old and new keys are valid simultaneously.
- **FR-008**: System MUST fall back to the previous active key if the new key fails authentication.
- **FR-009**: System MUST log all key changes in an audit trail (who, when, which service, which workspace).
- **FR-010**: System MUST prevent revoking the last active key for any service.

**Enrichment Preset Management**
- **FR-011**: System MUST support assigning one or more tags to enrichment presets.
- **FR-012**: The presets list MUST support filtering by tag.
- **FR-013**: System MUST support enabling and disabling individual presets.
- **FR-014**: Disabled presets MUST NOT appear in workflow builder ENRICHMENT node configuration dropdowns.
- **FR-015**: Disabling a preset MUST NOT affect existing workflows that already reference it.

**Data Retention**
- **FR-016**: System MUST support configurable data retention periods (30-90 days) for client contact data.
- **FR-017**: System MUST automatically purge contact-level data (PII, enrichment results) after the retention period expires.
- **FR-018**: System MUST retain application logs (execution metadata, errors, aggregate counts) permanently regardless of retention policy.
- **FR-019**: System MUST log each purge operation in the audit trail with record counts and affected workspace.

**Self-Hosted Licensing**
- **FR-020**: System MUST support license key activation for self-hosted deployments.
- **FR-021**: System MUST enforce user count limits based on the license tier (base: 15 users, additional: per-user).
- **FR-022**: System MUST provide a 14-day grace period after license expiry before entering read-only mode.
- **FR-023**: License validation MUST work offline after initial activation.
- **FR-024**: Self-hosted deployments MUST have feature parity with cloud-hosted deployments.

### Key Entities

- **Workspace**: A client-scoped container for configuration, credentials, workflows, and campaigns. Has a name, status (active/inactive), and associated API credential sets.
- **ApiCredential**: An API key or token for an external service, scoped to a workspace. Has a service identifier, encrypted key value, status (active/deprecated/revoked), and creation/rotation timestamps.
- **EnrichmentPresetTag**: A categorization label for enrichment presets. Many-to-many relationship with presets.
- **RetentionPolicy**: Per-workspace configuration defining the data retention period in days and the last purge timestamp.
- **License**: A deployment license with key, user count limit, expiry date, deployment fingerprint, and activation status.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Workflows assigned to a workspace use that workspace's API credentials 100% of the time (zero cross-workspace credential leakage).
- **SC-002**: API key rotation completes with zero workflow execution failures (fallback key is used when new key fails).
- **SC-003**: Enrichment preset filtering by tag reduces preset selection time (managers can find the right preset without scrolling through the full list).
- **SC-004**: Data purge runs complete within the configured retention window with 100% of expired contact data removed.
- **SC-005**: Application logs are retained indefinitely regardless of data retention policy (zero log loss during purge).
- **SC-006**: Self-hosted license enforcement correctly blocks user creation beyond the licensed limit 100% of the time.
- **SC-007**: All key rotation events are captured in the audit trail with complete context (who, when, service, workspace).

## Assumptions

- Workspaces extend the existing ManagedClient model rather than replacing it. Each ManagedClient gains workspace-level isolation for credentials and data.
- API key encryption uses the existing secrets management pattern already in use for storing HubSpot, Apollo, and other API keys.
- Data retention purge runs as a scheduled job, leveraging the existing queue infrastructure.
- The self-hosted licensing model uses cryptographic license keys (no license server dependency after activation).
- Enrichment preset tags are a flat taxonomy (no hierarchical tag structure).
- The data retention policy applies to contact-level data only. Workflow templates, configurations, and preset definitions are not subject to retention purge.
- SOC 2 compliance for the self-hosted deployment is the customer's responsibility; the platform provides the tools (audit logging, data retention, encryption) to support compliance.
