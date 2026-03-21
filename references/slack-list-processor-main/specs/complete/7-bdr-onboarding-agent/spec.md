# Feature Specification: BDR Onboarding Agent

**Feature Branch**: `7-bdr-onboarding-agent`
**Created**: 2026-03-08
**Status**: Draft
**Input**: User description: "BDR Onboarding Agent - Automated onboarding system that delivers structured 2-4 week training programs to new BDRs via daily Slack DMs. Includes a drip builder and automation builder in the admin dashboard for structuring daily messages, check-ins, training videos, resource links, registration instructions, and reimbursement/certification request flows. Tracks completion progress and transitions BDRs to live campaign work."

## Clarifications

### Session 2026-03-08

- Q: Who creates the onboarding plan content? -> A: BDR managers or admins create onboarding plans via the admin dashboard using a visual drip builder. Content includes links to Loom videos, written guides, quizzes, practice tasks, resource links, registration instructions, and reimbursement request info. The system delivers the content on schedule — it does not generate training content.
- Q: How long is onboarding? -> A: Configurable per plan, typically 2-4 weeks. Each plan has an ordered list of daily modules. If a BDR completes a day's module early, they wait for the next day's delivery (spaced learning).
- Q: What happens after onboarding completes? -> A: The BDR transitions to "active" status and begins receiving normal daily campaign DMs from the BDR Manager Agent (Feature 6). A graduation notification is sent to the assigned manager.
- Q: Can a BDR be onboarding and working campaigns simultaneously? -> A: Yes, in the "supervised" phase (typically week 3-4). The daily DM blends remaining onboarding modules with campaign tasks from a smaller, supervised contact list.
- Q: How are practice tasks different from real campaign tasks? -> A: Practice tasks are sandbox activities — review sample enrichments, critique email sequences, role-play call scripts. They don't touch real contacts or fire real API calls. Completion is self-reported or manager-verified.
- Q: What if a BDR falls behind? -> A: The system sends escalation alerts to the assigned manager after configurable thresholds (e.g., 2 consecutive days of incomplete modules). The manager can extend the onboarding timeline or intervene directly.
- Q: Can onboarding plans be reused across BDRs? -> A: Yes. Plans are templates. When a new BDR is enrolled, an instance of the plan is created with their specific progress tracking.
- Q: What about cloud/IT services training content? -> A: This is domain-specific content created by the agency (Loom videos, written guides about AWS services, cloud terminology, IT buyer personas). The system delivers it — content creation is outside system scope.
- Q: What about certifications and reimbursements? -> A: The system supports linking to external certification registrations (e.g., AWS Cloud Practitioner) and providing instructions on how to request reimbursement for training expenses the agency pays for. This is informational — the system surfaces links and instructions, not a financial processing system.
- Q: What does the drip builder look like? -> A: A visual timeline/calendar-style builder in the admin dashboard sidebar navigation. Managers drag-and-drop or add content items to each day, set automation triggers (daily DM, check-in prompts, reminders), and preview the full drip sequence before activating.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Drip Builder: Onboarding Plan Creation (Priority: P1)

A BDR manager uses the visual drip builder in the admin dashboard to create a reusable onboarding plan template. The drip builder presents a timeline view where each day is a row or card. The manager adds training items to each day — video links, reading materials, quizzes, practice tasks, checklists, resource links, and registration/reimbursement instructions. They can configure the plan duration, set which day the supervised campaign phase begins, preview the full drip sequence, and save it as a reusable template.

**Why this priority**: Nothing works without an onboarding plan. The drip builder is the primary tool for creating these plans and must be intuitive enough that managers can build plans without developer help.

**Independent Test**: Can be fully tested by creating a 3-week onboarding plan using the drip builder, adding all content types, previewing the drip sequence, and saving the template.

**Acceptance Scenarios**:

