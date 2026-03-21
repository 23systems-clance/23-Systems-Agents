# Feature Specification: Slack List Processor

**Feature Branch**: `1-slack-list-processor`
**Created**: 2026-03-04
**Status**: Draft
**Input**: User description: "Slack-based backend integration for processing company lists through BuiltWith and Apollo.io APIs with AI orchestration"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Technographic Enrichment via File Upload (Priority: P1)

A sales team member uploads a CSV or XLSX file containing company domains into a Slack channel. The bot detects the file upload and responds: "What would you like me to do with this list? Use ENRICH at the beginning of your sentence so I know you're talking to me." The user replies with a message starting with "ENRICH" followed by their intent (e.g., "ENRICH this list with tech stacks"). The AI orchestrator parses the instruction and enriches each company with its full technology stack using BuiltWith. The enriched list is returned as a downloadable file in the same Slack channel.

**Why this priority**: This is the core value proposition - enriching company lists with technographic data is the primary use case and delivers immediate value to the sales team without requiring additional API integrations.

**Independent Test**: Can be fully tested by uploading a CSV with 5 company domains to Slack and verifying an enriched CSV is returned with technology columns populated.

**Acceptance Scenarios**:

1. **Given** a user uploads a CSV or XLSX file to the channel, **When** the bot detects the upload, **Then** it responds asking what the user wants done with the list, instructing them to prefix their reply with "ENRICH".
2. **Given** the user replies with "ENRICH [instruction]", **When** the AI orchestrator parses the intent as technographic enrichment, **Then** the system processes the file and returns an enriched CSV/XLSX with all detected technologies per company added as new columns, plus dedicated columns for Cloud Hosting Provider and Technology Spend Tier (Tier 1/2/3).
3. **Given** a user uploads an XLSX file, **When** the system processes it, **Then** the output format matches the input format (XLSX in, XLSX out) unless the user specifies otherwise.
4. **Given** a user uploads a file with 500+ domains, **When** processing begins, **Then** the system sends a "processing" acknowledgment within 3 seconds and provides progress updates for long-running jobs.
5. **Given** a user uploads a file with some invalid or unreachable domains, **When** the system processes the file, **Then** those rows are included in the output with an error status column, not silently dropped.
6. **Given** a user uploads a file but does NOT reply with "ENRICH", **When** no trigger keyword is received, **Then** the bot does not process the file and takes no further action.

---

### User Story 2 - Decision Maker Lookup from Company List (Priority: P1)

A sales team member uploads a list of companies. The bot asks what to do with the list. The user replies with "ENRICH" followed by their intent (e.g., "ENRICH get me decision makers for these companies"). The AI orchestrator detects a contact enrichment request and asks clarifying questions via Slack (purpose: Cold Calling, Emailing, Just a List, or LinkedIn), then finds 2 decision makers per company using Apollo.io. Each contact is classified by persona type and returned with email, direct phone, and business phone number (no mobile numbers).

**Why this priority**: Equal priority with technographic enrichment as this is the other core workflow - converting company lists into actionable contact lists.

**Independent Test**: Can be fully tested by uploading a 10-company CSV, answering the Slack prompts, and verifying 2 contacts per company are returned with email, direct phone, business phone, and persona classification.

**Acceptance Scenarios**:

1. **Given** a user uploads a company list and replies with "ENRICH [contact-related instruction]", **When** the AI orchestrator detects a contact enrichment request, **Then** the system asks via Slack: "Is this for Cold Calling, Emailing, Just need a List, or LinkedIn?"
2. **Given** the user responds with their purpose, **When** the system processes the list, **Then** it finds up to 2 decision makers per company prioritized by seniority (C-suite, VP, Director, Manager).
3. **Given** contacts are found, **When** the enriched list is generated, **Then** each contact includes: Email Address, Direct Phone Number, Business Number, Job Title, Persona Type classification, Timezone (UTC), and Timezone (Label).
4. **Given** a contact is found, **When** the system classifies the persona, **Then** it maps the job title to one of the defined persona types: IT Leader, Engineering Leader, Finance Leader, Sales Leader, Founder/Owner, CEO, Operations Leader, HR Leader, Customer Success Leader, Marketing Leader, Product Leader, Compliance Leader, Research Leader, or Non-Leader.
5. **Given** the system cannot find 2 decision makers at a company, **When** the results are compiled, **Then** the company row shows however many were found (0 or 1) with a note indicating no additional contacts were available.
6. **Given** a contact has no direct phone or business number available, **When** the results are compiled, **Then** the field is left blank rather than substituting a mobile number.

