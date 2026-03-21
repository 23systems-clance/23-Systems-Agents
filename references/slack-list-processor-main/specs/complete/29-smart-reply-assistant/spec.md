# Feature Specification: Smart Reply Assistant

**Feature Branch**: `29-smart-reply-assistant`
**Created**: 2026-03-15
**Status**: Draft
**Input**: Smart Reply Assistant with on-demand AI Ark personality enrichment (Slack command + dashboard), contact personality details page, Slack-shareable contact profiles, and personality data export for BDR orchestration platform.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - AI-Drafted Reply for Incoming Prospect Email (Priority: P1)

A BDR receives a reply from a prospect they've been emailing through a campaign. Instead of composing a response from scratch, the system automatically generates a draft reply using the campaign's email copy, ICP definition, prospect details, and (if available) personality analysis data. The BDR reviews the draft in the UniBox, optionally edits it, and sends it with one click.

**Why this priority**: This is the core value proposition. BDRs spend significant time composing personalized replies. AI-drafted replies reduce response time from minutes to seconds while maintaining quality through human review.

**Independent Test**: Can be fully tested by triggering a reply webhook from Instantly and verifying a draft appears in the UniBox detail panel, ready for review and sending.

**Acceptance Scenarios**:

1. **Given** a campaign with active contacts and email sequence copy, **When** an email reply arrives via the Instantly webhook, **Then** the system classifies the reply intent and generates a contextual draft reply within 30 seconds.
2. **Given** a generated draft reply in the UniBox, **When** the BDR clicks "Accept & Send", **Then** the reply is sent via the existing Instantly email reply mechanism and the draft is marked as sent.
3. **Given** a generated draft reply, **When** the BDR edits the text and clicks "Accept & Send", **Then** the edited version is sent (not the original draft).
4. **Given** a generated draft reply, **When** the BDR clicks "Dismiss", **Then** the draft is hidden and the manual reply textarea remains available.
5. **Given** an out-of-office or auto-reply message, **When** the system classifies the reply, **Then** no draft is generated but the intent label (e.g., "out_of_office") is displayed.

---

### User Story 2 - Reply Intent Classification (Priority: P1)

When a prospect reply arrives, the system classifies it into one of several intent categories so BDRs can quickly triage their inbox: interested, meeting request, question, objection, not interested, wrong person, out of office, auto-reply, or other.

**Why this priority**: Tied directly to US1 - intent classification drives whether a draft is generated and what type. Also enables BDRs to prioritize high-value replies (interested, meeting requests) over low-value ones (OOO, auto-replies).

**Independent Test**: Can be tested by sending various reply types through the webhook and verifying correct intent labels appear in the UniBox.

**Acceptance Scenarios**:

1. **Given** a reply containing positive language ("I'd love to learn more"), **When** classified, **Then** the intent is "interested" and a draft is generated.
2. **Given** a reply asking to schedule a call, **When** classified, **Then** the intent is "meeting_request" and the draft includes the campaign's meeting link.
3. **Given** an auto-generated out-of-office message, **When** classified, **Then** the intent is "out_of_office" and no draft is generated.
4. **Given** a reply saying "You have the wrong person", **When** classified, **Then** the intent is "wrong_person" and no draft is generated.
5. **Given** a reply with pricing objections, **When** classified, **Then** the intent is "objection" and the draft addresses the concern using campaign context.

---

### User Story 3 - Regenerate Draft with Different Tone (Priority: P2)

A BDR reviews a generated draft but wants a different approach. They can regenerate the draft with a specified tone (professional, casual, assertive, or empathetic) to better match the situation.

**Why this priority**: Enhances the core reply experience but is not essential for the MVP. BDRs can manually edit drafts as a workaround.

**Independent Test**: Can be tested by clicking "Regenerate" with a tone selection and verifying a new draft replaces the previous one.

**Acceptance Scenarios**:

