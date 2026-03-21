# Feature Specification: Client Billing & Enrichment Credit Management

**Feature Branch**: `12-client-billing`
**Created**: 2026-03-09
**Status**: Draft
**Input**: User description: "Client-facing billing system with Stripe integration, hybrid credit model (monthly allowance + overage charges), magic link onboarding, and real-time credit deduction during enrichment. Everything happens in the client's assigned Slack channel."

## Clarifications

### Session 2026-03-10

- Q: What triggers the "suspended" billing status? → A: Admin manually suspends (for disputes, contract holds, offboarding). It is not auto-triggered by the system.
- Q: Who receives the magic link DM? → A: A designated billing contact (Slack user) set in the billing profile by admin, plus the ability to send to an email address. Email delivery requires an email sending service integration (e.g., Resend).
- Q: Does 1 credit = 1 API call regardless of provider? → A: No. Per-provider credit rates set in config (e.g., BuiltWith = X credits/lookup, Apollo = Y credits/enrichment). Different operations cost different credit amounts.
- Q: What happens if a workspace has a negative balance at monthly reset? → A: Negative balance carries forward and is deducted from the new allocation (e.g., -100 owed + 500 new = 400 effective balance).
- Q: Can admins exempt specific workspaces from the billing gate? → A: Yes. Admin can set a "billing exempt" flag per workspace (for internal testing, partner accounts, or trial periods). Exempt workspaces bypass the billing gate entirely.

### Session 2026-03-10 (Gap Audit)

- Q: Which enrichment entry points need the billing gate? → A: ALL of them. There are 7 entry points: (1) agent/NL flow via intentRouter, (2) "Get Technographics" button, (3) "Get Contacts" button, (4) "Get Both" button, (5) chain from completed tech job, (6) tech report generation via reportFilters, (7) fresh tech report via cacheDecision (cache_fresh). Currently only the agent flow has a limit check. The billing gate must be injected into all 7.
- Q: The existing internal cost tracking has 3 competing logging functions — how should this be handled? → A: As a prerequisite before billing implementation, consolidate all API usage logging into a single function (`trackUsage`) that always captures `slackTeamId` for workspace attribution and triggers budget threshold checks. The current worker-local `logApiUsage` functions in contact.ts and technographic.ts are missing both.
- Q: What happens to the existing `WorkspaceInstallation` limit fields (monthlySpendCapUsd, maxBuiltwithLookups, maxApolloCredits, maxAiTokens)? → A: These are superseded by the billing profile. During rollout: if a workspace has a billing profile, the billing system takes precedence; if no billing profile exists, the legacy limits still apply. After full migration, the legacy fields are deprecated and removed.
- Q: Are per-provider credit rates global or per-workspace? → A: Global platform configuration managed via the admin dashboard. All workspaces pay the same credit rate per operation. Rates are: BuiltWith CTU lookup, BuiltWith domain lookup, Apollo people search, Apollo bulk enrich — each with its own credit cost.
- Q: Are tech reports (BuiltWith search-based reports) billable? → A: Yes. Tech reports consume BuiltWith credits and must be gated and metered the same as other enrichment types.
- Q: How accurate should the pre-enrichment credit estimate be? → A: The estimate is based on row count multiplied by the per-operation credit rate. For contact enrichment, it assumes 1 people search per company plus 1 bulk enrich call per batch. The estimate should be presented as "approximately X credits" (not exact) since actual usage depends on API responses.
- Q: How should credit pricing work relative to actual vendor costs? → A: Hybrid model — each operation type has a fixed base credit cost (e.g., "Apollo people search = 3 credits"), plus a global markup percentage applied on top (e.g., 25% markup). Final credit cost per operation = ceil(baseCost * (1 + markupPercent / 100)). This allows setting what each operation is "worth" in platform credits independently, while applying a single margin lever across all operations. Both the base costs and the markup percentage are global (same for all clients) and managed via the admin dashboard.

