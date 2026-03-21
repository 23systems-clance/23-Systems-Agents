/**
 * TypeScript interfaces for the HeyReach API.
 */

/** Lead input for adding to a HeyReach campaign. */
export interface HeyReachLeadInput {
  linkedInUrl: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
}

/** HeyReach list item for adding leads. */
export interface HeyReachListItem {
  linkedInUrl: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
}

/** Response from the add leads to campaign endpoint. */
export interface HeyReachAddLeadsResponse {
  success: boolean;
  leadsAdded?: number;
  message?: string;
}

/** HeyReach campaign info. */
export interface HeyReachCampaign {
  id: number;
  name: string;
  status: string;
}

/** HeyReach campaign list item from campaigns list endpoint. */
export interface HeyReachCampaignListItem {
  id: number;
  name: string;
  status: string;
}

/** HeyReach campaign stats. */
export interface HeyReachCampaignStats {
  campaignId: number;
  connectionRequestsSent: number;
  connectionRequestsAccepted: number;
  messagesSent: number;
  messagesReceived: number;
  inmailsSent: number;
  inmailsReceived: number;
}

/** HeyReach conversation from the inbox. */
export interface HeyReachConversation {
  id: string;
  campaignId: number;
  linkedInUrl: string;
  firstName: string;
  lastName: string;
  messages: HeyReachMessage[];
}

/** Individual message in a HeyReach conversation. */
export interface HeyReachMessage {
  id: string;
  body: string;
  sentAt: string;
  isOutgoing: boolean;
}

/** HeyReach webhook event payload. */
export interface HeyReachWebhookPayload {
  event_type: string;
  campaign_id?: number;
  linkedin_url?: string;
  first_name?: string;
  last_name?: string;
  message_body?: string;
  timestamp?: string;
  [key: string]: unknown;
}
