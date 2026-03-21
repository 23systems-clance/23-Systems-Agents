/**
 * Slack Assistant class registration and event handlers.
 *
 * Registers the agent with @slack/bolt's Assistant class, providing:
 * - threadStarted: Greeting + suggested prompts
 * - threadContextChanged: Channel awareness updates
 * - userMessage: Intent classification → routing → response
 *
 * Handles file uploads within agent threads by routing to existing pipeline.
 */

import { Assistant, type AssistantConfig } from '@slack/bolt';
import { classifyAgentIntent } from '../ai/agentOrchestrator.js';
import { getOrInitThread, addTurn, loadTurns, mergeClassifiedParams, persistEnrichmentParams } from './conversationManager.js';
import { updateThreadState } from './contextStore.js';
import { routeIntent, formatIntentName, type IntentContext } from './intentRouter.js';
import { startStream, type StreamConfig } from './streamingHelper.js';
import { runOnboarding } from '../workspace/onboarding.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { promptGenerator } from './promptGenerator.js';
import { promptContextBuilder } from './promptContext.js';
import { DEFAULT_PROMPTS } from '../../constants/defaultPrompts.js';
import { promptMetrics } from '../../utils/promptMetrics.js';

/**
 * Creates and returns the Assistant instance for registration with the Bolt app.
 */
