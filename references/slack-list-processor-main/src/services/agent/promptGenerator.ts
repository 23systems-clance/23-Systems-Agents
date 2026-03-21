/**
 * Prompt Generator - Core Algorithm
 * Feature 23: Dynamic Suggested Prompts - T018-T021
 */

import logger from '../../lib/logger';
import {
  IPromptGenerator,
  PromptContext,
  SuggestedPrompt,
  PromptCandidate,
  PromptClickEventInput,
} from '../../types/promptTypes';
import { PROMPT_TEMPLATES } from './promptTemplates';
import { PRIORITY_WEIGHTS, SLACK_LIMITS, ACTIVITY_WINDOWS } from '../../constants/promptCategories';
import { fallbackToDefaultPrompts, validatePrompts } from '../../utils/promptErrors';
import { promptMetrics } from '../../utils/promptMetrics';
import { promptContextCache } from '../cache/promptCache';
import { prisma } from '../../models/index';

export class PromptGenerator implements IPromptGenerator {
  // T021: Main generation function
  async generate(context: PromptContext): Promise<SuggestedPrompt[]> {
    const startTime = Date.now();

    try {
      const recentPromptIds = await promptContextCache.getRecentPrompts(context.teamId, context.userId);

      const applicableTemplates = PROMPT_TEMPLATES.filter(template => {
        try {
          return template.isApplicable(context);
        } catch (error) {
          logger.warn('Template applicability check failed', { templateId: template.id, error });
          return false;
        }
      });

      const candidates: PromptCandidate[] = applicableTemplates.map(template => {
        const score = this.calculateScore(template, context, recentPromptIds);
        return {
          template,
          score: score.finalScore,
          scoreBreakdown: {
            basePriority: score.basePriority,
            recencyBonus: score.recencyBonus,
            diversityPenalty: score.diversityPenalty,
          },
        };
      });

      candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.template.id.localeCompare(b.template.id);
      });

      const selected = this.applyDiversityFilter(candidates, SLACK_LIMITS.MAX_PROMPTS);

      const prompts: SuggestedPrompt[] = [];
      const selectedTemplateIds: string[] = [];

      for (const candidate of selected) {
        try {
          const prompt = candidate.template.render(context);
          prompts.push(prompt);
          selectedTemplateIds.push(candidate.template.id);
        } catch (error) {
          logger.error('Template render failed', { templateId: candidate.template.id, error });
        }
      }

      const validatedPrompts = validatePrompts(prompts);

      await promptContextCache.trackRecentPrompts(context.teamId, context.userId, selectedTemplateIds);

      const latency = Date.now() - startTime;
      promptMetrics.recordGenerationLatency(latency, context.teamId, false);

      logger.info('Prompts generated successfully', { userId: context.userId, teamId: context.teamId, latency, templateIds: selectedTemplateIds });

      return validatedPrompts;
    } catch (error) {
      const latency = Date.now() - startTime;
      logger.error('Prompt generation failed', { error, userId: context.userId, teamId: context.teamId, latency });

      promptMetrics.recordFallback(context.teamId, error instanceof Error ? error.name : 'Unknown');

      return fallbackToDefaultPrompts(
        error instanceof Error ? error : new Error(String(error)),
        { userId: context.userId, teamId: context.teamId, operation: 'generate' }
      );
    }
  }

  // T018-T019: Calculate score with priority matrix and recency bonus
  private calculateScore(
    template: any,
    context: PromptContext,
    recentPromptIds: string[]
  ): {
    finalScore: number;
    basePriority: number;
    recencyBonus: number;
    diversityPenalty: number;
  } {
    let score = template.basePriority;
    const basePriority = template.basePriority;

    const recencyBonus = this.addRecencyBonus(template, context);
    score += recencyBonus;

    const appearanceCount = recentPromptIds.filter(id => id === template.id).length;
    const diversityPenalty = appearanceCount * PRIORITY_WEIGHTS.DIVERSITY_PENALTY;
    score -= diversityPenalty;

    return { finalScore: score, basePriority, recencyBonus, diversityPenalty };
  }

  // T019: Add recency bonus
  private addRecencyBonus(template: any, context: PromptContext): number {
    let bonus = 0;

    if (template.subcategory === 'active' && context.activeJobs.length > 0) {
      const mostRecentJob = context.activeJobs[0];
      const hoursSinceCreation = (Date.now() - mostRecentJob.createdAt.getTime()) / (1000 * 60 * 60);

      if (hoursSinceCreation < 24) {
        bonus += 200 * (1 - hoursSinceCreation / 24);
      }
    }

    if (template.subcategory === 'failed' && context.failedJobs.length > 0) {
      const mostRecentFailure = context.failedJobs[0];
      const hoursSinceFailure = (Date.now() - mostRecentFailure.createdAt.getTime()) / (1000 * 60 * 60);

      if (hoursSinceFailure < ACTIVITY_WINDOWS.FAILED_JOBS_HOURS) {
        bonus += 150 * (1 - hoursSinceFailure / ACTIVITY_WINDOWS.FAILED_JOBS_HOURS);
      }
    }

    if (template.subcategory === 'results' && context.completedJobs.length > 0) {
      const mostRecentCompletion = context.completedJobs[0];
      const hoursSinceCompletion = (Date.now() - mostRecentCompletion.createdAt.getTime()) / (1000 * 60 * 60);

      if (hoursSinceCompletion < 24) {
        bonus += 100 * (1 - hoursSinceCompletion / 24);
      }
    }

    return bonus * PRIORITY_WEIGHTS.RECENCY_WEIGHT;
  }

  // T020: Apply diversity filter
  private applyDiversityFilter(candidates: PromptCandidate[], maxCount: number): PromptCandidate[] {
    const selected: PromptCandidate[] = [];
    const categoryCounts: Record<string, number> = {};

    for (const candidate of candidates) {
      if (selected.length >= maxCount) break;

      const category = candidate.template.category;
      const currentCount = categoryCounts[category] || 0;

      if (currentCount >= 2) continue;

      selected.push(candidate);
      categoryCounts[category] = currentCount + 1;
    }

    if (selected.length < maxCount) {
      for (const candidate of candidates) {
        if (selected.length >= maxCount) break;
        if (!selected.includes(candidate)) {
          selected.push(candidate);
        }
      }
    }

    return selected;
  }

  async recordClick(event: PromptClickEventInput): Promise<void> {
    // Disabled - promptClickEvent table does not exist
    return;
  }
}

export const promptGenerator = new PromptGenerator();