---

### User Story 3 - Technology Report Generation via Natural Language (Priority: P2)

A user types a natural language request in Slack starting with "ENRICH" such as "ENRICH find companies using OpenAI in the United States." The AI orchestrator parses the technology name and geographic filter, queries the BuiltWith Lists API, and returns a CSV file of matching companies delivered to the Slack channel.

**Why this priority**: This extends the platform from list enrichment to list generation, opening a new prospecting workflow. Depends on the BuiltWith integration from P1 being established.

**Independent Test**: Can be fully tested by typing "ENRICH find companies using Shopify in the United States" in Slack and verifying a CSV is returned with company domains, names, and location data.

**Acceptance Scenarios**:

1. **Given** a user types "ENRICH find companies using [Technology] in [Country]", **When** the AI orchestrator parses the request, **Then** it extracts the technology name and asks filtering questions (country, state/region, company size, traffic level) before executing.
2. **Given** the user provides filters, **When** the system checks for cached results, **Then** if an identical query was previously run, it offers the cached result with its generation date. The user can accept the cached result or force a fresh query.
3. **Given** no cached result exists or the user requests fresh data, **When** the system executes the query, **Then** it paginates through all available results and delivers the complete list as a CSV.
4. **Given** the query returns results, **When** the CSV is generated, **Then** it includes: Domain, Company Name, Location (Country, State/Region, City), Traffic Rank, and the specific technology detected.
5. **Given** a user types an ambiguous request, **When** the AI orchestrator cannot confidently parse the technology name, **Then** it asks the user to clarify before proceeding.

---

### User Story 4 - Slack Contextual Questions and List Metadata (Priority: P2)

When a user uploads a list, the system asks contextual follow-up questions to tag the list with metadata: whether it's a co-sell list with a cloud provider, who owns the list, and any additional context. This metadata is stored with the job and included in the output file.

**Why this priority**: Adds organizational value and context to every list processed, enabling better tracking and attribution. Not required for core enrichment to function.

**Independent Test**: Can be fully tested by uploading a list, answering the Slack prompts about list ownership and co-sell status, and verifying the metadata appears in the output file headers or a companion metadata sheet.

**Acceptance Scenarios**:

1. **Given** a user uploads a list file, **When** the system detects the upload, **Then** it asks: "Is this a co-sell list with a cloud provider?" with Yes/No options.
2. **Given** the user confirms it is a co-sell list, **When** follow-up questions are presented, **Then** the system asks: "Which cloud provider?" with options (AWS, Azure, GCP, Other).
3. **Given** any list upload, **When** the system gathers context, **Then** it asks: "Who is the owner of this list and is there any additional details we should know to associate this list to?"
4. **Given** the user provides metadata answers, **When** the enriched file is generated, **Then** the metadata (purpose, owner, co-sell status, notes) is included as a summary sheet or header in the output file.

---

### User Story 5 - Export and Delivery Back to Slack Channel (Priority: P1)

After any processing job completes, the system delivers the result file (CSV or XLSX) directly back to the Slack channel where the request originated. The file includes a summary message indicating what was processed and key statistics.

**Why this priority**: This is the delivery mechanism for all other workflows - without it, no results reach the user.

**Independent Test**: Can be fully tested by triggering any processing job and verifying the output file appears in the Slack channel with a summary message.

**Acceptance Scenarios**:

