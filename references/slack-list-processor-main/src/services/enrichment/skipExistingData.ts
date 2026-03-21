/**
 * Skip contacts with existing data (Feature 27, US1).
 * Implements FR-026: Don't enrich fields that already have values.
 */

import { DataType } from '@prisma/client';
import logger from '../../lib/logger.js';

interface ContactWithData {
  id: string;
  email?: string | null;
  directPhone?: string | null;
  businessPhone?: string | null;
}

export function skipExistingData<T extends ContactWithData>(
  contacts: T[],
  dataType: DataType,
): T[] {
  const filtered = contacts.filter((contact) => {
    if (dataType === 'EMAIL') {
      return !contact.email;
    } else if (dataType === 'PHONE') {
      return !contact.directPhone && !contact.businessPhone;
    }
    return true;
  });

  const skipped = contacts.length - filtered.length;
  if (skipped > 0) {
    logger.info('Skipped contacts with existing data (FR-026)', {
      dataType,
      totalContacts: contacts.length,
      skipped,
      remaining: filtered.length,
      skipPercentage: Math.round((skipped / contacts.length) * 100),
    });
  }

  return filtered;
}
