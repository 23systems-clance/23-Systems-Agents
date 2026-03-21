/**
 * TypeScript interfaces for the AI ARK Personality Analysis API.
 *
 * Endpoint: POST /api/developer-portal/v1/people/analysis
 * Auth: X-TOKEN header (same as other AI ARK endpoints)
 *
 * NOTE: These interfaces are based on the V2 Dark Analytics mockup.
 * The actual API response shape should be verified on first call
 * and these types adjusted accordingly.
 */

/** Request body for POST /v1/people/analysis */
export interface PersonalityAnalysisRequest {
  linkedin?: string;
  name?: string;
  domain?: string;
}

/** Individual DISC or OCEAN dimension score */
export interface PersonalityDimension {
  score: number;
  level: string;
}

/** DISC profile (scored 0-10 per dimension) */
export interface DISCProfile {
  dominance: PersonalityDimension;
  influence: PersonalityDimension;
  steadiness: PersonalityDimension;
  calculativeness: PersonalityDimension;
}

/** OCEAN / Big Five profile (scored 0-10 per dimension) */
export interface OCEANProfile {
  openness: PersonalityDimension;
  conscientiousness: PersonalityDimension;
  extraversion: PersonalityDimension;
  agreeableness: PersonalityDimension;
  emotional_stability: PersonalityDimension;
}

/** Archetype information */
export interface Archetype {
  name: string;
  score: number;
  description: string;
}

/** Communication style guidance */
export interface CommunicationStyle {
  tags: string[];
  what_to_say: string[];
  what_to_avoid: string[];
}

/** Key decision-making traits */
export interface DecisionTraits {
  risk_tolerance: string;
  ability_to_say_no: string;
  decision_speed: string;
  decision_drivers: string;
}

/** Email approach guide */
export interface EmailApproach {
  tone: string;
  length: string;
  greeting: string;
  subject: string;
  messaging: string;
  closing: string;
  bullet_points: string;
}

/** Top-level API response from POST /v1/people/analysis */
export interface PersonalityAnalysisResponse {
  name?: string;
  title?: string;
  company?: string;
  linkedin_url?: string;
  email?: string;

  archetype?: Archetype;
  disc?: DISCProfile;
  ocean?: OCEANProfile;
  communication_style?: CommunicationStyle;
  decision_traits?: DecisionTraits;
  email_approach?: EmailApproach;

  error?: string;
}

/** Metadata from the app (campaign context, etc.) passed to the renderer */
export interface PersonalityContactMeta {
  contactId?: string;
  campaignName?: string;
  clientName?: string;
  enrichedAt?: Date;
}