### Session 2026-03-10 (Clarification Pass 3)

- Q: When a billing profile is activated mid-cycle, does the client receive credits immediately or wait for the first billing cycle day? → A: Immediate full allocation. The client receives their full monthly allowance upon activation. The first billing cycle reset happens on the configured cycle day.
- Q: How should refunds and Stripe chargebacks be handled? → A: Admin-only credit adjustments (FR-015) serve as the refund mechanism. Stripe chargebacks (charge.dispute.created webhook) trigger "delinquent" status and admin notification. No Stripe Refund API integration in v1.
- Q: What is explicitly out of scope for v1? → A: Invoice/PDF generation, tax calculation, multi-currency support, client-facing billing web portal, billing data CSV export, and per-workspace credit rates are all excluded from v1.
- Q: When a suspended workspace is reactivated, does it get fresh credits or resume with its prior balance? → A: Resume with prior balance. Reactivation restores the balance the workspace had when suspended. The monthly reset handles the next allocation naturally.
- Q: Should suspended or delinquent workspaces receive monthly credit allocations? → A: No. Only workspaces with "active" billing status receive monthly credit resets. Suspended and delinquent workspaces are skipped.

## Context

Clients use the Slack List Processor to enrich company and contact lists. Currently, enrichment costs are tracked internally but clients are not billed. This feature adds a client-facing billing system where clients receive a monthly credit allowance, enrichments deduct credits in real-time, and overages are automatically charged to their payment method. Clients who have not set up billing are blocked from enriching until they complete payment onboarding via a secure magic link.

## Out of Scope (v1)

- Invoice or PDF generation
- Tax calculation or sales tax compliance
- Multi-currency support (all amounts in USD)
- Client-facing billing web portal (clients see balance via Slack messages and manage payment via Stripe Customer Portal only)
- Billing data CSV export for accounting
- Per-workspace credit rates (rates are global platform configuration)
- Stripe Refund API integration (refunds handled via admin credit adjustments)

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Admin Configures Client Billing Profile (Priority: P1)

As a platform administrator, I need to set up a billing profile for each client workspace with a monthly credit allowance, overage rate, and rollover cap, so that clients can be billed for their enrichment usage.

**Why this priority**: Without billing profiles, no credit tracking or charging can occur. This is the foundational data model all other billing features depend on.

**Independent Test**: Can be tested by creating a billing profile for a workspace via the admin dashboard and verifying the profile is stored with correct credit allowance, overage rate, and rollover cap.

**Acceptance Scenarios**:

1. **Given** the admin dashboard billing page, **When** an administrator creates a billing profile for a workspace, **Then** the profile is stored with: monthly credit allowance, overage rate per credit, maximum rollover credits, billing cycle day, and billing email.
2. **Given** an existing billing profile, **When** an administrator updates the monthly credit allowance, **Then** the new allowance takes effect on the next billing cycle without affecting the current balance.
3. **Given** a billing profile, **When** an administrator manually adjusts the credit balance (add or deduct), **Then** a transaction record is created with the adjustment amount, reason, and the administrator's identity.
4. **Given** the admin dashboard billing page, **When** an administrator views the list of all workspaces, **Then** each workspace shows: billing status, current credit balance, monthly allowance, and overage rate.
5. **Given** a workspace without a billing profile, **When** the administrator views it, **Then** it is clearly marked as "No Billing Configured" and enrichment is blocked for that workspace.
6. **Given** an active billing profile, **When** an administrator manually suspends it (for disputes, contract holds, or offboarding), **Then** the billing status transitions to "suspended," enrichment is blocked, and the action is recorded in the transaction ledger.
7. **Given** a suspended billing profile, **When** an administrator reactivates it, **Then** the billing status transitions back to "active" with the same credit balance it had when suspended. No new credit allocation occurs; the monthly reset handles the next allocation on the billing cycle day.

---