1. **Given** a ready draft in the UniBox, **When** the BDR selects "Regenerate" with "casual" tone, **Then** a new draft is generated with a more conversational style.
2. **Given** a regeneration in progress, **When** the BDR views the reply, **Then** a loading state is shown until the new draft is ready.
3. **Given** a failed regeneration, **When** the BDR views the reply, **Then** an error message is shown with a retry option.

---

### User Story 4 - On-Demand Personality Enrichment (Priority: P2)

A BDR or admin can trigger AI Ark personality enrichment for a specific contact from two entry points: (1) a Slack command (e.g., `/enrich @contact` or similar), and (2) an "Enrich" button on the contact details page in the admin dashboard. The system calls the AI Ark People Analysis API for the contact (requires verified email + LinkedIn URL) and stores the personality data on the contact record.

**Why this priority**: Personality data enhances AI draft quality and enables the contact personality page. On-demand enrichment gives users control over when and which contacts to enrich, avoiding unnecessary API costs from bulk campaign-level enrichment.

**Independent Test**: Can be tested by clicking "Enrich" on a contact details page (or issuing the Slack command) for a contact with a LinkedIn URL and verified email, then verifying personality data appears on the contact.

**Acceptance Scenarios**:

1. **Given** a contact with a verified email and LinkedIn URL, **When** the BDR clicks "Enrich" on the contact details page, **Then** the system calls the AI Ark People Analysis API and stores the personality data on the contact record within 10 seconds.
2. **Given** a contact with a verified email and LinkedIn URL, **When** a BDR triggers enrichment via a Slack command, **Then** the system enriches the contact and posts a confirmation message in Slack with the contact's archetype and a link to the contact profile.
3. **Given** a contact without a LinkedIn URL, **When** enrichment is triggered, **Then** the system displays an error explaining that a LinkedIn URL is required.
4. **Given** a contact that already has personality data, **When** enrichment is triggered, **Then** the system skips the API call and notifies the user that data already exists. A "Re-enrich" option is available to force a refresh.
5. **Given** an AI Ark API failure, **When** enrichment is triggered, **Then** the error is displayed to the user with a retry option.

---

### User Story 5 - Contact Details Page with Personality Visualization (Priority: P3)

A BDR can view a rich contact profile page that displays the prospect's personality data (DISC profile, OCEAN/Big Five scores, archetype, communication style, selling guidance, key decision traits), along with conversation history and campaign context. The page is accessible from the UniBox and via links shared in Slack.

**Why this priority**: High user value. Can be built after the core reply assistant is functional. Personality data is populated via on-demand enrichment (US4).

**Independent Test**: Can be tested by navigating to a contact's detail page and verifying all personality visualization sections render correctly.

**Acceptance Scenarios**:

1. **Given** a contact with personality data, **When** the BDR navigates to the contact details page, **Then** the page displays DISC scores as horizontal bar charts, OCEAN scores as horizontal bar charts, archetype badge, communication adjectives, "what to say" and "what to avoid" lists, key decision traits, and email approach guide.
2. **Given** a contact without personality data, **When** the BDR navigates to the contact details page, **Then** the page displays contact info and conversation history but personality sections are gracefully hidden.
3. **Given** a contact with replies in the UniBox, **When** viewing the details page, **Then** the conversation history section shows all replies and sequence step executions in chronological order.
4. **Given** a contact in the UniBox reply list, **When** the BDR clicks the contact name, **Then** they navigate to the contact details page.

---

### User Story 6 - Slack Notification with Contact Profile Link (Priority: P3)

When a reply arrives, the system posts a Slack notification in two places: (1) a DM to each BDR assigned to the campaign, and (2) the campaign's originating Slack channel. Both include a preview of the reply, personality summary (if available), and a "View Contact Profile" button that links to the contact details page in the admin dashboard.

**Why this priority**: Convenience feature that enhances the workflow. BDRs can function without it by checking UniBox directly.

**Independent Test**: Can be tested by triggering a reply webhook for a campaign contact and verifying a Slack message appears with the correct dashboard link.

