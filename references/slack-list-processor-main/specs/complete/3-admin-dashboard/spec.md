# Feature Specification: Backend Admin Dashboard

**Feature Branch**: `3-admin-dashboard`
**Created**: 2026-03-05
**Status**: Draft
**Input**: Backend admin dashboard for admin users that tracks LLM cost usage, API call requests, errors, with multi-dimensional search/filtering and reporting insights.

## Clarifications

### Session 2026-03-05

- Q: Should the dashboard include proactive budget threshold alerts, or is it passive/read-only? → A: Include budget threshold alerts - admin sets a monthly spend limit, gets Slack notification when exceeded.
- Q: Should the system include configurable data retention policies, or keep all data permanently? → A: Configurable retention per data type (e.g., raw API logs 90 days, error logs 180 days, cost aggregates permanent).
- Q: How should admin identity work - shared key, individual keys, or full user accounts? → A: Individual admin API keys with admin identifier (audit trail per admin, no UI for user management).
- Q: How many lifecycle states should error entries have? → A: Three states - Open, Acknowledged, Resolved (intermediate state indicates someone is investigating).
- Q: Should dashboard API endpoints include rate limiting? → A: Yes, basic per-admin rate limiting at 100 requests/minute per admin key as a safeguard.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Cost & Usage Overview Dashboard (Priority: P1)

An admin user opens the dashboard and immediately sees a high-level summary of system costs and usage. They can see total spend across all API providers (BuiltWith, Apollo, Claude/Anthropic) for any time period, broken down by provider, by client workspace, and by job type. They can spot cost spikes, track trends over time, and drill into specific providers or time windows to understand where money is going.

**Why this priority**: Cost visibility is the primary business driver. Without knowing what the system costs to operate and which clients/operations drive those costs, the business cannot make informed decisions about pricing, budgets, or resource allocation.

**Independent Test**: Can be fully tested by querying existing API usage records and rendering aggregated cost data. Delivers immediate value by showing spend breakdowns without any other dashboard features.

**Acceptance Scenarios**:

1. **Given** the admin is authenticated, **When** they open the dashboard, **Then** they see a summary showing total API cost (USD), total API calls, total LLM tokens consumed, and active job count for the current period.
2. **Given** API usage logs exist for multiple providers, **When** the admin views the cost breakdown, **Then** they see spend separated by BuiltWith, Apollo, and Claude/Anthropic with percentages of total.
3. **Given** multiple Slack workspaces have submitted jobs, **When** the admin views the client breakdown, **Then** they see per-workspace cost totals ranked by spend.
4. **Given** the admin selects a date range, **When** the data refreshes, **Then** all metrics reflect only activity within that range.
5. **Given** the admin views trending data, **When** they select a daily/weekly/monthly granularity, **Then** they see cost plotted over time at that granularity.

---

### User Story 2 - API Call Request Log & Search (Priority: P1)

An admin user needs to investigate a specific API call or browse recent API activity. They can view a chronological log of every API call made to external services, with full details: which service, which endpoint, when it happened, how long it took, what it cost, whether it succeeded or failed, and which job/user/channel triggered it. They can search and filter this log by any dimension: API provider, call type, Slack channel, Slack user, client workspace, job ID, date range, or response status.

**Why this priority**: Operational visibility is critical for debugging, auditing, and understanding system behavior. This is the core data exploration capability that all other dashboard features build upon.

**Independent Test**: Can be fully tested by browsing and filtering API usage records joined with job metadata. Delivers immediate value by providing searchable API call history.

**Acceptance Scenarios**:

1. **Given** API calls have been logged, **When** the admin opens the request log, **Then** they see a paginated list of API calls sorted by most recent, showing service, endpoint, status, duration, cost, and timestamp.
2. **Given** the admin filters by API provider "APOLLO", **When** the filter is applied, **Then** only Apollo API calls are displayed.
3. **Given** the admin filters by Slack user, **When** the filter is applied, **Then** only API calls from jobs initiated by that user are displayed.
4. **Given** the admin filters by Slack channel, **When** the filter is applied, **Then** only API calls from jobs in that channel are displayed.
5. **Given** the admin enters a job ID, **When** they search, **Then** all API calls associated with that job are shown with their sequence and timing.
6. **Given** the admin combines multiple filters (e.g., provider + date range + client), **When** applied together, **Then** results match all filter criteria simultaneously.
7. **Given** the result set exceeds the page size, **When** the admin navigates pages, **Then** they can browse the full result set with consistent sort order.

---

### User Story 3 - Error Monitoring & Diagnostics (Priority: P2)

