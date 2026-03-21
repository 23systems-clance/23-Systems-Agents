# Data Model: BDR Onboarding Agent

**Feature**: 7-bdr-onboarding-agent | **Date**: 2026-03-08

## New Entities

### OnboardingPlan

A reusable template defining a BDR onboarding program structure. Plans are versioned — edits create new records with incremented version numbers.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique plan identifier |
| slackTeamId | String | FK → workspace, indexed | Workspace scope |
| name | String | required | Plan display name |
| description | String? | optional, text | Plan overview |
| durationDays | Int | required, > 0 | Total business days |
| supervisedStartDay | Int? | optional, >= 1 | Day supervised phase begins (null = no supervised phase) |
| version | Int | default: 1 | Version number (increments on edit) |
| isLatest | Boolean | default: true | Whether this is the latest version |
| parentPlanId | UUID? | self-reference | Original plan ID (for version tracking) |
| weekdaysOnly | Boolean | default: true | Skip weekends for module delivery |
| createdByUserId | String | required | Slack user ID of creator |
| createdAt | DateTime | auto | Creation timestamp |
| updatedAt | DateTime | auto-update | Last update timestamp |

**Relations**: Has many `OnboardingModule`, has many `OnboardingEnrollment`
**Indexes**: `[slackTeamId, isLatest]`, `[parentPlanId]`

### OnboardingModule

A single day's training content within a plan.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique module identifier |
| planId | UUID | FK → OnboardingPlan, indexed | Parent plan |
| dayNumber | Int | required, >= 1 | Day in the plan (1-based) |
| weekNumber | Int | required, >= 1 | Calculated week number |
| title | String | required | Module title (e.g., "Platform Basics") |
| description | String? | optional, text | What the BDR will learn |
| estimatedMinutes | Int? | optional | Estimated completion time in minutes |
| sortOrder | Int | required | Display order within day |
| createdAt | DateTime | auto | Creation timestamp |
| updatedAt | DateTime | auto-update | Last update timestamp |

**Relations**: Belongs to `OnboardingPlan`, has many `TrainingItem`, has many `OnboardingAutomation`
**Indexes**: `[planId, dayNumber]`
**Unique**: `[planId, dayNumber]` (one module per day per plan)

### TrainingItem

An individual piece of training content within a module.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique item identifier |
| moduleId | UUID | FK → OnboardingModule, indexed | Parent module |
| type | TrainingItemType | enum, required | Content type |
| title | String | required | Item title |
| content | String? | optional, text | URL or inline text content |
| metadata | Json? | optional, JSONB | Type-specific data (quiz answers, checklist items, verification config) |
| estimatedMinutes | Int? | optional | Estimated time for this item |
| sortOrder | Int | required | Display order within module |
| libraryItemId | UUID? | FK → ContentLibraryItem | Source library item (if created from library) |
| createdAt | DateTime | auto | Creation timestamp |
| updatedAt | DateTime | auto-update | Last update timestamp |

**TrainingItemType enum**: `VIDEO`, `READING`, `QUIZ`, `PRACTICE_TASK`, `CHECKLIST`, `RESOURCE_LINK`, `REIMBURSEMENT_INFO`

**Metadata shapes by type**:
- `QUIZ`: `{ questions: [{ question: string, options?: string[], correctAnswer?: string }] }`
- `PRACTICE_TASK`: `{ completionMethod: 'self_report' | 'manager_verified' }`
- `CHECKLIST`: `{ items: [{ label: string }] }`
- Others: `null` or `{}`

**Relations**: Belongs to `OnboardingModule`, optionally references `ContentLibraryItem`
**Indexes**: `[moduleId, sortOrder]`

### OnboardingAutomation

A scheduled action attached to a module/day.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique automation identifier |
| moduleId | UUID | FK → OnboardingModule, indexed | Parent module (day) |
| type | AutomationType | enum, required | Automation type |
| triggerTime | String | required | Time to fire (HH:MM format, e.g., "14:00") |
| content | String? | optional, text | Message content or prompt text |
| conditions | Json? | optional, JSONB | Conditions for firing (e.g., `{ onlyIfIncomplete: true }`) |
| sortOrder | Int | required | Display order within module's automations |
| createdAt | DateTime | auto | Creation timestamp |

**AutomationType enum**: `CHECK_IN`, `REMINDER`, `WEEKLY_SUMMARY`, `CUSTOM_MESSAGE`

**Relations**: Belongs to `OnboardingModule`
**Indexes**: `[moduleId]`

### OnboardingEnrollment

