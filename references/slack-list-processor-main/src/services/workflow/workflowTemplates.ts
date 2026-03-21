import type { WorkflowTemplateDefinition, WorkflowGraph } from './types.js';

/**
 * Company Enrichment Template
 * Flow: File Upload → Enrichment Type Selection → Purpose Selection → Enrichment Job
 */
const COMPANY_ENRICHMENT_TEMPLATE: WorkflowTemplateDefinition = {
  id: 'company_enrichment',
  name: 'Company Enrichment',
  description: 'Enrich company lists with technographic or combined data',
  nodeCount: 4,
  graph: {
    nodes: [
      {
        id: 'node-trigger',
        type: 'TRIGGER',
        data: {
          triggerType: 'file_upload',
          label: 'File Upload',
        },
        position: { x: 250, y: 0 },
      },
      {
        id: 'node-enrich-type',
        type: 'BUTTON_CHOICE',
        data: {
          prompt: 'What type of enrichment?',
          buttons: [
            {
              id: 'btn-tech',
              label: 'Technographic',
              value: 'technographic',
              style: 'primary',
            },
            {
              id: 'btn-combined',
              label: 'Combined (Tech + Contacts)',
              value: 'combined',
            },
          ],
          outputVariable: 'enrichmentType',
        },
        position: { x: 250, y: 200 },
      },
      {
        id: 'node-purpose',
        type: 'BUTTON_CHOICE',
        data: {
          prompt: 'What is the purpose of this list?',
          buttons: [
            {
              id: 'btn-calling',
              label: 'Cold Calling',
              value: 'COLD_CALLING',
            },
            {
              id: 'btn-email',
              label: 'Emailing',
              value: 'EMAILING',
            },
            {
              id: 'btn-linkedin',
              label: 'LinkedIn',
              value: 'LINKEDIN',
            },
            {
              id: 'btn-list',
              label: 'Just a List',
              value: 'JUST_A_LIST',
            },
          ],
          outputVariable: 'purpose',
        },
        position: { x: 250, y: 400 },
      },
      {
        id: 'node-enrich',
        type: 'ENRICHMENT',
        data: {
          enrichmentType: 'technographic',
          fileSourceVariable: 'fileId',
          outputJobIdVariable: 'jobId',
        },
        position: { x: 250, y: 600 },
      },
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'node-trigger',
        target: 'node-enrich-type',
      },
      {
        id: 'edge-2',
        source: 'node-enrich-type',
        sourceHandle: 'btn-tech',
        target: 'node-purpose',
      },
      {
        id: 'edge-3',
        source: 'node-enrich-type',
        sourceHandle: 'btn-combined',
        target: 'node-purpose',
      },
      {
        id: 'edge-4',
        source: 'node-purpose',
        sourceHandle: 'btn-calling',
        target: 'node-enrich',
      },
      {
        id: 'edge-5',
        source: 'node-purpose',
        sourceHandle: 'btn-email',
        target: 'node-enrich',
      },
      {
        id: 'edge-6',
        source: 'node-purpose',
        sourceHandle: 'btn-linkedin',
        target: 'node-enrich',
      },
      {
        id: 'edge-7',
        source: 'node-purpose',
        sourceHandle: 'btn-list',
        target: 'node-enrich',
      },
    ],
  },
};

/**
 * Contact Enrichment Template
 * Flow: File Upload → Purpose Selection → Contact Enrichment Job
 */
const CONTACT_ENRICHMENT_TEMPLATE: WorkflowTemplateDefinition = {
  id: 'contact_enrichment',
  name: 'Contact Enrichment',
  description: 'Enrich contact lists with Apollo data',
  nodeCount: 3,
  graph: {
    nodes: [
      {
        id: 'node-trigger',
        type: 'TRIGGER',
        data: {
          triggerType: 'file_upload',
          label: 'File Upload',
        },
        position: { x: 250, y: 0 },
      },
      {
        id: 'node-purpose',
        type: 'BUTTON_CHOICE',
        data: {
          prompt: 'What is the purpose of this contact list?',
          buttons: [
            {
              id: 'btn-calling',
              label: 'Cold Calling',
              value: 'COLD_CALLING',
            },
            {
              id: 'btn-email',
              label: 'Emailing',
              value: 'EMAILING',
            },
            {
              id: 'btn-linkedin',
              label: 'LinkedIn',
              value: 'LINKEDIN',
            },
            {
              id: 'btn-list',
              label: 'Just a List',
              value: 'JUST_A_LIST',
            },
          ],
          outputVariable: 'purpose',
        },
        position: { x: 250, y: 200 },
      },
      {
        id: 'node-enrich',
        type: 'ENRICHMENT',
        data: {
          enrichmentType: 'contact',
          fileSourceVariable: 'fileId',
          outputJobIdVariable: 'jobId',
        },
        position: { x: 250, y: 400 },
      },
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'node-trigger',
        target: 'node-purpose',
      },
      {
        id: 'edge-2',
        source: 'node-purpose',
        sourceHandle: 'btn-calling',
        target: 'node-enrich',
      },
      {
        id: 'edge-3',
        source: 'node-purpose',
        sourceHandle: 'btn-email',
        target: 'node-enrich',
      },
      {
        id: 'edge-4',
        source: 'node-purpose',
        sourceHandle: 'btn-linkedin',
        target: 'node-enrich',
      },
      {
        id: 'edge-5',
        source: 'node-purpose',
        sourceHandle: 'btn-list',
        target: 'node-enrich',
      },
    ],
  },
};

