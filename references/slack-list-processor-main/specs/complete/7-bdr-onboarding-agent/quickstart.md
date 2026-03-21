# Quickstart: BDR Onboarding Agent

**Feature**: 7-bdr-onboarding-agent | **Date**: 2026-03-08

## Integration Scenarios

### Scenario 1: Create an Onboarding Plan (US1)

**Actor**: BDR Manager via admin dashboard

1. Manager navigates to Onboarding > Plans in the admin sidebar
2. Clicks "Create New Plan"
3. Fills in plan name ("Standard 3-Week Onboarding"), description, duration (15 days), supervised start day (11)
4. For each day (1-15), adds training items:
   - Day 1: Welcome video (VIDEO), Platform setup guide (READING), Tool registration links (RESOURCE_LINK)
   - Day 2: Cloud fundamentals (VIDEO), Terminology quiz (QUIZ)
   - Day 7: Practice cold call script (PRACTICE_TASK, manager-verified)
   - Day 11: Start supervised phase — campaign tasks blended
5. Adds automations: Check-in at 2 PM on Days 1, 3, 5; Reminder at 3 PM if module incomplete; Weekly summary on Fridays
6. Clicks "Preview" to see all 15 daily DMs
7. Saves plan as template

**API Flow**: `POST /api/v1/admin/onboarding-plans` with full plan payload
**Verify**: Plan appears in list, modules and items persist, preview renders correctly

### Scenario 2: Enroll a BDR (US3)

**Actor**: BDR Manager via admin dashboard

1. Manager navigates to Onboarding > Enrollments
2. Clicks "Enroll BDR"
3. Selects BDR (John Smith, Slack ID U12345)
4. Selects plan ("Standard 3-Week Onboarding")
5. Sets start date (next Monday), delivery time (9 AM), timezone (America/New_York)
6. Confirms enrollment

**API Flow**: `POST /api/v1/admin/onboarding-enrollments`
**Side Effects**:
- Welcome Slack DM sent to BDR with plan overview
- BullMQ job scheduler created: `onboarding-dm-{enrollmentId}`, cron `0 9 * * 1-5`, tz `America/New_York`
- 15 ModuleProgress records created (one per day, status: PENDING)

**Verify**: BDR receives welcome DM, enrollment appears in dashboard, scheduler exists in BullMQ

### Scenario 3: Daily Module Delivery (US4)

**Actor**: System (BullMQ scheduler)

1. At 9 AM EST (14:00 UTC), onboarding worker fires for enrollment
2. Worker looks up enrollment, finds current day (e.g., Day 3)
3. Worker queries OnboardingModule for Day 3 with training items
4. Worker builds Slack Block Kit message:
   - Header: "Week 1, Day 3: Cloud Terminology"
   - Progress: "████░░░░░░ 13% (2/15 modules complete)"
   - Training items with links
   - Quiz question (if applicable)
   - "Mark Complete" button
5. Worker sends DM to BDR's Slack user ID
6. Worker updates ModuleProgress: status = DELIVERED, deliveredAt = now
7. Worker schedules intra-day automations (check-in at 2 PM, reminder at 3 PM)

**Side Effects**:
- If previous day's module is incomplete, DM includes reminder section
- If BDR has 2+ consecutive incomplete days, manager gets alert DM

**Verify**: BDR receives correctly formatted DM at configured time, progress updated

### Scenario 4: Module Completion (US5)

**Actor**: BDR via Slack

1. BDR reads training content (watches video, reads guide)
2. BDR clicks "Mark Complete" button in the DM
3. Slack sends action to bot: `action_id: onboarding_mark_complete`
4. Action handler updates ModuleProgress: status = COMPLETED, completedAt = now
5. Handler updates the original DM via `chat.update` to show completed state
6. Handler sends brief confirmation: "Module completed! You're now 20% through your onboarding."

**API Flow**: Slack action → `app.action('onboarding_mark_complete')` → update DB → update message
**Verify**: Progress percentage updates, manager dashboard reflects completion

### Scenario 5: Quiz Submission (US5)

**Actor**: BDR via Slack

1. Daily DM includes a quiz with radio button options
2. BDR selects answer and clicks "Submit Answer"
3. Action handler scores the quiz (compare to correct answers in metadata)
4. If passed (>= threshold): Module marked complete, score recorded
5. If failed: Module stays incomplete, manager notified, BDR sees feedback

**Verify**: Score recorded in ModuleProgress.quizScore, feedback shown in DM

### Scenario 6: Supervised Phase Transition (US6)

**Actor**: System (automatic)

1. Enrollment reaches configured supervised start day (e.g., Day 11)
2. Daily delivery worker detects: `currentDay >= plan.supervisedStartDay`
3. Worker updates enrollment status: ACTIVE → SUPERVISED
4. Daily DMs now include two sections:
   - "Today's Training": Remaining onboarding modules
   - "Today's Campaign Tasks": Tasks from assigned supervised campaign
5. All campaign activity is tagged with "supervised" flag

**Prerequisites**: Manager must assign a supervised campaign to the enrollment
**Verify**: DM shows blended content, campaign activity has supervised flag

### Scenario 7: Graduation (US7)

**Actor**: Manager via Slack

1. BDR completes all 15 modules
2. System detects: all ModuleProgress records are COMPLETED
3. System updates enrollment status to PENDING_GRADUATION
4. System sends Slack DM to manager: "[BDR Name] has completed onboarding. Approve graduation?"
5. Manager clicks "Approve Graduation" button
6. Action handler:
   - Updates enrollment: status = GRADUATED, graduatedAt = now
   - Removes BullMQ onboarding scheduler
   - Sends graduation DM to BDR
   - Logs audit event
7. Next daily DM cycle (Feature 6) picks up the BDR for normal campaign work

**Alternative**: Manager clicks "Extend Onboarding" → prompted for additional days

**Verify**: BDR status is GRADUATED, no more onboarding DMs, Feature 6 DMs begin

### Scenario 8: Manager Alert — Behind Schedule (US8)

**Actor**: System (daily check)

1. During daily delivery, worker checks each enrollment
2. BDR has 2 consecutive incomplete modules (Day 3 and Day 4 incomplete, now Day 5)
3. Worker sends alert DM to manager: "[BDR Name] is 2 days behind. Current module: 'Email Sequence Writing'. Consider reaching out."
4. Alert visible in onboarding dashboard alerts section

**Verify**: Manager receives alert DM, dashboard shows alert

### Scenario 9: Content Library Usage (US9)

**Actor**: Manager via admin dashboard

1. Manager navigates to Onboarding > Content Library
2. Adds a new item: type VIDEO, title "Apollo.io Walkthrough", URL, tags: ["tool_walkthroughs"]
3. When building a plan in the drip builder, manager clicks "Add from Library"
4. Filters by category "tool_walkthroughs"
5. Selects the item — it populates into the module as a training item

**Verify**: Library item searchable by tag, populates correctly in drip builder

## Deployment Notes

- New Prisma migration required for 8 new models
- New BullMQ queue (`onboarding`) with repeatable job scheduler per enrollment
- New admin routes mounted under `/api/v1/admin/onboarding-*`
- New Slack action listeners registered in app.ts
- Admin dashboard sidebar gets "Onboarding" section with Plans, Enrollments, Progress, Library pages
- No new external API integrations — uses existing Slack DM delivery
- No new environment variables required