1. **Given** a processing job completes successfully, **When** the file is ready, **Then** it is uploaded to the originating Slack channel with a summary message (e.g., "Processed 150 companies. 148 enriched successfully. 2 failed.").
2. **Given** a processing job fails entirely, **When** the error is caught, **Then** the user receives an error message in Slack explaining what went wrong and suggested next steps.
3. **Given** the output file exceeds Slack's 1 GB file upload limit, **When** delivery is attempted, **Then** the system uploads the file to persistent object storage (S3) and posts a pre-signed download link in the Slack thread with a 7-day expiry.

---

### Edge Cases

- What happens when a user uploads a file with no recognizable domain column? The system should ask the user to identify which column contains domains.
- What happens when BuiltWith or Apollo.io API is down or rate-limited? The system should queue the job and notify the user of the delay.
- What happens when a CSV file has encoding issues or mixed delimiters? The system should attempt auto-detection and fall back to asking the user for format clarification.
- What happens when multiple users upload files simultaneously? Each job should be processed independently with results delivered to the correct channel/thread.
- What happens when the same company list is uploaded twice? The system should process it fresh each time (no caching that would return stale data).
- What happens when a contact's job title doesn't match any leader persona type? The system should classify it as "Non-Leader" and include the original job title for reference.
- What happens when a user uploads a list while a previous job is still processing? The system should queue the new job and inform the user of its position.
- What happens when a user uploads a file exceeding 5,000 rows? The system rejects the file immediately with an error message and suggests splitting into smaller files.
- What happens when a user requests a technology report that was previously cached months ago? The system shows the cache date and lets the user decide: use cached data or pay for a fresh query.
- What happens when a user uploads a file but never replies with "ENRICH"? The bot takes no action — the file upload prompt expires silently after a reasonable period.
- What happens when someone types "ENRICH" without a preceding file upload? The AI orchestrator checks if this is a natural language technology report request. If no file context and no valid report query, it responds with usage instructions.
- What happens when BuiltWith data doesn't include a recognizable cloud hosting provider? The Cloud Hosting Provider column is set to "Unknown" for that company.
- What happens when the technology spend cannot be reliably estimated? The Technology Spend column is set to "Unclassified" with the raw technology count included for manual review.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST detect CSV and XLSX file uploads in any Slack channel the bot is invited to. Upon detection, the bot MUST respond asking what the user wants done with the list, instructing them to prefix their reply with "ENRICH". The bot MUST NOT process the file until a message starting with "ENRICH" is received. A dedicated primary channel serves as the default team workspace, but the bot is fully functional in any channel.
- **FR-002**: System MUST use an AI orchestrator to interpret the user's "ENRICH [instruction]" message, determining whether the request is for technographic enrichment, contact lookup, combined enrichment, or technology report generation. For natural language technology report requests (no file upload), the "ENRICH" prefix is also required to trigger the bot.
- **FR-003**: System MUST enrich company domains with technographic data from BuiltWith, including all detected technologies, technology categories, first/last detection dates, and traffic rankings. The output MUST include dedicated columns for Cloud Hosting Provider and Technology Spend Tier.
- **FR-003a**: System MUST extract the cloud hosting provider (e.g., AWS, Azure, GCP, Oracle Cloud, IBM Cloud, Other) from the BuiltWith technographic data and populate a dedicated "Cloud Hosting Provider" column in the output for each company.
- **FR-003b**: System MUST estimate a Technology Spend tier for each company based on the number, type, and sophistication of detected technologies, and populate a dedicated "Technology Spend" column classified as Tier 1 (high spend), Tier 2 (mid spend), or Tier 3 (low spend).
- **FR-004**: System MUST find up to 2 decision makers per company by default (not prompted), prioritized by seniority level (C-suite, VP, Director, Manager). This is a system default that applies automatically to every contact enrichment job.
- **FR-005**: System MUST collect Email Address, Direct Phone Number, and Business Phone Number for each contact. Mobile numbers MUST NOT be included.
- **FR-006**: System MUST classify every contact's job title into a persona type and include it as a column in the output. The persona types are: IT Leader, Engineering Leader, Finance Leader, Sales Leader, Founder/Owner, CEO, Operations Leader, HR Leader, Customer Success Leader, Marketing Leader, Product Leader, Compliance Leader, Research Leader, or Non-Leader. _(Note: This extends the constitution's 10 persona types with Operations Leader, Product Leader, Compliance Leader, Research Leader, and Non-Leader to provide finer-grained classification for sales targeting.)_
- **FR-007**: System MUST present contextual Slack prompts before processing. For contact and combined enrichment jobs, the system MUST ask the purpose of the list (Cold Calling, Emailing, Just a List, LinkedIn). For all job types (technographic, contact, combined), the system MUST ask co-sell status, list owner, and additional context.
- **FR-008**: System MUST generate technology reports from natural language queries by extracting technology name and geographic filters and delivering results as CSV. Before executing, the system MUST ask filtering questions via Slack to narrow the query: country, state/region, company size range, and traffic level. No hard result cap is enforced; however, queries returning more than 50,000 results MUST be paginated and the user MUST be warned before proceeding with very large result sets.
- **FR-009**: System MUST deliver all output files (CSV or XLSX) back to the originating Slack channel with a summary message including processing statistics.
- **FR-010**: System MUST acknowledge receipt of long-running requests within 3 seconds and provide progress updates during processing.
- **FR-011**: System MUST handle API rate limits gracefully by queuing requests and retrying with appropriate backoff.
- **FR-012**: System MUST process jobs from multiple users concurrently without cross-contamination of data or results.
- **FR-013**: System MUST handle asynchronous phone number delivery via webhook and reconcile it with the rest of the contact record before delivering results.
- **FR-014**: System MUST resolve company names to domains when the uploaded list contains company names instead of domain URLs.
- **FR-015**: System MUST enforce a hard maximum of 5,000 rows per uploaded file. Files exceeding 5,000 rows MUST be rejected with a message instructing the user to split the file. Files up to 1,000 rows are processed at standard priority. Files between 1,001-5,000 rows are processed with a warning message to the user that results will take longer; processing logic is identical but the user is informed of the expected delay due to volume.
- **FR-016**: System MUST permanently store all job metadata, source files, and result files in persistent object storage (S3 or equivalent). Users MUST be able to search and retrieve past job results via Slack by typing "ENRICH history" (lists the 10 most recent jobs with status and type) or "ENRICH history [search term]" (filters by filename, owner, or job type). Each history entry includes a re-download link.
- **FR-017**: System MUST support combined workflows where a single upload triggers both technographic enrichment (BuiltWith) and decision maker lookup (Apollo.io). The AI orchestrator detects or asks when both are needed, and the system produces a single merged output file containing tech stack data alongside contact data per company.
- **FR-018**: System MUST cache technology report results. Before executing a report query, the system MUST check if an identical or substantially similar query (same technology + same filters) has been run previously. If a cached result exists, the system MUST offer it to the user instead of re-querying the API, displaying when the cached result was generated. Users can choose to use the cached result or force a fresh query.
- **FR-019**: System MUST log all API usage per job, including: BuiltWith API calls and credits consumed, Apollo.io API calls and credits consumed (email credits, mobile credits separately), AI orchestrator token usage and estimated cost, total API calls made, and timestamps. Cost estimation MUST use configurable per-service pricing rates defined in environment variables (e.g., BUILTWITH_COST_PER_CREDIT, APOLLO_COST_PER_CREDIT, AI_COST_PER_1K_INPUT_TOKENS, AI_COST_PER_1K_OUTPUT_TOKENS). This data MUST be stored alongside the job record to support future analytics and dashboard reporting.
- **FR-020**: System MUST persist all source files and result files in S3-compatible object storage. Files uploaded to Slack are also copied to S3 for permanent retention independent of Slack's file lifecycle. The REST API endpoint for file download (`GET /api/v1/jobs/:id/result`) MUST serve files from S3 storage.
- **FR-021**: System MUST include a "Timezone (UTC)" and "Timezone (Label)" column for each contact in the output. The timezone is derived from the contact's location data (city/state from Apollo.io). The UTC column shows the offset (e.g., "UTC-5", "UTC-8"). The Label column shows a standardized U.S. layman's term: "Eastern" (UTC-5), "Central" (UTC-6), "Mountain" (UTC-7), "Pacific" (UTC-8), "Alaska" (UTC-9), "Hawaii" (UTC-10). For non-U.S. contacts, the label shows the IANA timezone region name (e.g., "GMT", "CET", "IST"). If location data is unavailable, both fields are set to "Unknown".

