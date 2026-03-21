/**
 * Apollo contact search filter types and defaults.
 *
 * Used across conversation state, job queue data, search execution,
 * and the admin dashboard to maintain consistent filter configuration.
 */

/** Apollo contact search filter parameters passed to the mixed_people/api_search endpoint. */
export interface ApolloContactFilters {
  /** Seniority levels to filter by (e.g. 'c_suite', 'vp', 'director'). */
  personSeniorities: string[];
  /** Specific job titles to filter by (e.g. 'CTO', 'VP of Engineering'). */
  personTitles: string[];
  /** Department filters (e.g. 'engineering', 'sales'). */
  personDepartments: string[];
  /** Job function filters. */
  personFunctions: string[];
  /** Number of results per API page (1-100). */
  perPage: number;
}

/** Default filters applied when no preset or customization is selected. */
export const DEFAULT_APOLLO_FILTERS: ApolloContactFilters = {
  personSeniorities: ['c_suite', 'founder', 'owner', 'vp', 'director'],
  personTitles: [],
  personDepartments: [],
  personFunctions: [],
  perPage: 25,
};

/** Valid seniority values accepted by Apollo's API with human-readable labels. */
export const APOLLO_SENIORITY_OPTIONS = [
  { value: 'c_suite', label: 'C-Suite' },
  { value: 'founder', label: 'Founder' },
  { value: 'owner', label: 'Owner' },
  { value: 'vp', label: 'VP' },
  { value: 'director', label: 'Director' },
  { value: 'head', label: 'Head' },
  { value: 'manager', label: 'Manager' },
  { value: 'senior', label: 'Senior' },
  { value: 'entry', label: 'Entry' },
  { value: 'intern', label: 'Intern' },
] as const;
