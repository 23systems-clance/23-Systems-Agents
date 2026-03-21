/**
 * Smart Reply Generator — classifies inbound reply intent and generates
 * contextual draft replies using Claude Haiku 4.5 Tool Use.
 *
 * Single AI call returns { intent, confidence, should_reply, draft_body }.
 *
 * @module smartReplyGenerator
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import { calculateAiCost, type AiUsageData } from './costCalculator.js';
import { resolvePrompt } from './promptResolver.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid reply intent categories. */
export type ReplyIntent =
  | 'interested'
  | 'meeting_request'
  | 'question'
  | 'objection'
  | 'not_interested'
  | 'wrong_person'
  | 'out_of_office'
  | 'auto_reply'
  | 'other';

/** Result from a single classify + draft call. */
export interface SmartReplyResult {
  intent: ReplyIntent;
  confidence: number;
  shouldReply: boolean;
  draftBody: string | null;
  usage: AiUsageData;
}

/** Campaign context fed into the generation prompt. */
export interface CampaignContext {
  campaignName: string;
  sequenceCopy?: string;
  icpDefinition?: string;
  meetingLink?: string;
}

/** Contact context fed into the generation prompt. */
export interface ContactContext {
  firstName: string;
  lastName: string;
  companyName?: string;
  jobTitle?: string;
}

/** Personality data (AI Ark profile) for prompt enrichment. */
export interface PersonalityContext {
  archetype?: string;
  communicationAdjectives?: string[];
  whatToSay?: string[];
  whatToAvoid?: string[];
  emailTone?: string;
  emailLength?: string;
}

/** Tone options for draft regeneration. */
export type DraftTone = 'professional' | 'casual' | 'assertive' | 'empathetic';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_REPLY_CHARS = 2000;

const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classifies an inbound reply and optionally generates a draft response.
 *
 * @param replyBody - Raw inbound email body (truncated to 2,000 chars).
 * @param campaign - Campaign context (sequence copy, ICP, meeting link).
 * @param contact - Contact context (name, company, title).
 * @param personality - Optional AI Ark personality data.
 * @param tone - Optional tone override for regeneration.
 * @returns Classification result with optional draft body and usage data.
 */
export async function generateSmartReply(
  replyBody: string,
  campaign: CampaignContext,
  contact: ContactContext,
  personality?: PersonalityContext | null,
  tone?: DraftTone,
): Promise<SmartReplyResult> {
  const startMs = Date.now();
  const truncatedBody = replyBody.slice(0, MAX_REPLY_CHARS);

  // Resolve prompt from library (Redis → DB → compiled default)
  const resolved = await resolvePrompt('smart-reply-generator');

  // Build system prompt with template variable substitutions
  let systemPrompt = resolved.content;

  // Inject personality instructions if available
  const personalityBlock = personality
    ? buildPersonalityInstructions(personality)
    : '';
  systemPrompt = systemPrompt.replace('{{personalityInstructions}}', personalityBlock);

  // Inject tone instructions if specified (regeneration)
  const toneBlock = tone ? buildToneInstructions(tone) : '';
  systemPrompt = systemPrompt.replace('{{toneInstructions}}', toneBlock);

  // Build user message with all context
  const userMessage = buildUserMessage(truncatedBody, campaign, contact);

  const tools =
    (resolved.toolDefinitions as unknown as Anthropic.Messages.Tool[]) ?? [];

  const response = await anthropic.messages.create({
    model: resolved.modelConfig.model,
    max_tokens: resolved.modelConfig.maxTokens,
    temperature: resolved.modelConfig.temperature ?? 0.7,
    tools,
    tool_choice: { type: 'tool', name: 'classify_and_draft_reply' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const durationMs = Date.now() - startMs;
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;

  const usage: AiUsageData = {
    inputTokens,
    outputTokens,
    estimatedCostUsd: calculateAiCost(inputTokens, outputTokens),
    durationMs,
  };

  // Extract tool use result
  const toolUseBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === 'tool_use',
  );

  if (!toolUseBlock) {
    logger.warn('Smart reply generator returned no tool use block');
    return {
      intent: 'other',
      confidence: 0,
      shouldReply: false,
      draftBody: null,
      usage,
    };
  }

  const input = toolUseBlock.input as Record<string, unknown>;

  return {
    intent: (input.intent as ReplyIntent) ?? 'other',
    confidence: (input.confidence as number) ?? 0,
    shouldReply: (input.should_reply as boolean) ?? false,
    draftBody: (input.draft_body as string) ?? null,
    usage,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUserMessage(
  replyBody: string,
  campaign: CampaignContext,
  contact: ContactContext,
): string {
  const parts: string[] = [];

  parts.push('## Inbound Reply');
  parts.push(replyBody);

  parts.push('\n## Campaign Context');
  parts.push(`Campaign: ${campaign.campaignName}`);
  if (campaign.icpDefinition) parts.push(`ICP: ${campaign.icpDefinition}`);
  if (campaign.sequenceCopy) parts.push(`Email Sequence Copy:\n${campaign.sequenceCopy}`);
  if (campaign.meetingLink) parts.push(`Meeting Link: ${campaign.meetingLink}`);

  parts.push('\n## Contact');
  parts.push(`Name: ${contact.firstName} ${contact.lastName}`);
  if (contact.companyName) parts.push(`Company: ${contact.companyName}`);
  if (contact.jobTitle) parts.push(`Title: ${contact.jobTitle}`);

  return parts.join('\n');
}

function buildPersonalityInstructions(p: PersonalityContext): string {
  const lines: string[] = [
    '\n**Personality-informed drafting (from AI Ark analysis):**',
  ];
  if (p.archetype) lines.push(`- Archetype: ${p.archetype}`);
  if (p.communicationAdjectives?.length) {
    lines.push(`- Communication style: ${p.communicationAdjectives.join(', ')}`);
  }
  if (p.whatToSay?.length) {
    lines.push(`- What to say: ${p.whatToSay.join('; ')}`);
  }
  if (p.whatToAvoid?.length) {
    lines.push(`- What to avoid: ${p.whatToAvoid.join('; ')}`);
  }
  if (p.emailTone) lines.push(`- Preferred email tone: ${p.emailTone}`);
  if (p.emailLength) lines.push(`- Preferred email length: ${p.emailLength}`);
  lines.push('Use these insights to tailor the draft reply style and messaging.');
  return lines.join('\n');
}

function buildToneInstructions(tone: DraftTone): string {
  const toneGuide: Record<DraftTone, string> = {
    professional:
      'Write in a formal, business-appropriate tone. Use proper salutations and structured language.',
    casual:
      'Write in a conversational, friendly tone. Keep it approachable and human. Use first names.',
    assertive:
      'Write confidently and directly. Lead with value propositions. Be concise and action-oriented.',
    empathetic:
      'Write with warmth and understanding. Acknowledge the prospect\'s perspective. Show genuine interest in their situation.',
  };
  return `\n**Tone instruction:** ${toneGuide[tone]}`;
}
