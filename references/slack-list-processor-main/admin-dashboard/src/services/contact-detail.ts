/**
 * Contact detail API functions for BDR dashboard.
 */

import { api } from '@/lib/api-client';
import { bdrApi } from '@/lib/bdr-api-client';

export interface PersonalityEnrichResult {
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  archetype: string | null;
  enrichedAt: string;
}

export interface PersonalityData {
  archetype?: { name: string; score: number };
  disc?: { dominance: number; influence: number; steadiness: number; calculativeness: number };
  ocean?: { openness: number; conscientiousness: number; extraversion: number; agreeableness: number; emotional_stability: number };
  communication?: { types?: string[]; adjectives?: string[]; what_to_say?: string[]; what_to_avoid?: string[] };
  key_traits?: { risk_tolerance?: string; ability_to_say_no?: string; decision_speed?: string; decision_drivers?: string[] };
  email_approach?: { tone?: string; length?: string; greeting?: string; subject?: string; messaging?: string; closing?: string };
}

export interface ContactDetail {
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    companyName: string | null;
    jobTitle: string | null;
    linkedinUrl: string | null;
    mobilePhone: string | null;
    resolvedPhone: string | null;
    status: string;
    lastActivityAt: string | null;
    createdAt: string;
  };
  campaign: {
    id: string;
    name: string;
    status: string;
    clientName: string | null;
  } | null;
  personality: PersonalityData | null;
  personalityEnrichedAt: string | null;
  conversationHistory: {
    replies: Array<{
      id: string;
      channel: string;
      fromName: string | null;
      fromEmail: string | null;
      subject: string | null;
      body: string;
      isRead: boolean;
      receivedAt: string;
      draftStatus: string | null;
      draftIntent: string | null;
    }>;
    executions: Array<{
      id: string;
      stepIndex: number;
      stepType: string;
      status: string;
      result: string | null;
      createdAt: string;
      completedAt: string | null;
    }>;
  };
}

/**
 * Fetches full contact detail including personality and conversation history.
 */
export async function getContactDetail(contactId: string): Promise<ContactDetail> {
  const { data } = await api.get<ContactDetail>(`/contacts/${contactId}`);
  return data;
}

/**
 * Triggers AI Ark personality enrichment for a contact.
 */
export async function enrichContact(
  contactId: string,
  force = false,
): Promise<PersonalityEnrichResult> {
  const { data } = await bdrApi.post<PersonalityEnrichResult>(
    `/personality/${contactId}/enrich`,
    { force },
  );
  return data;
}
