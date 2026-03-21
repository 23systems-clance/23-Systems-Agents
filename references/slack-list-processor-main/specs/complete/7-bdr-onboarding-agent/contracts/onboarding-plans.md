# API Contract: Onboarding Plans

**Base Path**: `/api/v1/admin/onboarding-plans`
**Auth**: Admin session cookie or X-Admin-Key header (via `adminAuth` middleware)

---

## GET /api/v1/admin/onboarding-plans

List all onboarding plans for a workspace.

**Query Parameters**:
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| teamId | string | yes | Slack workspace ID |
| latestOnly | boolean | no | If true, only return latest versions (default: true) |

**Response 200**:
```json
{
  "plans": [
    {
      "id": "uuid",
      "name": "Standard BDR Onboarding",
      "description": "3-week program for new BDRs",
      "duration_days": 15,
      "supervised_start_day": 11,
      "version": 2,
      "is_latest": true,
      "module_count": 15,
      "active_enrollments": 3,
      "created_by_user_id": "U12345",
      "created_at": "2026-03-08T10:00:00Z",
      "updated_at": "2026-03-08T10:00:00Z"
    }
  ]
}
```

---

## GET /api/v1/admin/onboarding-plans/:planId

Get a single plan with all modules, training items, and automations.

**Response 200**:
```json
{
  "plan": {
    "id": "uuid",
    "name": "Standard BDR Onboarding",
    "description": "3-week program",
    "duration_days": 15,
    "supervised_start_day": 11,
    "version": 2,
    "is_latest": true,
    "weekdays_only": true,
    "created_by_user_id": "U12345",
    "created_at": "2026-03-08T10:00:00Z",
    "modules": [
      {
        "id": "uuid",
        "day_number": 1,
        "week_number": 1,
        "title": "Welcome & Platform Setup",
        "description": "Get set up with all tools",
        "estimated_minutes": 60,
        "training_items": [
          {
            "id": "uuid",
            "type": "VIDEO",
            "title": "Platform Walkthrough",
            "content": "https://loom.com/share/abc123",
            "metadata": null,
            "estimated_minutes": 15,
            "sort_order": 1,
            "library_item_id": null
          }
        ],
        "automations": [
          {
            "id": "uuid",
            "type": "CHECK_IN",
            "trigger_time": "14:00",
            "content": "How's your first day going?",
            "conditions": null
          }
        ]
      }
    ]
  }
}
```

---

## POST /api/v1/admin/onboarding-plans

Create a new onboarding plan.

**Request Body**:
```json
{
  "slack_team_id": "T12345",
  "name": "Standard BDR Onboarding",
  "description": "3-week program for new BDRs",
  "duration_days": 15,
  "supervised_start_day": 11,
  "weekdays_only": true,
  "modules": [
    {
      "day_number": 1,
      "title": "Welcome & Platform Setup",
      "description": "Get set up with all tools",
      "estimated_minutes": 60,
      "training_items": [
        {
          "type": "VIDEO",
          "title": "Platform Walkthrough",
          "content": "https://loom.com/share/abc123",
          "estimated_minutes": 15,
          "library_item_id": null
        }
      ],
      "automations": [
        {
          "type": "CHECK_IN",
          "trigger_time": "14:00",
          "content": "How's your first day going?"
        }
      ]
    }
  ]
}
```

**Response 201**: Created plan object (same shape as GET detail)

---

## PUT /api/v1/admin/onboarding-plans/:planId

Update a plan. Creates a new version if the plan has active enrollments; otherwise updates in place.

**Request Body**: Same shape as POST (partial updates allowed — only included fields are updated).

**Response 200**: Updated plan object.

**Response 409**: Plan has active enrollments — new version created.
```json
{
  "plan": { ... },
  "new_version_created": true,
  "message": "Plan has active enrollments. A new version (v3) was created."
}
```

---

## DELETE /api/v1/admin/onboarding-plans/:planId

Delete a plan (soft delete — marks as archived).

**Response 200**:
```json
{
  "message": "Plan archived successfully",
  "plan_id": "uuid"
}
```

**Response 409**: Cannot delete plan with active enrollments.

---

## POST /api/v1/admin/onboarding-plans/:planId/duplicate

Duplicate a plan as a new template.

**Request Body**:
```json
{
  "name": "Standard BDR Onboarding (Copy)"
}
```

**Response 201**: New plan object with all modules and items copied.

---

## GET /api/v1/admin/onboarding-plans/:planId/preview

Preview the drip sequence — what each daily DM will look like.

**Response 200**:
```json
{
  "preview": [
    {
      "day_number": 1,
      "week_number": 1,
      "module_title": "Welcome & Platform Setup",
      "dm_blocks": [ /* Slack Block Kit JSON */ ],
      "automations": [
        {
          "type": "CHECK_IN",
          "trigger_time": "14:00",
          "content": "How's your first day going?"
        }
      ]
    }
  ]
}
```
