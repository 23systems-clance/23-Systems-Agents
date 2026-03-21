/**
 * TypeScript types for the Visual Workflow Builder.
 *
 * Defines the graph structure (nodes, edges, viewport), node configuration
 * schemas for all 8 node types, edge conditions, and execution history entries.
 * These types map directly to the JSONB `graph` column in WorkflowVersion
 * and the `nodeHistory` / `context` columns in WorkflowExecution.
 */

import type { WorkflowNodeType } from '@prisma/client';

// ---------------------------------------------------------------------------
// Graph structure (stored as JSONB in WorkflowVersion.graph)
// ---------------------------------------------------------------------------

/** Complete workflow graph persisted in the database. */
export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

/** A single node in the workflow graph. */
export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label?: string;
  position: { x: number; y: number };
  /** Node-specific configuration. */
  data: Record<string, unknown>;
  /** Typed accessor (convenience alias parsed from `data`). */
  config?: NodeConfig;
}

/** A directed edge connecting two nodes. */
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  condition?: EdgeCondition;
  label?: string;
}

// ---------------------------------------------------------------------------
// Node configuration schemas (one per WorkflowNodeType)
// ---------------------------------------------------------------------------

export interface TriggerNodeConfig {
  type: 'TRIGGER';
  triggerType: 'file_upload' | 'keyword' | 'slash_command' | 'manual' | 'webhook';
  pattern?: string;
  command?: string;
  /** Populated after publish for webhook triggers. */
  webhookUrl?: string;
  /** Populated after publish for webhook triggers. */
  webhookToken?: string;
}

export interface MessageNodeConfig {
  type: 'MESSAGE';
  text: string;
  blocks: object[];
  ephemeral?: boolean;
}

export interface ButtonChoiceNodeConfig {
  type: 'BUTTON_CHOICE';
  prompt: string;
  buttons: Array<{
    id: string;
    label: string;
    style?: 'primary' | 'danger';
    value: string;
  }>;
  outputVariable: string;
}

export interface FormModalNodeConfig {
  type: 'FORM_MODAL';
  title: string;
  fields: Array<{
    id: string;
    label: string;
    type: 'text' | 'textarea' | 'select' | 'multi_select' | 'number' | 'date' | 'checkbox';
    required?: boolean;
    placeholder?: string;
    options?: Array<{ label: string; value: string }>;
  }>;
  submitLabel?: string;
  outputMapping: Record<string, string>;
}

export interface EnrichmentNodeConfig {
  type: 'ENRICHMENT';
  enrichmentType: 'technographic' | 'contact' | 'combined';
  fileSourceVariable: string;
  purpose?: 'COLD_CALLING' | 'EMAILING' | 'JUST_A_LIST' | 'LINKEDIN';
  outputJobIdVariable: string;
}

export interface ConditionNodeConfig {
  type: 'CONDITION';
  evaluationField: string;
  description?: string;
}

export interface ActionNodeConfig {
  type: 'ACTION';
  actionType: string;
  params: Record<string, unknown>;
  outputVariable?: string;
}

export interface DelayNodeConfig {
  type: 'DELAY';
  durationSeconds: number;
  durationVariable?: string;
}

// ---------------------------------------------------------------------------
// New node types (Platform V2 - spec 9)
// ---------------------------------------------------------------------------

export interface HubSpotNodeConfig {
  type: 'HUBSPOT';
  mode: 'import' | 'sync';
  /** HubSpot list ID for import mode. */
  listId?: string;
  /** Properties to import from HubSpot. */
  importProperties?: string[];
  /** Fields to match on in sync mode (email, domain, company_name). */
  syncMatchFields?: string[];
  /** Jaro-Winkler threshold 0-100 for fuzzy company matching. Default 85. */
  fuzzyThreshold?: number;
  /** Whether to create new records in HubSpot when no match found. */
  createNewRecords?: boolean;
  /** Whether to update existing matched records. */
  updateExisting?: boolean;
  /** Maps workflow context field names to HubSpot property names. */
  fieldMapping?: Array<{ sourceField: string; targetField: string }>;
  /** Client ID for multi-tenant HubSpot credentials. */
  clientId?: string;
  /** Variable name to store output in execution context. */
  outputVariable?: string;
}

