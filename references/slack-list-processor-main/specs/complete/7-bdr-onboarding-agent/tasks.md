# Tasks: BDR Onboarding Agent

**Input**: Design documents from `/specs/7-bdr-onboarding-agent/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not explicitly requested — test tasks omitted.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Database models, enums, migration, and shared service scaffolding

- [x] T001 Add OnboardingPlan, OnboardingModule, TrainingItem, OnboardingAutomation, OnboardingEnrollment, ModuleProgress (including deliveryFailed Boolean and deliveryError String? fields), CheckinResponse, and ContentLibraryItem models with enums (TrainingItemType, AutomationType, EnrollmentStatus, ModuleStatus, ReviewStatus) to prisma/schema.prisma per data-model.md
- [x] T002 Generate and apply Prisma migration for onboarding models by running `npx prisma migrate dev --name bdr_onboarding_agent`
- [x] T003 Create onboarding BullMQ queue (`onboarding`) with connection config in src/services/queue/queues.ts — no repeatable jobs yet (schedulers created per enrollment)
- [x] T004 Create onboarding worker skeleton with job-name-based routing (pattern: campaignDispatcher.ts) in src/services/queue/workers/onboardingWorker.ts — register processors for `onboarding-daily-dm`, `onboarding-automation`, `onboarding-daily-check`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core services that multiple user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 [P] Create planService.ts in src/services/onboarding/planService.ts with CRUD functions: createPlan (accepts full plan with modules/items/automations, creates all nested records in a transaction), getPlan (includes modules, items, automations), listPlans (filter by teamId, latestOnly), updatePlan (version-aware: if active enrollments exist, create new version with incremented version number and isLatest=true, set old version isLatest=false), deletePlan (soft-delete: check no active enrollments), duplicatePlan (deep copy all modules/items/automations with new UUID)
- [x] T006 [P] Create moduleService.ts in src/services/onboarding/moduleService.ts with functions: getModulesForPlan (ordered by dayNumber), createModule (with training items and automations), updateModule, deleteModule, reorderModules
- [x] T007 [P] Create enrollmentService.ts in src/services/onboarding/enrollmentService.ts with functions: enrollBdr (create enrollment + N ModuleProgress records in transaction, create BullMQ job scheduler per research.md R1, send welcome DM), getEnrollment (with module progress), listEnrollments (filter by teamId/status), updateEnrollment (delivery hour/timezone — upsert job scheduler), cancelEnrollment (set status CANCELLED, remove job scheduler), getEnrollmentBySlackUser (for action handlers)
- [x] T008 [P] Create progressService.ts in src/services/onboarding/progressService.ts with functions: markModuleComplete (update status/timestamp, recalculate progress %, check if all modules done → trigger graduation review), submitQuizAnswers (score against metadata answers, record score, mark complete if passed; if score < passing threshold, immediately send manager alert via slackBlocks.buildAlertDm with quiz topic and score — FR-032), submitPracticeTask (set review status PENDING_REVIEW), approvePracticeTask (manager action, mark complete), rejectPracticeTask (manager action, keep IN_PROGRESS), getProgressSummary (completed/total/percentage), checkConsecutiveIncomplete (for alert logic)
- [x] T009 [P] Create Slack Block Kit message builder utility in src/services/onboarding/slackBlocks.ts with functions: buildDailyModuleDm (header with week/day, progress bar, training items with links by type, quiz with radio buttons if QUIZ type, "Mark Complete" button, incomplete reminder section), buildWelcomeDm (plan overview, duration, weekly summary, resource links, first day preview), buildGraduationNotification (for manager: approve/extend/reject buttons — FR-028), buildGraduationDm (for BDR: congratulations + next steps), buildAlertDm (behind schedule / quiz failed / overdue), buildCheckinPrompt (prompt text + response button that opens modal), buildWeeklySummary (modules completed this week, overall progress, next week preview), buildReminderDm (incomplete module reminder)

**Checkpoint**: Foundation ready — user story implementation can begin

---

## Phase 3: User Story 1 — Drip Builder: Onboarding Plan Creation (Priority: P1) MVP

**Goal**: Managers create reusable onboarding plan templates with the visual drip builder in the admin dashboard

**Independent Test**: Create a 3-week plan using the drip builder, add all content types to modules, preview the drip sequence, save and duplicate the template

### Implementation

- [x] T010 [US1] Create admin API routes for onboarding plans in src/routes/admin/onboardingPlans.ts — GET / (list), GET /:planId (detail with modules/items/automations), POST / (create), PUT /:planId (update with versioning), DELETE /:planId (soft delete), POST /:planId/duplicate, GET /:planId/preview (render Block Kit preview) — all per contracts/onboarding-plans.md
- [x] T011 [US1] Mount onboarding plan routes in src/routes/admin/index.ts — add `import { onboardingPlansRouter } from './onboardingPlans.js'` and `adminRouter.use('/onboarding-plans', onboardingPlansRouter)`
- [x] T012 [P] [US1] Create frontend API client for onboarding plans in admin-dashboard/src/services/onboarding-plans.ts — functions matching all plan endpoints (list, get, create, update, delete, duplicate, preview) using existing API client pattern
- [x] T013 [P] [US1] Add onboarding query keys to admin-dashboard/src/lib/query-keys.ts — add keys for onboardingPlans, onboardingPlan, onboardingPlanPreview
- [x] T014 [P] [US1] Add onboarding TypeScript types to admin-dashboard/src/types/api.ts — OnboardingPlan, OnboardingModule, TrainingItem, OnboardingAutomation, TrainingItemType enum, AutomationType enum, and API response shapes
- [x] T015 [US1] Create onboarding plans list page in admin-dashboard/src/pages/onboarding-plans.tsx — table with columns: name, duration, modules, active enrollments, version, actions (edit, duplicate, delete). "Create New Plan" button. Filter by workspace
- [x] T016 [US1] Create drip builder / plan detail page in admin-dashboard/src/pages/onboarding-plan-detail.tsx — left panel: vertical timeline of days (Day 1 through Day N) with summary cards showing item count/types/estimated time. Right panel: module editor when a day is selected — add/edit/remove training items (type selector, title, content/URL, metadata fields per type), add/remove automations (type, trigger time, content, conditions), estimated time. Plan settings: name, description, duration (adjustable — adds/removes days), supervised start day, weekdays only toggle. Save and Preview buttons
- [x] T017 [US1] Add onboarding plan routes to admin-dashboard/src/router.tsx — `/onboarding-plans` for list page, `/onboarding-plans/new` and `/onboarding-plans/:planId` for detail/editor page
- [x] T018 [US1] Add "Onboarding" section to admin-dashboard/src/components/layout/AppSidebar.tsx — under existing sidebar sections, add collapsible "Onboarding" group with links: Plans, Enrollments, Progress, Content Library

**Checkpoint**: Plan creation and editing fully functional via drip builder

---

## Phase 4: User Story 2 — Automation Builder: Triggers & Check-Ins (Priority: P1)

**Goal**: Managers configure automations (check-ins, reminders, weekly summaries, custom messages) within the drip builder

**Independent Test**: Create automations for a plan and verify they display correctly in the drip builder; automation execution tested in US4

**Dependencies**: US1 (drip builder must exist)

### Implementation

- [x] T019 [US2] Create automationService.ts in src/services/onboarding/automationService.ts — functions: scheduleAutomationsForDay (called by daily delivery worker — calculates delays from current time to each automation's triggerTime, creates BullMQ delayed jobs), processCheckin (send check-in DM, open modal for response), processReminder (check if module is still incomplete, send reminder if so, suppress if complete), processWeeklySummary (calculate week stats, send summary DM), processCustomMessage (send custom content DM), cancelDayAutomations (remove pending delayed jobs for a day)
- [x] T020 [US2] Add automation processing logic to onboarding worker in src/services/queue/workers/onboardingWorker.ts — register processor for `onboarding-automation` job name, route to automationService functions based on automation type in job data
- [x] T021 [US2] Create Slack action listener for check-in response button in src/listeners/actions/onboardingCheckin.ts — action_id `onboarding_open_checkin`: open modal with text input for response. View submission callback_id `onboarding_checkin_submit`: save CheckinResponse to database, update original message to show response recorded
- [x] T022 [US2] Register check-in action listener in src/app.ts — import and register onboardingCheckin action and view handlers

**Checkpoint**: Automations configurable in drip builder, execution infrastructure ready

---

## Phase 5: User Story 3 — BDR Enrollment & Onboarding Kickoff (Priority: P1)

**Goal**: Managers enroll BDRs in onboarding plans, triggering welcome DMs and scheduling

**Independent Test**: Enroll a BDR in a plan, verify welcome DM is sent with plan details, verify BullMQ scheduler is created

### Implementation

- [x] T023 [US3] Create admin API routes for enrollments in src/routes/admin/onboardingEnrollments.ts — GET / (list with progress summary), GET /:enrollmentId (detail with module progress), POST / (enroll — calls enrollmentService.enrollBdr), PUT /:enrollmentId (update delivery settings), POST /:enrollmentId/cancel, POST /:enrollmentId/graduate, POST /:enrollmentId/extend — all per contracts/onboarding-enrollments.md
- [x] T024 [US3] Mount enrollment routes in src/routes/admin/index.ts — add `import { onboardingEnrollmentsRouter } from './onboardingEnrollments.js'` and `adminRouter.use('/onboarding-enrollments', onboardingEnrollmentsRouter)`
- [x] T025 [P] [US3] Create frontend API client for enrollments in admin-dashboard/src/services/onboarding-enrollments.ts — functions: list, get, enroll, update, cancel, graduate, extend
- [x] T026 [P] [US3] Add enrollment TypeScript types to admin-dashboard/src/types/api.ts — OnboardingEnrollment, EnrollmentStatus enum, EnrollmentSummary, ModuleProgress types
- [x] T027 [US3] Create enrollments list/management page in admin-dashboard/src/pages/onboarding-enrollments.tsx — table: BDR name, plan name, start date, current day/total, progress %, status, manager, actions (view, cancel). "Enroll BDR" button opens form: select BDR (from workspace BDRs), select plan, start date, delivery hour, timezone. Summary stats at top: total active/supervised/pending/graduated
- [x] T028 [US3] Add enrollment page route to admin-dashboard/src/router.tsx — `/onboarding-enrollments` for list, `/onboarding-enrollments/:enrollmentId` for detail
- [x] T029 [US3] Implement welcome DM sending in enrollmentService.enrollBdr — after creating enrollment and ModuleProgress records, call slackBlocks.buildWelcomeDm and send via slackClient.chat.postMessage to BDR's Slack user ID. Include: plan name, duration, weekly overview, resource links from first module, manager name, delivery time info

**Checkpoint**: BDR enrollment functional, welcome DMs delivered, schedulers active

---

## Phase 6: User Story 4 — Daily Onboarding Module Delivery (Priority: P1)

**Goal**: System sends daily Slack DMs with training content at the BDR's configured time

**Independent Test**: Enroll a BDR, wait for delivery time, verify correct module DM is sent with all content items, progress indicator, and completion button

### Implementation

- [x] T030 [US4] Create deliveryService.ts in src/services/onboarding/deliveryService.ts — function: deliverDailyModule(enrollmentId) — 1) load enrollment with plan modules and progress, 2) determine current day based on start date and business day calculation (skip weekends if weekdaysOnly), 3) get module for current day, 4) check if previous day's module is incomplete (include reminder), 5) build Block Kit DM via slackBlocks.buildDailyModuleDm, 6) send DM to BDR, 7) update ModuleProgress: status=DELIVERED, deliveredAt=now, store message timestamp, 8) update enrollment currentDay, 9) schedule day's automations via automationService.scheduleAutomationsForDay, 10) check consecutive incomplete threshold → send manager alert if exceeded, 11) check if enrollment has reached supervisedStartDay → transition status to SUPERVISED
- [x] T031 [US4] Add daily delivery processor to onboarding worker in src/services/queue/workers/onboardingWorker.ts — register processor for `onboarding-daily-dm` job name, calls deliveryService.deliverDailyModule(job.data.enrollmentId). Include error handling: log delivery failures, alert manager if DM fails to send
- [x] T032 [US4] Add daily check processor to onboarding worker — register processor for `onboarding-daily-check` job name, runs daily across all active enrollments: check for overdue enrollments (past expected end date), check for consecutive incomplete modules, send alerts to managers. Register as repeatable job in queues.ts: cron `0 18 * * 1-5` (6 PM UTC weekdays)
- [x] T033 [US4] Implement business day calculation utility in src/services/onboarding/businessDays.ts — functions: calculateCurrentBusinessDay(startDate, today) returns day number skipping weekends, calculateExpectedEndDate(startDate, durationDays) returns the date after N business days, isBusinessDay(date) returns boolean, getNextBusinessDay(date) returns next weekday

**Checkpoint**: Daily module delivery operational, BDRs receive training content on schedule

---

## Phase 7: User Story 5 — Module Completion & Progress Tracking (Priority: P1)

**Goal**: BDRs mark modules complete via Slack, system tracks progress and quiz scores

**Independent Test**: Complete modules across multiple days, verify progress percentages, quiz scoring, manager-verified tasks

### Implementation

- [x] T034 [US5] Create Slack action listener for "Mark Complete" button in src/listeners/actions/onboardingComplete.ts — action_id `onboarding_mark_complete`: parse enrollment ID and day number from action value, call progressService.markModuleComplete, update original DM via chat.update to show completed state with checkmark, send brief confirmation message with updated progress %
- [x] T035 [US5] Create Slack action listener for quiz submission in src/listeners/actions/onboardingQuiz.ts — action_id `onboarding_quiz_submit`: collect selected radio button answer from state.values, call progressService.submitQuizAnswers, update message with score feedback (correct/incorrect per question), mark module complete if passed. If quiz fails (below threshold), progressService sends immediate manager alert (FR-032)
- [x] T036 [US5] Create Slack action listener for practice task submission in src/listeners/actions/onboardingComplete.ts — action_id `onboarding_practice_submit`: open modal with text input for submission, view callback `onboarding_practice_submission`: call progressService.submitPracticeTask, notify manager with approve/reject buttons
- [x] T037 [US5] Create Slack action listener for manager practice task review in src/listeners/actions/onboardingComplete.ts — action_ids `onboarding_practice_approve` and `onboarding_practice_reject`: call progressService.approvePracticeTask or rejectPracticeTask, notify BDR of result, update manager's message
- [x] T038 [US5] Register all onboarding action listeners in src/app.ts — import and register onboardingComplete (mark complete, practice submit/approve/reject), onboardingQuiz (quiz submit), ensure all action_ids are unique
- [x] T039 [P] [US5] Create admin API route for progress dashboard in src/routes/admin/onboardingProgress.ts — GET /dashboard (aggregate stats per contracts/onboarding-progress.md), GET /:enrollmentId/checkins (list check-in responses)
- [x] T040 [US5] Mount progress routes in src/routes/admin/index.ts — add `import { onboardingProgressRouter } from './onboardingProgress.js'` and `adminRouter.use('/onboarding-progress', onboardingProgressRouter)`
- [x] T041 [P] [US5] Create frontend API client for progress in admin-dashboard/src/services/onboarding-progress.ts — functions: getDashboard, getCheckins
- [x] T042 [US5] Create progress dashboard page in admin-dashboard/src/pages/onboarding-progress.tsx — top: aggregate stats (active, supervised, pending graduation, avg progress). Table: BDR list with progress bars, status badges, days behind indicator. Click BDR → expand to show per-module status (complete/incomplete/in-review), quiz scores, check-in responses, estimated completion date. Alerts section: behind schedule, overdue, quiz failed
- [x] T043 [US5] Add progress page route to admin-dashboard/src/router.tsx — `/onboarding-progress`

**Checkpoint**: Full progress tracking operational, BDRs complete modules via Slack, managers see real-time progress

---

## Phase 8: User Story 6 — Supervised Campaign Phase (Priority: P1)

**Goal**: BDRs transition to supervised status where daily DMs blend onboarding content with campaign tasks

**Independent Test**: Advance a BDR to supervised phase, verify blended DMs with "Today's Training" and "Today's Campaign Tasks" sections

**Dependencies**: US4 (daily delivery must exist), Feature 6 campaign system (existing)

### Implementation

- [x] T044 [US6] Extend deliveryService.ts in src/services/onboarding/deliveryService.ts — in deliverDailyModule, after status transition to SUPERVISED: query assigned campaign tasks via existing campaignService, build blended DM with two sections: "Today's Training" (onboarding module) and "Today's Campaign Tasks" (call list and activity from supervised campaign). Use slackBlocks to build combined message
- [x] T045 [US6] Extend slackBlocks.ts in src/services/onboarding/slackBlocks.ts — add buildSupervisedDm function: combines onboarding module blocks with campaign task blocks (call list, email queue, LinkedIn queue). Include "Supervised" badge in header context
- [x] T046 [US6] Add supervised campaign assignment field to enrollment update endpoint in src/routes/admin/onboardingEnrollments.ts — PUT /:enrollmentId should accept `supervised_campaign_id` to assign a campaign for the supervised phase
- [x] T047 [US6] Extend enrollment management page in admin-dashboard/src/pages/onboarding-enrollments.tsx — when enrollment status is SUPERVISED or nearing supervised start day, show campaign assignment dropdown to link a campaign. Display supervised campaign name in enrollment detail view
- [x] T047B [US6] Flag supervised BDR activity in campaign reporting — extend DailyBdrActivity model or reporting queries to include a `supervised` boolean flag. When a supervised BDR's campaign activity is logged, set the flag to true so managers can distinguish supervised activity from independent activity (FR-026)

**Checkpoint**: Supervised phase transitions automatically, blended DMs work

---

## Phase 9: User Story 7 — Graduation & Transition to Active Status (Priority: P1)

**Goal**: Completed BDRs graduate and transition to receiving standard campaign DMs from Feature 6

**Independent Test**: Complete all modules, verify manager receives graduation notification, approve graduation, verify BDR receives graduation DM and stops receiving onboarding DMs

**Dependencies**: US5 (module completion triggers graduation), Feature 6 (handoff target)

### Implementation

- [x] T048 [US7] Create graduationService.ts in src/services/onboarding/graduationService.ts — functions: triggerGraduationReview (called when all modules complete — send manager notification with approve/extend/reject buttons via slackBlocks.buildGraduationNotification), approveGraduation (update enrollment status to GRADUATED, set graduatedAt, remove BullMQ job scheduler, send graduation DM to BDR via slackBlocks.buildGraduationDm, log audit event), extendOnboarding (add additional days to plan, create new ModuleProgress records for extension days, reset status to ACTIVE or SUPERVISED, update job scheduler), rejectGraduation (manager provides reason and selects additional modules — reset status to ACTIVE, notify BDR with feedback and additional requirements — FR-028)
- [x] T049 [US7] Create Slack action listener for graduation review in src/listeners/actions/graduationReview.ts — action_ids: `onboarding_graduation_approve` (call graduationService.approveGraduation), `onboarding_graduation_extend` (open modal asking for additional days + reason, then call graduationService.extendOnboarding), `onboarding_graduation_reject` (open modal asking for reason + additional modules, then call graduationService.rejectGraduation — FR-028). Update manager's message to show result
- [x] T050 [US7] Register graduation action listener in src/app.ts — import and register graduationReview action handlers
- [x] T051 [US7] Wire graduation trigger in progressService.markModuleComplete in src/services/onboarding/progressService.ts — after marking complete, check if all ModuleProgress records for enrollment are COMPLETED → if yes, update enrollment status to PENDING_GRADUATION, call graduationService.triggerGraduationReview

**Checkpoint**: Full onboarding lifecycle complete — enrollment through graduation to Feature 6 handoff

---

## Phase 10: User Story 8 — Manager Onboarding Dashboard & Alerts (Priority: P2)

**Goal**: Managers see aggregate onboarding metrics and receive proactive alerts

**Independent Test**: Enroll multiple BDRs with varying progress, verify dashboard shows correct stats and alerts fire for behind-schedule and overdue BDRs

**Dependencies**: US3 (enrollments exist), US5 (progress data exists)

### Implementation

- [x] T052 [US8] Extend daily check processor in src/services/queue/workers/onboardingWorker.ts — in `onboarding-daily-check` processor: iterate all active/supervised enrollments, for each: check consecutive incomplete count (call progressService.checkConsecutiveIncomplete, default threshold 2), check if past expected end date, check quiz failures below threshold. For each alert condition met, send manager DM via slackBlocks.buildAlertDm
- [x] T053 [US8] Extend onboarding progress dashboard API in src/routes/admin/onboardingProgress.ts — enhance GET /dashboard to include: common struggle modules (lowest completion rates), recent graduates list, overdue enrollments, active alert count
- [x] T054 [US8] Enhance progress dashboard page in admin-dashboard/src/pages/onboarding-progress.tsx — add tabs: Overview (aggregate stats), Alerts (active alerts with BDR name, type, action links), Graduates (history), Analytics (common struggle modules, avg graduation time). Add alert badge count in sidebar nav

**Checkpoint**: Proactive manager visibility and alerting operational

---

## Phase 11: User Story 9 — Onboarding Content Library (Priority: P2)

**Goal**: Managers maintain a shared library of reusable training items that can be assembled into plans

**Independent Test**: Add items to library with tags, build a plan by selecting items from library, verify items populate correctly in modules

**Dependencies**: US1 (drip builder must exist for library integration)

### Implementation

- [x] T055 [P] [US9] Create contentLibraryService.ts in src/services/onboarding/contentLibraryService.ts — functions: createItem, updateItem, deleteItem (check usage in active plans), listItems (filter by teamId, type, category tag, search by title), getCategories (aggregate distinct tags with counts), incrementUsageCount (called when item added to a plan), decrementUsageCount (called when item removed from a plan)
- [x] T056 [US9] Create admin API routes for content library in src/routes/admin/contentLibrary.ts — GET / (list with filters), POST / (create), PUT /:itemId (update with usage warning), DELETE /:itemId (check active plan usage), GET /categories — all per contracts/content-library.md
- [x] T057 [US9] Mount content library routes in src/routes/admin/index.ts — add `import { contentLibraryRouter } from './contentLibrary.js'` and `adminRouter.use('/content-library', contentLibraryRouter)`
- [x] T058 [P] [US9] Create frontend API client for content library in admin-dashboard/src/services/content-library.ts — functions: list, create, update, delete, getCategories
- [x] T059 [US9] Create content library management page in admin-dashboard/src/pages/content-library.tsx — table: title, type badge, categories as tags, estimated time, usage count, last updated, actions (edit, delete). "Add Item" form: type selector, title, content URL/text, metadata fields by type, category tag multi-select, estimated time. Filter bar: search, type dropdown, category dropdown
- [x] T060 [US9] Add content library page route to admin-dashboard/src/router.tsx — `/content-library`
- [x] T061 [US9] Integrate content library into drip builder in admin-dashboard/src/pages/onboarding-plan-detail.tsx — when adding a training item to a module, show "Add from Library" button that opens a modal with searchable/filterable library items. Selecting an item populates the training item fields and sets libraryItemId reference

**Checkpoint**: Content library fully operational with drip builder integration

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Integration, audit logging, and infrastructure finalization

- [x] T062 Add audit logging for all onboarding operations in src/services/onboarding/ — use existing auditLogger.log() for: plan create/update/delete/duplicate, enrollment create/cancel/graduate/extend, module completion, quiz submission, practice task review, automation fires. Note: onboarding data (progress, quiz scores, check-in responses, graduation dates) must be retained for at least 12 months per SC-009 — ensure no auto-purge is applied to onboarding tables (aligns with existing permanent job history pattern)
- [x] T063 [P] Create BDR-facing onboarding routes in src/routes/bdr/onboarding.ts — POST /complete (mark module complete), POST /quiz (submit quiz), POST /practice-submit (submit practice task) — protected by bdrAuth middleware, per contracts/onboarding-progress.md BDR-facing endpoints
- [x] T064 Mount BDR onboarding routes in src/routes/bdr/index.ts — add `import { onboardingBdrRouter } from './onboarding.js'` and `bdrRouter.use('/onboarding', onboardingBdrRouter)`
- [x] T065 [P] Add onboarding query keys for enrollments, progress, and content library to admin-dashboard/src/lib/query-keys.ts
- [x] T066 Register onboarding worker startup in src/app.ts — import onboardingWorker, ensure it starts alongside existing workers (campaignDispatcher, etc.)
- [x] T067 [P] Add TypeScript types for all remaining onboarding entities to admin-dashboard/src/types/api.ts — CheckinResponse, ContentLibraryItem, ModuleStatus, ReviewStatus, dashboard/alert response shapes
- [x] T068 Sync all active enrollment job schedulers on app startup in src/services/queue/queues.ts — after queue creation, query all enrollments with status ACTIVE or SUPERVISED, upsert BullMQ job scheduler for each to ensure schedules survive ECS task restarts
- [x] T069 Verify TypeScript compilation passes with `npx tsc --noEmit`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (models must exist in DB)
- **US1 (Phase 3)**: Depends on Phase 2 — MVP target
- **US2 (Phase 4)**: Depends on US1 (automations configured within drip builder)
- **US3 (Phase 5)**: Depends on Phase 2 (enrollment service is foundational but enrollment UI needs plan list from US1)
- **US4 (Phase 6)**: Depends on US2 + US3 (delivery uses automations, requires enrollments)
- **US5 (Phase 7)**: Depends on US4 (completion requires delivered modules)
- **US6 (Phase 8)**: Depends on US4 (supervised is part of delivery flow)
- **US7 (Phase 9)**: Depends on US5 (graduation triggered by completion)
- **US8 (Phase 10)**: Depends on US3 + US5 (alerts need enrollments and progress data)
- **US9 (Phase 11)**: Depends on US1 (library integrates into drip builder)
- **Polish (Phase 12)**: Depends on all user stories complete

### User Story Dependencies

```
Phase 1 → Phase 2 → US1 (Plan CRUD + Drip Builder)
                       ├→ US2 (Automation Builder) → US4 (Daily Delivery)
                       │                               ├→ US5 (Completion) → US7 (Graduation)
                       │                               └→ US6 (Supervised Phase)
                       ├→ US3 (Enrollment) ─────────────┘
                       ├→ US9 (Content Library)
                       └→ US8 (Dashboard & Alerts) ← US3 + US5