An admin user notices job failures or wants to proactively monitor system health. They can view a centralized error log that captures failures from all system components: API call failures, queue processing errors, file parsing errors, and Slack delivery errors. Each error entry includes the error message, error category, associated job/user/channel context, timestamp, and stack trace where applicable. They can filter errors by category, severity, service, time range, and resolution status.

**Why this priority**: Error visibility enables proactive issue detection and faster incident response. Without centralized error tracking, admins must dig through application logs to identify and diagnose problems.

**Independent Test**: Can be fully tested by recording errors from various system components and browsing/filtering them through the error log interface. Delivers value by centralizing error visibility.

**Acceptance Scenarios**:

1. **Given** errors have occurred in the system, **When** the admin opens the error log, **Then** they see a paginated list of errors sorted by most recent, showing error message, category, service, associated job, and timestamp.
2. **Given** a BuiltWith API call returned a 429 rate limit error, **When** the admin views the error log, **Then** they see an entry categorized as "API Error" with the specific error details and the associated job context.
3. **Given** a file parsing operation failed, **When** the admin views the error log, **Then** they see an entry categorized as "File Processing Error" with the filename, row count, and parsing error details.
4. **Given** the admin filters errors by category "Queue Error", **When** the filter is applied, **Then** only BullMQ worker failures and timeout errors are displayed.
5. **Given** the admin clicks on an individual error, **When** the detail view opens, **Then** they see the full error message, stack trace, job context (job ID, user, channel, workspace), and timestamps.
6. **Given** the admin marks an error as "acknowledged", **When** the error list is refreshed, **Then** the error shows an "acknowledged" badge indicating someone is investigating, and the acknowledging admin's identity is recorded.
7. **Given** the admin marks an acknowledged error as "resolved", **When** the error list is refreshed, **Then** the error shows a "resolved" badge and can be filtered out of the active error view.
8. **Given** errors are accumulating for a specific service, **When** the admin views error frequency, **Then** they see error counts over time grouped by category and service.

---

### User Story 4 - Client Management & Per-Client Insights (Priority: P2)

An admin user wants to understand how different client workspaces are using the system. They can view a list of all client workspaces (identified by Slack team ID), with per-client summaries: total jobs, total API calls, total cost, error rate, most active users, and most common job types. They can drill into any client to see their full activity timeline, usage patterns, and cost history.

**Why this priority**: Multi-tenant usage visibility is essential for understanding client value, identifying heavy users, detecting abuse, and informing pricing decisions. Depends on cost and usage data from P1 stories.

**Independent Test**: Can be fully tested by aggregating job and API usage records by workspace and presenting per-client dashboards. Delivers value by showing client-level usage patterns.

**Acceptance Scenarios**:

1. **Given** multiple Slack workspaces have submitted jobs, **When** the admin opens the clients view, **Then** they see a list of workspaces with name/ID, total jobs, total cost, last active date, and error rate.
2. **Given** the admin clicks on a specific client, **When** the detail view opens, **Then** they see that client's job history, cost breakdown by provider, top users, and activity timeline.
3. **Given** the admin sorts clients by total cost, **When** the sort is applied, **Then** clients are ranked from highest to lowest spend.
4. **Given** a client has had multiple job failures, **When** the admin views that client's error rate, **Then** they see the failure percentage relative to total jobs and can drill into specific errors.

---

### User Story 5 - Budget Threshold Alerts (Priority: P2)

An admin user wants to be proactively notified when system costs exceed predefined limits rather than having to manually check the dashboard. They can configure monthly spend thresholds (overall or per API provider), and when cumulative spend crosses a threshold, the system sends a Slack notification to a designated admin channel. This prevents runaway costs from going unnoticed.

**Why this priority**: Proactive cost alerting prevents bill shock and enables rapid response to unexpected cost spikes. Passive dashboards only help if someone remembers to check them. Builds directly on the cost data from US1.

**Independent Test**: Can be fully tested by setting a threshold, simulating API usage that exceeds it, and verifying a Slack notification is delivered. Delivers value by turning cost data into actionable alerts.

**Acceptance Scenarios**:

1. **Given** an admin configures a monthly spend threshold of $500, **When** cumulative spend for the current month reaches $500, **Then** a Slack notification is sent to the configured admin channel with the current spend total and which provider(s) contributed most.
2. **Given** an admin configures per-provider thresholds ($200 for Apollo, $100 for Claude), **When** Apollo spend reaches $200, **Then** a provider-specific alert is sent even if the overall threshold has not been reached.
3. **Given** a threshold has already been triggered this month, **When** spend continues to increase, **Then** no duplicate alerts are sent for the same threshold in the same period.
4. **Given** a new month begins, **When** the monthly period resets, **Then** threshold tracking resets and alerts can fire again for the new period.
5. **Given** no thresholds are configured, **When** costs increase, **Then** no alerts are sent (alerting is opt-in).

