/**
 * HubSpot Personality CRM Sync service.
 *
 * Idempotently creates 16 custom `aiark_` properties in HubSpot
 * and pushes personality data for enriched campaign contacts.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';
import {
  ensureCustomProperties,
  batchUpdateContacts,
  searchContactsByEmail,
} from '../hubspot/hubspotClient.js';
import logger from '../../lib/logger.js';

/** Personality HubSpot property definitions. */
const PERSONALITY_PROPERTIES = [
  { name: 'aiark_archetype', label: 'AI Ark Archetype', type: 'string', fieldType: 'text', groupName: 'contactinformation' },
  { name: 'aiark_disc_dominance', label: 'DISC - Dominance', type: 'number', fieldType: 'number', groupName: 'contactinformation' },
  { name: 'aiark_disc_influence', label: 'DISC - Influence', type: 'number', fieldType: 'number', groupName: 'contactinformation' },
  { name: 'aiark_disc_steadiness', label: 'DISC - Steadiness', type: 'number', fieldType: 'number', groupName: 'contactinformation' },
  { name: 'aiark_disc_calculativeness', label: 'DISC - Calculativeness', type: 'number', fieldType: 'number', groupName: 'contactinformation' },
  { name: 'aiark_ocean_openness', label: 'OCEAN - Openness', type: 'number', fieldType: 'number', groupName: 'contactinformation' },
  { name: 'aiark_ocean_conscientiousness', label: 'OCEAN - Conscientiousness', type: 'number', fieldType: 'number', groupName: 'contactinformation' },
  { name: 'aiark_ocean_extraversion', label: 'OCEAN - Extraversion', type: 'number', fieldType: 'number', groupName: 'contactinformation' },
  { name: 'aiark_ocean_agreeableness', label: 'OCEAN - Agreeableness', type: 'number', fieldType: 'number', groupName: 'contactinformation' },
  { name: 'aiark_ocean_emotional_stability', label: 'OCEAN - Emotional Stability', type: 'number', fieldType: 'number', groupName: 'contactinformation' },
  { name: 'aiark_communication_types', label: 'Communication Types', type: 'string', fieldType: 'text', groupName: 'contactinformation' },
  { name: 'aiark_communication_adjectives', label: 'Communication Adjectives', type: 'string', fieldType: 'text', groupName: 'contactinformation' },
  { name: 'aiark_key_traits_risk', label: 'Key Traits - Risk Tolerance', type: 'string', fieldType: 'text', groupName: 'contactinformation' },
  { name: 'aiark_key_traits_decision_drivers', label: 'Key Traits - Decision Drivers', type: 'string', fieldType: 'text', groupName: 'contactinformation' },
  { name: 'aiark_email_tone', label: 'Email Approach - Tone', type: 'string', fieldType: 'text', groupName: 'contactinformation' },
  { name: 'aiark_email_length', label: 'Email Approach - Length', type: 'string', fieldType: 'text', groupName: 'contactinformation' },
] as const;

