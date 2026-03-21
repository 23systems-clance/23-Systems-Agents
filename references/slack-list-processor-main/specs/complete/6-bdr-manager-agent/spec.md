# Feature Specification: BDR Manager Agent

**Feature Branch**: `6-bdr-manager-agent`
**Created**: 2026-03-07
**Status**: Draft
**Input**: User description: "A BDR Manager/Assistant Agent that sends daily Slack DMs to BDRs with their campaign tasks for the day. Manages multi-step outreach sequences (Email via Instantly.ai, Phone via HubSpot dialer, LinkedIn via Heyreach) with webhook-driven progression. Provides a web UI for campaign setup, daily task execution (UniBox + call lists), and end-of-day reporting. Campaigns are the central entity containing ICP, scripts, sequences, and meeting links. Campaigns can be created via API POST from an external application or manually through the UI."

## Clarifications

### Session 2026-03-07

- Q: Where do contacts come from? -> A: HubSpot Lists. Lists are already enriched in HubSpot with verified emails and phone numbers. System pulls contacts via HubSpot API.
- Q: How does sequence progression work? -> A: Webhook-driven. Instantly.ai and Heyreach send webhooks when email/LinkedIn actions fire. The system is the single source of truth for sequence position. On webhook receipt, the contact advances to the next sequence step.
- Q: What happens when contact data is missing for a step? -> A: Skip logic. If mobile number is missing, fall back to direct number. If both phone numbers are missing, skip the phone call step. If email is missing or not verified, skip email steps. If LinkedIn URL is missing or invalid, skip LinkedIn step and move to next contact.
- Q: How do phone calls work? -> A: Link to HubSpot contact record which opens the HubSpot dialer. No custom dialer integration needed initially.
- Q: What does the web UI show when a BDR clicks the Slack DM link? -> A: Two main views: (1) UniBox aggregating email replies (from Instantly) and LinkedIn responses (from Heyreach), and (2) a call list per campaign showing contacts with valid phone numbers linked to their HubSpot contact page.
- Q: How are campaigns created? -> A: Two methods: (1) API POST from an external application that sends all campaign data programmatically, or (2) manual input through the campaign setup UI. Both paths require the same data fields to be populated before the campaign can run.
- Q: What data does a campaign contain? -> A: ICP definition, meeting link, BDR call scripts, BDR email sequence copy (for Instantly), BDR LinkedIn sequence/messaging copy (for Heyreach), assigned HubSpot list, assigned BDR(s), and the ordered sequence template.
- Q: Are emails and LinkedIn automated? -> A: Yes. Email sequences fire via Instantly.ai API and LinkedIn sequences fire via Heyreach API in the background. The BDR only needs to manage the UniBox (replies) and make phone calls manually.
- Q: What about end-of-day reporting? -> A: The BDR Manager Agent sends an EOD Slack DM asking for a report or auto-generates one. Includes stats: emails sent, LinkedIn connections/messages, calls made, replies received.
- Q: What campaign types are supported? -> A: 4 types: (1) Email-only — all steps are emails via Instantly. (2) Phone-only — all steps are manual phone calls. (3) LinkedIn-only — all steps via HeyReach. (4) Multi-Channel — always starts with Email (Instantly) as step 1, then mixes Phone/LinkedIn/Email.
- Q: What is the sequence start behavior? -> A: For multi-channel campaigns, Email is ALWAYS step 1. Leads are added to the Instantly campaign first, Instantly sends the email and fires a webhook, our system receives it and advances to step 2. This is the universal pattern.
- Q: What if HeyReach campaign ID is missing? -> A: If the `heyreachCampaignId` is not set on the campaign, all LinkedIn sequence steps are skipped (not blocked). The campaign still runs with Email and Phone steps.
- Q: How does the UniBox work? -> A: Webhook-driven storage. Reply data is stored in our database when Instantly `reply_received` webhooks arrive. BDRs can respond to emails directly from our UniBox using Instantly's reply-to-email API. LinkedIn replies are stored from HeyReach `MESSAGE_REPLY_RECEIVED` webhooks.
- Q: Should the system be designed for future integration? -> A: Yes. Keep the Slack system lightweight and integrable. HubSpot is the transitional contact source; abstract contact source so it can be swapped for the BDR Management Platform's list system later via `externalListId`.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Campaign Creation & Configuration (Priority: P1)