---

### User Story 6 - Exportable Reports & Scheduled Delivery (Priority: P3)

An admin user needs to share cost and usage reports with stakeholders who don't have dashboard access. They can generate reports for any time period covering cost summaries, usage breakdowns, client activity, and error rates. Reports can be exported as CSV files. Recurring reports can be scheduled for automatic delivery to a Slack channel at a chosen frequency (daily, weekly, monthly).

**Why this priority**: Reporting and sharing extends the value of dashboard data to non-admin stakeholders. It's a convenience feature that builds on top of all P1 and P2 capabilities.

**Independent Test**: Can be fully tested by generating a report for a date range and verifying the exported file contains the expected data. Scheduled delivery can be tested by configuring a recurring report and verifying it arrives.

**Acceptance Scenarios**:

1. **Given** the admin selects a date range and report type (cost summary, usage breakdown, client report), **When** they click "Export CSV", **Then** a CSV file is generated and downloaded containing the relevant data.
2. **Given** the admin configures a weekly cost summary report, **When** the scheduled time arrives, **Then** the report is automatically generated and delivered to the configured Slack channel.
3. **Given** the admin configures a monthly client usage report, **When** the month ends, **Then** each client's usage summary is generated and delivered.
4. **Given** a scheduled report fails to generate, **When** the failure occurs, **Then** the admin is notified of the failure with the reason.

---

### Edge Cases

- What happens when there are no API usage records for the selected time period? The dashboard displays zero-state messaging with "No data for this period" rather than empty charts.
- What happens when a job has no associated API usage logs? The job appears in job history but shows "$0.00" cost and "0 API calls" rather than being hidden.
- How does the system handle very large result sets (e.g., 100,000+ API log entries)? Pagination with server-side filtering ensures only the requested page is loaded. Aggregation queries use database-level computation.
- What happens when an admin searches for a Slack user who has been deactivated? The user ID still appears in search results with their last known display name, even if no longer active in Slack.
- What happens when cost data has null estimated cost values? Entries with unknown cost are displayed as "N/A" in detail views and excluded from cost aggregation totals with a footnote indicating incomplete cost data.
- How does the dashboard handle concurrent admin users? Multiple admins can view the dashboard simultaneously. Data is read-only so there are no concurrency conflicts.
- What happens if a date range filter spans a period with pricing changes? The dashboard reports data as-is based on the values stored at the time of logging. Historical pricing changes are not retroactively applied.
- What happens when an admin queries a date range older than the retention period for raw logs? The system returns pre-computed daily/monthly aggregates for purged periods and indicates that raw drill-down data is no longer available.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST display a summary dashboard showing total API cost, total API calls, total LLM tokens (input + output), and active/completed job counts for a configurable time period.
- **FR-002**: System MUST provide cost breakdowns by API provider (BuiltWith, Apollo, Claude/Anthropic), by client workspace, and by job type.
- **FR-003**: System MUST display time-series cost and usage trends at daily, weekly, and monthly granularity.
- **FR-004**: System MUST provide a paginated, searchable API call request log showing service, endpoint, response status, duration, cost, token counts, and timestamp for every logged API call.
- **FR-005**: System MUST support filtering the API call log by: API provider, API endpoint/call type, Slack channel (ID or name), Slack user (ID or display name), client workspace (team ID), job ID, date range, and response status (success/failure).
- **FR-006**: System MUST support combining multiple filters simultaneously with AND logic.
- **FR-007**: System MUST provide a centralized error log capturing failures from API calls, queue workers, file processing, and Slack operations.
- **FR-008**: System MUST categorize errors by type: API Error, Queue Error, File Processing Error, Slack Error, and System Error.
- **FR-009**: System MUST display error details including: error message, category, associated service, job ID, Slack user, Slack channel, workspace, stack trace, and timestamp.
- **FR-010**: System MUST support a three-state error lifecycle (Open → Acknowledged → Resolved) and allow admins to transition errors between states. The error log MUST be filterable by lifecycle state, and state changes MUST be attributed to the admin who made them.
- **FR-011**: System MUST display a client list showing all Slack workspaces with per-client aggregated metrics: total jobs, total cost, total API calls, error rate, and last active date.
- **FR-012**: System MUST provide per-client detail views showing job history, cost breakdown by provider, top active users, and activity timeline.
- **FR-013**: System MUST allow sorting clients by any aggregated metric (cost, jobs, error rate, last active).
- **FR-014**: System MUST support exporting any dashboard view or report as a CSV file for a selected date range.
- **FR-015**: System MUST support configuring scheduled recurring reports (daily, weekly, monthly) delivered to a Slack channel.
- **FR-016**: System MUST restrict all dashboard access to individually authenticated admin users via per-admin API keys, separate from the regular API authentication used by the enrichment service. Each admin key MUST be associated with an admin identifier for audit trail purposes.
- **FR-017**: System MUST paginate all list endpoints with configurable page sizes.
- **FR-018**: System MUST support date range filtering on all time-series and log data.
- **FR-019**: System MUST log all errors with sufficient context to trace back to the originating job, user, and channel without requiring access to application logs.
- **FR-020**: System MUST display error frequency trends over time, grouped by error category and service.
- **FR-021**: System MUST allow admins to configure monthly spend thresholds (overall and/or per API provider) with a target Slack channel for notifications.
- **FR-022**: System MUST send a Slack notification to the configured channel when cumulative monthly spend crosses a configured threshold, including the current total and top contributing providers.
- **FR-023**: System MUST suppress duplicate alerts for the same threshold within the same monthly period and reset tracking at the start of each new month.
- **FR-024**: System MUST support configurable data retention policies per data type, with admin-settable retention periods (e.g., raw API call logs 90 days, error entries 180 days, pre-computed cost aggregates permanent).
- **FR-025**: System MUST automatically purge raw records that exceed their configured retention period while preserving any pre-computed aggregates derived from them.
- **FR-026**: System MUST enforce per-admin rate limiting on all dashboard API endpoints at 100 requests per minute per admin key, returning an appropriate error when the limit is exceeded.

