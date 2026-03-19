/**
 * Schedule Mapper — converts between human-readable schedules and cron expressions.
 */

/**
 * Preset schedule options for the UI picker.
 */
export const SCHEDULE_PRESETS = [
  { id: 'now', label: 'Just once — right now', cron: null },
  { id: 'hourly', label: 'Every hour', cron: '0 * * * *' },
  { id: 'every2h', label: 'Every 2 hours', cron: '0 */2 * * *' },
  { id: 'every4h', label: 'Every 4 hours', cron: '0 */4 * * *' },
  { id: 'daily', label: 'Every day', cron: '0 9 * * *', configurable: { time: true } },
  { id: 'weekdays', label: 'Every weekday', cron: '0 9 * * 1-5', configurable: { time: true } },
  { id: 'weekly', label: 'Every week', cron: '0 9 * * 1', configurable: { day: true, time: true } },
  { id: 'monthly', label: 'Every month', cron: '0 9 1 * *', configurable: { date: true, time: true } },
  { id: 'custom', label: 'Custom schedule...', cron: null, advanced: true },
];

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
];

/**
 * Build a cron expression from a human-readable selection.
 *
 * @param {object} selection
 * @param {string} selection.preset - Preset ID from SCHEDULE_PRESETS
 * @param {number} [selection.hour] - Hour (0-23), default 9
 * @param {number} [selection.minute] - Minute (0-59), default 0
 * @param {number} [selection.dayOfWeek] - Day of week (0-6, 0=Sunday)
 * @param {number} [selection.dayOfMonth] - Day of month (1-31)
 * @param {string} [selection.customCron] - Raw cron expression (for advanced)
 *
 * @returns {{ humanLabel: string, cron: string | null }}
 */
export function humanToCron(selection) {
  const { preset, hour = 9, minute = 0, dayOfWeek = 1, dayOfMonth = 1, customCron } = selection;

  const timeStr = formatTime(hour, minute);

  switch (preset) {
    case 'now':
      return { humanLabel: 'Run once now', cron: null };

    case 'hourly':
      return { humanLabel: 'Every hour', cron: '0 * * * *' };

    case 'every2h':
      return { humanLabel: 'Every 2 hours', cron: '0 */2 * * *' };

    case 'every4h':
      return { humanLabel: 'Every 4 hours', cron: '0 */4 * * *' };

    case 'daily':
      return {
        humanLabel: `Every day at ${timeStr}`,
        cron: `${minute} ${hour} * * *`,
      };

    case 'weekdays':
      return {
        humanLabel: `Every weekday at ${timeStr}`,
        cron: `${minute} ${hour} * * 1-5`,
      };

    case 'weekly': {
      const dayName = DAYS_OF_WEEK.find(d => d.value === dayOfWeek)?.label || 'Monday';
      return {
        humanLabel: `Every ${dayName} at ${timeStr}`,
        cron: `${minute} ${hour} * * ${dayOfWeek}`,
      };
    }

    case 'monthly':
      return {
        humanLabel: `Monthly on the ${ordinal(dayOfMonth)} at ${timeStr}`,
        cron: `${minute} ${hour} ${dayOfMonth} * *`,
      };

    case 'custom':
      if (!customCron) return { humanLabel: 'Custom schedule', cron: null };
      return {
        humanLabel: cronToHuman(customCron),
        cron: customCron,
      };

    default:
      return { humanLabel: 'Run once now', cron: null };
  }
}

/**
 * Convert a cron expression to a human-readable string.
 * Handles common patterns — falls back to raw expression for complex ones.
 */
export function cronToHuman(cron) {
  if (!cron || typeof cron !== 'string') return 'No schedule';

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every minute
  if (cron === '* * * * *') return 'Every minute';

  // Every N minutes
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every ${minute.slice(2)} minutes`;
  }

  // Every hour
  if (minute !== '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every hour';
  }

  // Every N hours
  if (hour.startsWith('*/') && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every ${hour.slice(2)} hours`;
  }

  // Daily
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && !hour.includes('*') && !hour.includes('/')) {
    return `Every day at ${formatTime(parseInt(hour), parseInt(minute))}`;
  }

  // Weekdays
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5' && !hour.includes('*')) {
    return `Every weekday at ${formatTime(parseInt(hour), parseInt(minute))}`;
  }

  // Weekly
  if (dayOfMonth === '*' && month === '*' && !dayOfWeek.includes('*') && !dayOfWeek.includes('/') && !dayOfWeek.includes('-')) {
    const day = DAYS_OF_WEEK.find(d => d.value === parseInt(dayOfWeek));
    if (day) {
      return `Every ${day.label} at ${formatTime(parseInt(hour), parseInt(minute))}`;
    }
  }

  // Monthly
  if (!dayOfMonth.includes('*') && month === '*' && dayOfWeek === '*' && !hour.includes('*')) {
    return `Monthly on the ${ordinal(parseInt(dayOfMonth))} at ${formatTime(parseInt(hour), parseInt(minute))}`;
  }

  return `Custom: ${cron}`;
}

/**
 * Get the next N scheduled run times for a cron expression.
 * Simple implementation for common patterns.
 */
export function getNextRuns(cron, count = 3) {
  if (!cron) return [];

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return [];

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;
  const runs = [];
  const now = new Date();
  let cursor = new Date(now);

  for (let i = 0; i < count * 100 && runs.length < count; i++) {
    cursor = new Date(cursor.getTime() + 60000); // advance 1 minute

    const m = cursor.getMinutes();
    const h = cursor.getHours();
    const dom = cursor.getDate();
    const dow = cursor.getDay();

    if (!matchesCronField(minute, m)) continue;
    if (!matchesCronField(hour, h)) continue;
    if (!matchesCronField(dayOfMonth, dom)) continue;
    if (!matchesCronField(dayOfWeek, dow)) continue;

    runs.push(new Date(cursor));
  }

  return runs;
}

function matchesCronField(field, value) {
  if (field === '*') return true;
  if (field.startsWith('*/')) return value % parseInt(field.slice(2)) === 0;
  if (field.includes('-')) {
    const [min, max] = field.split('-').map(Number);
    return value >= min && value <= max;
  }
  if (field.includes(',')) {
    return field.split(',').map(Number).includes(value);
  }
  return parseInt(field) === value;
}

function formatTime(hour, minute) {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  const m = String(minute).padStart(2, '0');
  return `${h}:${m} ${ampm}`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export { DAYS_OF_WEEK };