/**
 * Combined Enrichment Template
 * Flow: File Upload → List Type Selection → Purpose Selection → Enrichment Job
 */
const COMBINED_ENRICHMENT_TEMPLATE: WorkflowTemplateDefinition = {
  id: 'combined_enrichment',
  name: 'Combined Enrichment',
  description: 'Flexible enrichment for company, contact, or combined lists',
  nodeCount: 4,
  graph: {
    nodes: [
      {
        id: 'node-trigger',
        type: 'TRIGGER',
        data: {
          triggerType: 'file_upload',
          label: 'File Upload',
        },
        position: { x: 250, y: 0 },
      },
      {
        id: 'node-list-type',
        type: 'BUTTON_CHOICE',
        data: {
          prompt: 'What type of list is this?',
          buttons: [
            {
              id: 'btn-company',
              label: 'Company List',
              value: 'company',
              style: 'primary',
            },
            {
              id: 'btn-contact',
              label: 'Contact List',
              value: 'contact',
            },
            {
              id: 'btn-combined',
              label: 'Both',
              value: 'combined',
            },
          ],
          outputVariable: 'listType',
        },
        position: { x: 250, y: 200 },
      },
      {
        id: 'node-purpose',
        type: 'BUTTON_CHOICE',
        data: {
          prompt: 'What is the purpose of this list?',
          buttons: [
            {
              id: 'btn-calling',
              label: 'Cold Calling',
              value: 'COLD_CALLING',
            },
            {
              id: 'btn-email',
              label: 'Emailing',
              value: 'EMAILING',
            },
            {
              id: 'btn-linkedin',
              label: 'LinkedIn',
              value: 'LINKEDIN',
            },
            {
              id: 'btn-list',
              label: 'Just a List',
              value: 'JUST_A_LIST',
            },
          ],
          outputVariable: 'purpose',
        },
        position: { x: 250, y: 400 },
      },
      {
        id: 'node-enrich',
        type: 'ENRICHMENT',
        data: {
          enrichmentType: 'combined',
          fileSourceVariable: 'fileId',
          outputJobIdVariable: 'jobId',
        },
        position: { x: 250, y: 600 },
      },
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'node-trigger',
        target: 'node-list-type',
      },
      {
        id: 'edge-2',
        source: 'node-list-type',
        sourceHandle: 'btn-company',
        target: 'node-purpose',
      },
      {
        id: 'edge-3',
        source: 'node-list-type',
        sourceHandle: 'btn-contact',
        target: 'node-purpose',
      },
      {
        id: 'edge-4',
        source: 'node-list-type',
        sourceHandle: 'btn-combined',
        target: 'node-purpose',
      },
      {
        id: 'edge-5',
        source: 'node-purpose',
        sourceHandle: 'btn-calling',
        target: 'node-enrich',
      },
      {
        id: 'edge-6',
        source: 'node-purpose',
        sourceHandle: 'btn-email',
        target: 'node-enrich',
      },
      {
        id: 'edge-7',
        source: 'node-purpose',
        sourceHandle: 'btn-linkedin',
        target: 'node-enrich',
      },
      {
        id: 'edge-8',
        source: 'node-purpose',
        sourceHandle: 'btn-list',
        target: 'node-enrich',
      },
    ],
  },
};

/**
 * Get all built-in workflow templates
 */
export function getBuiltInTemplates(): WorkflowTemplateDefinition[] {
  return [
    COMPANY_ENRICHMENT_TEMPLATE,
    CONTACT_ENRICHMENT_TEMPLATE,
    COMBINED_ENRICHMENT_TEMPLATE,
  ];
}

/**
 * Get a specific template by ID
 * @param templateId - The unique identifier for the template
 * @returns The template definition or undefined if not found
 */
export function getTemplateById(
  templateId: string
): WorkflowTemplateDefinition | undefined {
  return getBuiltInTemplates().find((template) => template.id === templateId);
}