An admin or manager creates a new outreach campaign by defining the target ICP, assigning a HubSpot list of enriched contacts, setting up the outreach sequence (ordered steps of Email, Phone, LinkedIn), and populating campaign assets (call scripts, email copy, LinkedIn messaging, meeting link). Campaigns can be created through the web UI or programmatically via an API POST from an external application.

**Why this priority**: Nothing works without campaigns. This is the foundational data structure that drives all other features.

**Independent Test**: Can be fully tested by creating a campaign through the UI with all required fields, verifying it persists correctly, and confirming the same campaign can be created via the API endpoint.

**Acceptance Scenarios**:

1. **Given** a manager opens the campaign setup UI, **When** they fill in all required fields (name, ICP, HubSpot list, sequence, scripts, meeting link, assigned BDRs), **Then** the campaign is created in "draft" status and all data is persisted.
2. **Given** a campaign is in "draft" status, **When** the manager reviews and activates it, **Then** contacts are imported from the HubSpot list and each contact is initialized at sequence step 1.
3. **Given** an external application sends a POST request to `/api/campaigns` with all required campaign data, **When** the payload is valid, **Then** the campaign is created identically to the UI-created version.
4. **Given** a campaign is being configured, **When** the manager defines the sequence as [Email, Phone, LinkedIn, Email, Phone, Email, Phone, Phone, Email, Phone], **Then** the sequence is stored as an ordered list and each step type is validated.
5. **Given** a campaign has required fields missing (e.g., no email copy but sequence includes Email steps), **When** the manager tries to activate it, **Then** the system blocks activation and specifies which fields are missing.

---

### User Story 2 - HubSpot List Import & Contact Validation (Priority: P1)

When a campaign is activated, the system imports contacts from the assigned HubSpot list via the HubSpot API. Each contact is validated for required data based on the sequence steps: mobile/direct phone numbers for call steps, verified email for email steps, and valid LinkedIn URL for LinkedIn steps. Contacts with missing data have those specific steps skipped.

**Why this priority**: Contact data quality directly determines whether sequences can execute. Without proper import and validation, campaigns will fail silently.

**Independent Test**: Can be tested by activating a campaign with a HubSpot list containing contacts with varying data completeness and verifying correct skip logic.

**Acceptance Scenarios**:

1. **Given** a campaign is activated with a HubSpot list ID, **When** the import runs, **Then** all contacts from the list are pulled via HubSpot API with properties: first name, last name, email, mobile number, direct number, LinkedIn URL, company, and job title.
2. **Given** a contact has a mobile number, **When** a phone step is reached, **Then** the system uses the mobile number for the call task.
3. **Given** a contact has no mobile number but has a direct number, **When** a phone step is reached, **Then** the system falls back to the direct number.
4. **Given** a contact has neither mobile nor direct number, **When** a phone step is reached, **Then** the phone step is skipped and the contact advances to the next sequence step.
5. **Given** a contact has no email or an unverified email, **When** an email step is reached, **Then** the email step is skipped and the contact advances to the next step.
6. **Given** a contact has no LinkedIn URL or an invalid LinkedIn URL, **When** a LinkedIn step is reached, **Then** the LinkedIn step is skipped and the contact moves to the next step.

---

### User Story 3 - Sequence Execution Engine (Priority: P1)

The system orchestrates outreach sequences across three channels. For each contact in a campaign, the sequence engine determines the current step and either fires automated actions (email via Instantly, LinkedIn via Heyreach) or surfaces manual tasks (phone calls). Webhooks from Instantly and Heyreach confirm automated step completion and trigger advancement to the next step.

**Why this priority**: This is the core state machine that drives all campaign activity. Without it, there is no automated progression through sequences.

**Independent Test**: Can be tested by activating a campaign and verifying that email steps trigger Instantly API calls, LinkedIn steps trigger Heyreach API calls, phone steps surface as BDR tasks, and webhook receipt advances contacts to the next step.

**Acceptance Scenarios**:

1. **Given** a contact is at a sequence step of type "Email", **When** the step is due, **Then** the system fires the email via Instantly.ai API using the campaign's email copy and the contact's verified email address.
2. **Given** a contact is at a sequence step of type "LinkedIn", **When** the step is due, **Then** the system fires the LinkedIn action via Heyreach API using the campaign's LinkedIn messaging copy and the contact's LinkedIn URL.
3. **Given** a contact is at a sequence step of type "Phone", **When** the step is due, **Then** the step is surfaced as a manual task for the assigned BDR (not automated).
4. **Given** Instantly sends a webhook confirming an email was sent, **When** the webhook is received, **Then** the system matches the contact, marks the current step complete, and advances to the next step.
5. **Given** Heyreach sends a webhook confirming a LinkedIn action was completed, **When** the webhook is received, **Then** the system matches the contact, marks the current step complete, and advances to the next step.
6. **Given** a BDR marks a phone call as complete in the task UI, **When** the action is confirmed, **Then** the contact advances to the next sequence step.
7. **Given** a contact has completed all sequence steps, **When** the final step is marked complete, **Then** the contact's campaign status is set to "completed".

---

### User Story 4 - Daily BDR Slack DM Briefing (Priority: P1)

Every morning at a configured time, the BDR Manager Agent sends a Slack DM to each BDR with a summary of their tasks for the day across all assigned campaigns. The DM includes counts of calls to make, emails and LinkedIn actions firing in the background, and a link to the web task UI.

**Why this priority**: The daily DM is the BDR's primary touchpoint with the system. It drives adoption and ensures BDRs know what to do each day.

**Independent Test**: Can be tested by configuring a BDR with active campaigns and verifying the daily DM arrives with accurate task counts and a working link to the task UI.

**Acceptance Scenarios**:

1. **Given** a BDR has active campaigns with pending tasks, **When** the morning DM fires at the configured time, **Then** the BDR receives a Slack DM with: campaign names, number of phone calls to make per campaign, number of emails firing today, number of LinkedIn actions firing today, and a link to start activity.
2. **Given** a BDR has no pending tasks for the day, **When** the morning DM fires, **Then** the DM says there are no tasks and shows campaign status summaries.
3. **Given** the link in the DM is clicked, **When** the browser opens, **Then** the BDR is taken to the web task UI filtered to their tasks for today.
4. **Given** multiple campaigns are active for a BDR, **When** the DM is generated, **Then** tasks are grouped by campaign with per-campaign summaries.

---

### User Story 5 - Web Task UI: Call List & UniBox (Priority: P1)

When a BDR clicks the link from the daily Slack DM, a web interface opens showing two main sections: (1) a UniBox that aggregates email replies from Instantly and LinkedIn responses from Heyreach, and (2) a call list per campaign showing contacts with valid phone numbers. Each contact in the call list links to their HubSpot contact record to open the HubSpot dialer.

**Why this priority**: This is the BDR's primary work surface. Without it, the daily DM link has nowhere to go.

**Independent Test**: Can be tested by accessing the web UI as a BDR and verifying the UniBox displays responses and the call list shows contacts with HubSpot links.

**Acceptance Scenarios**:

1. **Given** a BDR opens the task UI, **When** the page loads, **Then** it displays two main sections: UniBox (email + LinkedIn responses) and Call Lists (grouped by campaign).
2. **Given** emails have been sent via Instantly and replies received, **When** the UniBox loads, **Then** email replies are displayed with sender, subject, timestamp, and reply content pulled from Instantly's API.
3. **Given** LinkedIn messages have been sent via Heyreach and responses received, **When** the UniBox loads, **Then** LinkedIn responses are displayed alongside email replies in a unified view.
4. **Given** a campaign has contacts at a "Phone" sequence step, **When** the call list loads, **Then** it shows contact name, company, job title, phone number, and a link to the HubSpot contact record.
5. **Given** a BDR clicks the HubSpot link for a contact, **When** the link opens, **Then** it navigates to the HubSpot contact record where the BDR can use the HubSpot dialer.
6. **Given** a BDR completes a call, **When** they return to the task UI and mark the call complete, **Then** the contact advances to the next sequence step and disappears from the call list.

---

### User Story 6 - Daily Stats & End-of-Day Report (Priority: P2)

Throughout the day, the system tracks activity stats: emails sent, LinkedIn connection requests/messages sent, phone calls completed, and replies received across all channels. At end of day, the BDR Manager Agent sends a Slack DM asking for an EOD report or auto-generates one with the day's statistics.

