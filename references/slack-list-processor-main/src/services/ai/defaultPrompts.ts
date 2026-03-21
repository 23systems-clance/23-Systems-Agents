/**
 * Compiled-in default prompts for emergency fallback.
 *
 * These are the original inline prompts extracted from the 4 AI services.
 * They serve as the last-resort fallback when both Redis and the database
 * are unavailable. Under normal operation the prompt library (DB-backed)
 * is used instead.
 *
 * @module defaultPrompts
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface DefaultPrompt {
  slug: string;
  displayName: string;
  description: string;
  category: 'CLASSIFIER' | 'PARSER' | 'GENERATOR';
  modelConfig: {
    model: string;
    maxTokens: number;
    temperature?: number;
  };
  content: string;
  toolDefinitions: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// 1. Agent Intent Classifier
// ---------------------------------------------------------------------------

export const AGENT_INTENT_CLASSIFIER_PROMPT: DefaultPrompt = {
  slug: 'agent-intent-classifier',
  displayName: 'Agent Intent Classifier',
  description:
    'Classifies conversational Slack messages into one of 15 agent intents for the side-panel AI assistant.',
  category: 'CLASSIFIER',
  modelConfig: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 300,
  },
  content: `You are an intent classifier for a Slack-based AI agent that helps users with company list enrichment. Users interact via a conversational side-panel.

Classify the user's message into exactly one of these intents:

**Enrichment intents:**
1. **technographic** — Enrich a company list with technology stack data (BuiltWith). Keywords: "tech stacks", "technologies", "what software they use".
2. **contact** — Find decision makers / contacts for companies (Apollo.io). Keywords: "contacts", "decision makers", "people", "emails", "find who".
3. **combined** — Both tech data AND contacts. Keywords: "full enrichment", "everything", "tech stacks and contacts".
4. **tech_report** — Generate a technology adoption report (no file needed). Keywords: "find companies using [tech]", "who uses [tech]". CRITICAL: Extract the EXACT technology name from the user's CURRENT message (e.g. "find me 50 companies using HubSpot" → technology: "HubSpot", requestedCount: 50). Do NOT use technology names from conversation history or previous messages.

**Job management intents:**
5. **job_status** — Check on running/recent jobs. Keywords: "what's running?", "check my jobs", "status of".
6. **job_cancel** — Cancel/stop a job. Keywords: "stop job", "cancel the enrichment". Extract job ID if mentioned.
7. **job_history** — View past enrichments. Keywords: "my last enrichments", "show history", "past jobs".
8. **job_download** — Download results from a job. Keywords: "download results", "get the file", "send me the output".

**Filter intent:**
9. **filter_results** — Filter previous enrichment results. Keywords: "filter out", "only show", "exclude companies". Extract the filter expression.

**Admin intent:**
10. **usage_query** — Check workspace API usage/costs. Keywords: "show our usage", "how much have we spent", "API credits". Extract time period if mentioned.

**Settings intent:**
11. **settings_update** — Update workspace settings like spending caps or API limits. Keywords: "set cap", "change limit", "update settings", "show settings", "configure". Extract the setting details.

**Conversation management:**
12. **help** — User asking what the agent can do. Keywords: "what can you do?", "help", "how does this work".
13. **clarification** — User is responding to a question from the agent with additional information. Contextual — identify when the user is providing a missing parameter or choosing between options.
14. **confirmation** — User is confirming a proposed action. Keywords: "yes", "go ahead", "start it", "do it", "sounds good".
15. **unknown** — Message doesn't match any intent.

**Confidence scoring:**
- 0.90+ for clear, unambiguous matches
- 0.50-0.89 for reasonable but ambiguous matches
- Below 0.50 for guesses

Consider the conversation history to disambiguate. If a user says "yes" after the agent proposed an enrichment, classify as "confirmation", not "unknown".`,
  toolDefinitions: [
    {
      name: 'classify_agent_intent',
      description: 'Classify a Slack message into an agent intent',
      input_schema: {
        type: 'object',
        properties: {
          intent: {
            type: 'string',
            enum: [
              'technographic',
              'contact',
              'combined',
              'tech_report',
              'job_status',
              'job_cancel',
              'job_history',
              'job_download',
              'filter_results',
              'usage_query',
              'settings_update',
              'help',
              'clarification',
              'confirmation',
              'unknown',
            ],
          },
          confidence: {
            type: 'number',
            description: 'Confidence score between 0.0 and 1.0',
            minimum: 0.0,
            maximum: 1.0,
          },
          technology: {
            type: 'string',
            description: 'For tech_report: EXACT technology name extracted from the user\'s current message. Do NOT use names from conversation history.',
          },
          requestedCount: {
            type: 'number',
            description:
              'For tech_report: number of companies requested (e.g. "100 companies" → 100). Only extract if explicitly stated.',
          },
          jobId: {
            type: 'string',
            description:
              'For job_status/cancel/download: specific job ID referenced',
          },
          filterExpression: {
            type: 'string',
            description:
              'For filter_results: natural language filter expression',
          },
          enrichmentType: {
            type: 'string',
            description: 'Clarified enrichment type if user is specifying',
          },
          usagePeriod: {
            type: 'string',
            description:
              'For usage_query: time period like "this month" or "last 30 days"',
          },
        },
        required: ['intent', 'confidence'],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// 2. Enrichment Intent Classifier
// ---------------------------------------------------------------------------

export const ENRICHMENT_INTENT_CLASSIFIER_PROMPT: DefaultPrompt = {
  slug: 'enrichment-intent-classifier',
  displayName: 'Enrichment Intent Classifier',
  description:
    'Classifies ENRICH-prefixed Slack messages into one of 5 enrichment intents.',
  category: 'CLASSIFIER',
  modelConfig: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 200,
  },
  content: `You are an intent classifier for a Slack-based company list enrichment bot. Users send messages starting with "ENRICH" to request different types of data enrichment.

Classify the user's message into exactly one of these five intents:

1. **technographic** — The user wants to enrich a company list with technology stack data (BuiltWith). Keywords: "tech stacks", "technologies", "what software", "tech data", "technographic".

2. **contact** — The user wants to find decision makers / contacts for companies on a list (Apollo.io). Keywords: "contacts", "decision makers", "people", "emails", "phone numbers", "who works at".

3. **combined** — The user wants BOTH technographic data AND contacts in a single enrichment. Keywords: "tech stacks and contacts", "full enrichment", "everything", "technologies and decision makers".

4. **tech_report** — The user wants to generate a report of companies using a specific technology (no file upload needed). Keywords: "find companies using [technology]", "who uses [technology]", "companies that use [technology]", "report on [technology]". CRITICAL: Always extract the EXACT technology name from the user's message and country if mentioned.

5. **unknown** — The message does not clearly match any of the above intents.

Set confidence between 0.0 and 1.0 based on how clearly the message matches the intent. Use 0.9+ for obvious matches, 0.5-0.8 for ambiguous messages, below 0.5 for guesses.`,
  toolDefinitions: [
    {
      name: 'classify_intent',
      description: 'Classify an enrichment request message into an intent',
      input_schema: {
        type: 'object',
        properties: {
          intent: {
            type: 'string',
            enum: [
              'technographic',
              'contact',
              'combined',
              'tech_report',
              'unknown',
            ],
          },
          confidence: {
            type: 'number',
            description: 'Confidence score between 0 and 1',
          },
          technology: {
            type: 'string',
            description: 'For tech_report: EXACT technology name from the user\'s message. Do NOT substitute or infer.',
          },
          country: {
            type: 'string',
            description: 'For tech_report: country filter if mentioned',
          },
          additional_filters: {
            type: 'object',
            description:
              'Any additional filters extracted from the message',
          },
        },
        required: ['intent', 'confidence'],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// 3. Persona Classifier
// ---------------------------------------------------------------------------

export const PERSONA_CLASSIFIER_PROMPT: DefaultPrompt = {
  slug: 'persona-classifier',
  displayName: 'Persona Classifier',
  description:
    'Classifies job titles into one of 14 persona types for decision-maker targeting.',
  category: 'CLASSIFIER',
  modelConfig: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 200,
  },
  content: `You are a job title classifier. Given a job title, classify it into exactly one persona type.

Persona types:
- IT_LEADER: CTO, CIO, CISO, VP/Director/Head of IT, Technology
- ENGINEERING_LEADER: VP/Director/Head of Engineering, Software Development, Infrastructure
- FINANCE_LEADER: CFO, VP/Director/Head of Finance, Accounting, Controller
- SALES_LEADER: CRO, VP/Director/Head of Sales, Business Development
- FOUNDER_OWNER: Founder, Co-Founder, Owner, Managing Partner
- CEO: Chief Executive Officer
- OPERATIONS_LEADER: COO, VP/Director/Head of Operations, Supply Chain, Procurement
- HR_LEADER: CHRO, VP/Director/Head of HR, People, Talent
- CUSTOMER_SUCCESS_LEADER: VP/Director/Head of Customer Success, Client Services, Customer Support
- MARKETING_LEADER: CMO, VP/Director/Head of Marketing, Growth, Demand Generation
- PRODUCT_LEADER: CPO, VP/Director/Head of Product, Product Management
- COMPLIANCE_LEADER: CCO, General Counsel, VP/Director/Head of Compliance, Legal, Risk
- RESEARCH_LEADER: Chief Scientist, VP/Director/Head of Research, R&D, Data Science
- NON_LEADER: Does not fit any leadership persona above

Set confidence between 0.0 and 1.0 based on how clearly the title matches a persona.`,
  toolDefinitions: [
    {
      name: 'classify_persona',
      description: 'Classify a job title into a persona type',
      input_schema: {
        type: 'object',
        properties: {
          persona_type: {
            type: 'string',
            enum: [
              'IT_LEADER',
              'ENGINEERING_LEADER',
              'FINANCE_LEADER',
              'SALES_LEADER',
              'FOUNDER_OWNER',
              'CEO',
              'OPERATIONS_LEADER',
              'HR_LEADER',
              'CUSTOMER_SUCCESS_LEADER',
              'MARKETING_LEADER',
              'PRODUCT_LEADER',
              'COMPLIANCE_LEADER',
              'RESEARCH_LEADER',
              'NON_LEADER',
            ],
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },
        },
        required: ['persona_type', 'confidence'],
      },
    },
  ],
};

/** Batch tool definition for persona classifier (used for multi-title classification). */
export const PERSONA_CLASSIFIER_BATCH_TOOL = {
  name: 'classify_personas_batch',
  description: 'Classify multiple job titles into persona types',
  input_schema: {
    type: 'object',
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            persona_type: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['index', 'persona_type', 'confidence'],
        },
      },
    },
    required: ['classifications'],
  },
};

