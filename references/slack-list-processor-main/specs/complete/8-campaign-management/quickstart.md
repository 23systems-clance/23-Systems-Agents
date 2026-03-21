# Quickstart: Campaign Management Enhancements

**Feature**: 8-campaign-management

## Files to Modify

### Backend
| File | Change |
| ---- | ------ |
| `src/routes/admin/campaigns.ts` | Add DELETE endpoint, add `clientId` filter to GET list, include client/quality in GET detail, return validation errors on activate |
| `src/routes/admin/clientManagement.ts` | Add GET `/:clientId/external-campaigns` endpoint |
| `src/services/campaign/campaignService.ts` | Update `validateCampaignForActivation()` to require client, add `deleteCampaign()` and `archiveCampaign()` functions |
| `src/services/campaign/contactImport.ts` | Update `canCall` logic to check `donotcall` HubSpot property |
| `src/services/campaign/statsAggregator.ts` | Add `getContactQualityStats()` function |
| `src/services/campaign/types.ts` | Add `ContactQualityStats` and `ExternalCampaignItem` types |
| `src/services/instantly/instantlyClient.ts` | Add `listCampaigns(apiKey)` function |
| `src/services/instantly/types.ts` | Add `InstantlyCampaignListItem` type |
| `src/services/heyreach/heyreachClient.ts` | Add `listCampaigns(apiKey)` function |
| `src/services/heyreach/types.ts` | Add `HeyReachCampaignListItem` type |
| `src/lib/clientApiService.ts` | **New** - decrypt client API keys for per-client API calls |

### Frontend
| File | Change |
| ---- | ------ |
| `admin-dashboard/src/services/campaigns.ts` | Add `deleteCampaign`, `archiveCampaign`, `fetchContactQuality`, `fetchExternalCampaigns` |
| `admin-dashboard/src/pages/campaigns.tsx` | Add client filter dropdown |
| `admin-dashboard/src/pages/campaign-detail.tsx` | Add Edit button, Delete/Archive buttons, contact quality card, client display |
| `admin-dashboard/src/pages/campaign-create.tsx` | Add BDR multi-select, client dropdown |
| `admin-dashboard/src/components/campaigns/CampaignEditDialog.tsx` | **New** - edit dialog with all campaign fields, BDR selection, client selection, external campaign linking |

## Key Patterns to Follow

- **Dialog pattern**: Follow `managed-bdrs.tsx` and `managed-clients.tsx` for edit/delete dialogs
- **AlertDialog**: Use for delete/archive confirmation (follow `workflows.tsx` pattern)
- **Multi-select**: BDR selection should use checkbox list (follow BDR association pattern in `managed-clients.tsx`)
- **Service calls**: All API calls via `admin-dashboard/src/services/` with typed responses
- **Error display**: `actionError` pattern from existing campaign-detail.tsx
- **Encryption**: Use `decrypt()` from `src/lib/tokenEncryption.ts` for client API keys

## Verification

1. Create a campaign without BDRs or client → verify edit dialog allows adding both
2. Activate campaign after setting all required fields → should succeed (no 400)
3. Filter campaigns by client → verify list updates
4. View contact quality stats after import → verify email/phone/linkedin/multi-channel counts
5. Delete a DRAFT campaign → verify hard delete
6. Archive an ACTIVE campaign → verify status change to ARCHIVED
7. Fetch external campaigns → verify Instantly/HeyReach dropdown populates
8. Import contacts with DNC contacts → verify canCall is false for DNC unknowns
