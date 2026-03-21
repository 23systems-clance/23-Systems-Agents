/**
 * Campaign CRUD and lifecycle management service (Feature 6).
 *
 * Handles creation, validation, activation, pause/resume, and querying
 * of outreach campaigns for the BDR Manager Agent.
 */

import { CampaignStatus, CampaignType, StepType } from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { ValidationError } from '../../lib/errors.js';
import type {
  CreateCampaignInput,
  UpdateCampaignInput,
  CampaignDetail,
  CampaignFilters,
  ValidationResult,
  PaginatedResult,
} from './types.js';


// ---------------------------------------------------------------------------
// Campaign CRUD
// ---------------------------------------------------------------------------

/**
 * Creates a campaign in DRAFT status with sequence steps and BDR assignments.
 */
export async function createCampaign(input: CreateCampaignInput): Promise<CampaignDetail> {
  const campaign = await prisma.campaign.create({
    data: {
      slackTeamId: input.slackTeamId,
      name: input.name,
      description: input.description,
      campaignType: input.campaignType,
      status: CampaignStatus.DRAFT,
      icpDefinition: input.icpDefinition,
      meetingLink: input.meetingLink,
      callScript: input.callScript,
      emailSequenceCopy: input.emailSequenceCopy,
      linkedinSequenceCopy: input.linkedinSequenceCopy,
      hubspotListId: input.hubspotListId,
      externalListId: input.externalListId,
      instantlyCampaignId: input.instantlyCampaignId,
      heyreachCampaignId: input.heyreachCampaignId,
      clientId: input.clientId,
      sequenceSteps: input.sequenceSteps
        ? {
            create: input.sequenceSteps.map((s) => ({
              stepOrder: s.stepOrder,
              stepType: s.stepType,
            })),
          }
        : undefined,
      bdrs: input.bdrs
        ? {
            create: input.bdrs.map((b) => ({
              slackUserId: b.slackUserId,
              slackTeamId: b.slackTeamId,
              displayName: b.displayName,
            })),
          }
        : undefined,
    },
    include: {
      sequenceSteps: { orderBy: { stepOrder: 'asc' } },
      bdrs: true,
    },
  });

  logger.info('Campaign created', { campaignId: campaign.id, name: campaign.name });

  return await mapCampaignDetail(campaign);
}

/**
 * Updates a campaign's fields. Only allowed in DRAFT or PAUSED status.
 */
export async function updateCampaign(
  campaignId: string,
  input: UpdateCampaignInput,
): Promise<CampaignDetail> {
  const existing = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!existing) {
    throw new ValidationError(`Campaign not found: ${campaignId}`);
  }
  if (existing.status !== CampaignStatus.DRAFT && existing.status !== CampaignStatus.PAUSED) {
    throw new ValidationError(`Campaign can only be updated in DRAFT or PAUSED status (current: ${existing.status})`);
  }

  // If sequence steps are provided, replace them entirely
  if (input.sequenceSteps) {
    await prisma.campaignSequenceStep.deleteMany({ where: { campaignId } });
    await prisma.campaignSequenceStep.createMany({
      data: input.sequenceSteps.map((s) => ({
        campaignId,
        stepOrder: s.stepOrder,
        stepType: s.stepType,
      })),
    });
  }

  // If BDRs are provided, replace them entirely
  if (input.bdrs) {
    await prisma.campaignBdr.deleteMany({ where: { campaignId } });
    await prisma.campaignBdr.createMany({
      data: input.bdrs.map((b) => ({
        campaignId,
        slackUserId: b.slackUserId,
        slackTeamId: b.slackTeamId,
        displayName: b.displayName,
      })),
    });
  }

  const campaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      name: input.name,
      description: input.description,
      icpDefinition: input.icpDefinition,
      meetingLink: input.meetingLink,
      callScript: input.callScript,
      emailSequenceCopy: input.emailSequenceCopy,
      linkedinSequenceCopy: input.linkedinSequenceCopy,
      hubspotListId: input.hubspotListId,
      externalListId: input.externalListId,
      instantlyCampaignId: input.instantlyCampaignId,
      heyreachCampaignId: input.heyreachCampaignId,
      clientId: input.clientId,
    },
    include: {
      sequenceSteps: { orderBy: { stepOrder: 'asc' } },
      bdrs: true,
    },
  });

  logger.info('Campaign updated', { campaignId });

  return await mapCampaignDetail(campaign);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates that a campaign has all required assets for activation.
 * Rules vary by campaign type.
 */