1. **Given** a manager navigates to the "Onboarding" section in the admin dashboard sidebar, **When** they click "Create New Plan", **Then** the drip builder opens with a blank timeline view showing configurable days (default 15 business days / 3 weeks).
2. **Given** the drip builder is open, **When** the manager clicks on a day slot (e.g., Day 1), **Then** a module editor opens where they can add training items with types: video (URL + title), reading (URL or inline text), quiz (questions + optional answers), practice_task (description + completion method), checklist (ordered items), resource_link (URL + description for registrations, tools, etc.), and reimbursement_info (instructions for requesting training expense reimbursement).
3. **Given** a module has items added, **When** the manager sets estimated completion time and saves, **Then** the day slot on the timeline shows a summary card with item count, types, and estimated time.
4. **Given** a completed plan exists, **When** the manager clicks "Preview Drip Sequence", **Then** a preview shows exactly what each daily DM will look like, in chronological order, so the manager can review the BDR experience end-to-end.
5. **Given** a plan is saved as a template, **When** the manager clicks "Duplicate Plan", **Then** a copy is created with all modules and items, ready for modification (e.g., adapting for a different client vertical).
6. **Given** a plan is in use by active enrollments, **When** the manager edits the plan, **Then** existing enrollments continue with the version they started; changes apply only to future enrollments.

---

### User Story 2 - Automation Builder: Triggers & Check-Ins (Priority: P1)

Within the drip builder, the manager configures automations that control when and how the system interacts with BDRs beyond daily module delivery. Automations include: daily check-in prompts ("How are you feeling about today's training?"), scheduled reminders for incomplete modules, end-of-week progress summaries, and conditional triggers (e.g., "If module not completed by 3 PM, send reminder"). The automation builder uses a simple rule-based interface — not a full workflow engine.

**Why this priority**: Automations are what make the system a manager replacement rather than just a content delivery tool. Without check-ins and reminders, BDRs can silently fall behind.

**Independent Test**: Can be tested by creating automations (check-in, reminder, summary) and verifying they fire at the correct times with the correct content.

**Acceptance Scenarios**:

1. **Given** a manager is editing a day in the drip builder, **When** they click "Add Automation", **Then** they can select from automation types: check_in (send a prompt and record response), reminder (send if module not completed by time X), weekly_summary (end-of-week progress recap), and custom_message (scheduled message at a specific time).
2. **Given** a check-in automation is configured for Day 3 at 2 PM, **When** 2 PM arrives on the BDR's Day 3, **Then** the BDR receives a Slack DM with the check-in prompt (e.g., "How's your training going today? Any questions?") and their response is logged and visible to the manager.
3. **Given** a reminder automation is set for "If Day 5 module not complete by 3 PM", **When** 3 PM arrives and the module is incomplete, **Then** the BDR receives a reminder DM. If the module IS complete, no reminder is sent.
4. **Given** a weekly summary automation is configured, **When** Friday end-of-day arrives, **Then** the BDR receives a summary: modules completed this week, overall progress percentage, next week's preview, and an encouraging message.
5. **Given** a custom message automation is set for Day 1 at 10 AM with content "Don't forget to register for AWS Cloud Practitioner here: [link]", **When** 10 AM on Day 1 arrives, **Then** the BDR receives that exact message.

---

### User Story 3 - BDR Enrollment & Onboarding Kickoff (Priority: P1)

When a new BDR is added to the system, a manager enrolls them in an onboarding plan. The enrollment captures the BDR's Slack user ID, assigns them a specific onboarding plan, sets a start date, and configures their daily DM delivery time. The system creates a personalized progress tracker and sends the BDR a welcome Slack DM explaining what to expect over the coming weeks.

**Why this priority**: Enrollment is the trigger that starts the entire onboarding process. Without it, no training is delivered.

**Independent Test**: Can be tested by enrolling a BDR in a plan and verifying the welcome DM is sent with accurate plan details (duration, what to expect, first module preview).

**Acceptance Scenarios**:

1. **Given** a manager selects a BDR and an onboarding plan from the dashboard, **When** they click enroll and set a start date and DM delivery time, **Then** an onboarding enrollment is created with status "active", a personalized progress record is initialized for every module in the plan, and the DM time is confirmed.
2. **Given** a BDR is enrolled, **When** the enrollment is confirmed, **Then** the BDR receives a welcome Slack DM with: the plan name, total duration, what they'll learn each week (high-level summary), their manager's name, resource links (tool registrations, reimbursement instructions), and instructions on how daily modules will be delivered.
3. **Given** a manager tries to enroll a BDR who is already in an active onboarding plan, **When** they attempt enrollment, **Then** the system warns that the BDR has an active plan and asks for confirmation to either replace it or run both concurrently.
4. **Given** a BDR's start date is in the future, **When** the enrollment is created, **Then** no DMs are sent until the start date arrives.