/** Batch model config overrides (higher maxTokens for multi-title responses). */
export const PERSONA_CLASSIFIER_BATCH_CONFIG = {
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 4096,
};

// ---------------------------------------------------------------------------
// 4. Filter Parser
// ---------------------------------------------------------------------------

export const FILTER_PARSER_PROMPT: DefaultPrompt = {
  slug: 'filter-parser',
  displayName: 'Filter Parser',
  description:
    'Parses natural language filter criteria into structured filter operations for CSV/XLSX data.',
  category: 'PARSER',
  modelConfig: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 1024,
  },
  content: `You are a data filter parser. The user wants to filter a CSV/XLSX file.
Parse their natural language filter criteria into structured operations.

Available columns: {{availableColumns}}

Sample data (first rows):
{{sampleData}}

Rules:
- The "field" must match one of the available columns (use the closest match).
- Use "exclude" action when the user says "exclude", "remove", "without", "not", "filter out", "drop".
- Use "include" action when the user says "only", "keep", "just", "where", "with".
- For numeric comparisons use "greater_than" or "less_than".
- For exact matches use "equals" or "not_equals".
- For partial text matches use "contains" or "not_contains".
- Parse numbers from the user message (e.g. "200" from "more than 200 employees").
- If the user specifies multiple conditions, create multiple filter entries.

IMPORTANT — "understood" field:
- Set "understood" to true ONLY if the message is a clear, actionable filter instruction.
- Set "understood" to false if:
  - The message is vague, nonsensical, or unrelated to filtering data.
  - You cannot determine which column(s) or condition(s) the user means.
  - The message is a greeting, question, or general comment (not a filter instruction).
  - The message references columns or values that do not exist in the data.
- When "understood" is false, return an empty "filters" array and explain what was unclear in "explanation".`,
  toolDefinitions: [
    {
      name: 'parse_filter',
      description: 'Parse natural language filter criteria into structured operations',
      input_schema: {
        type: 'object',
        properties: {
          filters: {
            type: 'array',
            description: 'Array of filter operations to apply',
            items: {
              type: 'object',
              properties: {
                field: {
                  type: 'string',
                  description:
                    'Column name to filter on (must match one of the available columns)',
                },
                operator: {
                  type: 'string',
                  enum: [
                    'equals',
                    'not_equals',
                    'contains',
                    'not_contains',
                    'greater_than',
                    'less_than',
                    'is_empty',
                    'is_not_empty',
                    'regex',
                  ],
                  description: 'Comparison operator',
                },
                value: {
                  type: 'string',
                  description:
                    'Value to compare against (use empty string for is_empty/is_not_empty)',
                },
                action: {
                  type: 'string',
                  enum: ['include', 'exclude'],
                  description:
                    'Whether to include rows matching this criterion or exclude them',
                },
              },
              required: ['field', 'operator', 'value', 'action'],
            },
          },
          explanation: {
            type: 'string',
            description:
              'Human-readable explanation of the parsed filter criteria',
          },
          understood: {
            type: 'boolean',
            description:
              'Set to true if the user message is a valid, understandable filter instruction. Set to false if the message is unclear, unrelated to filtering, nonsensical, or you cannot determine what filter to apply.',
          },
        },
        required: ['filters', 'explanation', 'understood'],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// 5. Smart Reply Generator
// ---------------------------------------------------------------------------

export const SMART_REPLY_GENERATOR_PROMPT: DefaultPrompt = {
  slug: 'smart-reply-generator',
  displayName: 'Smart Reply Generator',
  description:
    'Classifies inbound email reply intent and generates a contextual draft reply for BDR review.',
  category: 'GENERATOR',
  modelConfig: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 1024,
    temperature: 0.7,
  },
  content: `You are an expert B2B sales development email assistant. Your task is to:
1. Classify the intent of an inbound prospect reply.
2. Decide if a draft reply should be generated.
3. If yes, write a short, professional reply draft.

**Intent categories:**
- interested: Prospect expresses interest, wants to learn more
- meeting_request: Prospect asks to schedule a call/meeting
- question: Prospect asks a question about the product/service
- objection: Prospect raises a concern or pushback (pricing, timing, fit)
- not_interested: Prospect declines politely or firmly
- wrong_person: Prospect says they are not the right contact
- out_of_office: Automated out-of-office/vacation reply
- auto_reply: Automated system reply (delivery confirmation, etc.)
- other: None of the above

**Draft generation rules:**
- Generate a draft for: interested, meeting_request, question, objection
- Do NOT generate a draft for: not_interested, wrong_person, out_of_office, auto_reply, other
- Keep drafts under 150 words, concise and professional
- Match the tone of professional B2B email replies
- For meeting_request: include the meeting link if provided in campaign context
- For objection: address the concern using campaign context (ICP, value props)
- For question: answer using campaign context, offer to provide more detail
- Personalize using contact name and company when available

**Campaign context** (provided in the user message):
- Email sequence copy and ICP definition
- Contact name, company, title
- Meeting link (if available)
- Personality insights (if available) — use these to adjust communication style

{{personalityInstructions}}

{{toneInstructions}}`,
  toolDefinitions: [
    {
      name: 'classify_and_draft_reply',
      description:
        'Classify the intent of an inbound email reply and optionally generate a draft response',
      input_schema: {
        type: 'object',
        properties: {
          intent: {
            type: 'string',
            enum: [
              'interested',
              'meeting_request',
              'question',
              'objection',
              'not_interested',
              'wrong_person',
              'out_of_office',
              'auto_reply',
              'other',
            ],
            description: 'The classified intent of the inbound reply',
          },
          confidence: {
            type: 'number',
            description: 'Confidence score between 0.0 and 1.0',
            minimum: 0.0,
            maximum: 1.0,
          },
          should_reply: {
            type: 'boolean',
            description:
              'Whether a draft reply should be generated for this intent',
          },
          draft_body: {
            type: 'string',
            description:
              'The generated draft reply text. Only present when should_reply is true.',
          },
        },
        required: ['intent', 'confidence', 'should_reply'],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Lookup map by slug
// ---------------------------------------------------------------------------

export const DEFAULT_PROMPTS: Record<string, DefaultPrompt> = {
  'agent-intent-classifier': AGENT_INTENT_CLASSIFIER_PROMPT,
  'enrichment-intent-classifier': ENRICHMENT_INTENT_CLASSIFIER_PROMPT,
  'persona-classifier': PERSONA_CLASSIFIER_PROMPT,
  'filter-parser': FILTER_PARSER_PROMPT,
  'smart-reply-generator': SMART_REPLY_GENERATOR_PROMPT,
};
