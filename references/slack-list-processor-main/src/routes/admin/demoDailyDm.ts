/**
 * Demo endpoints for testing the BDR daily briefing and task dashboard.
 *
 * - POST /daily-dm: Sends a demo morning briefing DM (hardcoded mock data)
 * - POST /daily-dm/test: Sends a REAL daily briefing using live DB data
 * - POST /seed: Creates test campaign data so the dashboard shows real content
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { WebClient } from '@slack/web-api';
import {
  CampaignStatus,
  CampaignType,
  StepType,
  StepExecutionStatus,
  ContactCampaignStatus,
  ReplyChannel,
} from '@prisma/client';
import { config } from '../../config/index.js';
import { generateBdrToken } from '../../lib/bdrAuth.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { sendBriefingToBdr } from '../../services/campaign/dailyDm.js';

const router = Router();

/**
 * POST /api/v1/admin/demo/daily-dm
 *
 * Sends a demo daily briefing DM with mock campaign data
 * and a working magic link token.
 */
router.post('/daily-dm', async (req: Request, res: Response) => {
  try {
    const { slackUserId, slackTeamId = 'T07QEB4KWG1' } = req.body as {
      slackUserId: string;
      slackTeamId?: string;
    };

    if (!slackUserId) {
      res.status(400).json({ error: 'slackUserId is required' });
      return;
    }

    const slackClient = new WebClient(config.slack.botToken);

    let displayName = 'Team Member';
    try {
      const userInfo = await slackClient.users.info({ user: slackUserId });
      displayName =
        userInfo.user?.profile?.display_name ||
        userInfo.user?.real_name ||
        displayName;
    } catch {
      logger.warn('Could not fetch Slack user info for demo DM', { slackUserId });
    }

    const token = generateBdrToken(slackUserId, slackTeamId);
    const taskUrl = `${config.dashboardUrl}/bdr/tasks?token=${token}`;

    const hour = new Date().getUTCHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    const message =
      `${greeting}, ${displayName}! Here's your daily campaign briefing:\n\n` +
      `*Summary*\n` +
      `  Phone calls to make: 12\n` +
      `  Sequences in progress: 47\n` +
      `  Unread replies: 5\n\n` +
      `*Campaigns (3)*\n` +
      `*Q1 Enterprise SaaS Outreach*\n` +
      `  Contacts: 85 active / 200 total\n` +
      `  Calls pending: 6\n` +
      `  Emails/LinkedIn in progress: 28\n` +
      `  Unread replies: 3\n\n` +
      `*Mid-Market FinTech Push*\n` +
      `  Contacts: 42 active / 150 total\n` +
      `  Calls pending: 4\n` +
      `  Emails/LinkedIn in progress: 15\n` +
      `  Unread replies: 2\n\n` +
      `*Healthcare IT Decision Makers*\n` +
      `  Contacts: 31 active / 100 total\n` +
      `  Calls pending: 2\n` +
      `  Emails/LinkedIn in progress: 4\n` +
      `  Unread replies: 0\n\n` +
      `<${taskUrl}|Open Task Dashboard>`;

    await slackClient.chat.postMessage({
      channel: slackUserId,
      text: message,
      mrkdwn: true,
    });

    logger.info('Demo daily briefing sent', { slackUserId });

    res.json({
      success: true,
      message: `Demo daily briefing sent to ${slackUserId}`,
      taskUrl,
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to send demo daily briefing', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/admin/demo/daily-dm/test
 *
 * Triggers the REAL daily briefing pipeline for a specific BDR.
 * Queries live DB data, sends real Slack DM, and returns diagnostic info.
 *
 * Body: { slackUserId: string, slackTeamId?: string, dryRun?: boolean }
 *   - dryRun: if true, returns data without sending Slack DM
 */
router.post('/daily-dm/test', async (req: Request, res: Response) => {
  try {
    const { slackUserId, slackTeamId = 'T07QEB4KWG1', dryRun = false } = req.body as {
      slackUserId: string;
      slackTeamId?: string;
      dryRun?: boolean;
    };

    if (!slackUserId) {
      res.status(400).json({ error: 'slackUserId is required' });
      return;
    }

    // Step 1: Check if BDR has active campaign assignments
    const assignments = await prisma.campaignBdr.findMany({
      where: {
        slackUserId,
        campaign: { status: CampaignStatus.ACTIVE },
      },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
            totalContacts: true,
            activeContacts: true,
            completedContacts: true,
          },
        },
      },
    });

    // Step 2: Gather per-campaign stats (same queries as real dailyDm.ts)
    const campaignDiagnostics = [];
    let totalPendingCalls = 0;
    let totalWaitingWebhook = 0;
    let totalUnreadReplies = 0;

    for (const assignment of assignments) {
      const campaign = assignment.campaign;

      const pendingCalls = await prisma.campaignContactStepExecution.count({
        where: {
          status: StepExecutionStatus.PENDING,
          stepType: StepType.PHONE,
          campaignContact: {
            campaignId: campaign.id,
            status: ContactCampaignStatus.ACTIVE,
          },
        },
      });

      const waitingWebhook = await prisma.campaignContactStepExecution.count({
        where: {
          status: StepExecutionStatus.WAITING_WEBHOOK,
          campaignContact: {
            campaignId: campaign.id,
            status: ContactCampaignStatus.ACTIVE,
          },
        },
      });

      const unreadReplies = await prisma.uniboxReply.count({
        where: {
          campaignId: campaign.id,
          isRead: false,
        },
      });

      totalPendingCalls += pendingCalls;
      totalWaitingWebhook += waitingWebhook;
      totalUnreadReplies += unreadReplies;

      campaignDiagnostics.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        campaignStatus: campaign.status,
        totalContacts: campaign.totalContacts,
        activeContacts: campaign.activeContacts,
        completedContacts: campaign.completedContacts,
        pendingCalls,
        waitingWebhook,
        unreadReplies,
      });
    }

    const diagnostics = {
      slackUserId,
      slackTeamId,
      activeCampaignAssignments: assignments.length,
      totals: {
        pendingCalls: totalPendingCalls,
        waitingWebhook: totalWaitingWebhook,
        unreadReplies: totalUnreadReplies,
      },
      campaigns: campaignDiagnostics,
      dashboardUrl: config.dashboardUrl,
    };

    // Step 3: If not dry run, send the real DM
    let dmSent = false;
    let dmError: string | null = null;

    if (!dryRun) {
      if (assignments.length === 0) {
        dmError = 'No active campaign assignments found for this BDR — no DM to send';
      } else {
        try {
          const slackClient = new WebClient(config.slack.botToken);
          const displayName = assignments[0].displayName || 'Team Member';
          await sendBriefingToBdr(slackClient, slackUserId, slackTeamId, displayName);
          dmSent = true;
        } catch (err) {
          const sendErr = err as Error;
          dmError = sendErr.message;
          logger.error('Test daily DM send failed', {
            slackUserId,
            error: sendErr.message,
            stack: sendErr.stack,
          });
        }
      }
    }

    res.json({
      success: true,
      dryRun,
      dmSent,
      dmError,
      diagnostics,
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to run daily DM test', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// ---------------------------------------------------------------------------
// Sample contacts for seeding
// ---------------------------------------------------------------------------

const SAMPLE_CONTACTS = [
  { firstName: 'Sarah', lastName: 'Chen', email: 'sarah.chen@acmecorp.io', companyName: 'Acme Corp', jobTitle: 'VP of Engineering', phone: '+1-555-0101' },
  { firstName: 'Marcus', lastName: 'Williams', email: 'marcus.w@techglobal.com', companyName: 'TechGlobal Inc', jobTitle: 'CTO', phone: '+1-555-0102' },
  { firstName: 'Emily', lastName: 'Rodriguez', email: 'emily.r@cloudnative.co', companyName: 'CloudNative', jobTitle: 'Director of IT', phone: '+1-555-0103' },
  { firstName: 'James', lastName: 'Park', email: 'jpark@financeplus.com', companyName: 'FinancePlus', jobTitle: 'Head of Engineering', phone: '+1-555-0104' },
  { firstName: 'Priya', lastName: 'Sharma', email: 'priya@dataflow.io', companyName: 'DataFlow Systems', jobTitle: 'VP of Technology', phone: '+1-555-0105' },
  { firstName: 'Michael', lastName: 'Thompson', email: 'mthompson@scaleup.ai', companyName: 'ScaleUp AI', jobTitle: 'CEO', phone: '+1-555-0106' },
  { firstName: 'Lisa', lastName: 'Nakamura', email: 'lisa.n@healthtechpro.com', companyName: 'HealthTech Pro', jobTitle: 'CIO', phone: '+1-555-0107' },
  { firstName: 'David', lastName: 'O\'Brien', email: 'dobrien@securestack.com', companyName: 'SecureStack', jobTitle: 'VP of Engineering', phone: '+1-555-0108' },
];

/**
 * POST /api/v1/admin/demo/seed
 *
 * Creates a test campaign with contacts, pending calls,
 * active sequences, and unread unibox replies assigned to the BDR.
 *
 * Body: { slackUserId: string, slackTeamId?: string }
 */
router.post('/seed', async (req: Request, res: Response) => {
  try {
    const { slackUserId, slackTeamId = 'T07QEB4KWG1' } = req.body as {
      slackUserId: string;
      slackTeamId?: string;
    };

    if (!slackUserId) {
      res.status(400).json({ error: 'slackUserId is required' });
      return;
    }

    // Look up display name
    const slackClient = new WebClient(config.slack.botToken);
    let displayName = 'Demo BDR';
    try {
      const userInfo = await slackClient.users.info({ user: slackUserId });
      displayName =
        userInfo.user?.profile?.display_name ||
        userInfo.user?.real_name ||
        displayName;
    } catch {
      // fallback
    }

    // Create campaign with ACTIVE status, sequence steps, and BDR assignment
    const campaign = await prisma.campaign.create({
      data: {
        slackTeamId,
        name: 'Q1 Enterprise SaaS Outreach',
        description: 'Demo campaign targeting enterprise SaaS decision makers',
        campaignType: CampaignType.MULTI_CHANNEL,
        status: CampaignStatus.ACTIVE,
        callScript: 'Hi {firstName}, this is {bdrName} from DevLabs. I noticed {companyName} is scaling its engineering team and wanted to share how we help companies like yours streamline their outreach...',
        meetingLink: 'https://calendly.com/devlabs/demo',
        totalContacts: SAMPLE_CONTACTS.length,
        activeContacts: SAMPLE_CONTACTS.length - 1,
        completedContacts: 1,
        sequenceSteps: {
          create: [
            { stepOrder: 0, stepType: StepType.EMAIL },
            { stepOrder: 1, stepType: StepType.LINKEDIN },
            { stepOrder: 2, stepType: StepType.PHONE },
            { stepOrder: 3, stepType: StepType.EMAIL },
          ],
        },
        bdrs: {
          create: [{
            slackUserId,
            slackTeamId,
            displayName,
          }],
        },
      },
    });

    // Create contacts with varying statuses
    const contactPromises = SAMPLE_CONTACTS.map((c, i) =>
      prisma.campaignContact.create({
        data: {
          campaignId: campaign.id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          companyName: c.companyName,
          jobTitle: c.jobTitle,
          directPhone: c.phone,
          canEmail: true,
          canCall: true,
          canLinkedin: true,
          status: i === 0 ? ContactCampaignStatus.COMPLETED : ContactCampaignStatus.ACTIVE,
          currentStepIndex: i === 0 ? 3 : Math.min(i % 4, 2),
          startedAt: new Date(Date.now() - (7 - i) * 86400000),
          completedAt: i === 0 ? new Date() : null,
        },
      }),
    );
    const contacts = await Promise.all(contactPromises);

    // Create step executions: pending phone calls for contacts at step 2
    const stepExecPromises: Promise<unknown>[] = [];
    for (const contact of contacts) {
      if (contact.status === 'COMPLETED') continue;

      const stepIdx = contact.currentStepIndex;

      // Completed earlier steps
      for (let s = 0; s < stepIdx; s++) {
        const types = [StepType.EMAIL, StepType.LINKEDIN, StepType.PHONE, StepType.EMAIL];
        stepExecPromises.push(
          prisma.campaignContactStepExecution.create({
            data: {
              campaignContactId: contact.id,
              stepIndex: s,
              stepType: types[s] ?? StepType.EMAIL,
              status: StepExecutionStatus.COMPLETED,
              firedAt: new Date(Date.now() - (5 - s) * 86400000),
              completedAt: new Date(Date.now() - (4 - s) * 86400000),
            },
          }),
        );
      }

      // Current step
      const currentTypes = [StepType.EMAIL, StepType.LINKEDIN, StepType.PHONE, StepType.EMAIL];
      const currentType = currentTypes[stepIdx] ?? StepType.EMAIL;
      const currentStatus = currentType === StepType.PHONE
        ? StepExecutionStatus.PENDING
        : StepExecutionStatus.WAITING_WEBHOOK;

      stepExecPromises.push(
        prisma.campaignContactStepExecution.create({
          data: {
            campaignContactId: contact.id,
            stepIndex: stepIdx,
            stepType: currentType,
            status: currentStatus,
            firedAt: currentStatus === StepExecutionStatus.WAITING_WEBHOOK ? new Date() : null,
          },
        }),
      );
    }
    await Promise.all(stepExecPromises);

    // Create unread unibox replies (email + LinkedIn)
    const replyContacts = contacts.slice(1, 4);
    const replyPromises = replyContacts.map((c, i) =>
      prisma.uniboxReply.create({
        data: {
          campaignId: campaign.id,
          campaignContactId: c.id,
          channel: i === 2 ? ReplyChannel.LINKEDIN : ReplyChannel.EMAIL,
          fromName: `${c.firstName} ${c.lastName}`,
          fromEmail: i === 2 ? null : c.email,
          fromLinkedinUrl: i === 2 ? `https://linkedin.com/in/${c.firstName.toLowerCase()}${c.lastName.toLowerCase()}` : null,
          subject: i === 2 ? null : `Re: Quick question about ${c.companyName}`,
          body: [
            'Hi, thanks for reaching out. We are actually looking at solutions like this. Can we schedule a call this week?',
            'Interesting timing - we just started evaluating vendors in this space. Please send over some case studies.',
            'Hey, saw your message on LinkedIn. Happy to chat. What does your calendar look like Thursday?',
          ][i] ?? '',
          isRead: false,
          receivedAt: new Date(Date.now() - (3 - i) * 3600000),
        },
      }),
    );
    await Promise.all(replyPromises);

    logger.info('Demo campaign seeded', { campaignId: campaign.id, slackUserId });

    res.json({
      success: true,
      campaignId: campaign.id,
      contactsCreated: SAMPLE_CONTACTS.length,
      repliesCreated: replyContacts.length,
      message: 'Demo campaign with contacts, calls, and replies created',
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to seed demo campaign', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export { router as demoDailyDmRouter };