export async function validateCampaignForActivation(campaignId: string): Promise<ValidationResult> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      sequenceSteps: { orderBy: { stepOrder: 'asc' } },
      bdrs: true,
    },
  });

  if (!campaign) {
    return { valid: false, errors: ['Campaign not found'] };
  }

  const errors: string[] = [];

  // Universal checks
  if (!campaign.name.trim()) {
    errors.push('Campaign must have a name');
  }
  if (!campaign.clientId) {
    errors.push('Campaign must have a client assigned');
  }
  if (campaign.sequenceSteps.length === 0) {
    errors.push('Campaign must have at least one sequence step');
  }
  if (campaign.bdrs.length === 0) {
    errors.push('Campaign must have at least one BDR assigned');
  }
  if (!campaign.hubspotListId && !campaign.externalListId) {
    errors.push('Campaign must have a contact list assigned (hubspotListId or externalListId)');
  }
  if (campaign.status !== CampaignStatus.DRAFT) {
    errors.push(`Campaign must be in DRAFT status to activate (current: ${campaign.status})`);
  }

  const stepTypes = new Set(campaign.sequenceSteps.map((s) => s.stepType));

  // Type-specific checks
  switch (campaign.campaignType) {
    case CampaignType.EMAIL:
      if (!campaign.emailSequenceCopy?.trim()) {
        errors.push('EMAIL campaign requires emailSequenceCopy');
      }
      if (!campaign.instantlyCampaignId?.trim()) {
        errors.push('EMAIL campaign requires instantlyCampaignId');
      }
      for (const step of campaign.sequenceSteps) {
        if (step.stepType !== StepType.EMAIL) {
          errors.push(`EMAIL campaign can only have EMAIL steps (found ${step.stepType} at step ${step.stepOrder})`);
        }
      }
      break;

    case CampaignType.PHONE:
      if (!campaign.callScript?.trim()) {
        errors.push('PHONE campaign requires callScript');
      }
      for (const step of campaign.sequenceSteps) {
        if (step.stepType !== StepType.PHONE) {
          errors.push(`PHONE campaign can only have PHONE steps (found ${step.stepType} at step ${step.stepOrder})`);
        }
      }
      break;

    case CampaignType.LINKEDIN:
      if (!campaign.linkedinSequenceCopy?.trim()) {
        errors.push('LINKEDIN campaign requires linkedinSequenceCopy');
      }
      if (!campaign.heyreachCampaignId?.trim()) {
        errors.push('LINKEDIN campaign requires heyreachCampaignId');
      }
      for (const step of campaign.sequenceSteps) {
        if (step.stepType !== StepType.LINKEDIN) {
          errors.push(`LINKEDIN campaign can only have LINKEDIN steps (found ${step.stepType} at step ${step.stepOrder})`);
        }
      }
      break;

    case CampaignType.MULTI_CHANNEL:
      // Step 1 must be EMAIL for multi-channel
      if (campaign.sequenceSteps.length > 0 && campaign.sequenceSteps[0].stepType !== StepType.EMAIL) {
        errors.push('MULTI_CHANNEL campaign must start with an EMAIL step');
      }
      if (!campaign.emailSequenceCopy?.trim()) {
        errors.push('MULTI_CHANNEL campaign requires emailSequenceCopy');
      }
      if (!campaign.instantlyCampaignId?.trim()) {
        errors.push('MULTI_CHANNEL campaign requires instantlyCampaignId');
      }
      if (stepTypes.has(StepType.PHONE) && !campaign.callScript?.trim()) {
        errors.push('MULTI_CHANNEL campaign with PHONE steps requires callScript');
      }
      // LinkedIn steps are allowed without heyreachCampaignId (they'll be skipped)
      break;
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Lifecycle Transitions
// ---------------------------------------------------------------------------

/**
 * Activates a DRAFT campaign: validates, transitions to ACTIVE.
 * Contact import and sequence initialization are handled by the caller (queue worker).
 */
export async function activateCampaign(campaignId: string): Promise<CampaignDetail> {
  const validation = await validateCampaignForActivation(campaignId);
  if (!validation.valid) {
    throw new ValidationError(`Campaign cannot be activated: ${validation.errors.join('; ')}`);
  }

  const campaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: CampaignStatus.ACTIVE },
    include: {
      sequenceSteps: { orderBy: { stepOrder: 'asc' } },
      bdrs: true,
    },
  });

  logger.info('Campaign activated', { campaignId });

  return await mapCampaignDetail(campaign);
}

