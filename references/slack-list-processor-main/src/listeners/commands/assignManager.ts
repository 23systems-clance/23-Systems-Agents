/**
 * Slash command handler for /assign-manager.
 *
 * Assigns or reassigns a manager to a BDR and updates any active
 * onboarding enrollments to use the new manager.
 *
 * Usage: /assign-manager @bdr @manager
 */

import type { App } from '@slack/bolt';
import { OnboardingEnrollmentStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

export function registerAssignManagerCommand(app: App): void {
  app.command('/assign-manager', async ({ command, ack, respond }) => {
    await ack();

    try {
      const text = command.text.trim();
      const teamId = command.team_id;
      const invokerId = command.user_id;

      // Parse two user mentions: <@UBDR|name> <@UMGR|name>
      const mentionRegex = /<@(U[A-Z0-9]+)(?:\|[^>]*)?>/g;
      const mentions = [...text.matchAll(mentionRegex)];

      if (mentions.length < 2) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: `/assign-manager @bdr @manager`\nExample: `/assign-manager @jane @john`',
        });
        return;
      }

      const bdrSlackUserId = mentions[0][1];
      const managerSlackUserId = mentions[1][1];

      // Prevent self-assignment
      if (bdrSlackUserId === managerSlackUserId) {
        await respond({
          response_type: 'ephemeral',
          text: 'A BDR cannot be their own manager.',
        });
        return;
      }

      // Look up BDR
      const bdr = await prisma.bdr.findFirst({
        where: { slackUserId: bdrSlackUserId, slackTeamId: teamId, isActive: true },
      });

      if (!bdr) {
        await respond({
          response_type: 'ephemeral',
          text: `<@${bdrSlackUserId}> is not a registered BDR.`,
        });
        return;
      }

      const previousManagerId = bdr.managerId;

      // Update BDR's managerId
      await prisma.bdr.update({
        where: { id: bdr.id },
        data: { managerId: managerSlackUserId },
      });

      // Update active/supervised enrollments for this BDR
      const updatedEnrollments = await prisma.onboardingEnrollment.updateMany({
        where: {
          slackUserId: bdrSlackUserId,
          status: {
            in: [OnboardingEnrollmentStatus.ACTIVE, OnboardingEnrollmentStatus.SUPERVISED],
          },
        },
        data: { managerId: managerSlackUserId },
      });

      logAudit({
        action: 'bdr_manager_assigned',
        actorUserId: invokerId,
        actorTeamId: teamId,
        targetType: 'Bdr',
        targetId: bdr.id,
        metadata: {
          previousManagerId: previousManagerId ?? null,
          newManagerId: managerSlackUserId,
          enrollmentsUpdated: updatedEnrollments.count,
        },
      }).catch(() => {});

      const enrollmentNote =
        updatedEnrollments.count > 0
          ? `\nAlso updated ${updatedEnrollments.count} active enrollment(s) to the new manager.`
          : '';

      await respond({
        response_type: 'ephemeral',
        text: `Assigned <@${managerSlackUserId}> as manager for *${bdr.name}* (<@${bdrSlackUserId}>).${enrollmentNote}`,
      });

      logger.info('/assign-manager completed', {
        bdrId: bdr.id,
        bdrSlackUserId,
        previousManagerId,
        newManagerId: managerSlackUserId,
        enrollmentsUpdated: updatedEnrollments.count,
        invokedBy: invokerId,
      });
    } catch (error) {
      logger.error('/assign-manager command failed', { error });
      await respond({
        response_type: 'ephemeral',
        text: 'Something went wrong. Please try again or contact an admin.',
      });
    }
  });
}