export function createAssistant(): Assistant {
  const assistantConfig: AssistantConfig = {
    threadStarted: async ({ event, say, setSuggestedPrompts, setTitle, client }) => {
      try {
        const threadTs = event.assistant_thread.thread_ts;
        const channelId = event.assistant_thread.channel_id;
        const userId = event.assistant_thread.user_id;
        const teamId = event.assistant_thread.context?.team_id;

        if (!teamId) {
          logger.warn('threadStarted missing team_id in context', { threadTs });
          await say('Welcome! How can I help you today?');
          return;
        }

        // Initialize thread state
        await getOrInitThread({
          threadTs,
          channelId,
          userId,
          teamId,
        });

        // Check if onboarding needs to run
        const onboardingTriggered = await runOnboarding(
          client,
          teamId,
          channelId,
          threadTs,
        );

        // If onboarding ran, skip the default greeting (onboarding sends its own message)
        if (onboardingTriggered) {
          // Set title
          await setTitle('List Enrichment Agent');

          // T022-T024: Generate dynamic suggested prompts for onboarding (Feature 23)
          try {
            const context = await promptContextBuilder.build({
              userId,
              teamId,
              channelId,
              threadTs,
            });

            const prompts = await promptGenerator.generate(context);

            await setSuggestedPrompts({
              prompts,
            });
          } catch (promptError) {
            logger.error('Failed to generate dynamic prompts during onboarding, using defaults', {
              error: promptError instanceof Error ? promptError.message : String(promptError),
              teamId,
            });

            await setSuggestedPrompts({
              prompts: DEFAULT_PROMPTS,
            });
          }

          // Record the onboarding message as a turn
          await addTurn(teamId, threadTs, {
            role: 'assistant',
            content: 'Onboarding message sent.',
          });
          return;
        }

        // Set title
        await setTitle('List Enrichment Agent');

        // T022-T024: Generate dynamic suggested prompts (Feature 23)
        const promptStartTime = Date.now();
        try {
          const context = await promptContextBuilder.build({
            userId,
            teamId,
            channelId,
            threadTs,
          });

          const prompts = await promptGenerator.generate(context);

          await setSuggestedPrompts({
            prompts,
          });

          const promptDuration = Date.now() - promptStartTime;
          promptMetrics.recordGenerationLatency(promptDuration, teamId, false);

          if (promptDuration > 500) {
            logger.warn('Prompt generation exceeded performance target', {
              duration: promptDuration,
              target: 500,
              teamId,
            });
          }
        } catch (promptError) {
          logger.error('Failed to generate dynamic prompts, using defaults', {
            error: promptError instanceof Error ? promptError.message : String(promptError),
            teamId,
          });

          await setSuggestedPrompts({
            prompts: DEFAULT_PROMPTS,
          });

          promptMetrics.recordFallback(teamId, promptError instanceof Error ? promptError.name : 'Unknown');
        }

        // Send greeting
        await say(
          "Hi! I'm your List Enrichment Agent. I can help you enrich company lists with tech stacks, find decision makers, generate technology reports, and manage your enrichment jobs.\n\nUpload a CSV/XLSX file or tell me what you need!",
        );

        // Record the greeting as a turn
        await addTurn(teamId, threadTs, {
          role: 'assistant',
          content: 'Greeting sent with suggested prompts.',
        });
      } catch (error) {
        logger.error('Error in threadStarted handler', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    threadContextChanged: async ({ event, setSuggestedPrompts }) => {
      try {
        const threadTs = event.assistant_thread.thread_ts;
        const userId = event.assistant_thread.user_id;
        const context = event.assistant_thread.context;
        const teamId = context?.team_id;

        if (!teamId) return;

        const channelId = context?.channel_id as string | undefined;
        const channelName = (context as Record<string, unknown> | undefined)?.channel_name as string | undefined;

        if (channelId) {
          // T036: Persist to Redis
          await updateThreadState(teamId, threadTs, {
            viewingChannelId: channelId,
            viewingChannelName: channelName,
          });

          // T036: Persist to DB
          const dbThread = await prisma.agentThread.findFirst({
            where: { slackTeamId: teamId, slackThreadTs: threadTs },
            select: { id: true },
          });
          if (dbThread) {
            await prisma.agentThread.update({
              where: { id: dbThread.id },
              data: {
                viewingChannelId: channelId,
                viewingChannelName: channelName,
              },
            });
          }

          // T035-T037: Update suggested prompts based on channel context (Feature 23)
          try {
            const promptContext = await promptContextBuilder.build({
              userId,
              teamId,
              channelId,
              threadTs,
            });

            const prompts = await promptGenerator.generate(promptContext);

            await setSuggestedPrompts({
              prompts,
            });
          } catch (promptError) {
            logger.error('Failed to generate dynamic prompts on context change, using defaults', {
              error: promptError instanceof Error ? promptError.message : String(promptError),
              teamId,
              channelId,
            });

            await setSuggestedPrompts({
              prompts: DEFAULT_PROMPTS,
            });

            promptMetrics.recordFallback(teamId, promptError instanceof Error ? promptError.name : 'Unknown');
          }
        }
      } catch (error) {
        logger.error('Error in threadContextChanged handler', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    userMessage: async ({ event, say, setStatus, client }) => {
      try {
        // Cast to unknown first then to Record for flexible property access —
        // Bolt's union types don't expose all message subtype fields consistently
        const msg = event as unknown as Record<string, unknown>;
        const threadTs = (msg.thread_ts as string) || (msg.ts as string);
        const channelId = msg.channel as string;
        const userId = msg.user as string;
        const teamId = msg.team as string | undefined;
        const messageText = (msg.text as string) || '';

        if (!teamId || !userId) {
          logger.warn('userMessage missing team_id or user', { threadTs });
          await say({ text: "I couldn't identify your workspace. Please try again." });
          return;
        }

        const startMs = Date.now();

        // Show thinking indicator
        await setStatus('Thinking...');

        // Get or init thread state
        const threadState = await getOrInitThread({
          threadTs,
          channelId,
          userId,
          teamId,
        });

        // Check for file uploads — smart routing with optional text classification
        const files = msg.files as Array<Record<string, unknown>> | undefined;
        if (files && files.length > 0) {
          await handleFileUpload(threadState, files, messageText, async (text) => { await say({ text }); }, teamId, threadTs);
          return;
        }

        // Load conversation history for context (before recording new turn)
        const history = await loadTurns(teamId, threadTs);

        // Classify intent with conversation context
        const classification = await classifyAgentIntent(
          messageText,
          history,
          threadState.viewingChannelName,
          threadState.activeJobId,
        );

        // Record user turn with classification metadata (single write)
        await addTurn(teamId, threadTs, {
          role: 'user',
          content: messageText,
          intent: classification.intent.intent,
          confidence: classification.intent.confidence,
          tokensInput: classification.usage.inputTokens,
          tokensOutput: classification.usage.outputTokens,
        });

        // Merge extracted params into accumulated enrichmentParams (T030)
        await mergeClassifiedParams(threadState, classification);

        // Route to handler
        const ctx: IntentContext = {
          client,
          channelId,
          threadTs,
          userId,
          teamId,
          threadState,
          classification,
        };

        const result = await routeIntent(ctx);

        logger.info('agent:response-time', {
          durationMs: Date.now() - startMs,
          intent: classification.intent.intent,
          threadTs,
        });

        // Persist any enrichmentParams changes made by intent handlers (T030)
        await persistEnrichmentParams(threadState);

        // Send response (unless handler already sent it via streaming)
        if (!result.alreadySent) {
          // Use streaming for progressive text delivery
          const streamConfig: StreamConfig = {
            client,
            channel: channelId,
            threadTs,
            userId,
            teamId,
          };

          const session = await startStream(streamConfig);
          session.appendText(result.text);
          await session.flush();
          await session.stop();

          // Record assistant response turn
          await addTurn(teamId, threadTs, {
            role: 'assistant',
            content: result.text,
          });
        }
      } catch (error) {
        logger.error('Error in userMessage handler', {
          error: error instanceof Error ? error.message : String(error),
        });
        await say({ text: 'Something went wrong processing your message. Please try again.' });
      }
    },
  };

  return new Assistant(assistantConfig);
}

/**
 * Determines whether the accompanying text is meaningful enough
 * to warrant AI classification. Filters out empty strings,
 * bare filenames, and whitespace-only content.
 */
function hasActionableText(text: string, fileName: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 3) return false;
  // Check if text is just the filename (Slack sometimes echoes it)
  const baseName = fileName.replace(/\.[^.]+$/, '').toLowerCase();
  if (trimmed.toLowerCase() === baseName || trimmed.toLowerCase() === fileName.toLowerCase()) return false;
  return true;
}

/**
 * Handles file uploads in the agent thread.
 * When meaningful text accompanies the file, classifies the intent via AI
 * and routes accordingly (e.g., auto-set enrichment type, store technology filter).
 * Falls back to the static enrichment menu when no actionable text is present.
 */
async function handleFileUpload(
  threadState: AgentThreadState,
  files: Array<Record<string, unknown>>,
  messageText: string,
  say: (message: string) => Promise<void>,
  teamId: string,
  threadTs: string,
): Promise<void> {
  const file = files[0];
  const fileName = (file.name as string) || 'uploaded file';
  const fileId = file.id as string;

  // Store file metadata in thread state
  threadState.enrichmentParams.fileId = fileId;
  threadState.enrichmentParams.fileName = fileName;
  await updateThreadState(teamId, threadTs, {
    enrichmentParams: threadState.enrichmentParams,
  });

  // If no actionable text, fall back to static enrichment menu
  if (!hasActionableText(messageText, fileName)) {
    await addTurn(teamId, threadTs, {
      role: 'user',
      content: `[File uploaded: ${fileName}]`,
    });

    const response = `Got your file *${fileName}*! What kind of enrichment would you like?\n\n• *Technographic* — Tech stack data for each company\n• *Contact* — Find decision makers at each company\n• *Combined* — Both tech stacks and contacts`;
    await say(response);
    await addTurn(teamId, threadTs, { role: 'assistant', content: response });
    return;
  }

  // Actionable text present — classify intent with file context
  const history = await loadTurns(teamId, threadTs);
  const classification = await classifyAgentIntent(
    messageText,
    history,
    threadState.viewingChannelName,
    threadState.activeJobId,
    true, // hasUploadedFile
  );

  // Record user turn with both file and text
  await addTurn(teamId, threadTs, {
    role: 'user',
    content: `[File uploaded: ${fileName}] ${messageText}`,
    intent: classification.intent.intent,
    confidence: classification.intent.confidence,
    tokensInput: classification.usage.inputTokens,
    tokensOutput: classification.usage.outputTokens,
  });

  // Merge classified params into thread state
  await mergeClassifiedParams(threadState, classification);

  const intent = classification.intent.intent;
  const technology = classification.intent.technology;
  const confidence = classification.intent.confidence;

  // Low confidence — fall back to menu
  if (confidence < 0.50) {
    const response = `Got your file *${fileName}*! I wasn't sure what you meant. What kind of enrichment would you like?\n\n• *Technographic* — Tech stack data for each company\n• *Contact* — Find decision makers at each company\n• *Combined* — Both tech stacks and contacts`;
    await say(response);
    await addTurn(teamId, threadTs, { role: 'assistant', content: response });
    return;
  }

  // Technology query with file (e.g., "find companies that use AWS")
  if (technology && (intent === 'technographic' || intent === 'tech_report')) {
    threadState.enrichmentParams.enrichIntent = 'technographic';
    threadState.enrichmentParams.technology = technology;
    threadState.enrichmentParams.postEnrichmentFilter = {
      filterExpression: messageText,
      technology,
    };
    await updateThreadState(teamId, threadTs, {
      enrichmentParams: threadState.enrichmentParams,
    });

    const response = `Got your file *${fileName}*! I'll run *Technographic* enrichment, then filter for companies using *${technology}*.\n\nShall I proceed? Reply "yes" to start.`;
    await say(response);
    await addTurn(teamId, threadTs, { role: 'assistant', content: response });
    return;
  }

  // Direct enrichment intent (e.g., "get contacts for these", "enrich with tech data")
  if (intent === 'technographic' || intent === 'contact' || intent === 'combined') {
    threadState.enrichmentParams.enrichIntent = intent as 'technographic' | 'contact' | 'combined';
    await updateThreadState(teamId, threadTs, {
      enrichmentParams: threadState.enrichmentParams,
    });

    const intentName = formatIntentName(intent);
    const response = `Got your file *${fileName}*! Ready to run *${intentName}* enrichment.\n\nShall I proceed? Reply "yes" to start.`;
    await say(response);
    await addTurn(teamId, threadTs, { role: 'assistant', content: response });
    return;
  }

  // Any other intent or medium-confidence mismatch — fall back to menu
  const response = `Got your file *${fileName}*! What kind of enrichment would you like?\n\n• *Technographic* — Tech stack data for each company\n• *Contact* — Find decision makers at each company\n• *Combined* — Both tech stacks and contacts`;
  await say(response);
  await addTurn(teamId, threadTs, { role: 'assistant', content: response });
}

// Re-export for type reference
import type { AgentThreadState } from './contextStore.js';