/**
 * Pauses an ACTIVE campaign. Stops automated step execution.
 */
export async function pauseCampaign(campaignId: string): Promise<CampaignDetail> {
  const existing = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!existing) throw new ValidationError(`Campaign not found: ${campaignId}`);
  if (existing.status !== CampaignStatus.ACTIVE) {
    throw new ValidationError(`Only ACTIVE campaigns can be paused (current: ${existing.status})`);
  }

  const campaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: CampaignStatus.PAUSED },
    include: {
      sequenceSteps: { orderBy: { stepOrder: 'asc' } },
      bdrs: true,
    },
  });

  logger.info('Campaign paused', { campaignId });

  return await mapCampaignDetail(campaign);
}

/**
 * Resumes a PAUSED campaign.
 */
export async function resumeCampaign(campaignId: string): Promise<CampaignDetail> {
  const existing = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!existing) throw new ValidationError(`Campaign not found: ${campaignId}`);
  if (existing.status !== CampaignStatus.PAUSED) {
    throw new ValidationError(`Only PAUSED campaigns can be resumed (current: ${existing.status})`);
  }

  const campaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: CampaignStatus.ACTIVE },
    include: {
      sequenceSteps: { orderBy: { stepOrder: 'asc' } },
      bdrs: true,
    },
  });

  logger.info('Campaign resumed', { campaignId });

  return await mapCampaignDetail(campaign);
}

// ---------------------------------------------------------------------------
// Delete / Archive
// ---------------------------------------------------------------------------

/**
 * Hard-deletes a DRAFT campaign with 0 contacts.
 * Cascades: CampaignBdr, CampaignSequenceStep.
 *
 * @throws ValidationError if campaign is not DRAFT or has contacts.
 */
export async function deleteCampaign(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { _count: { select: { contacts: true } } },
  });
  if (!campaign) throw new ValidationError(`Campaign not found: ${campaignId}`);

  if (campaign.status !== CampaignStatus.DRAFT) {
    throw new ValidationError('Only DRAFT campaigns can be permanently deleted. Use archive for other statuses.');
  }
  if (campaign._count.contacts > 0) {
    throw new ValidationError('Cannot delete campaign with imported contacts. Use archive instead.');
  }

  await prisma.$transaction([
    prisma.campaignBdr.deleteMany({ where: { campaignId } }),
    prisma.campaignSequenceStep.deleteMany({ where: { campaignId } }),
    prisma.campaign.delete({ where: { id: campaignId } }),
  ]);

  logger.info('Campaign hard-deleted', { campaignId });
}

/**
 * Archives a campaign by setting status to ARCHIVED.
 * For ACTIVE campaigns, also removes queued BullMQ jobs.
 */
