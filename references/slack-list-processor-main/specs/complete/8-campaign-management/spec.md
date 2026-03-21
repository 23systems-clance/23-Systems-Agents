# Feature Specification: Campaign Management Enhancements

**Feature Branch**: `8-campaign-management`
**Created**: 2026-03-09
**Status**: Draft
**Input**: User description: "Campaign Management Enhancements - Delete, Edit, BDR Assignment, Client Organization, HubSpot Import Intelligence"

## Clarifications

### Session 2026-03-09

- Q: Should client assignment be required or optional when creating/editing a campaign? → A: Required at activation - optional during creation but must be set before activating.
- Q: Should contact quality summary be a pre-import preview or post-import stats? → A: Post-import stats on campaign detail page, broken down by channel (LinkedIn, Mobile Phone, Email) with a Multi-Channel Total showing contacts reachable on all channels.
- Q: How should external platform campaign IDs (Instantly, HeyReach) be configured? → A: Once a client is attached, use a "Fetch Campaigns" button to call Instantly/HeyReach APIs with client credentials and let manager select from a dropdown of available campaigns. If a client's API key for a channel is empty, that channel is not available. On activation, prompt which external campaign to associate. Fallback to manual ID entry if API fetch is not feasible.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Edit Campaign and Assign BDRs (Priority: P1)

As a campaign manager, I need to edit an existing campaign and assign BDRs to it so that the campaign has all the required configuration to be activated. Currently, creating a campaign does not allow BDR assignment, so activation always fails with a 400 error because "Campaign must have at least one BDR assigned."

**Why this priority**: This is the most critical blocker. Without BDR assignment, no campaign can be activated. Without edit capability, there's no way to fix incomplete campaigns after creation.

**Independent Test**: Can be fully tested by creating a campaign, then editing it to assign BDRs and update fields. Delivers the ability to successfully activate campaigns.

**Acceptance Scenarios**:

1. **Given** a campaign in DRAFT status, **When** a manager clicks "Edit" on the campaign detail page, **Then** an edit form appears pre-filled with the campaign's current configuration.
2. **Given** the edit form is open, **When** a manager selects BDRs from a list of available BDRs, **Then** the selected BDRs appear as assigned and are saved when the form is submitted.
3. **Given** a campaign in DRAFT status with BDRs, steps, contact list, and type-specific config all set, **When** the manager clicks "Activate", **Then** the campaign transitions to ACTIVE and contact import begins (no 400 error).
4. **Given** a campaign in PAUSED status, **When** a manager edits the campaign, **Then** editable fields can be updated and saved.
5. **Given** a campaign in ACTIVE or COMPLETED status, **When** a manager views the detail page, **Then** the "Edit" button is not available (read-only).
6. **Given** the campaign create form, **When** a manager creates a new campaign, **Then** they can also assign BDRs and a client during creation.

---

### User Story 2 - Assign Campaigns to Clients (Priority: P1)

As a campaign manager, I need to assign campaigns to specific clients so that campaigns are organized by client and use the correct client API credentials (Instantly, HeyReach, HubSpot).

**Why this priority**: Client organization is fundamental to how campaigns operate. Each client has their own API keys, and campaigns need to be linked to the right client.

**Independent Test**: Can be tested by creating/editing a campaign with a client selected, and filtering the campaign list by client.

**Acceptance Scenarios**:

1. **Given** the campaign create or edit form, **When** a manager selects a client from a dropdown, **Then** the campaign is associated with that client.
2. **Given** the campaigns list page, **When** a manager selects a client filter, **Then** only campaigns belonging to that client are displayed.
3. **Given** a campaign assigned to a client, **When** viewing the campaign detail page, **Then** the assigned client name is displayed.
4. **Given** the client filter is set, **When** a manager also applies a status filter and search, **Then** all filters work together to narrow results.

---

### User Story 3 - Delete Campaigns (Priority: P2)