### User Story 2 - Client Payment Onboarding via Magic Link (Priority: P1)

As a client, I need to receive a secure link to set up my payment details so that I can start using the enrichment service and be billed for usage.

**Why this priority**: Without payment method collection, overages cannot be charged and the billing system has no enforcement mechanism. This must work before any enrichment can proceed.

**Independent Test**: Can be tested by generating a magic link for a workspace, clicking it, completing payment setup on the hosted billing page, and verifying the workspace's billing status transitions to active.

**Acceptance Scenarios**:

1. **Given** a workspace with a billing profile but no payment method, **When** an administrator triggers "Send Magic Link" from the admin dashboard, **Then** the designated billing contact (Slack user specified in the billing profile) receives a direct message containing a secure, time-limited link to set up payment, AND the magic link is also sent to the billing email address via email.
2. **Given** the magic link is sent, **When** the bot sends the DM, **Then** it also posts a message in the client's assigned Slack channel saying "Check your DMs for a secure link to set up billing."
3. **Given** the billing profile has a billing email configured, **When** a magic link is generated, **Then** the system sends the magic link to that email address via the email sending service, in addition to the Slack DM.
4. **Given** a valid magic link, **When** the client clicks it, **Then** they are redirected to a hosted payment page where they can enter their billing details (card, bank) without the platform handling sensitive payment data directly.
5. **Given** the client completes payment setup, **When** the payment processor confirms the payment method is valid, **Then** the workspace's billing status transitions from "pending" to "active."
6. **Given** a magic link that has expired (older than 24 hours), **When** the client clicks it, **Then** they see a friendly message explaining the link has expired and instructions to request a new one from their Slack channel.
7. **Given** a magic link that has already been used, **When** someone clicks it again, **Then** it redirects to the billing portal for managing existing payment details (not a duplicate setup).
8. **Given** a workspace whose billing status transitions to "active" mid-cycle, **When** the activation is confirmed, **Then** the client immediately receives their full monthly credit allowance as a "monthly allocation" transaction, and the first billing cycle reset occurs on the configured billing cycle day.

---

### User Story 3 - Pre-Enrichment Billing Gate (Priority: P1)

As the system, I need to verify a client's billing status and credit balance before processing any enrichment job, so that no enrichment occurs without an active billing arrangement.

**Why this priority**: This is the enforcement mechanism that ties billing to the enrichment pipeline. Without it, clients could enrich without being billed.

**Independent Test**: Can be tested by attempting to trigger enrichment for a workspace with no billing profile and verifying the job is blocked with an appropriate message.

**Acceptance Scenarios**:

1. **Given** a workspace with no billing profile and no legacy spend limits, **When** a user triggers an enrichment job, **Then** the enrichment is blocked and the user receives a Slack message: "Before enriching lists, billing needs to be set up. Check your DMs for a secure link to add your payment details." The magic link is sent automatically. **Exception**: During rollout, workspaces with legacy limits (monthlySpendCapUsd, maxBuiltwithLookups, etc.) but no billing profile continue under legacy rules until migrated.
2. **Given** a workspace with a suspended or delinquent billing status, **When** a user triggers an enrichment job, **Then** the enrichment is blocked with a message explaining their billing account needs attention.
3. **Given** a workspace with active billing and sufficient credits, **When** a user triggers an enrichment job, **Then** the enrichment proceeds normally.
4. **Given** a workspace with active billing but zero credits and a valid payment method, **When** a user triggers an enrichment job, **Then** the enrichment proceeds with a warning: "Your credit balance is 0. This enrichment will be charged as an overage at [rate] per credit."
5. **Given** a workspace with active billing and low credits, **When** a user triggers an enrichment job that will exceed the remaining balance, **Then** the user sees a warning: "You have X credits remaining. This enrichment will use approximately Y credits. Z credits will be charged as overages at [rate] per credit."
6. **Given** a workspace marked as "billing exempt" by an administrator, **When** a user triggers an enrichment job, **Then** the enrichment proceeds without billing checks, credit deductions, or overage charges. Usage is still logged to the internal cost tracking system.