### Key Entities

- **Job**: A processing request initiated by a Slack user. Contains: source file, job type (technographic/contact/report/combined), status, metadata (owner, purpose, co-sell status), timestamps, originating channel/thread, requesting user. All jobs are permanently stored and searchable.
- **Company**: A business entity identified by domain name. Contains: domain, company name, location, traffic rank, technology stack, cloud hosting provider (dedicated column), technology spend tier (Tier 1/2/3 dedicated column).
- **Contact**: A person associated with a company. Contains: name, email, direct phone, business phone, job title, persona type, seniority level, timezone (UTC offset + layman's label), company association.
- **Persona Type**: A classification category for contacts based on job title. Contains: type name, associated title patterns, priority ranking.
- **Technology Report**: A generated list of companies matching a technology + geography query. Contains: technology name, geographic filter, result count, company list.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Users can upload a company list and receive a technographic-enriched file back in the same Slack channel within 5 minutes for lists of 100 companies or fewer.
- **SC-002**: Contact enrichment returns at least 1 decision maker for 80% of companies in a typical B2B company list.
- **SC-003**: Persona type classification accurately maps 90% of job titles to the correct persona category.
- **SC-004**: Technology report queries return results within 2 minutes for searches yielding up to 1,000 companies.
- **SC-005**: System processes at least 10 concurrent jobs without degraded performance or incorrect result delivery.
- **SC-006**: Zero mobile phone numbers appear in contact enrichment outputs.
- **SC-007**: All Slack interactions (acknowledgments, questions, results) are delivered to the correct channel and thread with no cross-user data leakage.
- **SC-008**: 95% of jobs complete successfully without requiring user intervention to resolve errors.

## Clarifications

### Session 2026-03-04

- Q: Should the bot operate in a single dedicated channel, multiple approved channels, or any channel it's invited to? → A: Any channel it's invited to (Option C), plus a dedicated primary channel for the team.
- Q: What is the maximum number of rows per uploaded file? → A: 1,000 rows default processing limit, 5,000 rows hard maximum.
- Q: Should processed results and job history be stored beyond Slack file delivery? → A: Permanent history - store all jobs and results indefinitely with searchable job history.
- Q: Can users request both technographic enrichment and decision maker lookup in a single upload? → A: Yes, combined workflow supported. Single upload can trigger both enrichments and produce one merged output file.
- Q: Should technology report results have a hard cap? → A: No hard cap. Instead, the system asks filtering questions (country, state, company size, traffic level) to narrow queries before executing. Previously fetched report results are cached/stored so identical queries are served from history without re-consuming API credits.

## Assumptions

- The organization has active paid subscriptions to both BuiltWith (Pro plan or higher for Lists API access) and Apollo.io (Professional plan or higher for adequate credits).
- A Slack workspace is available with permissions to install a custom bot/app that can read messages, upload files, and post messages.
- The AI orchestrator service (Claude API or OpenAI API) is available and the organization has an active API key.
- Apollo.io's People Search API remains free (no credit cost) for the initial search phase; credits are only consumed during enrichment.
- The backend service has a publicly accessible HTTPS endpoint to receive webhook callbacks for asynchronous phone number delivery.
- Users uploading lists will have files with either a clear domain column or company name column that can be identified programmatically or through user clarification.
- The persona type classification will use AI-based job title matching rather than exact string matching, allowing for variations in title naming conventions.