**Why this priority**: Reporting closes the daily loop and gives managers visibility into BDR activity. Important but not required for the core task execution flow.

**Independent Test**: Can be tested by running a full day of campaign activity and verifying the EOD report contains accurate statistics.

**Acceptance Scenarios**:

1. **Given** a BDR has been active throughout the day, **When** the EOD trigger fires (configured time or manual request), **Then** the BDR Manager Agent sends a Slack DM with: total emails sent, total LinkedIn actions performed, total calls completed, total replies received (email + LinkedIn), and per-campaign breakdowns.
2. **Given** the EOD report is configured for auto-generation, **When** the configured time is reached, **Then** the report is generated and sent without BDR interaction.
3. **Given** the EOD report is configured for prompted mode, **When** the configured time is reached, **Then** the agent DMs the BDR asking if they want to submit notes or have the report auto-generated.
4. **Given** the agent asks for an EOD report, **When** the BDR provides notes (e.g., "Had 3 good conversations, 1 meeting booked"), **Then** the notes are included in the report alongside the automated stats.
5. **Given** a manager wants to see team-wide EOD reports, **When** they access the reporting view, **Then** they see aggregated stats across all BDRs for the day.

---

### User Story 7 - Campaign Management & Monitoring (Priority: P2)

Managers can view campaign performance, pause/resume campaigns, and monitor sequence progression across all contacts. The campaign dashboard shows overall metrics: contacts in each sequence step, completion rates, reply rates, and BDR activity.

**Why this priority**: Visibility into campaign health is essential for managers but not blocking for BDR daily execution.

**Independent Test**: Can be tested by viewing an active campaign's dashboard and verifying accurate metrics across all sequence steps.

**Acceptance Scenarios**:

1. **Given** a campaign is active, **When** a manager views the campaign dashboard, **Then** they see: total contacts, contacts per sequence step, completion count, reply count, and per-step conversion metrics.
2. **Given** a campaign needs to be paused, **When** the manager clicks pause, **Then** no new automated steps fire and phone tasks are hidden from BDR call lists until resumed.
3. **Given** a paused campaign is resumed, **When** the manager clicks resume, **Then** pending automated steps fire and phone tasks reappear in BDR call lists.
4. **Given** a contact replies to an email or LinkedIn message, **When** the reply is detected, **Then** the contact is flagged as "responded" and optionally paused from further sequence steps pending review.

---

### User Story 8 - Campaign API for External Application Integration (Priority: P2)

An external application (e.g., BDR Management Platform) can create and manage campaigns programmatically via a REST API. The API accepts all campaign data fields including ICP, sequences, scripts, HubSpot list references, and BDR assignments. This enables campaign orchestration from systems outside the Slack bot.

**Why this priority**: Enables the broader BDR Management Platform to be the system of record for campaign strategy while this system handles execution.

**Independent Test**: Can be tested by sending a complete campaign payload via API POST and verifying the campaign is created, contacts are imported, and sequences begin executing.

**Acceptance Scenarios**:

1. **Given** an external application sends a POST to `/api/campaigns` with a valid payload, **When** the request is authenticated, **Then** the campaign is created with all provided data fields.
2. **Given** the API payload includes `autoActivate: true`, **When** all required fields are present, **Then** the campaign is automatically activated and contact import begins.
3. **Given** an external application sends a GET to `/api/campaigns/:id`, **When** the campaign exists, **Then** it returns campaign details including current sequence progress and contact statistics.
4. **Given** an external application sends a PATCH to `/api/campaigns/:id` with `status: "paused"`, **When** the campaign is active, **Then** the campaign pauses and no further automated actions fire.
5. **Given** the API receives an invalid payload (missing required fields), **When** validation fails, **Then** a 400 response is returned with specific field-level error messages.

---

### Edge Cases