---

### User Story 4 - Real-Time Credit Deduction During Enrichment (Priority: P1)

As the system, I need to deduct credits from a client's balance as enrichment operations consume API credits, so that the balance reflects actual usage in real time.

**Why this priority**: Credit deduction is the core billing mechanic. Without it, balances never change and overages are never triggered.

**Independent Test**: Can be tested by running an enrichment job for a workspace with a known credit balance and verifying the balance decreases by the correct amount after completion.

**Acceptance Scenarios**:

1. **Given** a workspace with 500 credits and an enrichment job that consumes 50 credits, **When** the enrichment completes, **Then** the workspace's credit balance is 450 and a deduction transaction is recorded.
2. **Given** an enrichment job in progress, **When** each batch of contacts is enriched, **Then** credits are deducted incrementally (not all at once at the end) so the balance stays current.
3. **Given** a credit deduction, **When** the transaction is recorded, **Then** it includes: the job ID, the number of credits deducted, the balance after deduction, and a timestamp.
4. **Given** an enrichment job that fails partway through, **When** some batches succeeded and some failed, **Then** only the credits for successfully processed batches are deducted.
5. **Given** a workspace whose balance reaches zero during an enrichment job, **When** additional batches remain, **Then** the remaining batches continue processing (not interrupted) and the negative balance is recorded as an overage.

---

### User Story 5 - Overage Detection and Automatic Charging (Priority: P2)

As the system, I need to detect when a client's credit usage exceeds their monthly allowance and automatically charge the overage to their payment method, so that the platform is compensated for all usage.

**Why this priority**: Overages are the revenue mechanism beyond the base allowance. Without automatic charging, overages would require manual invoicing. Depends on credit deduction (Story 4) working first.

**Independent Test**: Can be tested by depleting a workspace's credits to zero, running an additional enrichment, and verifying a charge is created on the client's payment method for the overage amount.

**Acceptance Scenarios**:

1. **Given** a workspace with 0 credits and an overage rate of $0.05/credit, **When** an enrichment consumes 100 credits, **Then** a charge of $5.00 is created on the client's payment method.
2. **Given** an overage charge, **When** it is created, **Then** a transaction record is stored with type "overage charge," the credit amount, the dollar amount, and the payment processor's charge reference.
3. **Given** an overage charge attempt, **When** the payment fails (declined card, insufficient funds), **Then** the workspace's billing status transitions to "delinquent," future enrichments are blocked, and the administrator is notified.
4. **Given** a delinquent workspace, **When** the payment issue is resolved (card updated, payment retried successfully), **Then** the billing status transitions back to "active" and enrichments are unblocked.
5. **Given** multiple overage-triggering enrichments in the same billing cycle, **When** overages accumulate, **Then** each overage is charged individually (not batched to end of month) to minimize collection risk.

---

### User Story 6 - Monthly Credit Cycle Reset with Capped Rollover (Priority: P2)

As the system, I need to reset each client's credit balance on their billing cycle day, rolling over unused credits up to a configurable maximum, so that clients receive fresh credits each month without unlimited accumulation.

**Why this priority**: The monthly reset is what makes the billing model "hybrid" rather than purely consumption-based. Depends on the billing profile (Story 1) being configured.

**Independent Test**: Can be tested by setting a workspace's billing cycle day to today, running the reset process, and verifying the new balance equals rollover (capped) plus monthly allowance.

**Acceptance Scenarios**:

