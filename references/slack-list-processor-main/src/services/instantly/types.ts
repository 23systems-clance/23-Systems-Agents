/**
 * TypeScript interfaces for the Instantly.ai API v2.
 */

/** Lead input for adding to an Instantly campaign. */
export interface InstantlyLeadInput {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  personalization?: string;
  phone?: string;
  website?: string;
  custom_variables?: Record<string, string>;
}

/** Response from the bulk add leads endpoint. */
export interface InstantlyAddLeadsResponse {
  status: string;
  total_leads_added: number;
  failed_leads?: Array<{
    email: string;
    reason: string;
  }>;
}

/** Email record from the Instantly UniBox API. */
export interface InstantlyEmail {
  id: string;
  campaign_id: string;
  lead_email: string;
  from_email: string;
  subject: string;
  body: string;
  timestamp: string;
  is_reply: boolean;
}

/** Response from the UniBox emails list endpoint. */
export interface InstantlyUniBoxResponse {
  data: InstantlyEmail[];
  next_cursor?: string;
}

/** Response from the reply-to-email endpoint. */
export interface InstantlyReplyResponse {
  status: string;
  message_id?: string;
}

/** Instantly campaign analytics. */
export interface InstantlyCampaignAnalytics {
  campaign_id: string;
  total_leads: number;
  contacted: number;
  emails_sent: number;
  emails_opened: number;
  emails_replied: number;
  bounced: number;
}

/** Instantly campaign list item from the campaigns endpoint. */
export interface InstantlyCampaignListItem {
  id: string;
  name: string;
  status: string;
}

/** Instantly webhook event payload. */
export interface InstantlyWebhookPayload {
  event_type: string;
  campaign_id?: string;
  lead_email?: string;
  from_email?: string;
  subject?: string;
  body?: string;
  timestamp?: string;
  [key: string]: unknown;
}