---

### User Story 4 - Daily Onboarding Module Delivery (Priority: P1)

Each morning at the configured time, the onboarding agent sends a Slack DM to each enrolled BDR with that day's training module. The DM contains the module title, a brief description of what they'll learn, links to all training items (videos, readings, resource links, certification registration links), any quizzes or practice tasks to complete, reimbursement instructions if applicable, and estimated time to finish. The BDR works through the module at their own pace during the day.

**Why this priority**: This is the core delivery mechanism. It replaces the manager's daily 1:1 training sessions with automated, structured content delivery.

**Independent Test**: Can be tested by enrolling a BDR in a plan and verifying the correct daily module is delivered at the configured time with all content items included.

**Acceptance Scenarios**:

1. **Given** a BDR is enrolled in an active onboarding plan, **When** the configured morning DM time arrives, **Then** the BDR receives a Slack DM with: day number and week number (e.g., "Week 1, Day 3"), module title, module description, all training items with links and types, resource links (where to register, tool access), reimbursement instructions if the day includes a paid certification, estimated completion time, and a completion action button.
2. **Given** a BDR is on Day 5 of a 15-day plan, **When** the daily DM is sent, **Then** it includes progress context: "You're 33% through your onboarding — keep it up!" with a visual progress indicator.
3. **Given** a BDR did not complete yesterday's module, **When** today's DM is sent, **Then** it includes a reminder about the incomplete module alongside today's new module, and the manager is notified if this is the second consecutive incomplete day.
4. **Given** it is a weekend day, **When** the DM scheduler runs, **Then** no onboarding DM is sent (weekdays only by default, configurable per plan).
5. **Given** a module includes a resource_link item of type "registration", **When** the DM is delivered, **Then** the link is displayed with clear instructions (e.g., "Register for AWS Cloud Practitioner here: [link]. After registering, submit your reimbursement request using the instructions below.").

---

### User Story 5 - Module Completion & Progress Tracking (Priority: P1)

BDRs mark modules as complete through Slack interactions (button clicks or message responses). The system tracks completion timestamps, maintains a running progress percentage, and provides both the BDR and their manager with visibility into onboarding progress. Quizzes are self-scored or manager-reviewed depending on configuration.

**Why this priority**: Without progress tracking, there's no accountability and no way to identify BDRs who are falling behind.

**Independent Test**: Can be tested by completing modules across multiple days and verifying progress percentages update correctly, completion timestamps are recorded, and the manager dashboard reflects accurate status.

**Acceptance Scenarios**:

1. **Given** a BDR receives a daily module DM, **When** they click the "Mark Complete" button, **Then** the module is marked complete with a timestamp, the overall progress percentage updates, and a brief confirmation message is sent.
2. **Given** a module contains a quiz, **When** the BDR submits their answers via Slack, **Then** the quiz score is recorded and the module is marked complete (pass/fail threshold is configurable per quiz).
3. **Given** a module contains a practice task marked as "manager-verified", **When** the BDR clicks "Submit for Review", **Then** the manager receives a notification to review and approve/reject the task. The module is not marked complete until the manager approves.
4. **Given** a manager opens the onboarding progress view in the admin dashboard, **When** they select a BDR, **Then** they see: overall progress percentage, per-module completion status (complete/incomplete/in-review), quiz scores, days on track vs. behind, check-in responses, and estimated completion date.
5. **Given** a BDR has completed all modules in the plan, **When** the final module is marked complete, **Then** the enrollment status changes to "pending_graduation" and the graduation review flow is triggered (manager must approve before status becomes "graduated").

---

### User Story 6 - Supervised Campaign Phase (Priority: P1)

During the later weeks of onboarding (configurable via the drip builder, typically week 3-4), the BDR transitions to a "supervised" phase where their daily DMs blend remaining onboarding content with real campaign tasks. The BDR is assigned to a campaign with a smaller contact list and their activity is flagged for manager review. This supervised phase bridges training and full-capacity work.

