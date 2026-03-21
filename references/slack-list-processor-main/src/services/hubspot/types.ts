/**
 * HubSpot API type definitions for contact and list operations.
 */

/** HubSpot contact properties fetched from the CRM API. */
export interface HubSpotContactProperties {
  firstname?: string;
  lastname?: string;
  email?: string;
  mobilephone?: string;
  phone?: string;
  hs_linkedin_url?: string;
  company?: string;
  jobtitle?: string;
  hs_email_domain?: string;
  /** HubSpot stores email verification as a string. */
  hs_email_status?: string;
  /** Hard/soft bounce indicator. */
  hs_email_bounce?: string;
  /** Do Not Call flag from HubSpot. */
  donotcall?: string;
}

/** A single contact record from HubSpot. */
export interface HubSpotContact {
  id: string;
  properties: HubSpotContactProperties;
  createdAt: string;
  updatedAt: string;
}

/** Paginated response from HubSpot CRM API. */
export interface HubSpotPaginatedResponse<T> {
  results: T[];
  paging?: {
    next?: {
      after: string;
      link: string;
    };
  };
}

/** HubSpot list membership response. */
export interface HubSpotListMembershipsResponse {
  results: Array<{ recordId: string }>;
  paging?: {
    next?: {
      after: string;
    };
  };
}