1. **Given** a workspace with 200 remaining credits, a monthly allowance of 500, and a rollover cap of 1000 (2x allowance), **When** the billing cycle resets, **Then** the new balance is 700 (200 rollover + 500 new allocation).
2. **Given** a workspace with 1,100 remaining credits, a monthly allowance of 500, and a rollover cap of 1000, **When** the billing cycle resets, **Then** the new balance is 1,500 (1,000 capped rollover + 500 new allocation).
3. **Given** a workspace with 0 remaining credits, **When** the billing cycle resets, **Then** the new balance is exactly the monthly allowance (0 rollover + allowance).
4. **Given** the billing cycle reset, **When** it executes, **Then** a transaction record is created with type "monthly allocation" showing the rollover amount, the new allocation, and the resulting balance.
5. **Given** a workspace whose billing cycle day falls on the 31st but the current month has only 28 days, **When** the reset logic runs, **Then** the reset occurs on the last day of that month.
6. **Given** a workspace with a negative balance of -100 credits (unpaid overage) and a monthly allowance of 500, **When** the billing cycle resets, **Then** the negative balance carries forward: new balance is 400 (-100 + 500). No rollover applies to negative balances.
7. **Given** a workspace with "suspended" or "delinquent" billing status, **When** the monthly billing cycle reset runs, **Then** the workspace is skipped and receives no credit allocation. The balance remains unchanged.

---

### User Story 7 - Credit Transaction History and Reporting (Priority: P2)

As a platform administrator, I need to view a complete transaction history for each client showing all credit movements, so that I can audit usage, resolve disputes, and understand revenue.

**Why this priority**: Auditability is essential for any billing system. Provides the data foundation for dispute resolution and financial reporting.

**Independent Test**: Can be tested by performing several credit operations (allocation, deduction, overage, manual adjustment) and verifying all appear in the transaction history with correct details.

**Acceptance Scenarios**:

1. **Given** the admin dashboard billing detail view for a workspace, **When** an administrator views the transaction history, **Then** they see a chronological list of all credit transactions with: date, type, credit amount, balance after, reference (job ID or charge ID), and description.
2. **Given** the transaction history, **When** an administrator filters by transaction type (allocation, deduction, overage, adjustment), **Then** only matching transactions are shown.
3. **Given** the transaction history, **When** an administrator filters by date range, **Then** only transactions within that range are shown.
4. **Given** the admin dashboard overview page, **When** an administrator views billing KPIs, **Then** they see: total overage revenue across all clients and count of clients with low credit balance (below 20% of monthly allowance).

---

### User Story 8 - Slack Credit Balance Notifications (Priority: P3)

As a client, I need to see my credit balance and usage in Slack after each enrichment job completes, so that I have visibility into my spending without leaving Slack.

**Why this priority**: Transparency builds trust. Clients should not be surprised by charges. This is a quality-of-life improvement that enhances the billing experience.

**Independent Test**: Can be tested by completing an enrichment job and verifying the completion message in Slack includes credit usage and remaining balance.

**Acceptance Scenarios**:

1. **Given** an enrichment job completes successfully, **When** the completion message is posted to the Slack channel, **Then** it includes: credits used for this job, remaining credit balance, and (if applicable) overage credits charged.
2. **Given** a workspace whose credit balance drops below 20% of their monthly allowance, **When** the threshold is crossed during enrichment, **Then** a warning message is posted: "Your enrichment credit balance is running low. X credits remaining out of Y monthly allowance."
3. **Given** a workspace whose credits are fully depleted, **When** the balance reaches zero, **Then** a notification is posted: "Your monthly enrichment credits have been used. Additional enrichments will be charged at [rate] per credit."

---

### Edge Cases