**Why this priority**: The transition from training to live work is the most critical and risky phase. Without a structured supervised period, BDRs either get thrown into the deep end or stay in training too long.

**Independent Test**: Can be tested by advancing a BDR to the supervised phase and verifying their daily DM contains both onboarding modules and campaign tasks, and that their campaign activity is visible to the manager with a "supervised" flag.

**Acceptance Scenarios**:

1. **Given** a BDR's onboarding plan specifies supervised phase starting at week 3, **When** the BDR reaches week 3, **Then** their status changes from "onboarding" to "supervised" and they become eligible for campaign assignment.
2. **Given** a supervised BDR is assigned to a campaign, **When** the daily DM is generated, **Then** it contains two sections: "Today's Training" (remaining onboarding modules) and "Today's Campaign Tasks" (call list and activity from assigned campaigns).
3. **Given** a supervised BDR completes a call or task, **When** the activity is logged, **Then** it is flagged as "supervised" in reporting so managers can distinguish supervised activity from independent activity.
4. **Given** a manager reviews a supervised BDR's work, **When** they view the dashboard, **Then** they see the BDR's campaign activity alongside their onboarding progress, with a clear indicator that this BDR is still in supervised mode.

---

### User Story 7 - Graduation & Transition to Active Status (Priority: P1)

When a BDR completes all onboarding modules and the manager confirms readiness, the BDR graduates from onboarding to "active" status. The system sends a graduation notification to both the BDR and the manager, updates the BDR's status across all systems, and transitions the BDR to receiving normal daily campaign DMs from the BDR Manager Agent.

**Why this priority**: Graduation is the handoff between onboarding and production work. A clean transition ensures no gap in BDR productivity.

**Independent Test**: Can be tested by completing all onboarding modules for a BDR, confirming manager approval, and verifying the BDR begins receiving standard campaign DMs instead of onboarding DMs.

**Acceptance Scenarios**:

1. **Given** a BDR has completed all onboarding modules, **When** the final module is marked complete, **Then** the manager receives a notification: "[BDR Name] has completed their onboarding plan. Review their progress and confirm graduation."
2. **Given** a manager receives a graduation notification, **When** they click "Approve Graduation", **Then** the BDR's status changes to "active", the onboarding enrollment is marked "graduated", and the BDR receives a congratulatory DM with next steps.
3. **Given** a manager receives a graduation notification, **When** they click "Extend Onboarding", **Then** they can add additional days/modules to the plan and the BDR continues receiving onboarding content.
4. **Given** a BDR is graduated, **When** the next daily DM cycle runs, **Then** the BDR receives a standard campaign task DM (from Feature 6) instead of onboarding content.
5. **Given** a BDR is graduated, **When** a manager views the team roster, **Then** the BDR shows as "active" with their graduation date and onboarding completion stats.

---

### User Story 8 - Manager Onboarding Dashboard & Alerts (Priority: P2)

Managers have a dedicated view in the admin dashboard showing all BDRs currently in onboarding, their progress, and any alerts. The system proactively notifies managers when BDRs fall behind schedule, fail quizzes, or need task reviews. Aggregate views show onboarding metrics across the team.

**Why this priority**: Visibility and alerting are important for manager oversight but not blocking for the core onboarding delivery flow.

**Independent Test**: Can be tested by enrolling multiple BDRs with varying progress levels and verifying the dashboard accurately reflects each BDR's status and alerts fire correctly.

**Acceptance Scenarios**:

1. **Given** a manager opens the onboarding section in the admin dashboard, **When** the page loads, **Then** they see a list of all BDRs in onboarding with: name, plan name, start date, current day/total days, progress percentage, status (on-track/behind/supervised), and days until expected graduation.
2. **Given** a BDR has not completed a module for 2 consecutive days, **When** the daily check runs, **Then** the manager receives a Slack DM alert: "[BDR Name] is 2 days behind on their onboarding. Current module: [module name]. Consider reaching out."
3. **Given** a BDR fails a quiz (below configured threshold), **When** the quiz score is recorded, **Then** the manager receives a notification with the quiz topic and score, and the module is flagged for re-review.
4. **Given** multiple BDRs are in onboarding, **When** the manager views the aggregate view, **Then** they see: total BDRs onboarding, average progress, average completion rate of past graduates, and common modules where BDRs struggle (lowest completion rates).
5. **Given** a BDR's onboarding is past the expected end date, **When** the daily check runs, **Then** the manager receives an escalation alert and the BDR's status is flagged as "overdue".