**Acceptance Scenarios**:

1. **Given** a reply from a contact with personality data, **When** the webhook is processed, **Then** a Slack DM is sent to the assigned BDR AND a message is posted to the originating channel, both with the reply preview, personality archetype, communication style summary, and a "View Contact Profile" button.
2. **Given** the BDR clicks the "View Contact Profile" button, **When** they are logged into the dashboard, **Then** they are taken directly to the contact details page.
3. **Given** a reply from a contact without personality data, **When** the webhook is processed, **Then** the Slack notifications (DM + originating channel) are posted without the personality summary but still include the contact link.

---

### User Story 7 - Export Personality Data to CRM (Priority: P2)

An admin can push personality analysis data from campaign contacts to their connected CRM (HubSpot first, then Attio and Salesforce). The system automatically creates the necessary custom properties/fields in the CRM and maps personality data fields to them, so users do not need to manually create or map properties. Personality data can also be exported as a CSV file.

**Why this priority**: Personality data is high-value intelligence that should live in the CRM alongside the contact record, not siloed in this platform. Automating property creation removes friction that would otherwise block adoption.

**Independent Test**: Can be tested by triggering a CRM sync for a campaign with enriched contacts and verifying custom properties appear on the CRM contact records. CSV export can be tested by downloading the file and verifying all personality fields are present.

**Acceptance Scenarios**:

1. **Given** a campaign with contacts that have personality data, **When** the admin clicks "Push to HubSpot", **Then** the system automatically creates any missing custom properties in HubSpot (DISC scores, OCEAN scores, archetype, communication style, key traits) and writes the values to each contact record.
2. **Given** the custom properties already exist in HubSpot from a prior sync, **When** a new sync is triggered, **Then** existing properties are reused (not duplicated) and values are updated.
3. **Given** a contact without personality data, **When** a CRM sync runs, **Then** that contact is skipped (no empty properties written).
4. **Given** a campaign with enriched contacts, **When** the admin clicks "Export CSV", **Then** a CSV file is downloaded containing contact info plus all personality data fields (DISC scores, OCEAN scores, archetype, communication adjectives, key traits, email approach guidance).
5. **Given** CRM sync fails for a specific contact (e.g., CRM API error), **When** the sync runs, **Then** that contact is skipped and the sync continues for remaining contacts. A summary of failures is shown.

---

### Edge Cases

- What happens if the HubSpot API rejects a custom property creation (e.g., naming conflict)? The system retries with a prefixed name (e.g., `aiark_disc_dominance`) and logs the conflict.
- What happens if the CRM connection is not configured? The "Push to CRM" button is disabled with a tooltip explaining the prerequisite.

- What happens when a reply arrives for a contact not associated with any campaign (orphan reply)? No draft is generated; the reply is stored as-is in UniBox.
- What happens when the AI service is temporarily unavailable? The draft status is set to "failed" with an error message. The BDR can retry or compose a manual reply.
- What happens when the reply body is very long (e.g., includes quoted email thread)? The input is truncated to 2,000 characters before passing to the AI service.
- What happens when a contact replies multiple times in quick succession? Each reply gets its own draft generated independently; no deduplication or consolidation window is applied. Follow-up replies may change intent (e.g., correction after initial response).
- What happens when the Instantly API rejects the reply send? The error is surfaced to the BDR with a clear message. The draft remains editable.

## Requirements _(mandatory)_

### Functional Requirements

**Smart Reply Drafting**