```

### Parallel Opportunities

- **Phase 2**: T005, T006, T007, T008, T009 can all run in parallel (different files)
- **US1**: T012, T013, T014 can run in parallel (frontend files, no backend dependency)
- **US3**: T025, T026 can run in parallel
- **US5**: T039, T041 can run in parallel
- **US9**: T055, T058 can run in parallel
- **Phase 12**: T062, T063, T065, T067 can run in parallel

---

## Implementation Strategy

### MVP First (User Stories 1-5)

1. Complete Phase 1: Setup (database models + migration)
2. Complete Phase 2: Foundational services
3. Complete US1: Drip builder — managers can create plans
4. Complete US2: Automation builder — automations configured in plans
5. Complete US3: Enrollment — BDRs can be enrolled
6. Complete US4: Daily delivery — BDRs receive daily DMs
7. Complete US5: Completion tracking — progress visible
8. **STOP and VALIDATE**: Full onboarding flow works end-to-end
9. Deploy to ECS via `./infra/deploy.sh --update`

### Incremental Delivery (After MVP)

10. Add US6: Supervised phase — blended DMs
11. Add US7: Graduation — handoff to Feature 6
12. Add US8: Manager dashboard — alerts and analytics
13. Add US9: Content library — reusable training items
14. Polish phase — audit logging, startup sync, type cleanup