---

### User Story 9 - Onboarding Content Library (Priority: P2)

Managers can build and maintain a shared content library of reusable training items (videos, documents, quizzes, practice tasks, resource links, certification info) that can be assembled into onboarding plans via the drip builder. Items in the library are tagged by category (platform training, cloud fundamentals, outreach skills, tool walkthroughs, certifications, admin/HR) and can be searched and filtered when building plans.

**Why this priority**: A content library makes plan creation faster and ensures consistency, but plans can be built without it by entering content directly into the drip builder.

**Independent Test**: Can be tested by adding items to the library with tags, then building an onboarding plan by selecting items from the library and verifying they populate correctly in the drip builder modules.

**Acceptance Scenarios**:

1. **Given** a manager opens the content library from the admin dashboard sidebar, **When** they add a new item, **Then** they provide: title, type (video/reading/quiz/practice_task/checklist/resource_link/reimbursement_info), content URL or inline text, estimated completion time, and one or more category tags.
2. **Given** items exist in the library, **When** a manager is building a plan in the drip builder and adds a module, **Then** they can browse/search the library and drag items into the module instead of creating them from scratch.
3. **Given** a library item is used in multiple onboarding plans, **When** the item is updated in the library, **Then** a prompt asks whether to update it in all plans that reference it or only in the library (plans can snapshot or reference).
4. **Given** a manager searches the library, **When** they filter by category "certifications", **Then** only items tagged with that category are shown (e.g., AWS Cloud Practitioner registration link, reimbursement form instructions, study guide links).

---

### Edge Cases