- What happens when a HubSpot list is updated after campaign activation (contacts added/removed)? Initial scope: contacts are imported at activation time only. Re-sync is a future enhancement.
- What happens when Instantly or Heyreach webhook delivery fails? Implement retry logic and a "stuck step" detector — if no webhook is received within a configurable timeout (e.g., 24 hours), flag the contact for manual review.
- What happens when a contact replies to an email mid-sequence? The contact is flagged as "responded" and sequence progression pauses for that contact. The reply appears in the UniBox for BDR review.
- What if a BDR is assigned to campaigns across multiple workspaces? Each workspace operates independently. BDRs see tasks scoped to their workspace.
- What happens when the HubSpot API rate limit is hit during contact import? Implement exponential backoff. For large lists, batch the import with configurable concurrency.
- What if a contact's phone number becomes invalid after import? The call task surfaces with the stored number. If the BDR reports the number as invalid, the step can be skipped manually.
- How does the system handle timezone differences for daily DMs and EOD reports? Configurable per-workspace or per-BDR timezone setting for DM scheduling.
- What if Instantly or Heyreach is temporarily unavailable? Queue the automated step and retry. Do not skip — the step should be attempted once the service recovers.

## Requirements _(mandatory)_

### Functional Requirements

**Campaign Management**
- **FR-001**: System MUST support campaign creation via web UI with all required fields: name, ICP definition, HubSpot list ID, sequence template, call scripts, email copy (for Instantly), LinkedIn messaging copy (for Heyreach), meeting link, and assigned BDR(s).
- **FR-002**: System MUST support campaign creation via authenticated REST API POST with the same data fields as the UI.
- **FR-003**: System MUST enforce campaign lifecycle states: draft -> active -> paused -> completed. Campaigns MUST have all required fields populated before activation.
- **FR-004**: System MUST support preset sequence templates as ordered lists of step types (Email, Phone, LinkedIn) with configurable length (e.g., 10 steps).
- **FR-005**: System MUST validate that campaign assets match sequence steps — e.g., a campaign with Email steps MUST have email copy defined.

**HubSpot Integration**
- **FR-006**: System MUST import contacts from a HubSpot list via HubSpot API when a campaign is activated, pulling: first name, last name, email, email verification status, mobile number, direct/office number, LinkedIn URL, company name, and job title.
- **FR-007**: System MUST resolve phone numbers with fallback logic: prefer mobile number, fall back to direct number if mobile is missing.
- **FR-008**: System MUST skip sequence steps when required contact data is missing: skip Phone steps if no phone numbers, skip Email steps if email is missing or unverified, skip LinkedIn steps if LinkedIn URL is missing or invalid.

**Sequence Engine**
- **FR-009**: System MUST maintain sequence position per contact per campaign as the single source of truth.
- **FR-010**: System MUST fire Email steps via Instantly.ai API using the campaign's email copy and the contact's email address.
- **FR-011**: System MUST fire LinkedIn steps via Heyreach API using the campaign's LinkedIn messaging copy and the contact's LinkedIn URL.
- **FR-012**: System MUST surface Phone steps as manual tasks for the assigned BDR (not automated).
- **FR-013**: System MUST accept webhooks from Instantly.ai and Heyreach to confirm step completion and advance the contact to the next sequence step.
- **FR-014**: System MUST detect stuck steps (no webhook received within configurable timeout) and flag contacts for manual review.
- **FR-015**: System MUST pause a contact's sequence progression when a reply is detected from any channel.

**Slack BDR Manager Agent**
- **FR-016**: System MUST send a daily Slack DM to each BDR at a configurable time with task summary: campaigns, call counts, automated action counts, and a link to the web task UI.
- **FR-017**: System MUST send an end-of-day Slack DM with activity statistics or prompt the BDR for EOD notes before generating the report.
- **FR-018**: System MUST support both auto-generated and prompted EOD report modes (configurable per workspace).

**Web Task UI**
- **FR-019**: System MUST provide a UniBox view aggregating email replies (from Instantly) and LinkedIn responses (from Heyreach) in a unified interface.
- **FR-020**: System MUST provide a call list view per campaign showing contacts at Phone sequence steps with: contact name, company, job title, phone number, and a link to the HubSpot contact record.
- **FR-021**: System MUST allow BDRs to mark phone calls as complete from the task UI, advancing the contact to the next sequence step.
- **FR-022**: System MUST provide real-time stats on the task UI: emails sent today, LinkedIn actions today, calls completed today, replies received today.