- **FR-001**: System MUST automatically generate a draft reply when an email reply arrives via webhook, provided the reply is associated with a campaign contact.
- **FR-002**: System MUST classify each incoming reply into one of these intents: interested, meeting_request, question, objection, not_interested, wrong_person, out_of_office, auto_reply, other.
- **FR-003**: System MUST NOT generate a draft reply for out_of_office, auto_reply, or wrong_person intents.
- **FR-004**: System MUST include campaign context (email sequence copy, ICP definition, meeting link) and contact context (name, company, title) when generating drafts.
- **FR-005**: System MUST include personality insights in the draft generation prompt when personality data is available for the contact.
- **FR-006**: System MUST allow BDRs to accept a draft as-is, edit and then accept, dismiss, or regenerate with a different tone.
- **FR-007**: System MUST send accepted drafts through the existing email reply mechanism.
- **FR-008**: System MUST support regeneration with four tone options: professional, casual, assertive, empathetic.
- **FR-009**: System MUST track the cost (tokens used, USD cost) of each draft generation for reporting purposes.
- **FR-010**: Draft generation MUST NOT block or delay webhook processing. If draft generation fails, the reply MUST still be stored normally.
- **FR-010a**: AI-generated draft replies MUST be short and concise (under 150 words), matching professional email reply conventions.
- **FR-010b**: Inbound reply body MUST be truncated to 2,000 characters before passing to the AI service for classification and draft generation.
- **FR-010c**: System MUST allow BDRs to attach file(s) when sending a reply (both AI-drafted and manual replies). Maximum 5 files per reply, 10MB per file, limited to common office and image types (PDF, DOCX, XLSX, PNG, JPG, GIF).

**On-Demand Personality Enrichment**

- **FR-011**: System MUST allow BDRs to trigger personality enrichment for a single contact from the contact details page via an "Enrich" button.
- **FR-012**: System MUST allow BDRs to trigger personality enrichment for a single contact via a Slack command.
- **FR-013**: System MUST only enrich contacts that have both a verified email address and a LinkedIn URL. If either is missing, the system MUST display an error explaining the requirement.
- **FR-014**: System MUST store the personality analysis response on the contact record for reuse across features. If a contact already has personality data, the system MUST skip enrichment by default and offer a "Re-enrich" option to force a refresh.
- **FR-015**: System MUST call the AI Ark People Analysis API with the contact's LinkedIn URL and return results within 10 seconds.
- **FR-016**: Enrichment failure MUST be surfaced to the user with a clear error message and a retry option.

**Contact Details Page**

- **FR-017**: System MUST provide a contact details page accessible from the admin dashboard showing contact info, personality visualization, and conversation history.
- **FR-018**: Personality visualization MUST include: DISC profile scores, OCEAN/Big Five scores, personality archetype, communication style adjectives, "what to say" guidance, "what to avoid" guidance, key decision traits, and email approach guide.
- **FR-019**: Contact details page MUST gracefully handle contacts without personality data by hiding personality sections.
- **FR-020**: Contact details page MUST display all conversation history (replies and sequence step executions) in chronological order.
- **FR-021**: BDRs MUST be able to navigate to the contact details page from the UniBox by clicking a contact name.

**Slack Integration**

- **FR-022**: System MUST send a Slack DM to ALL BDRs assigned to the campaign when a contact replies, including a reply preview, personality summary (if available), and a dashboard link to the contact profile. If no BDR is assigned to the campaign, the DM is skipped (channel notification per FR-023 still fires).
- **FR-022a**: System MUST provide a multi-select BDR assignment field on campaigns, allowing admins to assign one or more BDRs to a campaign. This assignment drives Slack DM notifications (FR-022) and future campaign-level access controls.
- **FR-023**: System MUST also post the reply notification to the campaign's originating Slack channel (`campaign.slackChannelId`). If no channel is set on the campaign, the channel notification is skipped.

**Personality Data Export & CRM Sync**

- **FR-024**: System MUST allow admins to push personality data to HubSpot for campaign contacts, automatically creating any missing custom contact properties in HubSpot before writing values.
- **FR-025**: CRM custom property creation MUST be idempotent - if properties already exist from a prior sync, they MUST be reused without duplication.
- **FR-026**: CRM sync failure for individual contacts MUST NOT prevent the sync from completing for remaining contacts. A summary of successes and failures MUST be displayed.
- **FR-027**: System MUST allow admins to export personality data as a CSV file containing contact info and all personality fields (DISC scores, OCEAN scores, archetype, communication adjectives, key traits, email approach guidance).
- **FR-028**: CRM sync MUST be extensible to support Attio and Salesforce in future iterations (HubSpot first).

