# API Contract: Onboarding Enrollments

**Base Path**: `/api/v1/admin/onboarding-enrollments`
**Auth**: Admin session cookie or X-Admin-Key header (via `adminAuth` middleware)

---

## GET /api/v1/admin/onboarding-enrollments

List all enrollments with progress summary.

**Query Parameters**:
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| teamId | string | yes | Slack workspace ID |
| status | string | no | Filter by status (ACTIVE, SUPERVISED, PENDING_GRADUATION, GRADUATED, CANCELLED) |

**Response 200**:
```json
{
  "enrollments": [
    {
      "id": "uuid",
      "bdr_name": "John Smith",
      "slack_user_id": "U12345",
      "plan_name": "Standard BDR Onboarding",
      "plan_id": "uuid",
      "start_date": "2026-03-10",
      "status": "ACTIVE",
      "current_day": 5,
      "total_days": 15,
      "progress_percentage": 33.3,
      "modules_completed": 5,
      "modules_total": 15,
      "days_behind": 0,
      "manager_id": "U67890",
      "delivery_hour": 9,
      "timezone": "America/New_York",
      "expected_end_date": "2026-03-28",
      "created_at": "2026-03-08T10:00:00Z"
    }
  ],
  "summary": {
    "total_active": 5,
    "total_supervised": 2,
    "total_pending_graduation": 1,
    "average_progress": 45.2
  }
}
```

---

## GET /api/v1/admin/onboarding-enrollments/:enrollmentId

Get detailed enrollment with full module progress.

**Response 200**:
```json
{
  "enrollment": {
    "id": "uuid",
    "bdr_name": "John Smith",
    "slack_user_id": "U12345",
    "plan": {
      "id": "uuid",
      "name": "Standard BDR Onboarding",
      "duration_days": 15,
      "supervised_start_day": 11
    },
    "start_date": "2026-03-10",
    "status": "ACTIVE",
    "current_day": 5,
    "progress_percentage": 33.3,
    "manager_id": "U67890",
    "delivery_hour": 9,
    "timezone": "America/New_York",
    "supervised_campaign_id": null,
    "graduated_at": null,
    "extended_days": 0,
    "module_progress": [
      {
        "day_number": 1,
        "module_title": "Welcome & Platform Setup",
        "status": "COMPLETED",
        "delivered_at": "2026-03-10T14:00:00Z",
        "completed_at": "2026-03-10T16:30:00Z",
        "quiz_score": null,
        "manager_review_status": null,
        "checkin_responses": [
          {
            "automation_type": "CHECK_IN",
            "response": "Going great so far!",
            "responded_at": "2026-03-10T19:00:00Z"
          }
        ]
      }
    ]
  }
}
```

---

## POST /api/v1/admin/onboarding-enrollments

Enroll a BDR in an onboarding plan.

**Request Body**:
```json
{
  "slack_team_id": "T12345",
  "slack_user_id": "U12345",
  "bdr_name": "John Smith",
  "plan_id": "uuid",
  "manager_id": "U67890",
  "start_date": "2026-03-10",
  "delivery_hour": 9,
  "timezone": "America/New_York"
}
```

**Response 201**:
```json
{
  "enrollment": { ... },
  "welcome_dm_sent": true,
  "scheduler_created": true
}
```

**Response 409**: BDR already has an active enrollment.
```json
{
  "error": "duplicate_enrollment",
  "message": "BDR already has an active onboarding enrollment",
  "existing_enrollment_id": "uuid",
  "existing_plan_name": "Standard BDR Onboarding"
}
```

---

## PUT /api/v1/admin/onboarding-enrollments/:enrollmentId

Update enrollment settings (delivery time, timezone, etc.).

**Request Body** (partial update):
```json
{
  "delivery_hour": 10,
  "timezone": "America/Chicago"
}
```

**Response 200**: Updated enrollment object.

---

## POST /api/v1/admin/onboarding-enrollments/:enrollmentId/cancel

Cancel an enrollment.

**Request Body**:
```json
{
  "reason": "BDR left the company"
}
```

**Response 200**:
```json
{
  "enrollment": { ... },
  "status": "CANCELLED",
  "scheduler_removed": true
}
```

---

## POST /api/v1/admin/onboarding-enrollments/:enrollmentId/graduate

Manager approves graduation.

**Response 200**:
```json
{
  "enrollment": { ... },
  "status": "GRADUATED",
  "graduated_at": "2026-03-28T15:00:00Z",
  "graduation_dm_sent": true,
  "scheduler_removed": true
}
```

---

## POST /api/v1/admin/onboarding-enrollments/:enrollmentId/extend

Manager extends onboarding with additional days.

**Request Body**:
```json
{
  "additional_days": 5,
  "reason": "Needs more practice with call scripts"
}
```

**Response 200**:
```json
{
  "enrollment": { ... },
  "extended_days": 5,
  "new_total_days": 20,
  "new_expected_end_date": "2026-04-04"
}
```
