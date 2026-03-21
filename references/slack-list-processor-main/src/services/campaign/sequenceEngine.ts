/**
 * Campaign sequence engine — core state machine.
 *
 * Manages the lifecycle of contacts through campaign sequence steps:
 * - Initializes contacts at step 0 and fires step 1
 * - Advances contacts to the next step after webhook confirmation
 * - Skips steps where the contact lacks required data
 * - Marks contacts as COMPLETED when all steps are done
 */

import {
  StepType,
  StepExecutionStatus,
  ContactCampaignStatus,
} from '@prisma/client';
import { prisma } from '../../models/index.js';
import { executeEmailStep } from './executors/emailExecutor.js';
import { executeLinkedinStep } from './executors/linkedinExecutor.js';
import { executeCallStep } from './executors/callExecutor.js';
import logger from '../../lib/logger.js';


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CampaignWithSteps {
  id: string;
  instantlyCampaignId: string | null;
  heyreachCampaignId: string | null;
  sequenceSteps: Array<{
    id: string;
    stepOrder: number;
    stepType: StepType;
  }>;
}

interface ContactForExecution {
  id: string;
  email: string | null;
  firstName: string;
  lastName: string;
  companyName: string | null;
  linkedinUrl: string | null;
  resolvedPhone: string | null;
  canEmail: boolean;
  canCall: boolean;
  canLinkedin: boolean;
  currentStepIndex: number;
}

// ---------------------------------------------------------------------------
// Initialize Sequence
// ---------------------------------------------------------------------------

/**
 * Initializes sequence execution for all ACTIVE contacts in a campaign.
 * Called after contact import is complete.
 *
 * For each contact, fires the first non-skippable step.
 *
 * @param campaignId - Campaign to initialize
 */