As a campaign manager, I need to delete campaigns that are no longer needed so that the campaign list stays clean and manageable.

**Why this priority**: Important for data hygiene but not a blocker for core campaign functionality.

**Independent Test**: Can be tested by deleting a DRAFT campaign (hard delete) and archiving an ACTIVE/PAUSED campaign.

**Acceptance Scenarios**:

1. **Given** a campaign in DRAFT status with no imported contacts, **When** a manager clicks "Delete" and confirms, **Then** the campaign is permanently removed.
2. **Given** a campaign in ACTIVE or PAUSED status, **When** a manager clicks "Archive" and confirms, **Then** the campaign transitions to ARCHIVED status and stops all activity.
3. **Given** a campaign in COMPLETED status, **When** a manager clicks "Archive", **Then** the campaign transitions to ARCHIVED status.
4. **Given** a delete/archive confirmation dialog, **When** a manager cancels, **Then** no action is taken and the campaign remains unchanged.
5. **Given** the campaigns list filtered to "All statuses", **When** archived campaigns exist, **Then** they appear with an ARCHIVED badge.

---

### User Story 4 - HubSpot Contact Import Intelligence (Priority: P2)

As a campaign manager, I need to see a quality summary of imported contacts after pulling from HubSpot, so I know how many contacts are reachable via each channel (email, phone, LinkedIn).

**Why this priority**: Understanding contact quality is essential for campaign planning but can be added after core CRUD is working.

**Independent Test**: Can be tested by importing a HubSpot list and reviewing the quality summary stats on the campaign detail page.

**Acceptance Scenarios**:

1. **Given** a campaign with imported contacts, **When** a manager views the campaign detail page, **Then** a contact quality summary card shows per-channel counts: Email (verified), Mobile Phone (callable), LinkedIn (available), and a Multi-Channel Total (contacts reachable on all three channels).
2. **Given** contacts imported from HubSpot, **When** the system evaluates email quality, **Then** it counts emails that are not bounced and have a valid format as "verified."
3. **Given** contacts imported from HubSpot, **When** the system evaluates phone quality, **Then** it counts contacts that have a mobile or direct phone number AND whose "Do Not Call" property is NOT set to true or unknown.
4. **Given** contacts imported from HubSpot, **When** the system evaluates LinkedIn availability, **Then** it counts contacts with a non-empty LinkedIn URL field.
5. **Given** a contact whose "Do Not Call" status is unknown, **When** imported, **Then** the contact's `canCall` flag is set to false (filtered out).

---

### User Story 5 - External Campaign Linking via API (Priority: P2)

As a campaign manager, I need the system to fetch available campaigns from Instantly and HeyReach using the client's API credentials so I can select which external campaign to link rather than manually entering IDs.

**Why this priority**: Eliminates error-prone manual ID entry and ensures campaigns are linked to valid external campaigns. Depends on client assignment (Story 2).

**Independent Test**: Can be tested by attaching a client with Instantly API key, clicking "Fetch Campaigns", and selecting an Instantly campaign from the dropdown.

**Acceptance Scenarios**:

1. **Given** a campaign with a client assigned that has an Instantly API key, **When** a manager clicks "Fetch Campaigns" for Instantly, **Then** the system calls the Instantly API and displays a dropdown of available campaigns to select from.
2. **Given** a campaign with a client assigned that has a HeyReach API key, **When** a manager clicks "Fetch Campaigns" for HeyReach, **Then** the system calls the HeyReach API and displays a dropdown of available campaigns.
3. **Given** a client with no Instantly API key configured, **When** viewing the campaign edit form, **Then** the Instantly channel section shows "Not configured" and is disabled.
4. **Given** a client with no HeyReach API key configured, **When** viewing the campaign edit form, **Then** the HeyReach channel section shows "Not configured" and is disabled.
5. **Given** the Instantly/HeyReach API call fails, **When** the fetch returns an error, **Then** a fallback manual ID entry field is shown with an error message explaining the API failure.
6. **Given** a campaign being activated without a client, **When** the manager clicks "Activate", **Then** the system displays validation errors listing "Missing client assignment" and any other unmet requirements.