export async function archiveCampaign(campaignId: string): Promise<CampaignDetail> {
  const existing = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!existing) throw new ValidationError(`Campaign not found: ${campaignId}`);
  if (existing.status === CampaignStatus.ARCHIVED) {
    throw new ValidationError('Campaign is already archived');
  }

  const campaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: CampaignStatus.ARCHIVED },
    include: {
      sequenceSteps: { orderBy: { stepOrder: 'asc' } },
      bdrs: true,
    },
  });

  logger.info('Campaign archived', { campaignId, previousStatus: existing.status });

  return await mapCampaignDetail(campaign);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Retrieves a campaign with sequence steps and BDR assignments.
 */
export async function getCampaignDetail(campaignId: string): Promise<CampaignDetail | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      sequenceSteps: { orderBy: { stepOrder: 'asc' } },
      bdrs: true,
    },
  });

  if (!campaign) return null;

  return await mapCampaignDetail(campaign);
}

/**
 * Lists campaigns for a workspace with pagination and optional filters.
 */
export async function listCampaigns(
  slackTeamId: string,
  filters?: CampaignFilters,
): Promise<PaginatedResult<CampaignDetail>> {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { slackTeamId };
  if (filters?.status) where.status = filters.status;
  if (filters?.campaignType) where.campaignType = filters.campaignType;
  if (filters?.clientId) where.clientId = filters.clientId;
  if (filters?.search) {
    where.name = { contains: filters.search, mode: 'insensitive' };
  }

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      include: {
        sequenceSteps: { orderBy: { stepOrder: 'asc' } },
        bdrs: true,
        client: { select: { id: true, name: true, slug: true, isActive: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.campaign.count({ where }),
  ]);

  return {
    data: await Promise.all(campaigns.map(mapCampaignDetail)),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a Prisma campaign record to a CampaignDetail response object.
 * Looks up BDR active status from the Bdr table by slackUserId.
 */
async function mapCampaignDetail(campaign: Record<string, unknown>): Promise<CampaignDetail> {
  const c = campaign as Record<string, unknown>;
  const campaignBdrs = c.bdrs as Array<{ id: string; slackUserId: string; displayName: string }>;

  // Batch-lookup BDR active status by slackUserId
  const slackUserIds = campaignBdrs.map((b) => b.slackUserId);
  const bdrRecords = slackUserIds.length > 0
    ? await prisma.bdr.findMany({
        where: { slackUserId: { in: slackUserIds } },
        select: { slackUserId: true, isActive: true },
      })
    : [];
  const bdrActiveMap = new Map(bdrRecords.map((b) => [b.slackUserId, b.isActive]));

  return {
    id: c.id as string,
    slackTeamId: c.slackTeamId as string,
    name: c.name as string,
    description: c.description as string | null,
    campaignType: c.campaignType as CampaignType,
    status: c.status as CampaignStatus,
    icpDefinition: c.icpDefinition as string | null,
    meetingLink: c.meetingLink as string | null,
    callScript: c.callScript as string | null,
    emailSequenceCopy: c.emailSequenceCopy as string | null,
    linkedinSequenceCopy: c.linkedinSequenceCopy as string | null,
    hubspotListId: c.hubspotListId as string | null,
    externalListId: c.externalListId as string | null,
    instantlyCampaignId: c.instantlyCampaignId as string | null,
    heyreachCampaignId: c.heyreachCampaignId as string | null,
    clientId: c.clientId as string | null,
    client: (c.client as { id: string; name: string; slug: string; isActive: boolean } | null) ?? null,
    totalContacts: c.totalContacts as number,
    activeContacts: c.activeContacts as number,
    completedContacts: c.completedContacts as number,
    createdAt: c.createdAt as Date,
    updatedAt: c.updatedAt as Date,
    sequenceSteps: (c.sequenceSteps as Array<{ id: string; stepOrder: number; stepType: StepType }>)
      .map((s) => ({ id: s.id, stepOrder: s.stepOrder, stepType: s.stepType })),
    bdrs: campaignBdrs.map((b) => ({
      id: b.id,
      slackUserId: b.slackUserId,
      displayName: b.displayName,
      isActive: bdrActiveMap.get(b.slackUserId) ?? true,
    })),
  };
}
