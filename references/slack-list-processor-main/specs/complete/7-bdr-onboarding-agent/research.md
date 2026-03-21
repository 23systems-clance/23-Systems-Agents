# Research: BDR Onboarding Agent

**Feature**: 7-bdr-onboarding-agent | **Date**: 2026-03-08

## R1: Per-User Timezone-Aware Scheduled Delivery

**Decision**: Use individual BullMQ Job Schedulers per enrollment with the `tz` parameter.

**Rationale**: BullMQ's `upsertJobScheduler` supports per-job timezone via the `tz` parameter (IANA timezone strings). This eliminates manual timezone math and handles DST automatically. Each BDR enrollment gets its own scheduler with their configured delivery hour and timezone.

**Implementation**:
```typescript
await onboardingQueue.upsertJobScheduler(
  `onboarding-dm-${enrollmentId}`,
  {
    pattern: `0 ${deliveryHour} * * 1-5`,  // weekdays only
    tz: timezone  // e.g., 'America/New_York'
  },
  {
    name: 'onboarding-daily-dm',
    data: { enrollmentId }
  }
);
```

**Alternatives Considered**:
- Single hourly cron that checks all users: Rejected — requires manual timezone math, runs unnecessarily when no users need processing.
- Per-delivery delayed jobs (re-scheduled after each delivery): Rejected — more failure points, must re-schedule after every delivery, timezone math still required.

**Key Details**:
- Delayed/scheduled jobs persist in Redis sorted sets — survive worker restarts
- `upsertJobScheduler` allows updating schedule without remove/re-add
- On app startup, sync all active enrollment schedules
- When enrollment completes/cancels, remove the scheduler

## R2: Slack Block Kit for Interactive Onboarding DMs

**Decision**: Use Block Kit with header, section, context, divider, and actions blocks for daily module DMs. Use modals for check-in text responses.

**Rationale**: Block Kit provides all needed elements — buttons for "Mark Complete", radio buttons for quizzes (max 10 options), modals for free-text check-in responses. Text-based progress bars work within context blocks.

**Key Constraints**:
- 50 blocks max per message
- 40,000 characters max per message
- 3,000 characters per section block
- Radio button groups support up to 10 options

**DM Structure**:
1. **Header block**: "Week X, Day Y: Module Title"
2. **Context block**: Progress indicator ("████████░░ 80% — 4/5 modules complete")
3. **Divider**
4. **Section blocks**: Training items with links (video, reading, resource, reimbursement)
5. **Section + radio_buttons**: Quiz questions (if applicable)
6. **Actions block**: "Mark Complete" button (primary style), "Open Check-in" button (if check-in automation exists)

**Interactive Patterns**:
- "Mark Complete" → `app.action('onboarding_mark_complete')` → update DB → `chat.update` to show completed state
- Quiz submission → `app.action('onboarding_quiz_submit')` → score and record → update message with feedback
- Check-in response → button opens modal → `app.view('onboarding_checkin_submit')` → save response to DB

## R3: Plan Versioning Strategy

**Decision**: Snapshot-based versioning. Each plan edit creates a new version number. Enrollments lock to the version at enrollment time.

**Rationale**: Prisma doesn't have built-in temporal/versioning support. Simplest approach is a `version` integer on OnboardingPlan that increments on edit, with OnboardingEnrollment storing a `planVersion` reference. Plan modules are stored as a JSONB snapshot on the enrollment record at enrollment time.

**Implementation**:
- `OnboardingPlan` has `version: Int @default(1)` and `isLatest: Boolean @default(true)`
- On edit: Create new plan record with incremented version, set previous version's `isLatest = false`
- `OnboardingEnrollment` stores `planId` pointing to the specific version
- Enrollments always reference the exact plan version — immune to future edits

**Alternatives Considered**:
- Mutable plan with changelog: Rejected — hard to reconstruct what a BDR was actually shown
- Copy-on-enroll (deep clone modules into enrollment): Rejected — excessive data duplication
- Separate PlanVersion table: Rejected — over-engineering for current scale (20 concurrent enrollments)

**Chosen approach**: The plan record IS the version. Multiple rows in OnboardingPlan with the same `name` but different `version` numbers. `isLatest` flag for UI queries. Enrollment references a specific plan row.

## R4: Drip Builder UI Pattern

**Decision**: Timeline/list view with day cards. Each day card expands to show module editor. No drag-and-drop canvas (too complex for initial scope).

**Rationale**: The drip builder is a plan configuration tool, not a visual workflow engine. A vertical timeline/list with expandable day cards provides intuitive plan building without the complexity of a drag-and-drop canvas like ReactFlow. This matches the "calendar-style builder" described in the spec.

**Implementation**:
- Left panel: Vertical list of days (Day 1, Day 2, ... Day N)
- Click day → Right panel shows module editor
- Module editor: Add training items (type selector + content fields), set estimated time
- Add automations per day: type selector (check_in, reminder, weekly_summary, custom_message) + config
- Preview mode: Read-only rendering of all daily DMs in chronological order
- Plan settings: Duration, supervised phase start day, name, description

**UI Libraries**: Existing admin dashboard uses React 19 + Vite + shadcn/ui patterns. Use existing component patterns (tables, forms, modals).

## R5: Automation Scheduling

**Decision**: Use BullMQ delayed jobs for intra-day automations (check-ins, reminders). Use the daily delivery job to schedule that day's automations.

**Rationale**: Automations need to fire at specific times within a day (e.g., "reminder at 3 PM if module not complete"). Rather than creating repeatable schedulers for each automation, the daily module delivery worker schedules delayed jobs for that day's automations as part of module delivery.

**Flow**:
1. Daily delivery worker sends module DM at configured time
2. Worker checks the day's automations (check_in at 2 PM, reminder at 3 PM)
3. Worker schedules delayed jobs with calculated delays from current time
4. When delayed job fires: check conditions (e.g., is module still incomplete?), send DM if conditions met

**Benefits**:
- No need for long-lived repeatable schedulers for automations
- Automations are naturally scoped to the current day
- Easy to cancel (remove delayed job if enrollment status changes)
- Conditions checked at fire time, not schedule time

## R6: Graduation Handoff to Feature 6

**Decision**: On graduation approval, update BDR status and remove onboarding scheduler. Feature 6's existing daily DM cron will pick up the BDR on the next cycle.

**Rationale**: Feature 6's `sendDailyBriefings()` queries all BDRs with ACTIVE campaigns. The graduation flow sets the BDR's status to active and ensures they have campaign assignments. The next daily DM cycle (Feature 6) will include them automatically.

**Implementation**:
1. Manager approves graduation via Slack action or dashboard
2. System updates enrollment status to "graduated"
3. System removes the onboarding scheduler (`removeJobScheduler`)
4. System sends graduation DM to BDR
5. System notifies manager of completion
6. Feature 6's next daily DM cycle includes the BDR (they already have campaign assignments from supervised phase)