---

### User Story 6 - HubSpot Contact Property Mapping (Priority: P3)

As a campaign manager, I need the system to use proper HubSpot contact property mapping rules so that the quality assessment of contacts is accurate.

**Why this priority**: Enhances the accuracy of Story 4 but can start with reasonable defaults based on standard HubSpot properties.

**Independent Test**: Can be tested by importing contacts with various HubSpot property combinations and verifying the mapping rules produce correct canEmail/canCall/canLinkedin flags.

**Acceptance Scenarios**:

1. **Given** a HubSpot contact with a bounced email status, **When** imported, **Then** `canEmail` is set to false.
2. **Given** a HubSpot contact with a valid email and no bounce status, **When** imported, **Then** `canEmail` is set to true.
3. **Given** a HubSpot contact with a mobile or direct phone number populated and `donotcall` is false, **When** imported, **Then** `canCall` is set to true.
4. **Given** a HubSpot contact with `donotcall` set to true or unknown/null, **When** imported, **Then** `canCall` is set to false.
5. **Given** a HubSpot contact with a LinkedIn URL property populated, **When** imported, **Then** `canLinkedin` is set to true.

---

### Edge Cases

- What happens when a manager tries to delete a campaign that has active contacts in mid-sequence? The campaign should be archived (not hard deleted) and active contacts should be paused.
- What happens when a BDR assigned to a campaign is deactivated? The BDR remains in the campaign record but is flagged as inactive. New campaigns cannot select deactivated BDRs.
- What happens when a client assigned to a campaign is deactivated? The campaign retains the client association but a warning badge is shown on the campaign detail page.
- What happens when HubSpot returns contacts with missing or malformed data? The import should skip contacts with no email AND no phone AND no LinkedIn (completely unreachable), logging skipped contacts.
- What happens when the HubSpot list ID is invalid or the API returns an error? The system should display a clear error message and not change the campaign status.
- What happens when editing a campaign that's currently being imported? The edit should be blocked with a message "Campaign is currently importing contacts. Please wait."
- What happens when the Instantly or HeyReach API returns an empty campaign list? Display "No campaigns found" with the option to enter a campaign ID manually.
- What happens when the client's API credentials are invalid or expired? Display an error prompting the manager to update the client's credentials in the Managed Clients page.

## Requirements _(mandatory)_

### Functional Requirements

**Campaign Edit & BDR Assignment**
- **FR-001**: System MUST provide an edit interface for campaigns in DRAFT or PAUSED status.
- **FR-002**: The edit interface MUST allow updating: name, description, channel configuration fields, HubSpot list ID, sequence steps, and BDR assignments.
- **FR-003**: System MUST allow selecting BDRs from the list of active BDRs in the workspace during campaign creation and editing.
- **FR-004**: System MUST display the current BDR assignments and allow adding/removing BDRs.
- **FR-005**: _(Covered by FR-003 and FR-006 which both specify "during creation and editing")_

**Client Organization**
- **FR-006**: System MUST allow assigning a campaign to a client (ManagedClient) during creation and editing. Client is optional at creation but required before activation.
- **FR-007**: The campaigns list page MUST provide a client filter dropdown.
- **FR-008**: Campaign detail page MUST display the assigned client name.
- **FR-009**: System MUST show only active clients in the client selection dropdown.

**Campaign Deletion**
- **FR-010**: System MUST allow permanent deletion of DRAFT campaigns that have no imported contacts.
- **FR-011**: System MUST allow archiving campaigns in any status (ACTIVE, PAUSED, COMPLETED) by transitioning to ARCHIVED status.
- **FR-012**: System MUST show a confirmation dialog before delete or archive actions.
- **FR-013**: Archiving an ACTIVE campaign MUST stop all sequence execution for that campaign.

