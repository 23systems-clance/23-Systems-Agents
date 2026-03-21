# API Contract: Quality Gate Results

**Feature**: 16-lead-quality-gating
**Context**: These are not standalone endpoints. Quality gate results are embedded in existing Job API responses and Slack messages.

---

## Job API Response Extension

### GET /api/v1/admin/jobs/:jobId (existing endpoint, extended response)

The existing job detail endpoint now includes quality gate data when present.

### Extended Fields

```json
{
  "id": "job-uuid",
  "status": "COMPLETED",
  "sourceRowCount": 500,
  "...existing fields...": "...",

  "qualityGateResult": {
    "totalRows": 500,
    "passedRows": 453,
    "filteredRows": 47,
    "uniqueDomains": 312,
    "duplicateDomainRows": 141,
    "filterBreakdown": {
      "personalEmail": 23,
      "suppressionDomain": 15,
      "missingCompany": 9,
      "duplicateEmail": 0
    },
    "filteredFileUrl": "https://s3-presigned-url...",
    "filteredFileKey": "jobs/job-uuid/filtered-rows.csv",
    "processingTimeMs": 145
  },
  "qualityGateConfigSnapshot": {
    "rejectPersonalEmails": true,
    "rejectMissingCompany": true,
    "rejectDuplicateEmails": true,
    "deduplicateDomains": true,
    "suppressionDomains": ["competitor.com"],
    "personalDomainOverrides": [],
    "allowPersonalDomains": [],
    "effectivePersonalDomains": ["gmail.com", "yahoo.com", "..."]
  }
}
```

**Notes**:
- `qualityGateResult` is `null` for jobs created before this feature or for job types where the gate doesn't apply (e.g., TECH_REPORT).
- `filteredFileUrl` is a presigned S3 URL with 7-day expiry. May be expired for older jobs.

---

## Job List API Extension

### GET /api/v1/admin/jobs (existing endpoint, extended response)

Each job in the list includes a summary of quality gate results.

### Extended Fields per Job

```json
{
  "id": "job-uuid",
  "...existing fields...": "...",
  "qualityGateSummary": {
    "totalRows": 500,
    "passedRows": 453,
    "filteredRows": 47,
    "uniqueDomains": 312
  }
}
```

**Notes**:
- `qualityGateSummary` is a lightweight subset of the full result, extracted from the JSONB field.
- `null` when no quality gate was applied.

---

## Slack Message Contract

### Filtering Summary Message

Posted to the enrichment thread when `filteredRows > 0`. Not posted when all rows pass (FR-010).

**Block Kit Structure**:

```json
{
  "channel": "<channel_id>",
  "thread_ts": "<thread_ts>",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Quality check:* 453 of 500 rows passed. 47 filtered."
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "- 23 personal email domains\n- 15 suppression list matches\n- 9 missing company data"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "5 unique domains detected across 453 rows. Technographic enrichment will run for 5 domains."
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "Download filtered rows"
          },
          "url": "https://s3-presigned-url...",
          "action_id": "quality_gate_download_filtered"
        }
      ]
    }
  ]
}
```

**Conditional sections**:
- Domain dedup section only shown when `duplicateDomainRows > 0`.
- Each breakdown line only shown when its count > 0.
- The entire message is suppressed when `filteredRows === 0` (FR-010).

### All Rows Filtered Message

Posted when 100% of rows are filtered out.

```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Quality check:* All 50 rows were filtered out. No rows qualify for enrichment."
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "Download filtered rows"
          },
          "url": "https://s3-presigned-url...",
          "action_id": "quality_gate_download_filtered"
        }
      ]
    }
  ]
}
```

**Behavior**: When all rows are filtered, no enrichment job is enqueued. The job record is marked as COMPLETED with 0 companies processed.

---

## Filtered Rows CSV Format

The downloaded CSV contains all filtered rows with an appended column.

### Schema

```
[...original columns...], Filter Reason
"John Doe", "john@gmail.com", "Acme Corp", "Personal email domain (gmail.com)"
"", "", "", "Missing company name and domain"
"Jane Smith", "jane@competitor.com", "Competitor Inc", "Suppression list match (competitor.com)"
"Bob Brown", "bob@acme.com", "Acme Corp", "Duplicate email (row 3)"
```

**Filter Reason values**:
- `Personal email domain ({domain})` — matched personal email list
- `Suppression list match ({domain})` — matched workspace suppression list
- `Missing company name and domain` — no company name AND no resolvable domain
- `Duplicate email (row {N})` — exact duplicate of email in row N (first occurrence kept)

**Notes**:
- Original row order preserved.
- Original columns preserved exactly (no reordering or reformatting).
- `Filter Reason` is always the last column.
- UTF-8 encoding with BOM for Excel compatibility.
