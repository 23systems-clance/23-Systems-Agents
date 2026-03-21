/**
 * Slack Block Kit message builders for onboarding DMs.
 *
 * Each function returns `{ blocks, text }` where `text` is the plain-text
 * fallback shown in push notifications and `blocks` is an array of Slack
 * Block Kit elements (kept under the 50-block limit).
 */

import type { KnownBlock } from '@slack/types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Builds a text-based progress bar for display inside a context block.
 *
 * @param completed - Number of completed modules.
 * @param total     - Total number of modules.
 * @returns A string like "████████░░ 80% — 12/15 modules complete".
 */
function buildProgressBar(completed: number, total: number): string {
  const percentage = Math.round((completed / total) * 100);
  const filled = Math.round((completed / total) * 10);
  const empty = 10 - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${percentage}% — ${completed}/${total} modules complete`;
}

/** Map a training-item type to its display icon. */
function typeIcon(type: string): string {
  const icons: Record<string, string> = {
    VIDEO: '🎬',
    READING: '📖',
    QUIZ: '❓',
    PRACTICE_TASK: '🎯',
    CHECKLIST: '✅',
    RESOURCE_LINK: '🔗',
    REIMBURSEMENT_INFO: '💰',
  };
  return icons[type] ?? '📌';
}

// ---------------------------------------------------------------------------
// Param types
// ---------------------------------------------------------------------------

/** A single training item rendered inside a daily module DM. */
export interface TrainingItemBlock {
  type: string;
  title: string;
  content?: string;
  /** Quiz-only: list of answer options. */
  quizOptions?: Array<{ text: string; value: string }>;
}

/** Parameters for {@link buildDailyModuleDm}. */
export interface DailyModuleDmParams {
  enrollmentId: string;
  dayNumber: number;
  weekNumber: number;
  moduleTitle: string;
  moduleDescription?: string;
  trainingItems: TrainingItemBlock[];
  progressCompleted: number;
  progressTotal: number;
  hasPreviousIncomplete: boolean;
  previousModuleTitle?: string;
}

/** Parameters for {@link buildWelcomeDm}. */
export interface WelcomeDmParams {
  planName: string;
  durationDays: number;
  managerName: string;
  deliveryHour: number;
  timezone: string;
  firstModuleTitle: string;
}

/** Parameters for {@link buildGraduationNotification}. */
export interface GraduationNotificationParams {
  enrollmentId: string;
  bdrName: string;
  planName: string;
  completionDays: number;
  modulesCompleted: number;
}

/** Parameters for {@link buildGraduationDm}. */
export interface GraduationDmParams {
  bdrName: string;
  planName: string;
}

/** Parameters for {@link buildAlertDm}. */
export interface AlertDmParams {
  alertType: 'behind_schedule' | 'quiz_failed' | 'overdue';
  bdrName: string;
  details: string;
  enrollmentId: string;
}

/** Parameters for {@link buildCheckinPrompt}. */
export interface CheckinPromptParams {
  enrollmentId: string;
  automationId: string;
  dayNumber: number;
  promptText: string;
}

/** Parameters for {@link buildWeeklySummary}. */
export interface WeeklySummaryParams {
  weekNumber: number;
  completedThisWeek: number;
  totalCompleted: number;
  totalModules: number;
  nextWeekPreview?: string;
}

/** Parameters for {@link buildReminderDm}. */
export interface ReminderDmParams {
  moduleTitle: string;
  dayNumber: number;
}

/** Campaign task summary for supervised phase blended DMs. */
export interface CampaignTaskSummary {
  campaignName: string;
  callsToMake: number;
  emailsQueued: number;
  linkedinQueued: number;
  unreadReplies: number;
  taskDashboardUrl?: string;
}

/** Parameters for {@link buildSupervisedDm}. */
export interface SupervisedDmParams {
  enrollmentId: string;
  dayNumber: number;
  weekNumber: number;
  moduleTitle: string;
  moduleDescription?: string;
  trainingItems: TrainingItemBlock[];
  progressCompleted: number;
  progressTotal: number;
  hasPreviousIncomplete: boolean;
  previousModuleTitle?: string;
  campaignTasks: CampaignTaskSummary;
}

/** Standard return shape for all block builders. */
export interface SlackMessage {
  blocks: KnownBlock[];
  text: string;
}

// ---------------------------------------------------------------------------
// 1. Daily module DM
// ---------------------------------------------------------------------------

/**
 * Builds the daily module DM sent to a BDR each morning.
 *
 * Includes a progress bar, training items with type icons, optional quiz
 * radio buttons, an incomplete-module warning, and a "Mark Complete" button.
 */
export function buildDailyModuleDm(params: DailyModuleDmParams): SlackMessage {
  const {
    enrollmentId,
    dayNumber,
    weekNumber,
    moduleTitle,
    moduleDescription,
    trainingItems,
    progressCompleted,
    progressTotal,
    hasPreviousIncomplete,
    previousModuleTitle,
  } = params;

  const blocks: KnownBlock[] = [];

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `Week ${weekNumber}, Day ${dayNumber}: ${moduleTitle}`,
      emoji: true,
    },
  });

  // Progress bar
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: buildProgressBar(progressCompleted, progressTotal),
      },
    ],
  });

  // Divider
  blocks.push({ type: 'divider' });

  // Module description (optional)
  if (moduleDescription) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: moduleDescription },
    });
  }

  // Training items
  for (const item of trainingItems) {
    const icon = typeIcon(item.type);
    const isUrl = item.content && /^https?:\/\//.test(item.content);

    const label = isUrl
      ? `${icon} *${item.title}*\n<${item.content}|Open resource>`
      : `${icon} *${item.title}*${item.content ? `\n${item.content}` : ''}`;

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: label },
    });

    // Quiz radio buttons
    if (item.type === 'QUIZ' && item.quizOptions && item.quizOptions.length > 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: 'Select your answer:' },
        accessory: {
          type: 'radio_buttons',
          action_id: 'onboarding_quiz_submit',
          options: item.quizOptions.map((opt) => ({
            text: { type: 'plain_text', text: opt.text, emoji: true },
            value: opt.value,
          })),
        },
      } as KnownBlock);
    }
  }

  // Previous-module incomplete warning
  if (hasPreviousIncomplete) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⚠️ *Reminder:* You still have an incomplete module — *${previousModuleTitle ?? 'previous module'}*. Please complete it when you can.`,
      },
    });
  }

  // Mark Complete button
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Mark Complete', emoji: true },
        style: 'primary',
        action_id: 'onboarding_mark_complete',
        value: JSON.stringify({ enrollmentId, dayNumber }),
      },
    ],
  } as KnownBlock);

  return {
    blocks,
    text: `Week ${weekNumber}, Day ${dayNumber}: ${moduleTitle}`,
  };
}

