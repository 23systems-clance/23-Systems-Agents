/**
 * Barrel export for the autonomous agent domain services (T027).
 *
 * Re-exports all core services and tool utilities for convenient
 * consumption by the rest of the application.
 */

// Core services
export * as auditRecorder from './auditRecorder.js';
export * as systemEventEmitter from './systemEventEmitter.js';
export * as confidenceGate from './confidenceGate.js';
export * as suggestOnlyManager from './suggestOnlyManager.js';
export * as teamManager from './teamManager.js';

// Agents
export * as infrastructureMaintenance from './agents/infrastructureMaintenance.js';
export * as apiRateLimitManager from './agents/apiRateLimitManager.js';
export * as anomalyDetector from './agents/anomalyDetector.js';
export * as rootCauseAnalyzer from './agents/rootCauseAnalyzer.js';
export * as autoRemediationExecutor from './agents/autoRemediationExecutor.js';
export * as campaignOptimizer from './agents/campaignOptimizer.js';
export * as crmConflictResolver from './agents/crmConflictResolver.js';

// Tools
export * as ecsOperations from './tools/ecsOperations.js';
export * as cloudWatchLogs from './tools/cloudWatchLogs.js';
export * as githubIssues from './tools/githubIssues.js';
export * as statisticalTests from './tools/statisticalTests.js';
export * as retryWithBackoff from './tools/retryWithBackoff.js';