- What happens when a payment processor webhook for a payment update arrives but the corresponding workspace cannot be found? The event is logged for manual review and no billing status change occurs.
- What happens if two enrichment jobs run concurrently for the same workspace? Credit deductions must be atomic (serialized) to prevent double-spending or race conditions on the balance.
- What happens if the monthly credit reset job fails or is delayed? The job is retried automatically. If it fails after retries, an alert is sent to administrators. Credits are backdated to the correct cycle date.
- What happens if a workspace is uninstalled while having a negative credit balance (unpaid overage)? The overage charge is still attempted. If the charge fails, the delinquent status and outstanding amount are preserved for manual collection.
- What happens if the administrator changes the monthly allowance mid-cycle? The change takes effect on the next billing cycle. The current cycle continues with the original allowance.
- What happens if the payment processor is temporarily unavailable when an overage charge is needed? The enrichment still completes (credits go negative), the charge is queued for retry with exponential backoff, and the administrator is notified if retries fail.
- What happens if the email sending service is unavailable when a magic link needs to be emailed? The Slack DM is still sent (primary delivery). The email is queued for retry. The admin is notified if email delivery fails after retries.
- What happens to workspaces that have existing legacy limit fields (monthlySpendCapUsd, maxBuiltwithLookups, etc.) but no billing profile? During rollout, legacy limits continue to apply for workspaces without a billing profile. Once a billing profile is created, the billing system takes precedence and legacy limits are ignored for that workspace. After full migration, legacy fields are deprecated and removed.
- What happens if a tech report is triggered for a workspace with insufficient credits? The same billing gate applies — tech reports are billable enrichment operations and follow the same blocking, estimation, and deduction rules as contact and technographic enrichments.
- What happens if an administrator changes credit rates or the markup percentage while enrichment jobs are in progress? In-progress jobs continue using the rates snapshotted at job start. The new rates apply only to jobs started after the change.
- What happens when a client disputes a charge with the payment processor (chargeback)? The workspace's billing status transitions to "delinquent," enrichments are blocked, and the administrator is notified. The admin resolves the dispute outside the platform (via the payment processor's dashboard). Credit refunds are handled via the existing manual adjustment mechanism (FR-015), not through payment processor refund APIs.
- What happens when a suspended workspace is reactivated? The credit balance is restored to whatever it was when suspended. No fresh allocation is granted. If a monthly reset occurred while suspended, the reset is skipped for that workspace (suspended workspaces do not receive monthly allocations). The admin can use manual credit adjustment (FR-015) if they want to grant additional credits upon reactivation.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST maintain a billing profile for each client workspace containing: monthly credit allowance, overage rate, rollover cap, billing cycle day, billing email, and billing status.
- **FR-002**: System MUST generate secure, time-limited (24-hour) magic links for client payment onboarding.
- **FR-003**: System MUST deliver magic links via Slack direct message to the designated billing contact (Slack user set in the billing profile), with a companion notification in the client's assigned channel.
- **FR-003a**: System MUST also deliver magic links via email to the billing email address configured in the billing profile, using an email sending service.
- **FR-003b**: Billing profile MUST include a designated billing contact (Slack user ID) and a billing email address, both set by the administrator.
- **FR-004**: System MUST redirect clients to a hosted, PCI-compliant payment page (not handle payment data directly) when they click the magic link.
- **FR-005**: System MUST transition billing status to "active" upon successful payment method setup, as confirmed by the payment processor's callback.
- **FR-006**: System MUST block all enrichment jobs for workspaces without an active billing profile and prompt the user with a magic link, unless the workspace is marked as billing exempt. The billing gate MUST be enforced at all 7 enrichment entry points: (1) agent/natural-language flow via intent router, (2) "Get Technographics" button, (3) "Get Contacts" button, (4) "Get Both" button, (5) chain from completed technographic job, (6) tech report generation via report filters, and (7) fresh tech report via cache decision.
- **FR-006a**: System MUST allow administrators to set a "billing exempt" flag on a workspace (for internal testing, partner accounts, or trial periods). Exempt workspaces bypass the billing gate and credit deduction entirely.
- **FR-007**: System MUST block all enrichment jobs for workspaces with "suspended" or "delinquent" billing status.
- **FR-008**: System MUST deduct credits from the client's balance incrementally as each enrichment batch completes (not at the end of the job).
- **FR-009**: System MUST record every credit movement as an immutable transaction in an append-only ledger with: type, amount, balance after, reference ID, description, and timestamp.
- **FR-010**: System MUST allow enrichment to continue when credits are exhausted if a valid payment method is on file, recording the deficit as overage.
- **FR-011**: System MUST automatically charge the client's payment method for overage credits at the configured overage rate.
- **FR-012**: System MUST transition billing status to "delinquent" when an overage charge fails and block future enrichments.
- **FR-013**: System MUST reset credit balances monthly on each workspace's configured billing cycle day, carrying over unused credits up to the rollover cap. Only workspaces with "active" billing status receive monthly resets; suspended and delinquent workspaces are skipped.
- **FR-014**: System MUST calculate rollover as: if balance is negative, carry forward the negative balance and add monthly allowance (no rollover); if balance is positive, rollover = min(current balance, max rollover credits) + monthly allowance.
- **FR-015**: System MUST provide administrators with the ability to manually adjust a client's credit balance with a recorded reason.
- **FR-016**: System MUST display credit usage and remaining balance in the Slack enrichment completion message.
- **FR-017**: System MUST notify clients in Slack when their credit balance drops below 20% of their monthly allowance.
- **FR-018**: System MUST provide administrators with a transaction history view filterable by type and date range.
- **FR-019**: System MUST provide administrators with billing KPIs: total overage revenue and count of low-balance clients.
- **FR-020**: System MUST ensure credit deductions are atomic to prevent race conditions when concurrent enrichment jobs modify the same balance.
- **FR-021**: System MUST show estimated credit cost before enrichment begins, including projected overage if applicable. The estimate is calculated as row count multiplied by per-operation credit rate and presented as "approximately X credits" since actual usage depends on API responses.
- **FR-022**: System MUST continue to log all API usage to the existing internal cost tracking system alongside the client-facing credit system. As a prerequisite, all API usage logging MUST be consolidated into a single tracking function that always captures the workspace ID (`slackTeamId`) for attribution and triggers budget threshold checks. The current fragmented logging (worker-local functions missing workspace attribution and threshold alerts) MUST be fixed before billing implementation begins.
- **FR-023**: System MUST support a hybrid credit pricing model with two components: (a) a fixed base credit cost per operation type, and (b) a global markup percentage applied on top. The operation types are: BuiltWith CTU lookup, BuiltWith domain lookup, Apollo people search, and Apollo bulk enrich. Both base costs and markup are global platform configuration (same for all clients) managed via the admin dashboard.
- **FR-024**: System MUST calculate credit deductions using the formula: `effectiveCost = ceil(baseCost * (1 + markupPercent / 100))` per operation. The total deduction for a job is the sum of effective costs across all operations consumed. This is not a flat 1:1 mapping — different operations cost different credit amounts.
- **FR-025**: System MUST provide administrators with an admin dashboard page to view and edit: (a) the base credit cost for each operation type, and (b) the global markup percentage. Changes take effect immediately for new enrichment jobs (in-progress jobs use the rates captured at job start).
- **FR-026**: System MUST snapshot the effective credit rates at the start of each enrichment job and use those rates for all deductions within that job, so that mid-job rate changes do not affect in-progress work.
- **FR-027**: System MUST immediately allocate the full monthly credit allowance when a billing profile transitions to "active" status for the first time (mid-cycle activation). The first billing cycle reset occurs on the configured billing cycle day.
- **FR-028**: System MUST transition billing status to "delinquent" and notify the administrator when the payment processor reports a chargeback (dispute). Credit refunds are handled exclusively through admin manual adjustments (FR-015); no payment processor refund API integration is included in v1.