export async function initializeSequence(campaignId: string): Promise<void> {
  const campaign = await getCampaignWithSteps(campaignId);
  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  if (campaign.sequenceSteps.length === 0) {
    logger.warn('Campaign has no sequence steps, skipping initialization', { campaignId });
    return;
  }

  const contacts = await prisma.campaignContact.findMany({
    where: {
      campaignId,
      status: ContactCampaignStatus.ACTIVE,
      currentStepIndex: 0,
    },
  });

  logger.info('Initializing sequence for contacts', {
    campaignId,
    contactCount: contacts.length,
  });

  for (const contact of contacts) {
    try {
      await executeNextStep(contact as ContactForExecution, campaign);
    } catch (err) {
      const error = err as Error;
      logger.error('Failed to initialize sequence for contact', {
        campaignId,
        contactId: contact.id,
        error: error.message,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Execute Step
// ---------------------------------------------------------------------------

/**
 * Executes the current step for a contact.
 * Creates a step execution record and delegates to the appropriate executor.
 *
 * @param contactId - CampaignContact ID
 */
export async function executeStep(contactId: string): Promise<void> {
  const contact = await prisma.campaignContact.findUnique({
    where: { id: contactId },
  });

  if (!contact || contact.status !== ContactCampaignStatus.ACTIVE) {
    logger.warn('Contact not found or not active, skipping step execution', { contactId });
    return;
  }

  const campaign = await getCampaignWithSteps(contact.campaignId);
  if (!campaign) {
    logger.error('Campaign not found for contact', { contactId, campaignId: contact.campaignId });
    return;
  }

  await executeNextStep(contact as ContactForExecution, campaign);
}

// ---------------------------------------------------------------------------
// Advance Contact
// ---------------------------------------------------------------------------

/**
 * Advances a contact to the next step in the sequence.
 * Called by webhook handlers after a step is confirmed complete.
 *
 * Skips steps where the contact lacks required data.
 * Marks the contact as COMPLETED if no more steps remain.
 *
 * @param contactId - CampaignContact ID
 */
export async function advanceContact(contactId: string): Promise<void> {
  const contact = await prisma.campaignContact.findUnique({
    where: { id: contactId },
  });

  if (!contact) {
    logger.error('Contact not found for advancement', { contactId });
    return;
  }

  if (contact.status !== ContactCampaignStatus.ACTIVE) {
    logger.warn('Contact not active, skipping advancement', {
      contactId,
      status: contact.status,
    });
    return;
  }

  const campaign = await getCampaignWithSteps(contact.campaignId);
  if (!campaign) {
    logger.error('Campaign not found for contact advancement', {
      contactId,
      campaignId: contact.campaignId,
    });
    return;
  }

  const nextStepIndex = contact.currentStepIndex + 1;

  // Check if we've exhausted all steps
  if (nextStepIndex >= campaign.sequenceSteps.length) {
    await markContactCompleted(contactId);
    return;
  }

  // Update contact to next step
  await prisma.campaignContact.update({
    where: { id: contactId },
    data: {
      currentStepIndex: nextStepIndex,
      lastActivityAt: new Date(),
    },
  });

  // Reload contact with updated step index
  const updatedContact = await prisma.campaignContact.findUnique({
    where: { id: contactId },
  });

  if (updatedContact) {
    await executeNextStep(updatedContact as ContactForExecution, campaign);
  }
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Finds the next non-skippable step and executes it.
 * If all remaining steps should be skipped, marks the contact as completed.
 */
async function executeNextStep(
  contact: ContactForExecution,
  campaign: CampaignWithSteps,
): Promise<void> {
  const steps = campaign.sequenceSteps;
  let stepIndex = contact.currentStepIndex;

  // Find the next step that shouldn't be skipped
  while (stepIndex < steps.length) {
    const step = steps[stepIndex];
    if (!shouldSkipStep(contact, step.stepType, campaign)) {
      break;
    }

    // Create a skipped execution record
    await prisma.campaignContactStepExecution.create({
      data: {
        campaignContactId: contact.id,
        stepIndex,
        stepType: step.stepType,
        status: StepExecutionStatus.SKIPPED,
        result: getSkipReason(contact, step.stepType, campaign),
        completedAt: new Date(),
      },
    });

    logger.info('Skipping step', {
      contactId: contact.id,
      stepIndex,
      stepType: step.stepType,
      reason: getSkipReason(contact, step.stepType, campaign),
    });

    stepIndex++;
  }

  // If we've exhausted all steps, mark complete
  if (stepIndex >= steps.length) {
    await markContactCompleted(contact.id);
    return;
  }

  // Update step index if we skipped any steps
  if (stepIndex !== contact.currentStepIndex) {
    await prisma.campaignContact.update({
      where: { id: contact.id },
      data: { currentStepIndex: stepIndex },
    });
  }

  const step = steps[stepIndex];

  // Create step execution record
  const execution = await prisma.campaignContactStepExecution.create({
    data: {
      campaignContactId: contact.id,
      stepIndex,
      stepType: step.stepType,
      status: StepExecutionStatus.FIRED,
    },
  });

  // Delegate to the appropriate executor
  switch (step.stepType) {
    case StepType.EMAIL:
      if (!campaign.instantlyCampaignId || !contact.email) {
        await markExecutionFailed(execution.id, 'Missing instantlyCampaignId or email');
        return;
      }
      await executeEmailStep(execution.id, campaign.instantlyCampaignId, {
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        companyName: contact.companyName,
      });
      break;

    case StepType.LINKEDIN:
      if (!campaign.heyreachCampaignId || !contact.linkedinUrl) {
        await markExecutionFailed(execution.id, 'Missing heyreachCampaignId or linkedinUrl');
        return;
      }
      await executeLinkedinStep(execution.id, campaign.heyreachCampaignId, {
        linkedinUrl: contact.linkedinUrl,
        firstName: contact.firstName,
        lastName: contact.lastName,
        companyName: contact.companyName,
      });
      break;

    case StepType.PHONE:
      await executeCallStep(execution.id, contact.id);
      break;
  }

  // Update contact's last activity
  await prisma.campaignContact.update({
    where: { id: contact.id },
    data: {
      lastActivityAt: new Date(),
      startedAt: contact.currentStepIndex === 0 ? new Date() : undefined,
    },
  });
}

/**
 * Determines whether a step should be skipped for a contact.
 */
function shouldSkipStep(
  contact: ContactForExecution,
  stepType: StepType,
  campaign: CampaignWithSteps,
): boolean {
  switch (stepType) {
    case StepType.EMAIL:
      return !contact.canEmail;
    case StepType.PHONE:
      return !contact.canCall;
    case StepType.LINKEDIN:
      return !contact.canLinkedin || !campaign.heyreachCampaignId;
    default:
      return false;
  }
}

/**
 * Returns a human-readable reason for why a step was skipped.
 */
function getSkipReason(
  contact: ContactForExecution,
  stepType: StepType,
  campaign: CampaignWithSteps,
): string {
  switch (stepType) {
    case StepType.EMAIL:
      return 'Contact has no verified email';
    case StepType.PHONE:
      return 'Contact has no phone number';
    case StepType.LINKEDIN:
      if (!campaign.heyreachCampaignId) return 'Campaign has no HeyReach campaign configured';
      return 'Contact has no valid LinkedIn URL';
    default:
      return 'Unknown step type';
  }
}

/**
 * Marks a contact as COMPLETED and updates campaign counters.
 */
async function markContactCompleted(contactId: string): Promise<void> {
  const contact = await prisma.campaignContact.update({
    where: { id: contactId },
    data: {
      status: ContactCampaignStatus.COMPLETED,
      completedAt: new Date(),
      lastActivityAt: new Date(),
    },
  });

  // Update campaign counters
  await prisma.campaign.update({
    where: { id: contact.campaignId },
    data: {
      activeContacts: { decrement: 1 },
      completedContacts: { increment: 1 },
    },
  });

  logger.info('Contact sequence completed', { contactId, campaignId: contact.campaignId });
}

/**
 * Marks a step execution as FAILED with a reason.
 */
async function markExecutionFailed(executionId: string, reason: string): Promise<void> {
  await prisma.campaignContactStepExecution.update({
    where: { id: executionId },
    data: {
      status: StepExecutionStatus.FAILED,
      result: reason,
      completedAt: new Date(),
    },
  });

  logger.error('Step execution failed', { executionId, reason });
}

/**
 * Fetches a campaign with its sequence steps ordered by stepOrder.
 */
async function getCampaignWithSteps(campaignId: string): Promise<CampaignWithSteps | null> {
  return prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      instantlyCampaignId: true,
      heyreachCampaignId: true,
      sequenceSteps: {
        orderBy: { stepOrder: 'asc' },
        select: {
          id: true,
          stepOrder: true,
          stepType: true,
        },
      },
    },
  });
}
