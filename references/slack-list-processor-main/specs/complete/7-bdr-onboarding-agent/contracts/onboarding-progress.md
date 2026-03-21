# API Contract: Onboarding Progress

**Base Path**: `/api/v1/admin/onboarding-progress`
**Auth**: Admin session cookie or X-Admin-Key header (via `adminAuth` middleware)

---

## GET /api/v1/admin/onboarding-progress/dashboard

Aggregate onboarding dashboard for a workspace.

**Query Parameters**:
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| teamId | string | yes | Slack workspace ID |

**Response 200**:
```json
{
  "dashboard": {
    "total_active_enrollments": 5,
    "total_supervised": 2,
    "total_pending_graduation": 1,
    "total_graduated_all_time": 12,
    "average_progress_percentage": 45.2,
    "average_graduation_days": 16.5,
    "common_struggle_modules": [
      {
        "module_title": "Cold Call Fundamentals",
        "day_number": 7,
        "avg_completion_time_hours": 8.5,
        "incomplete_rate": 0.25
      }
    ],
    "alerts": [
      {
        "type": "behind_schedule",
        "enrollment_id": "uuid",
        "bdr_name": "Jane Doe",
        "days_behind": 2,
        "current_module": "Email Sequence Writing"
      },
      {
        "type": "overdue",
        "enrollment_id": "uuid",
        "bdr_name": "Bob Wilson",
        "days_past_expected": 3
      },
      {
        "type": "quiz_failed",
        "enrollment_id": "uuid",
        "bdr_name": "Alice Brown",
        "quiz_topic": "Cloud Terminology",
        "score": 40
      }
    ],
    "recent_graduates": [
      {
        "bdr_name": "Mike Chen",
        "plan_name": "Standard BDR Onboarding",
        "graduated_at": "2026-03-05T15:00:00Z",
        "completion_days": 15
      }
    ]
  }
}
```

---

## GET /api/v1/admin/onboarding-progress/:enrollmentId/checkins

Get all check-in responses for an enrollment.

**Response 200**:
```json
{
  "checkins": [
    {
      "id": "uuid",
      "day_number": 1,
      "automation_type": "CHECK_IN",
      "prompt": "How's your first day going?",
      "response": "Going great! Just finished the platform walkthrough video.",
      "responded_at": "2026-03-10T19:00:00Z"
    }
  ]
}
```

---

## BDR-Facing Endpoints

**Base Path**: `/api/v1/bdr/onboarding`
**Auth**: BDR magic link JWT (via `bdrAuth` middleware)

### POST /api/v1/bdr/onboarding/complete

Mark a module as complete (BDR action).

**Request Body**:
```json
{
  "enrollment_id": "uuid",
  "day_number": 5
}
```

**Response 200**:
```json
{
  "module_progress": {
    "day_number": 5,
    "status": "COMPLETED",
    "completed_at": "2026-03-14T16:00:00Z"
  },
  "overall_progress": {
    "completed": 5,
    "total": 15,
    "percentage": 33.3
  }
}
```

### POST /api/v1/bdr/onboarding/quiz

Submit quiz answers.

**Request Body**:
```json
{
  "enrollment_id": "uuid",
  "day_number": 3,
  "answers": [
    { "question_index": 0, "answer": "B" },
    { "question_index": 1, "answer": "A" }
  ]
}
```

**Response 200**:
```json
{
  "quiz_result": {
    "score": 100,
    "passed": true,
    "passing_threshold": 70,
    "feedback": [
      { "question_index": 0, "correct": true },
      { "question_index": 1, "correct": true }
    ]
  },
  "module_status": "COMPLETED"
}
```

### POST /api/v1/bdr/onboarding/practice-submit

Submit a practice task for manager review.

**Request Body**:
```json
{
  "enrollment_id": "uuid",
  "day_number": 7,
  "submission": "I reviewed the sample enrichment list and identified 3 issues with domain formatting..."
}
```

**Response 200**:
```json
{
  "module_progress": {
    "day_number": 7,
    "status": "IN_PROGRESS",
    "manager_review_status": "PENDING_REVIEW"
  },
  "message": "Your submission has been sent to your manager for review."
}
```
