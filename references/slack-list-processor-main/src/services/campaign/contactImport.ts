/**
 * Contact import service for campaigns.
 *
 * Pulls contacts from a HubSpot list, computes derived fields
 * (phone resolution, capability flags), and batch-inserts into
 * the CampaignContact table.
 */

import { ContactCampaignStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';
import { getContactsFromList } from '../hubspot/hubspotClient.js';
import { isValidLinkedInUrl } from './validators.js';
import logger from '../../lib/logger.js';
import type { ImportResult } from './types.js';


/**
 * Imports contacts from a HubSpot list into a campaign.
 *
 * Steps:
 * 1. Fetch the campaign to get the hubspotListId
 * 2. Pull all contacts from the HubSpot list
 * 3. Compute derived fields (resolvedPhone, canEmail, canCall, canLinkedin)
 * 4. Batch-insert into CampaignContact
 * 5. Update campaign counters
 *
 * @param campaignId - The campaign to import contacts into
 * @returns Import result with counts
 */
export async function importContactsFromHubSpot(campaignId: string): Promise<ImportResult> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  if (!campaign.hubspotListId) {
    throw new Error(`Campaign ${campaignId} has no hubspotListId configured`);
  }

  logger.info('Starting HubSpot contact import', {
    campaignId,
    hubspotListId: campaign.hubspotListId,
  });

  const hubspotContacts = await getContactsFromList(campaign.hubspotListId);

  if (hubspotContacts.length === 0) {
    logger.warn('No contacts found in HubSpot list', {
      campaignId,
      hubspotListId: campaign.hubspotListId,
    });
    return { imported: 0, skipped: 0, total: 0, canEmail: 0, canCall: 0, canLinkedin: 0 };
  }

  // Map HubSpot contacts to CampaignContact records with derived fields
  const contactRecords = hubspotContacts.map((hc) => {
    const props = hc.properties;
    const mobilePhone = props.mobilephone?.trim() || null;
    const directPhone = props.phone?.trim() || null;
    const resolvedPhone = mobilePhone || directPhone || null;
    const email = props.email?.trim() || null;
    const linkedinUrl = props.hs_linkedin_url?.trim() || null;

    // Email: valid if present, not bounced status, and no hard bounce indicator
    const emailStatus = props.hs_email_status?.trim()?.toLowerCase();
    const emailBounce = props.hs_email_bounce?.trim()?.toLowerCase();
    const canEmail = !!email && emailStatus !== 'bounced' && emailBounce !== 'hard_bounce';

    // Phone: only callable if phone exists AND DNC is explicitly 'false'
    const donotcall = props.donotcall?.trim();
    const canCall = !!resolvedPhone && String(donotcall).toLowerCase() === 'false';

    return {
      campaignId,
      hubspotContactId: hc.id,
      firstName: props.firstname?.trim() || '',
      lastName: props.lastname?.trim() || '',
      email,
      emailVerified: canEmail,
      mobilePhone,
      directPhone,
      linkedinUrl,
      companyName: props.company?.trim() || null,
      jobTitle: props.jobtitle?.trim() || null,
      resolvedPhone,
      canEmail,
      canCall,
      canLinkedin: isValidLinkedInUrl(linkedinUrl),
      status: ContactCampaignStatus.ACTIVE,
    };
  });

  // Batch insert (Prisma createMany skips duplicates with skipDuplicates)
  const result = await prisma.campaignContact.createMany({
    data: contactRecords,
    skipDuplicates: true,
  });

  const imported = result.count;
  const skipped = contactRecords.length - imported;

  // Compute capability counts from the records we built
  const canEmailCount = contactRecords.filter((c) => c.canEmail).length;
  const canCallCount = contactRecords.filter((c) => c.canCall).length;
  const canLinkedinCount = contactRecords.filter((c) => c.canLinkedin).length;

  // Update campaign counters
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      totalContacts: { increment: imported },
      activeContacts: { increment: imported },
    },
  });

  logger.info('HubSpot contact import complete', {
    campaignId,
    hubspotListId: campaign.hubspotListId,
    imported,
    skipped,
    total: contactRecords.length,
    canEmail: canEmailCount,
    canCall: canCallCount,
    canLinkedin: canLinkedinCount,
  });

  return {
    imported,
    skipped,
    total: contactRecords.length,
    canEmail: canEmailCount,
    canCall: canCallCount,
    canLinkedin: canLinkedinCount,
  };
}
