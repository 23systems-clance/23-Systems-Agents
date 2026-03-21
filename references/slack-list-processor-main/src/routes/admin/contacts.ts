/**
 * Admin contact detail route.
 *
 * Returns rich contact profile including personality data
 * and conversation history.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * GET /api/v1/admin/contacts/:contactId
 *
 * Returns contact info, campaign context, personality data,
 * and conversation history (UniboxReplies + step executions).
 */
router.get('/:contactId', async (req: Request, res: Response) => {
  try {
    const contactId = req.params.contactId as string;

    const contact = await prisma.campaignContact.findUnique({
      where: { id: contactId },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
            icpDefinition: true,
            client: { select: { name: true } },
          },
        },
      },
    });

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    // Get conversation history (replies + step executions)
    const [replies, executions] = await Promise.all([
      prisma.uniboxReply.findMany({
        where: { campaignContactId: contactId },
        select: {
          id: true,
          channel: true,
          fromName: true,
          fromEmail: true,
          subject: true,
          body: true,
          isRead: true,
          receivedAt: true,
          draftStatus: true,
          draftIntent: true,
        },
        orderBy: { receivedAt: 'desc' },
      }),
      prisma.campaignContactStepExecution.findMany({
        where: { campaignContactId: contactId },
        select: {
          id: true,
          stepIndex: true,
          stepType: true,
          status: true,
          result: true,
          createdAt: true,
          completedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({
      contact: {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        companyName: contact.companyName,
        jobTitle: contact.jobTitle,
        linkedinUrl: contact.linkedinUrl,
        mobilePhone: contact.mobilePhone,
        resolvedPhone: contact.resolvedPhone,
        status: contact.status,
        lastActivityAt: contact.lastActivityAt,
        createdAt: contact.createdAt,
      },
      campaign: (contact as any).campaign
        ? {
            id: (contact as any).campaign.id,
            name: (contact as any).campaign.name,
            status: (contact as any).campaign.status,
            clientName: (contact as any).campaign.client?.name ?? null,
          }
        : null,
      personality: contact.personalityData ?? null,
      personalityEnrichedAt: contact.personalityEnrichedAt ?? null,
      conversationHistory: {
        replies,
        executions,
      },
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to get contact detail', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export { router as contactsAdminRouter };