// ---------------------------------------------------------------------------
// 2. Welcome DM
// ---------------------------------------------------------------------------

/**
 * Builds the welcome DM sent to a BDR when they are first enrolled in an
 * onboarding plan.
 */
export function buildWelcomeDm(params: WelcomeDmParams): SlackMessage {
  const { planName, durationDays, managerName, deliveryHour, timezone, firstModuleTitle } = params;

  const weeks = Math.ceil(durationDays / 5);
  const formattedHour =
    deliveryHour === 0
      ? '12:00 AM'
      : deliveryHour <= 12
        ? `${deliveryHour}:00 AM`
        : `${deliveryHour - 12}:00 PM`;

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Welcome to Your Onboarding!', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Plan:* ${planName}\n*Duration:* ${durationDays} business days / ${weeks} weeks`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Manager:* ${managerName}\n*Daily modules delivered at:* ${formattedHour} ${timezone}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*What to expect:* Each business day you'll receive a new training module right here in Slack. Your first module is *${firstModuleTitle}* — keep an eye out for it!`,
      },
    },
  ];

  return {
    blocks,
    text: `Welcome to your onboarding! Your plan "${planName}" starts now.`,
  };
}

// ---------------------------------------------------------------------------
// 3. Graduation notification (manager)
// ---------------------------------------------------------------------------

/**
 * Builds the graduation notification sent to a manager when a BDR completes
 * all onboarding modules.
 */
export function buildGraduationNotification(params: GraduationNotificationParams): SlackMessage {
  const { enrollmentId, bdrName, planName, completionDays, modulesCompleted } = params;

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Onboarding Complete!', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${bdrName}* has completed *${planName}*.`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Completed in *${completionDays}* days | *${modulesCompleted}* modules finished`,
        },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve Graduation', emoji: true },
          style: 'primary',
          action_id: 'onboarding_graduation_approve',
          value: enrollmentId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Extend Onboarding', emoji: true },
          action_id: 'onboarding_graduation_extend',
          value: enrollmentId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Reject', emoji: true },
          style: 'danger',
          action_id: 'onboarding_graduation_reject',
          value: enrollmentId,
        },
      ],
    } as KnownBlock,
  ];

  return {
    blocks,
    text: `${bdrName} has completed onboarding plan "${planName}".`,
  };
}

// ---------------------------------------------------------------------------
// 4. Graduation DM (BDR)
// ---------------------------------------------------------------------------

/**
 * Builds the congratulations DM sent to a BDR upon graduation.
 */
export function buildGraduationDm(params: GraduationDmParams): SlackMessage {
  const { bdrName, planName } = params;

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: "Congratulations! You've Graduated!", emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Great work, *${bdrName}*! You've successfully completed *${planName}*.\n\nYour manager has been notified. Keep up the momentum — the real fun starts now!`,
      },
    },
  ];

  return {
    blocks,
    text: `Congratulations ${bdrName}! You've graduated from "${planName}".`,
  };
}