### Key Entities

- **Billing Profile**: Represents a client workspace's billing configuration. Links to a workspace. Contains the monthly credit allowance, overage rate per credit, maximum rollover credits, billing cycle day, billing email, designated billing contact (Slack user ID), billing status (pending, active, suspended, delinquent), billing exempt flag (boolean, default false), payment processor customer reference, and magic link token with expiration. Status transitions: pending → active (payment method confirmed), active → delinquent (overage charge fails), delinquent → active (payment retried successfully), active → suspended (admin manual action), suspended → active (admin manual action).
- **Credit Transaction**: An immutable record of a single credit movement. Links to a billing profile. Contains the transaction type (monthly allocation, enrichment deduction, overage charge, manual adjustment, rollover reset), credit amount (positive for additions, negative for deductions), balance after the transaction, an optional reference to the originating job or payment charge, a human-readable description, and a timestamp.
- **Credit Rate Configuration**: Global platform settings for credit pricing. Contains: a set of operation-level base credit costs (one per operation type: BuiltWith CTU lookup, BuiltWith domain lookup, Apollo people search, Apollo bulk enrich), and a single global markup percentage. The effective credit cost for any operation is `ceil(baseCost * (1 + markupPercent / 100))`. Managed by administrators via the admin dashboard. There is exactly one active configuration at any time.
- **Workspace** (existing): Extended with a relationship to its billing profile. A workspace has at most one billing profile.