An instance of a BDR going through an onboarding plan.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique enrollment identifier |
| slackTeamId | String | indexed | Workspace scope |
| slackUserId | String | indexed | BDR's Slack user ID |
| bdrName | String | required | BDR display name (denormalized for DMs) |
| planId | UUID | FK → OnboardingPlan | Specific plan version enrolled in |
| managerId | String | required | Manager's Slack user ID |
| startDate | DateTime | required, Date only | First day of onboarding |
| deliveryHour | Int | required, 0-23 | Hour to deliver daily DM (in BDR's timezone) |
| timezone | String | required | IANA timezone (e.g., "America/New_York") |
| status | EnrollmentStatus | enum, required | Current lifecycle state |
| currentDay | Int | default: 0 | Current business day in the plan |
| supervisedCampaignId | UUID? | FK → Campaign | Campaign assigned during supervised phase |
| graduatedAt | DateTime? | optional | Graduation timestamp |
| cancelledAt | DateTime? | optional | Cancellation timestamp |
| extendedDays | Int | default: 0 | Additional days added by manager |
| createdAt | DateTime | auto | Creation timestamp |
| updatedAt | DateTime | auto-update | Last update timestamp |

**EnrollmentStatus enum**: `ACTIVE`, `SUPERVISED`, `PENDING_GRADUATION`, `GRADUATED`, `EXTENDED`, `CANCELLED`

**Relations**: Belongs to `OnboardingPlan`, has many `ModuleProgress`, optionally references `Campaign`
**Indexes**: `[slackUserId, status]`, `[slackTeamId, status]`, `[planId]`
**Unique**: No unique constraint — manager can override duplicate enrollment warning

### ModuleProgress

Per-module completion tracking for an enrolled BDR.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique progress identifier |
| enrollmentId | UUID | FK → OnboardingEnrollment, indexed | Parent enrollment |
| moduleId | UUID | FK → OnboardingModule | Original module reference |
| dayNumber | Int | required | Day number in the plan |
| status | ModuleStatus | enum, default: PENDING | Completion status |
| deliveredAt | DateTime? | optional | When the DM was sent |
| completedAt | DateTime? | optional | When BDR marked complete |
| quizResponses | Json? | optional, JSONB | Quiz answers and scores |
| quizScore | Float? | optional | Quiz score percentage (0-100) |
| practiceSubmission | String? | optional, text | Practice task submission text |
| managerReviewStatus | ReviewStatus? | optional | For manager-verified tasks |
| managerReviewedAt | DateTime? | optional | When manager reviewed |
| checklistProgress | Json? | optional, JSONB | Which checklist items are checked |
| deliveryMessageTs | String? | optional | Slack message timestamp (for updates) |
| deliveryFailed | Boolean | default: false | Whether DM delivery failed (edge case: deactivated Slack account) |
| deliveryError | String? | optional, text | Error message if delivery failed |
| createdAt | DateTime | auto | Creation timestamp |
| updatedAt | DateTime | auto-update | Last update timestamp |

**ModuleStatus enum**: `PENDING`, `DELIVERED`, `IN_PROGRESS`, `COMPLETED`, `SKIPPED`
**ReviewStatus enum**: `PENDING_REVIEW`, `APPROVED`, `REJECTED`

**Relations**: Belongs to `OnboardingEnrollment`, references `OnboardingModule`
**Indexes**: `[enrollmentId, dayNumber]`, `[enrollmentId, status]`
**Unique**: `[enrollmentId, dayNumber]`

### CheckinResponse

Records BDR responses to check-in prompts.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique response identifier |
| enrollmentId | UUID | FK → OnboardingEnrollment, indexed | Parent enrollment |
| automationId | UUID | FK → OnboardingAutomation | Which automation triggered this |
| dayNumber | Int | required | Day in the plan |
| response | String | required, text | BDR's response text |
| respondedAt | DateTime | auto | When BDR responded |

**Relations**: Belongs to `OnboardingEnrollment`, references `OnboardingAutomation`
**Indexes**: `[enrollmentId, dayNumber]`

### ContentLibraryItem

Reusable training content stored in a shared library.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique item identifier |
| slackTeamId | String | indexed | Workspace scope |
| type | TrainingItemType | enum, required | Content type |
| title | String | required | Item title |
| content | String? | optional, text | URL or inline text |
| metadata | Json? | optional, JSONB | Type-specific data |
| estimatedMinutes | Int? | optional | Estimated completion time |
| categoryTags | String[] | array | Category tags for filtering |
| usageCount | Int | default: 0 | Number of plans using this item |
| createdByUserId | String | required | Creator's Slack user ID |
| createdAt | DateTime | auto | Creation timestamp |
| updatedAt | DateTime | auto-update | Last update timestamp |

**Category tags**: `platform_training`, `cloud_fundamentals`, `outreach_skills`, `tool_walkthroughs`, `certifications`, `admin_hr`

**Relations**: Has many `TrainingItem` (via libraryItemId reference)
**Indexes**: `[slackTeamId]`, `[type]`

## Entity Relationship Diagram

```
OnboardingPlan (1) ──── (N) OnboardingModule (1) ──── (N) TrainingItem
       │                         │                           │
       │                         │                    ContentLibraryItem (optional ref)
       │                         │
       │                    (N) OnboardingAutomation
       │
       └── (N) OnboardingEnrollment (1) ──── (N) ModuleProgress
                    │
                    └── (N) CheckinResponse
                    │
                    └── Campaign (optional, supervised phase)
```

## State Transitions

### Enrollment Lifecycle

```
ACTIVE ──────────────→ SUPERVISED ──────────────→ PENDING_GRADUATION
  │                        │                            │
  │  (at supervisedStartDay)  │  (all modules complete)   │
  │                        │                            ├── GRADUATED (manager approves)
  │                        │                            ├── EXTENDED (manager extends)
  │                        │                            └── back to ACTIVE/SUPERVISED
  │                        │
  └── CANCELLED ←──────────┘── CANCELLED
  └── EXTENDED (manager adds days, returns to ACTIVE)
```

### Module Status Flow

```
PENDING → DELIVERED (DM sent) → IN_PROGRESS (BDR interacts) → COMPLETED (marked complete)
                                                             → SKIPPED (manager skips)
```
