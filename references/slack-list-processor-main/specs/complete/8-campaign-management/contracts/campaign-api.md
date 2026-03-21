# API Contracts: Campaign Management Enhancements

**Feature**: 8-campaign-management
**Base path**: `/api/v1/admin`

## Existing Endpoints (Modified)

### GET /campaigns
**Change**: Add `clientId` query parameter for filtering.

```
Query Parameters:
  slackTeamId: string (required)
  status?: CampaignStatus
  campaignType?: CampaignType
  search?: string
  clientId?: string          # NEW - filter by client
  page?: number
  limit?: number

Response 200: {
  data: CampaignListItem[],  # Now includes client info
  total: number,
  page: number,
  totalPages: number
}
```

### GET /campaigns/:id
**Change**: Response includes `contactQuality` stats and `client` info.

```
Response 200: {
  data: {
    ...CampaignDetail,
    client: { id, name, slug } | null,   # NEW
    stats: CampaignStats,
    funnel: StepFunnelItem[],
    contactQuality: {                     # NEW
      totalContacts: number,
      emailVerified: number,
      phoneCallable: number,
      linkedinAvailable: number,
      multiChannel: number
    }
  }
}
```

### POST /campaigns/:id/activate
**Change**: Returns detailed validation errors. Requires client assigned.

```
Response 400: {
  error: "Campaign cannot be activated: Missing client assignment; No BDRs assigned",
  validationErrors: string[]    # NEW - individual errors
}
```

### PATCH /campaigns/:id
**Change**: Input now accepts `clientId` and `bdrs`.

```
Request Body: {
  name?: string,
  description?: string,
  clientId?: string,           # NEW
  hubspotListId?: string,
  instantlyCampaignId?: string,
  heyreachCampaignId?: string,
  meetingLink?: string,
  callScript?: string,
  emailSequenceCopy?: string,
  linkedinSequenceCopy?: string,
  sequenceSteps?: { stepOrder: number, stepType: StepType }[],
  bdrs?: { slackUserId: string, slackTeamId: string, displayName: string }[]
}

Response 200: { data: CampaignDetail }
```

## New Endpoints

### DELETE /campaigns/:id
**Purpose**: Delete (hard) or archive a campaign.

```
Query Parameters:
  action?: "delete" | "archive"   # default: auto-detect based on status

Rules:
  - DRAFT with 0 contacts → hard delete (permanent)
  - DRAFT with contacts → archive (set ARCHIVED)
  - ACTIVE/PAUSED/COMPLETED → archive (set ARCHIVED)
  - ARCHIVED → 400 error (already archived)

Response 200: { message: "Campaign deleted" | "Campaign archived" }
Response 400: { error: "Campaign is already archived" }
Response 404: { error: "Campaign not found" }
```

### GET /campaigns/:id/quality
**Purpose**: Get contact quality breakdown for a campaign.

```
Response 200: {
  data: {
    totalContacts: number,
    emailVerified: number,
    phoneCallable: number,
    linkedinAvailable: number,
    multiChannel: number
  }
}
```

### GET /clients/:clientId/external-campaigns
**Purpose**: Fetch available campaigns from Instantly and/or HeyReach using client credentials.

```
Query Parameters:
  platform: "instantly" | "heyreach" (required)

Response 200: {
  data: {
    platform: string,
    campaigns: { id: string, name: string, status?: string }[]
  }
}

Response 400: { error: "Client does not have {platform} API key configured" }
Response 502: { error: "Failed to fetch campaigns from {platform}: {message}" }
```

### GET /bdrs (existing - used for BDR selection)
Already exists at `/api/v1/admin/bdrs`. Returns list of BDRs for selection in campaign forms.

### GET /clients (existing - used for client selection)
Already exists at `/api/v1/admin/clients`. Returns list of active clients for dropdown.

## Frontend Service Functions (New)

```typescript
// campaigns.ts additions
export async function deleteCampaign(id: string): Promise<void>;
export async function archiveCampaign(id: string): Promise<void>;
export async function fetchContactQuality(id: string): Promise<ContactQualityStats>;

// New: external campaign fetching
export async function fetchExternalCampaigns(
  clientId: string,
  platform: 'instantly' | 'heyreach'
): Promise<{ id: string; name: string; status?: string }[]>;
```
