/**
 * Resolves the ManagedClient ID for a given Slack team + channel.
 * Returns null if no mapping exists.
 */
import { prisma } from '../models/index.js';

export async function resolveClientId(
  slackTeamId: string,
  slackChannelId: string,
): Promise<string | null> {
  const mapping = await prisma.channelClientMapping.findUnique({
    where: { slackTeamId_slackChannelId: { slackTeamId, slackChannelId } },
    select: { clientId: true },
  });
  return mapping?.clientId ?? null;
}
