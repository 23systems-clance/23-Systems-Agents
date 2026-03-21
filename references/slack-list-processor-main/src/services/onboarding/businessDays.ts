/**
 * Business day calculation utilities for onboarding scheduling.
 *
 * All functions are pure (no side effects, no DB access) and operate
 * in UTC. Timezone handling is done at the scheduling layer.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the given date falls on a weekday (Monday-Friday).
 *
 * @param date - The date to check.
 * @returns `true` when the day is Mon-Fri, `false` for Sat/Sun.
 */
export function isBusinessDay(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

/**
 * Returns the next business day after the given date.
 *
 * - Mon-Thu  -> next calendar day
 * - Friday   -> following Monday
 * - Saturday -> following Monday
 * - Sunday   -> following Monday
 *
 * @param date - The reference date.
 * @returns A new Date representing the next weekday.
 */
export function getNextBusinessDay(date: Date): Date {
  const next = new Date(date);
  const day = next.getUTCDay();

  if (day === 5) {
    // Friday -> Monday (+3)
    next.setUTCDate(next.getUTCDate() + 3);
  } else if (day === 6) {
    // Saturday -> Monday (+2)
    next.setUTCDate(next.getUTCDate() + 2);
  } else if (day === 0) {
    // Sunday -> Monday (+1)
    next.setUTCDate(next.getUTCDate() + 1);
  } else {
    // Mon-Thu -> next calendar day
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next;
}

// ---------------------------------------------------------------------------
// Core calculations
// ---------------------------------------------------------------------------

/**
 * Calculates the current business day number (1-indexed) between a start
 * date and today, counting only weekdays.
 *
 * - Day 1 is the start date itself (if it falls on a weekday).
 * - If the start date is on a weekend, day 1 becomes the next Monday.
 * - If `today` is before the effective start date, returns 0.
 *
 * @param startDate - The onboarding start date.
 * @param today     - The current date to measure against.
 * @returns The 1-indexed business day number, or 0 if not yet started.
 *
 * @example
 * // startDate = Mon Mar 10, today = Fri Mar 14 -> returns 5
 * calculateCurrentBusinessDay(new Date('2025-03-10'), new Date('2025-03-14'));
 */
export function calculateCurrentBusinessDay(startDate: Date, today: Date): number {
  // Normalise the effective start to the first weekday on or after startDate
  let effectiveStart = new Date(startDate);
  while (!isBusinessDay(effectiveStart)) {
    effectiveStart.setUTCDate(effectiveStart.getUTCDate() + 1);
  }

  // If today is before the effective start, onboarding hasn't begun
  if (today < effectiveStart) {
    return 0;
  }

  let businessDays = 0;
  const cursor = new Date(effectiveStart);

  while (cursor <= today) {
    if (isBusinessDay(cursor)) {
      businessDays++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return businessDays;
}

/**
 * Calculates the expected end date after a given number of business days
 * from the start date, skipping weekends.
 *
 * @param startDate    - The onboarding start date.
 * @param durationDays - Total number of business days for the plan.
 * @returns A new Date representing the last business day of the plan.
 *
 * @example
 * // startDate = Mon Mar 10, durationDays = 15 -> returns Fri Mar 28
 * calculateExpectedEndDate(new Date('2025-03-10'), 15);
 */
export function calculateExpectedEndDate(startDate: Date, durationDays: number): Date {
  // Normalise the start to the first weekday on or after startDate
  let current = new Date(startDate);
  while (!isBusinessDay(current)) {
    current.setUTCDate(current.getUTCDate() + 1);
  }

  // Count business days (the start date itself counts as day 1)
  let counted = 1;
  while (counted < durationDays) {
    current.setUTCDate(current.getUTCDate() + 1);
    if (isBusinessDay(current)) {
      counted++;
    }
  }

  return current;
}