export interface ParserNodeConfig {
  type: 'PARSER';
  parseMode: 'json' | 'csv';
  /** JSON root path to extract (e.g., "data.contacts"). */
  jsonRootPath?: string;
  /** CSV delimiter character. Default comma. */
  csvDelimiter?: string;
  /** Whether CSV has a header row. Default true. */
  csvHasHeaders?: boolean;
  /** Field mapping rules: rename, combine, split. */
  fieldMappings?: Array<{
    sourceField: string;
    targetField: string;
    mode: 'rename' | 'combine' | 'split';
    combineWith?: string;
    combineDelimiter?: string;
    splitDelimiter?: string;
  }>;
  /** Transformation rules to apply to fields. */
  transformations?: Array<{
    field: string;
    function: string;
    args?: Record<string, unknown>;
  }>;
  /** Filter criteria to include/exclude rows. */
  filters?: Array<{
    field: string;
    operator: string;
    value?: string | number | boolean | string[];
    logic?: 'AND' | 'OR';
  }>;
  /** Context variable to read input from. */
  inputVariable?: string;
  /** Context variable to write output to. */
  outputVariable?: string;
}

export interface ApiCallNodeConfig {
  type: 'API_CALL';
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** URL with optional {{variable}} interpolation. */
  url: string;
  /** HTTP headers as key-value pairs. */
  headers?: Record<string, string>;
  /** Request body template with {{variable}} interpolation. */
  bodyTemplate?: string;
  /** Authentication type. */
  authType?: 'api_key' | 'bearer' | 'hmac' | 'none';
  /** Auth config (key name, token, secret depending on authType). */
  authConfig?: Record<string, string>;
  /** Maps response paths to context variable names. */
  responseMapping?: Array<{ responsePath: string; contextVariable: string }>;
  /** Discovered response schema from test execution. */
  responseSchema?: Array<{ path: string; type: string; isArray: boolean; sampleValue?: unknown }>;
  /** Max retry attempts on failure. Default 3. */
  maxRetries?: number;
  /** Initial retry delay in ms. Default 1000. */
  retryDelayMs?: number;
  /** Request timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Context variable to write raw response to. */
  outputVariable?: string;
}

/** Union type of all node configurations. */
export type NodeConfig =
  | TriggerNodeConfig
  | MessageNodeConfig
  | ButtonChoiceNodeConfig
  | FormModalNodeConfig
  | EnrichmentNodeConfig
  | ConditionNodeConfig
  | ActionNodeConfig
  | DelayNodeConfig
  | HubSpotNodeConfig
  | ParserNodeConfig
  | ApiCallNodeConfig;

// ---------------------------------------------------------------------------
// Edge condition (for branching logic)
// ---------------------------------------------------------------------------

export interface EdgeCondition {
  field: string;
  operator:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'greater_than'
    | 'less_than'
    | 'is_empty'
    | 'is_not_empty'
    | 'regex'
    | 'default';
  value?: string | number | boolean;
}

// ---------------------------------------------------------------------------
// Execution history (stored as JSONB array in WorkflowExecution.nodeHistory)
// ---------------------------------------------------------------------------

export interface NodeHistoryEntry {
  nodeId: string;
  nodeType: string;
  enteredAt: string;
  exitedAt?: string;
  output?: unknown;
  userInput?: unknown;
}

// ---------------------------------------------------------------------------
// Validation types
// ---------------------------------------------------------------------------

export interface ValidationError {
  message: string;
  nodeId?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors?: (string | ValidationError)[];
  warnings?: (string | ValidationError)[];
}

// ---------------------------------------------------------------------------
// Execution progress tracking (Platform V2)
// ---------------------------------------------------------------------------

/** Per-node progress tracking within a workflow execution. */
export interface NodeProgress {
  nodeId: string;
  nodeType: string;
  label?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  startedAt?: string;
  completedAt?: string;
  lastUpdatedAt: string;
  /** First 5 error messages for debugging. */
  errorSample?: string[];
}

// ---------------------------------------------------------------------------
// Template types
// ---------------------------------------------------------------------------

export interface WorkflowTemplateDefinition {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  previewImage?: string | null;
  graph: WorkflowGraph;
}