**HubSpot Contact Import Intelligence**
- **FR-014**: System MUST display a contact quality summary broken down by channel: Email (verified count), Mobile Phone (callable count), LinkedIn (available count), and Multi-Channel Total (contacts reachable via all three channels).
- **FR-015**: System MUST filter out contacts where "Do Not Call" is true or unknown when determining phone callability.
- **FR-016**: System MUST use HubSpot contact properties to determine email validity: email exists, `hs_email_status` is not `bounced`, and `hs_email_bounce` does not indicate a hard bounce.
- **FR-017**: System MUST use HubSpot contact properties to determine LinkedIn availability (non-empty LinkedIn URL).

**External Campaign Linking**
- **FR-020**: Once a client is attached, system MUST provide a "Fetch Campaigns" button that calls the Instantly and/or HeyReach APIs using the client's stored credentials.
- **FR-021**: System MUST display fetched external campaigns in a selectable dropdown for the manager to choose from.
- **FR-022**: If a client's API key for a channel (Instantly or HeyReach) is empty, that channel MUST be shown as "Not configured" and disabled.
- **FR-023**: If the external API call fails, system MUST fall back to manual campaign ID entry with a clear error message.
- **FR-024**: On activation, system MUST ensure the required external campaign associations are set based on campaign type (EMAIL/MULTI_CHANNEL requires Instantly, LINKEDIN requires HeyReach).

**Activation Fix**
- **FR-018**: The activation validation error message MUST clearly list all missing requirements (e.g., "Missing: BDRs, client, contact list") so the manager knows exactly what to fix.
- **FR-019**: System MUST validate that a client is assigned before allowing campaign activation.

### Key Entities

- **Campaign**: The core outreach campaign entity. Has status lifecycle (DRAFT > ACTIVE > PAUSED > COMPLETED > ARCHIVED). Must be associated with a client and at least one BDR before activation.
- **CampaignBdr**: Junction entity linking BDRs to campaigns. Contains slackUserId, slackTeamId, and displayName.
- **ManagedClient**: Business client entity with API credentials. Campaigns optionally belong to a client during creation but must have a client assigned before activation.
- **CampaignContact**: Imported contact with quality flags (canEmail, canCall, canLinkedin) determined by HubSpot property mapping.
- **Bdr**: Business Development Representative with workspace association. Can be active or inactive.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Managers can edit a DRAFT campaign and activate it in a single session without encountering errors (assuming all required fields are filled).
- **SC-002**: 100% of campaigns can have BDRs assigned via the UI (create or edit flow).
- **SC-003**: Campaign list can be filtered by client, showing only campaigns for the selected client.
- **SC-004**: Contact quality summary displays accurate counts that match the actual contact data within the campaign.
- **SC-005**: Managers can delete/archive campaigns from the UI with no more than 2 clicks (button + confirmation).
- **SC-006**: Contacts with "Do Not Call" set to true or unknown are consistently filtered out from callable counts (0% false positives on DNC).
- **SC-007**: All campaign management operations (create, edit, delete, activate) complete within 3 seconds from user action.

## Assumptions

- BDRs are managed via the existing BDR management page; this feature only adds BDR *selection* to campaign forms.
- Clients are managed via the existing managed clients page; this feature only adds client *selection* to campaign forms.
- HubSpot contact properties follow standard HubSpot naming conventions (`hs_email_bounce`, `mobilephone`, `phone`, `donotcall`, `linkedin_url`).
- "Do Not Call" unknown/null is treated as "do not call" (conservative approach per user requirement).
- The contact quality summary is calculated from already-imported contacts (post-import analysis), not a pre-import preview.
- Hard delete is only for DRAFT campaigns with zero contacts. All other deletions use the ARCHIVED status transition.