// ---------------------------------------------------------------------------
// 5. Alert DM (manager)
// ---------------------------------------------------------------------------

/**
 * Builds an alert DM sent to a manager when a BDR falls behind schedule,
 * fails a quiz, or has an overdue module.
 */
export function buildAlertDm(params: AlertDmParams): SlackMessage {
  const { alertType, bdrName, details, enrollmentId: _enrollmentId } = params;

  const alertLabels: Record<string, string> = {
    behind_schedule: '⚠️ Behind Schedule',
    quiz_failed: '❌ Quiz Failed',
    overdue: '🕐 Overdue',
  };

  const heading = alertLabels[alertType] ?? '⚠️ Alert';

  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${heading} — ${bdrName}*\n\n${details}`,
      },
    },
  ];

  return {
    blocks,
    text: `${heading}: ${bdrName} — ${details}`,
  };
}

// ---------------------------------------------------------------------------
// 6. Check-in prompt (BDR)
// ---------------------------------------------------------------------------

/**
 * Builds a check-in prompt DM sent to a BDR at a scheduled point during
 * onboarding, with a button to open the response flow.
 */
export function buildCheckinPrompt(params: CheckinPromptParams): SlackMessage {
  const { enrollmentId, automationId, dayNumber, promptText } = params;

  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: promptText },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Respond', emoji: true },
          action_id: 'onboarding_open_checkin',
          value: JSON.stringify({ enrollmentId, automationId, dayNumber }),
        },
      ],
    } as KnownBlock,
  ];

  return {
    blocks,
    text: promptText,
  };
}

// ---------------------------------------------------------------------------
// 7. Weekly summary
// ---------------------------------------------------------------------------

/**
 * Builds a weekly progress recap DM sent to a BDR at the end of each week.
 */
export function buildWeeklySummary(params: WeeklySummaryParams): SlackMessage {
  const { weekNumber, completedThisWeek, totalCompleted, totalModules, nextWeekPreview } = params;

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Week ${weekNumber} Summary`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*Completed this week:* ${completedThisWeek} modules`,
          `*Overall progress:* ${buildProgressBar(totalCompleted, totalModules)}`,
          nextWeekPreview ? `\n*Coming up next week:* ${nextWeekPreview}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    },
  ];

  return {
    blocks,
    text: `Week ${weekNumber} summary: ${completedThisWeek} modules completed, ${totalCompleted}/${totalModules} overall.`,
  };
}

// ---------------------------------------------------------------------------
// 8. Reminder DM
// ---------------------------------------------------------------------------

