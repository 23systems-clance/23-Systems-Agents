/**
 * Type definitions for the BDR Manager Agent campaign system (Feature 6).
 */

import type {
  CampaignType,
  CampaignStatus,
  StepType,
  ContactCampaignStatus,
} from '@prisma/client';

// ---------------------------------------------------------------------------
// Campaign CRUD
// ---------------------------------------------------------------------------

/** Input for creating a new campaign. */
export interface CreateCampaignInput {
  slackTeamId: string;
  name: string;
  description?: string;
  campaignType: CampaignType;
  icpDefinition?: string;
  meetingLink?: string;
  callScript?: string;
  emailSequenceCopy?: string;
  linkedinSequenceCopy?: string;
  hubspotListId?: string;
  externalListId?: string;
  instantlyCampaignId?: string;
  heyreachCampaignId?: string;
  /** Ordered sequence steps. */
  sequenceSteps?: { stepOrder: number; stepType: StepType }[];
  /** BDRs to assign. */
  bdrs?: { slackUserId: string; slackTeamId: string; displayName: string }[];
  /** Assign campaign to a client. */
  clientId?: string;
  /** If true, activate immediately after creation (skips DRAFT state). */
  autoActivate?: boolean;
}

/** Input for updating an existing campaign. */
export interface UpdateCampaignInput {
  name?: string;
  description?: string;
  icpDefinition?: string;
  meetingLink?: string;
  callScript?: string;
  emailSequenceCopy?: string;
  linkedinSequenceCopy?: string;
  hubspotListId?: string;
  externalListId?: string;
  instantlyCampaignId?: string;
  heyreachCampaignId?: string;
  /** Assign campaign to a client. */
  clientId?: string;
  /** Replace sequence steps entirely. */
  sequenceSteps?: { stepOrder: number; stepType: StepType }[];
  /** Replace BDR assignments entirely. */
  bdrs?: { slackUserId: string; slackTeamId: string; displayName: string }[];
}

// ---------------------------------------------------------------------------
// Campaign Detail / Listing
// ---------------------------------------------------------------------------

/** Campaign with computed stats for display. */
export interface CampaignDetail {
  id: string;
  slackTeamId: string;
  name: string;
  description: string | null;
  campaignType: CampaignType;
  status: CampaignStatus;
  icpDefinition: string | null;
  meetingLink: string | null;
  callScript: string | null;
  emailSequenceCopy: string | null;
  linkedinSequenceCopy: string | null;
  hubspotListId: string | null;
  externalListId: string | null;
  instantlyCampaignId: string | null;
  heyreachCampaignId: string | null;
  clientId: string | null;
  client: { id: string; name: string; slug: string; isActive: boolean } | null;
  totalContacts: number;
  activeContacts: number;
  completedContacts: number;
  createdAt: Date;
  updatedAt: Date;
  sequenceSteps: { id: string; stepOrder: number; stepType: StepType }[];
  bdrs: { id: string; slackUserId: string; displayName: string; isActive: boolean }[];
}

/** Filters for listing campaigns. */
export interface CampaignFilters {
  status?: CampaignStatus;
  campaignType?: CampaignType;
  clientId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Result of campaign activation validation. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** Generic paginated result wrapper. */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Contact Import
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Contact Quality
// ---------------------------------------------------------------------------

/** Contact quality breakdown for a campaign (computed, not persisted). */
export interface ContactQualityStats {
  totalContacts: number;
  emailVerified: number;
  phoneCallable: number;
  linkedinAvailable: number;
  multiChannel: number;
}

/** External campaign item from Instantly or HeyReach. */
export interface ExternalCampaignItem {
  id: string;
  name: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Contact Import
// ---------------------------------------------------------------------------

/** Result of importing contacts from HubSpot into a campaign. */
export interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  canEmail: number;
  canCall: number;
  canLinkedin: number;
}