## Assumptions

- Each workspace has at most one billing profile (one billing arrangement per Slack workspace).
- The platform does not handle or store payment card data directly; all sensitive payment data is managed by the payment processor.
- Overage charges are applied per enrichment job (not batched to end of month) to minimize collection risk.
- The magic link is a one-time-use token for initial setup; subsequent billing management uses the payment processor's customer portal.
- Credit pricing uses a hybrid model: a fixed base credit cost per operation type plus a global markup percentage. The formula `ceil(baseCost * (1 + markupPercent / 100))` determines what clients are charged. This allows the platform to set operation costs independently while maintaining a single margin lever. Rates are global (not per-client) and managed via the admin dashboard.
- The 20% low-balance threshold is configurable per workspace in future iterations but defaults to 20% for initial release.
- Billing cycle day is set by the administrator (not the client).
- The existing internal cost tracking continues to operate independently from the client-facing credit system.
- Tech reports are billable enrichment operations and are subject to the same billing gate, credit deduction, and overage rules as contact and technographic enrichments.
- Effective credit rates are snapshotted at job start so mid-job rate changes don't affect in-progress enrichments.
- The existing legacy workspace limit fields (monthlySpendCapUsd, maxBuiltwithLookups, maxApolloCredits, maxAiTokens) are superseded by billing profiles. During rollout, legacy limits apply only to workspaces without a billing profile. After full migration, legacy fields are removed.
- A prerequisite cleanup of the internal cost tracking system (consolidating fragmented logging functions, adding workspace attribution, and fixing missing budget threshold alerts for BuiltWith and Apollo) is required before billing implementation begins.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of enrichment jobs are blocked for workspaces without active billing, with a clear message and magic link delivered within 5 seconds.
- **SC-002**: Clients can complete payment onboarding (from magic link click to active billing status) in under 3 minutes.
- **SC-003**: Credit balances are updated within 2 seconds of each enrichment batch completing.
- **SC-004**: Overage charges are created on the payment processor within 30 seconds of an enrichment job completing with negative balance.
- **SC-005**: Monthly credit resets execute for all active workspaces within 5 minutes of the billing cycle day beginning.
- **SC-006**: Credit transaction ledger maintains 100% accuracy: sum of all transactions for a workspace equals the current balance at any point in time.
- **SC-007**: Administrators can view and manage all client billing profiles, transaction histories, and credit adjustments from a single dashboard page.
- **SC-008**: Clients see their credit balance and usage in every enrichment completion message in Slack.
- **SC-009**: Low-balance notifications are delivered before the client's credits are fully exhausted (at 20% threshold).
- **SC-010**: Zero payment data is stored or transmitted by the platform; all payment handling occurs on the payment processor's hosted pages.