export interface PersonalitySyncSummary {
  total: number;
  synced: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/**
 * Pushes personality data for a campaign's enriched contacts to HubSpot.
 *
 * @param campaignId - Campaign UUID
 * @param hubspotConnectionId - HubSpot connection to use
 * @returns Sync summary with counts and errors
 */
export async function pushPersonalityToHubSpot(
  campaignId: string,
): Promise<PersonalitySyncSummary> {
  const summary: PersonalitySyncSummary = {
    total: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Find campaign with HubSpot connection
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      clientId: true,
      client: {
        select: {
          hubspotConnection: { select: { id: true, accessToken: true, status: true } },
        },
      },
    },
  });

  const campaignWithClient = campaign as any;
  if (!campaignWithClient?.client?.hubspotConnection || campaignWithClient.client.hubspotConnection.status !== 'ACTIVE') {
    throw new Error('No active HubSpot connection found for this campaign');
  }

  // Ensure custom properties exist
  await ensureCustomProperties(PERSONALITY_PROPERTIES.map((p) => ({
    name: p.name,
    label: p.label,
    type: p.type,
    fieldType: p.fieldType,
    groupName: p.groupName,
  })));

  // Get contacts with personality data
  const contacts = await prisma.campaignContact.findMany({
    where: { campaignId, personalityData: { not: Prisma.JsonNull } },
    select: {
      id: true,
      email: true,
      personalityData: true,
    },
  });

  summary.total = contacts.length;

  if (contacts.length === 0) {
    return summary;
  }

  // Find HubSpot contact IDs by email
  const emails = contacts.filter((c) => c.email).map((c) => c.email!);
  const hubspotContacts = await searchContactsByEmail(emails);

  // Build email -> HubSpot ID map
  const emailToHubSpotId = new Map<string, string>();
  for (const hc of hubspotContacts) {
    const email = hc.properties?.email?.toLowerCase();
    if (email) emailToHubSpotId.set(email, hc.id);
  }

  // Build updates
  const updates: Array<{ hubspotId: string; data: Record<string, unknown> }> = [];

  for (const contact of contacts) {
    if (!contact.email) {
      summary.skipped++;
      continue;
    }

    const hubspotId = emailToHubSpotId.get(contact.email.toLowerCase());
    if (!hubspotId) {
      summary.skipped++;
      continue;
    }

    const pd = contact.personalityData as Record<string, unknown>;
    const archetype = pd.archetype as Record<string, unknown> | undefined;
    const disc = pd.disc as Record<string, number> | undefined;
    const ocean = pd.ocean as Record<string, number> | undefined;
    const comm = pd.communication as Record<string, unknown> | undefined;
    const keyTraits = pd.key_traits as Record<string, unknown> | undefined;
    const emailApproach = pd.email_approach as Record<string, unknown> | undefined;

    const properties: Record<string, string> = {};

    if (archetype?.name) properties.aiark_archetype = String(archetype.name);
    if (disc) {
      if (disc.dominance != null) properties.aiark_disc_dominance = String(disc.dominance);
      if (disc.influence != null) properties.aiark_disc_influence = String(disc.influence);
      if (disc.steadiness != null) properties.aiark_disc_steadiness = String(disc.steadiness);
      if (disc.calculativeness != null) properties.aiark_disc_calculativeness = String(disc.calculativeness);
    }
    if (ocean) {
      if (ocean.openness != null) properties.aiark_ocean_openness = String(ocean.openness);
      if (ocean.conscientiousness != null) properties.aiark_ocean_conscientiousness = String(ocean.conscientiousness);
      if (ocean.extraversion != null) properties.aiark_ocean_extraversion = String(ocean.extraversion);
      if (ocean.agreeableness != null) properties.aiark_ocean_agreeableness = String(ocean.agreeableness);
      if (ocean.emotional_stability != null) properties.aiark_ocean_emotional_stability = String(ocean.emotional_stability);
    }
    if (comm) {
      if (Array.isArray(comm.types)) properties.aiark_communication_types = comm.types.join(', ');
      if (Array.isArray(comm.adjectives)) properties.aiark_communication_adjectives = comm.adjectives.join(', ');
    }
    if (keyTraits) {
      if (keyTraits.risk_tolerance) properties.aiark_key_traits_risk = String(keyTraits.risk_tolerance);
      if (Array.isArray(keyTraits.decision_drivers)) properties.aiark_key_traits_decision_drivers = keyTraits.decision_drivers.join(', ');
    }
    if (emailApproach) {
      if (emailApproach.tone) properties.aiark_email_tone = String(emailApproach.tone);
      if (emailApproach.length) properties.aiark_email_length = String(emailApproach.length);
    }

    updates.push({ hubspotId, data: properties });
  }

  // Batch update
  if (updates.length > 0) {
    try {
      await batchUpdateContacts(updates);
      summary.synced = updates.length;
    } catch (err) {
      summary.failed = updates.length;
      summary.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  logger.info('Personality CRM sync completed', {
    campaignId,
    ...summary,
  });

  return summary;
}
