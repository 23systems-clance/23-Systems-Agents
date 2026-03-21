/**
 * CloudWatch Metrics for Prompt Generation
 * Feature 23: Dynamic Suggested Prompts
 */

import logger from '../lib/logger';
import { PERFORMANCE_TARGETS } from '../constants/promptCategories';

export enum PromptMetric {
  GENERATION_LATENCY = 'PromptGenerationLatency',
  CACHE_HIT = 'PromptCacheHit',
  CACHE_MISS = 'PromptCacheMiss',
  FALLBACK_USED = 'PromptFallbackUsed',
  ERROR_RATE = 'PromptErrorRate',
  CONTEXT_BUILD_LATENCY = 'PromptContextBuildLatency',
}

interface MetricDimensions {
  teamId?: string;
  contextType?: string;
  cacheHit?: 'true' | 'false';
  errorType?: string;
}

interface MetricDataPoint {
  metric: PromptMetric;
  value: number;
  unit: 'Milliseconds' | 'Count';
  dimensions?: MetricDimensions;
}

export class PromptMetricsEmitter {
  private readonly namespace = 'SlackListProcessor/Prompts';

  emit(dataPoint: MetricDataPoint): void {
    const entry = {
      namespace: this.namespace,
      metric: dataPoint.metric,
      value: dataPoint.value,
      unit: dataPoint.unit,
      dimensions: dataPoint.dimensions || {},
      timestamp: new Date(),
    };

    console.log(`MONITORING|${JSON.stringify(entry)}`);
    logger.debug('Prompt metric emitted', entry);
  }

  recordGenerationLatency(latencyMs: number, teamId: string, cacheHit: boolean): void {
    this.emit({
      metric: PromptMetric.GENERATION_LATENCY,
      value: latencyMs,
      unit: 'Milliseconds',
      dimensions: { teamId, cacheHit: cacheHit ? 'true' : 'false' },
    });

    if (latencyMs > PERFORMANCE_TARGETS.GENERATION_LATENCY_MS_P95) {
      logger.warn('Prompt generation latency exceeded target', { latencyMs, teamId });
    }
  }

  recordCacheHit(teamId: string): void {
    this.emit({
      metric: PromptMetric.CACHE_HIT,
      value: 1,
      unit: 'Count',
      dimensions: { teamId },
    });
  }

  recordCacheMiss(teamId: string): void {
    this.emit({
      metric: PromptMetric.CACHE_MISS,
      value: 1,
      unit: 'Count',
      dimensions: { teamId },
    });
  }

  recordFallback(teamId: string, errorType: string): void {
    this.emit({
      metric: PromptMetric.FALLBACK_USED,
      value: 1,
      unit: 'Count',
      dimensions: { teamId, errorType },
    });
  }

  recordContextBuildLatency(latencyMs: number, teamId: string): void {
    this.emit({
      metric: PromptMetric.CONTEXT_BUILD_LATENCY,
      value: latencyMs,
      unit: 'Milliseconds',
      dimensions: { teamId },
    });
  }
}

export const promptMetrics = new PromptMetricsEmitter();