### Key Entities

- **API Usage Record**: A single logged API call to an external service. Captures the service called, endpoint, cost, tokens consumed, response status, latency, and the originating job. Core data source for cost tracking and the request log.
- **Error Entry**: A recorded system error with categorization, severity context, associated job/user/channel metadata, stack trace, and lifecycle state (Open → Acknowledged → Resolved). State transitions are attributed to the admin who made them. Distinct from API usage records (which may include successful calls).
- **Client (Workspace)**: A Slack workspace identified by team ID. Aggregation boundary for usage, cost, and error metrics. Not a stored entity but a derived view from job records.
- **Scheduled Report**: A configured recurring report with delivery target (Slack channel), frequency, report type, and date range parameters.
- **Budget Threshold**: A configured spending limit with a monthly period, optional provider scope, target notification channel, and triggered/reset state. Tracks whether the threshold has already fired in the current period.
- **Admin User**: An individually identified admin with a unique API key and admin identifier. All dashboard actions (threshold configuration, error resolution, report exports) are attributed to the acting admin. Provisioned via environment configuration or database seeding, not via a self-service UI. Distinct from regular Slack users who interact with the enrichment bot.

## Assumptions

- The existing API usage logging infrastructure (ApiUsageLog model) captures all external API calls with sufficient detail for the dashboard. If any calls are currently not logged, they will need to be instrumented as a prerequisite.
- Error logging currently goes to structured JSON logs (logger.ts). A new database-backed error log entity will be needed to support the centralized error log with search, filtering, and resolution tracking.
- Client workspaces are identified by `slack_team_id` on the Job model. No separate client registration is needed; clients are discovered from job data.
- Admin authentication uses individual per-admin API keys (distinct from the enrichment `X-API-Key`). Admins are provisioned via config or DB seed, not self-service registration. All write actions are attributed to the authenticated admin.
- Scheduled reports use the existing BullMQ infrastructure for job scheduling (repeatable jobs).
- The dashboard is API-only (REST endpoints). A frontend UI is out of scope for this feature and will be a separate effort.
- Cost estimates stored in ApiUsageLog are calculated at write time using configurable pricing from environment variables. The dashboard reports these stored values without recalculation.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Admin users can view total system cost for any time period within 3 seconds of selecting the date range.
- **SC-002**: Admin users can search and filter the API call log across any combination of 3+ filters and receive paginated results within 2 seconds.
- **SC-003**: All API calls to external services (BuiltWith, Apollo, Claude) are captured in the request log with zero data loss under normal operating conditions.
- **SC-004**: Errors from all system components (API, queue, file processing, Slack) appear in the centralized error log within 60 seconds of occurrence.
- **SC-005**: Admin users can identify the top 5 clients by cost for any given month within 2 interactions (open dashboard, select date range).
- **SC-006**: Dashboard queries do not degrade enrichment processing performance by more than 5% under normal load.
- **SC-007**: Exported CSV reports contain all data matching the applied filters with no missing or duplicated records.
- **SC-008**: Scheduled reports are delivered within 15 minutes of their configured delivery time with a 99% reliability rate.
- **SC-009**: Admin users can trace any error back to its originating job, user, and channel without leaving the dashboard.
- **SC-010**: The dashboard supports at least 5 concurrent admin users without performance degradation.