### Key Entities

- **UniboxReply (extended)**: Existing entity representing an inbound reply. Extended with draft body, draft status lifecycle (generating, ready, sent, rejected, failed), classified intent, generation cost, and error tracking.
- **CampaignContact (extended)**: Existing entity representing a contact in a campaign. Extended with personality data (full personality profile) and enrichment timestamp.
- **Campaign (uses CampaignBdr)**: Existing entity representing a campaign. BDR-campaign assignment via existing CampaignBdr junction table (slackUserId, slackTeamId, displayName per BDR). Admin UI needed for multi-select BDR assignment.
- **AI Ark Personality Profile**: External data entity containing DISC scores (dominance, influence, steadiness, calculativeness), OCEAN scores (openness, conscientiousness, extraversion, agreeableness, emotional stability), archetype label, communication style (types, adjectives, descriptions, guidance), key decision traits (risk tolerance, ability to say no, decision speed, decision drivers), and email approach recommendations (tone, length, greeting, subject, messaging, closing).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: AI-drafted replies are available for BDR review within 30 seconds of a prospect reply arriving.
- **SC-002**: Intent classification accuracy reaches 85% or higher (measured by BDR override rate - when BDRs dismiss drafts due to incorrect classification).
- **SC-003**: BDR reply composition time decreases by 60% compared to manual drafting (from ~3 minutes to ~1 minute including review/edit).
- **SC-004**: 70% or more of generated drafts are accepted (with or without edits) rather than dismissed, indicating draft quality meets BDR expectations.
- **SC-005**: Contact details page loads within 3 seconds and displays all personality visualizations correctly.
- **SC-006**: AI draft generation costs remain below $5/month at 100 replies per day volume.

## Assumptions

- Instantly webhooks reliably deliver reply events with sufficient body text for classification.
- AI Ark People Analysis API is available with acceptable latency (under 10 seconds per call) and returns the documented response schema (DISC, OCEAN, archetype, selling communication guidance).
- BDRs are already logged into the admin dashboard daily (for UniBox usage) so dashboard links from Slack require no additional login.
- The existing email reply mechanism continues to function for sending replies via email thread IDs.
- The existing prompt library infrastructure can be extended with new prompt slugs without architectural changes.
- Personality data on contacts is populated via on-demand enrichment (Slack command or dashboard button), not bulk/automatic enrichment at campaign activation.

## Clarifications

### Session 2026-03-17

- Q: Does BDR-campaign assignment already exist or is it new scope? → A: New scope. Add a multi-select BDR assignment field to campaigns, allowing admins to assign one or more BDRs per campaign. This drives Slack DM notifications.
- Q: Should personality enrichment happen automatically at campaign activation? → A: No. Remove automatic bulk enrichment before campaign start (former US4/US5). Instead, provide on-demand enrichment via Slack command and "Enrich" button on contact details page.

### Session 2026-03-15

- Q: Should draft generation be suppressed for rapid-fire follow-up replies from the same contact? → A: No. Each reply gets its own draft independently with no dedup window.
- Q: Who receives the Slack reply notification and where? → A: DM to the assigned BDR AND posted to the originating Slack channel where the campaign job was triggered.
- Q: What is the character limit for inbound reply body truncation? → A: 2,000 characters. Also: drafts must be short/concise, and BDRs must be able to attach files to replies.
- Q: Should personality data be re-enriched per campaign or reused? → A: Reuse existing data by default (skip if already enriched). A "Re-enrich" option is available to force a refresh. Personality data must also be exportable to CRMs (HubSpot first, then Attio/Salesforce) with auto-created custom properties, and downloadable as CSV.