/**
 * Builds a reminder DM nudging a BDR about an incomplete module.
 */
export function buildReminderDm(params: ReminderDmParams): SlackMessage {
  const { moduleTitle, dayNumber } = params;

  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Hey! Just a friendly reminder — your Day ${dayNumber} module *${moduleTitle}* is still incomplete. Please finish it when you get a chance so you can stay on track.`,
      },
    },
  ];

  return {
    blocks,
    text: `Reminder: Day ${dayNumber} module "${moduleTitle}" is still incomplete.`,
  };
}

// ---------------------------------------------------------------------------
// 9. Supervised phase blended DM
// ---------------------------------------------------------------------------

/**
 * Builds a blended DM for supervised-phase BDRs that combines onboarding
 * module content with campaign task assignments.
 */
export function buildSupervisedDm(params: SupervisedDmParams): SlackMessage {
  const {
    enrollmentId,
    dayNumber,
    weekNumber,
    moduleTitle,
    moduleDescription,
    trainingItems,
    progressCompleted,
    progressTotal,
    hasPreviousIncomplete,
    previousModuleTitle,
    campaignTasks,
  } = params;

  const blocks: KnownBlock[] = [];

  // Header with supervised badge
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `Week ${weekNumber}, Day ${dayNumber}: ${moduleTitle}`,
      emoji: true,
    },
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `🔵 *Supervised Phase* — ${buildProgressBar(progressCompleted, progressTotal)}`,
      },
    ],
  });

  blocks.push({ type: 'divider' });

  // --- Today's Training section ---
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*📚 Today\'s Training*' },
  });

  if (moduleDescription) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: moduleDescription },
    });
  }

  for (const item of trainingItems) {
    const icon = typeIcon(item.type);
    const isUrl = item.content && /^https?:\/\//.test(item.content);

    const label = isUrl
      ? `${icon} *${item.title}*\n<${item.content}|Open resource>`
      : `${icon} *${item.title}*${item.content ? `\n${item.content}` : ''}`;

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: label },
    });

    if (item.type === 'QUIZ' && item.quizOptions && item.quizOptions.length > 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: 'Select your answer:' },
        accessory: {
          type: 'radio_buttons',
          action_id: 'onboarding_quiz_submit',
          options: item.quizOptions.map((opt) => ({
            text: { type: 'plain_text', text: opt.text, emoji: true },
            value: opt.value,
          })),
        },
      } as KnownBlock);
    }
  }

  // Previous-module incomplete warning
  if (hasPreviousIncomplete) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⚠️ *Reminder:* You still have an incomplete module — *${previousModuleTitle ?? 'previous module'}*. Please complete it when you can.`,
      },
    });
  }

  // Mark Complete button for training
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Mark Complete', emoji: true },
        style: 'primary',
        action_id: 'onboarding_mark_complete',
        value: JSON.stringify({ enrollmentId, dayNumber }),
      },
    ],
  } as KnownBlock);

  blocks.push({ type: 'divider' });

  // --- Today's Campaign Tasks section ---
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*📋 Today\'s Campaign Tasks*' },
  });

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Campaign:* ${campaignTasks.campaignName}`,
    },
  });

  const taskLines = [
    `📞 *Calls to make:* ${campaignTasks.callsToMake}`,
    `📧 *Emails queued:* ${campaignTasks.emailsQueued}`,
    `🔗 *LinkedIn actions:* ${campaignTasks.linkedinQueued}`,
  ];

  if (campaignTasks.unreadReplies > 0) {
    taskLines.push(`💬 *Unread replies:* ${campaignTasks.unreadReplies}`);
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: taskLines.join('\n') },
  });

  if (campaignTasks.taskDashboardUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open Task Dashboard', emoji: true },
          url: campaignTasks.taskDashboardUrl,
          action_id: 'onboarding_open_task_dashboard',
        },
      ],
    } as KnownBlock);
  }

  return {
    blocks,
    text: `Supervised: Week ${weekNumber}, Day ${dayNumber} — ${moduleTitle} + Campaign Tasks`,
  };
}
