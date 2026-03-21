# API Contract: Content Library

**Base Path**: `/api/v1/admin/content-library`
**Auth**: Admin session cookie or X-Admin-Key header (via `adminAuth` middleware)

---

## GET /api/v1/admin/content-library

List content library items with filtering.

**Query Parameters**:
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| teamId | string | yes | Slack workspace ID |
| type | string | no | Filter by TrainingItemType (VIDEO, READING, etc.) |
| category | string | no | Filter by category tag |
| search | string | no | Search by title (case-insensitive) |

**Response 200**:
```json
{
  "items": [
    {
      "id": "uuid",
      "type": "VIDEO",
      "title": "AWS Cloud Practitioner Study Guide",
      "content": "https://loom.com/share/abc123",
      "metadata": null,
      "estimated_minutes": 30,
      "category_tags": ["certifications", "cloud_fundamentals"],
      "usage_count": 4,
      "created_by_user_id": "U12345",
      "created_at": "2026-03-01T10:00:00Z",
      "updated_at": "2026-03-08T10:00:00Z"
    }
  ],
  "total": 25
}
```

---

## POST /api/v1/admin/content-library

Create a new library item.

**Request Body**:
```json
{
  "slack_team_id": "T12345",
  "type": "VIDEO",
  "title": "AWS Cloud Practitioner Study Guide",
  "content": "https://loom.com/share/abc123",
  "metadata": null,
  "estimated_minutes": 30,
  "category_tags": ["certifications", "cloud_fundamentals"]
}
```

**Response 201**: Created item object.

---

## PUT /api/v1/admin/content-library/:itemId

Update a library item.

**Request Body** (partial update):
```json
{
  "title": "AWS Cloud Practitioner Study Guide (Updated)",
  "content": "https://loom.com/share/newlink",
  "category_tags": ["certifications", "cloud_fundamentals", "platform_training"]
}
```

**Response 200**: Updated item object.

**Note**: If the item is used in plans, the response includes a warning:
```json
{
  "item": { ... },
  "warning": "This item is used in 4 onboarding plans. Changes apply to the library only — existing plan modules that reference this item are not automatically updated."
}
```

---

## DELETE /api/v1/admin/content-library/:itemId

Delete a library item.

**Response 200**:
```json
{
  "message": "Library item deleted",
  "item_id": "uuid"
}
```

**Response 409**: Item is used in active plans.
```json
{
  "error": "item_in_use",
  "message": "This item is referenced by 2 active onboarding plans. Remove it from those plans first.",
  "used_in_plans": ["Plan A", "Plan B"]
}
```

---

## GET /api/v1/admin/content-library/categories

Get all available category tags.

**Query Parameters**:
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| teamId | string | yes | Slack workspace ID |

**Response 200**:
```json
{
  "categories": [
    { "tag": "platform_training", "count": 8 },
    { "tag": "cloud_fundamentals", "count": 5 },
    { "tag": "outreach_skills", "count": 12 },
    { "tag": "tool_walkthroughs", "count": 6 },
    { "tag": "certifications", "count": 3 },
    { "tag": "admin_hr", "count": 4 }
  ]
}
```