- What happens when a BDR is terminated mid-onboarding? The enrollment is marked "cancelled" with the termination date. No further DMs are sent. Progress data is retained for reporting.
- What happens when a plan is modified while BDRs are enrolled? Existing enrollments continue with the plan version at enrollment time. Only new enrollments use the updated plan.
- What if a BDR completes modules out of order (e.g., marks Day 3 complete before Day 2)? Each module is independently completable. The system tracks which modules are complete regardless of order, but the daily DM always delivers the next scheduled module in sequence.
- What if the Slack DM fails to deliver (BDR's Slack account is deactivated)? The system logs the delivery failure and alerts the manager. The module is still marked as "delivered" with a failure flag.
- What happens if a BDR has no campaigns to assign during the supervised phase? The supervised phase proceeds with onboarding content only. Campaign tasks appear in the DM once a campaign is assigned. The manager is reminded to assign a campaign.
- How does the system handle BDRs in different timezones? DM delivery time is configurable per enrollment. The timezone is set at enrollment and used for all scheduling.
- What if a BDR requests to skip ahead in the plan? Only managers can modify the onboarding schedule. A BDR can complete today's module early but the next module is delivered on the next business day (spaced learning principle).
- What happens when a quiz has no correct answers defined? All quizzes without defined answers are treated as "self-scored" — the BDR marks it complete and the response is logged for manager review.
- What if an automation fires but the BDR has already completed the relevant module? Reminders are suppressed if the target module is already complete. Check-ins and custom messages always fire regardless.
- What happens when a certification link expires or changes? Resource links are stored as URLs. Managers are responsible for updating links. The content library shows "last updated" timestamps to help identify stale content.

## Requirements _(mandatory)_

### Functional Requirements

**Drip Builder & Plan Management**
- **FR-001**: System MUST provide a visual drip builder in the admin dashboard for creating onboarding plan templates, displaying a timeline view with each business day as an editable slot.
- **FR-002**: System MUST support organizing plans into weeks and days, with each day containing one or more training modules.
- **FR-003**: System MUST support seven training item types within modules: video (external URL), reading (external URL or inline text), quiz (questions with optional correct answers), practice_task (description with self-report or manager-verified completion), checklist (ordered list of items to check off), resource_link (URL + description for tool registrations, platform access, etc.), and reimbursement_info (instructions and links for requesting training expense reimbursement).
- **FR-004**: System MUST support plan versioning — existing enrollments use the plan version at enrollment time; edits create a new version for future enrollments.
- **FR-005**: System MUST support duplicating plans to create variations.
- **FR-006**: System MUST provide a preview mode showing exactly what each daily DM will look like before the plan is activated.
- **FR-007**: System MUST support configuring the supervised phase start day within the drip builder (e.g., "Supervised mode begins Day 11").

**Automation Builder**
- **FR-008**: System MUST support configuring automations within the drip builder for each day: check_in (send a prompt at a scheduled time, record BDR response), reminder (send if module not completed by a specified time), weekly_summary (end-of-week progress recap), and custom_message (scheduled message with custom content at a specified time).
- **FR-009**: System MUST suppress reminder automations if the target module is already completed.
- **FR-010**: System MUST log all check-in responses and make them visible to the manager on the onboarding dashboard.

**Enrollment & Lifecycle**
- **FR-011**: System MUST support enrolling a BDR (identified by Slack user ID) in an onboarding plan with a configurable start date, daily DM delivery time, and timezone.
- **FR-012**: System MUST enforce enrollment lifecycle states: active -> supervised -> graduated (happy path), with branches to: extended, cancelled.
- **FR-013**: System MUST prevent duplicate active enrollments unless the manager explicitly overrides.
- **FR-014**: System MUST send a welcome Slack DM to the BDR upon enrollment with plan overview, duration, resource links, reimbursement instructions, and first-day preview.

**Daily Module Delivery**
- **FR-015**: System MUST send a daily Slack DM to each actively enrolled BDR at their configured delivery time containing the current day's training module.
- **FR-016**: System MUST include in each daily DM: day/week number, module title, all training items with links and types, resource links, reimbursement info (if applicable), estimated time, progress percentage, and a completion action.
- **FR-017**: System MUST deliver modules on business days only (Monday-Friday by default, configurable per plan).
- **FR-018**: System MUST include a reminder for incomplete previous modules in the daily DM if the prior day's module was not completed.

**Progress Tracking**
- **FR-019**: System MUST track per-module completion status (pending/in_progress/completed/skipped) with timestamps.
- **FR-020**: System MUST calculate and display real-time progress percentage (completed modules / total modules).
- **FR-021**: System MUST support module completion via Slack button interaction ("Mark Complete").
- **FR-022**: System MUST support manager-verified completion for practice tasks — the task is submitted by the BDR and approved/rejected by the manager via Slack or dashboard.
- **FR-023**: System MUST record quiz responses and scores when quizzes have defined correct answers.

**Supervised Phase**
- **FR-024**: System MUST transition BDRs to supervised status at the configured day in the onboarding plan.
- **FR-025**: System MUST blend onboarding module content with campaign task content in the daily DM during the supervised phase.
- **FR-026**: System MUST flag all campaign activity by supervised BDRs as "supervised" in activity reporting.

**Graduation**
- **FR-027**: System MUST trigger a graduation review notification to the manager when all modules are completed.
- **FR-028**: System MUST support manager actions on graduation: approve (graduate to active), extend (add more days), or reject (with reason and additional modules).
- **FR-029**: System MUST transition graduated BDRs to receiving standard campaign DMs from the BDR Manager Agent.
- **FR-030**: System MUST send a graduation confirmation DM to the BDR upon manager approval.

**Manager Alerts & Visibility**
- **FR-031**: System MUST alert the manager via Slack DM when a BDR has incomplete modules for a configurable number of consecutive days (default: 2).
- **FR-032**: System MUST alert the manager when a BDR fails a quiz below the configured passing threshold.
- **FR-033**: System MUST alert the manager when a BDR's onboarding exceeds the expected end date.
- **FR-034**: System MUST provide an onboarding dashboard view in the admin dashboard sidebar showing all enrolled BDRs with progress, status, alerts, and check-in responses.

**Content Library**
- **FR-035**: System MUST support a shared content library where training items can be stored, tagged by category, and reused across multiple onboarding plans.
- **FR-036**: System MUST support searching and filtering library items by type and category when building plans in the drip builder.

### Key Entities

- **OnboardingPlan**: A reusable template defining the structure of a BDR onboarding program. Contains a name, description, duration (business days), supervised phase start day, and an ordered list of daily modules. Plans are versioned — edits create new versions.
- **OnboardingModule**: A single day's training content within a plan. Has a day number, week number, title, description, estimated completion time, and an ordered list of training items. Also contains automation configurations (check-ins, reminders, custom messages) for that day.
- **TrainingItem**: An individual piece of training content within a module. Has a type (video, reading, quiz, practice_task, checklist, resource_link, reimbursement_info), title, content (URL or inline text), estimated time, and optional metadata (quiz answers, verification requirements, category tags).
- **OnboardingAutomation**: A scheduled action attached to a module/day. Has a type (check_in, reminder, weekly_summary, custom_message), trigger time, content/prompt text, and conditions (e.g., "only fire if module incomplete").
- **OnboardingEnrollment**: An instance of a BDR going through an onboarding plan. Links a BDR (Slack user ID) to a specific plan version, with a start date, DM delivery time, timezone, current status (active/supervised/graduated/extended/cancelled), and assigned manager.
- **ModuleProgress**: Per-module completion tracking for an enrolled BDR. Records completion status (pending/in_progress/completed/skipped), completion timestamp, quiz scores, practice task submissions, check-in responses, and manager review status.
- **ContentLibraryItem**: A reusable training content item stored in the shared library. Has a type, title, content, estimated time, category tags (platform training, cloud fundamentals, outreach skills, tool walkthroughs, certifications, admin/HR), and usage count across plans.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A new BDR can be enrolled in an onboarding plan and receive their first daily module within 5 minutes of enrollment.
- **SC-002**: Daily onboarding DMs are delivered within a 5-minute window of the configured delivery time.
- **SC-003**: Managers can create a complete 3-week onboarding plan (15 daily modules with automations) in under 30 minutes using the drip builder.
- **SC-004**: Manager time spent on 1:1 onboarding training is reduced by 80% compared to pre-system baseline.
- **SC-005**: 90% of BDRs complete their onboarding plan within the expected duration (not extended or cancelled).
- **SC-006**: Manager alerts for behind-schedule BDRs are delivered within 1 hour of the threshold being crossed.
- **SC-007**: The system can support 20 concurrent onboarding enrollments without degradation.
- **SC-008**: BDR time-to-productivity (days from hire to first independently managed campaign) decreases by 40% compared to manual onboarding.
- **SC-009**: Onboarding completion data (progress, quiz scores, check-in responses, graduation dates) is available for reporting for at least 12 months.
- **SC-010**: A BDR transitioning from supervised to active status experiences zero gap in daily DM delivery — the handoff is seamless.

## Assumptions

- The BDR Manager Agent (Feature 6) is built or being built concurrently. The graduation handoff (US7) requires Feature 6's daily campaign DM system to be operational.
- Training content (Loom videos, written guides, quizzes) is created by the agency outside of this system. The system delivers content — it does not generate training content.
- BDRs have active Slack accounts and are reachable via DM. The system does not handle alternative delivery channels (email, SMS).
- Business days are Monday-Friday. Holiday schedules are not supported in initial scope.
- Quizzes are lightweight knowledge checks (multiple choice or short answer), not formal assessments. Complex testing or certification is out of scope.
- The admin dashboard (Feature 3) is available for the drip builder, automation builder, and progress dashboard UI extensions.
- One manager can oversee multiple BDR onboardings simultaneously. The system handles the delivery and tracking — the manager intervenes only when alerted.
- Onboarding plans are workspace-scoped. Different workspaces (clients) can have different onboarding plans.
- Certification registrations and reimbursement processes are external. The system provides links and instructions only — it does not process payments or manage certification status.
- The drip builder is a web-based UI component in the admin dashboard. It does not require a separate application.

## Dependencies

- BDR Manager Agent (Feature 6) — graduation handoff to campaign DMs, supervised phase campaign assignment
- Existing Slack bot infrastructure (Socket Mode, BullMQ, Prisma, ECS)
- Existing admin dashboard (React/Vite) for drip builder, automation builder, and progress dashboard
- Slack API (DM delivery, interactive messages with buttons/actions)
- Content hosting (Loom, Google Docs, or similar — external to this system)
