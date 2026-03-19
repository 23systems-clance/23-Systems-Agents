'use server';

import { loadTemplates } from './templates.js';

/**
 * Route a plain-English task description to the best matching template.
 *
 * Uses the LLM to understand user intent and match against available templates.
 * Returns the best match with confidence and suggested input pre-fills.
 *
 * @param {string} userInput - Plain-English task description
 * @returns {{ templateId: string | null, confidence: 'high' | 'medium' | 'low', reason: string, suggestedInputs: object }}
 */
export async function routeTask(userInput) {
  try {
    const templates = await loadTemplates();
    if (!templates.length) {
      return { templateId: null, confidence: 'low', reason: 'No templates available', suggestedInputs: {} };
    }

    // Build template summary for the LLM
    const templateSummary = templates.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      inputs: t.inputs.map(i => ({ id: i.id, label: i.label, type: i.type })),
    }));

    const { createModel } = await import('../../Clusters/lib/ai/model.js');
    const { z } = await import('zod');

    const model = await createModel({ maxTokens: 512 });

    const schema = z.object({
      templateId: z.string().describe('The ID of the best matching template, or "none" if no good match'),
      confidence: z.enum(['high', 'medium', 'low']).describe('How confident the match is'),
      reason: z.string().describe('One sentence explaining why this template matches'),
      suggestedInputs: z.record(z.string()).describe('Pre-fill values for template inputs based on the user description'),
    });

    const response = await model.withStructuredOutput(schema).invoke([
      ['system', `You are a task router. Given a user's plain-English description of what they need done, match it to the best available template.

Available templates:
${JSON.stringify(templateSummary, null, 2)}

Rules:
- Match based on the user's intent, not exact keywords
- If the user describes research, reports, or information gathering → research templates
- If the user describes writing, content, or marketing → content templates
- If the user describes code, bugs, or technical review → development templates
- If the user describes customer issues or support → support templates
- If the user describes SEO, rankings, or website optimization → marketing templates
- If the user describes meetings, calls, or prep → meeting-prep
- If the user describes data, files, spreadsheets, or processing → data templates
- Pre-fill as many input fields as possible from the user's description
- Set confidence to "high" if the intent clearly matches, "medium" if plausible, "low" if uncertain
- If nothing matches well, set templateId to "none"`],
      ['human', userInput],
    ]);

    if (response.templateId === 'none') {
      return { templateId: null, confidence: 'low', reason: response.reason, suggestedInputs: {} };
    }

    // Validate the template ID exists
    const matchedTemplate = templates.find(t => t.id === response.templateId);
    if (!matchedTemplate) {
      return { templateId: null, confidence: 'low', reason: 'Matched template not found', suggestedInputs: {} };
    }

    return {
      templateId: response.templateId,
      confidence: response.confidence,
      reason: response.reason,
      suggestedInputs: response.suggestedInputs || {},
    };
  } catch (err) {
    console.error('routeTask error:', err);
    return { templateId: null, confidence: 'low', reason: 'Routing failed', suggestedInputs: {} };
  }
}