**Campaign API**
- **FR-023**: System MUST expose REST API endpoints: POST `/api/campaigns` (create), GET `/api/campaigns/:id` (read), PATCH `/api/campaigns/:id` (update/pause/resume), GET `/api/campaigns` (list).
- **FR-024**: System MUST authenticate API requests via API key (consistent with existing admin API auth pattern).
- **FR-025**: System MUST support `autoActivate` flag on campaign creation to skip the draft state and immediately import contacts and begin sequencing.

**Reporting**
- **FR-026**: System MUST track daily activity metrics per BDR per campaign: emails sent, LinkedIn actions, calls completed, replies received (email + LinkedIn).
- **FR-027**: System MUST provide manager-level aggregated views of BDR activity across campaigns.
- **FR-028**: System MUST store EOD reports with BDR notes (if provided) and automated stats for historical reference.

### Key Entities

- **Campaign**: The central entity. Contains ICP definition, outreach assets (scripts, email copy, LinkedIn copy), meeting link, sequence template, assigned HubSpot list, assigned BDR(s), and lifecycle status (draft/active/paused/completed).
- **SequenceStep**: An ordered step within a campaign's sequence template. Has a position (1-N), type (Email/Phone/LinkedIn), and optional step-specific configuration.
- **CampaignContact**: A contact imported from HubSpot into a campaign. Stores contact data (name, email, phones, LinkedIn URL, company, title), current sequence position, step status, and campaign outcome (active/completed/responded/skipped).
- **CampaignBdr**: Junction entity linking a BDR (Slack user) to a campaign. Stores the BDR's Slack user ID and assignment metadata.
- **WebhookEvent**: Inbound event from Instantly or Heyreach confirming action completion. Stores source, contact reference, event type, timestamp, and raw payload.
- **DailyActivity**: Aggregated daily stats per BDR per campaign. Stores counts for emails sent, LinkedIn actions, calls completed, and replies received.
- **EodReport**: End-of-day report per BDR. Stores automated stats, optional BDR notes, and generation timestamp.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A campaign can be created (UI or API) and activated with contacts imported from HubSpot within 5 minutes.
- **SC-002**: Automated email and LinkedIn steps fire within 60 seconds of becoming due.
- **SC-003**: Webhook-driven sequence advancement occurs within 10 seconds of webhook receipt.
- **SC-004**: Daily BDR DMs are delivered within a 5-minute window of the configured send time.
- **SC-005**: The web task UI loads call lists and UniBox within 3 seconds.
- **SC-006**: 100% of phone, email, and LinkedIn activity is captured in daily stats and EOD reports.
- **SC-007**: Contact skip logic correctly handles all missing data scenarios (no phone, no email, no LinkedIn) without manual intervention.
- **SC-008**: Campaign API supports full campaign lifecycle management with response times under 500ms.
- **SC-009**: The system handles at least 50 concurrent campaigns with 1,000 contacts each without degradation.
- **SC-010**: BDRs can complete their daily call list tasks entirely from the web task UI without switching to other tools (except opening HubSpot dialer via link).

## Assumptions

- HubSpot lists are pre-enriched with verified contact data (emails, phones, LinkedIn URLs). The system does not perform enrichment — it consumes enriched lists.
- Instantly.ai and Heyreach provide webhook capabilities for confirming action completion. Specific webhook payload formats will be confirmed during implementation.
- The HubSpot dialer is accessible via direct link to the contact record (standard HubSpot URL pattern).
- Campaign sequences are linear (no branching logic based on outcomes). A contact progresses through steps 1 -> N with skips for missing data.
- A single BDR can be assigned to multiple campaigns. A campaign can have multiple BDRs assigned.
- The existing Slack bot infrastructure (Socket Mode, BullMQ, ECS) is reused. The web task UI is an extension of the existing admin dashboard.
- API authentication for the campaign API follows the existing API key pattern used by the admin endpoints.
- Sequence step timing (how long between steps) is out of initial scope — steps advance immediately on webhook receipt or manual completion. Configurable delays between steps is a future enhancement.

## Dependencies

- HubSpot API (contacts, lists, properties)
- Instantly.ai API (send emails, webhook callbacks, UniBox/reply retrieval)
- Heyreach API (LinkedIn actions, webhook callbacks, response retrieval)
- Existing Slack bot infrastructure (Socket Mode, BullMQ, Prisma, ECS)
- Existing admin dashboard (React/Vite) for web task UI extension
- Existing API authentication pattern (API key auth)
