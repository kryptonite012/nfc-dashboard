import { AppError } from './errors';

const validZones = new Map<string, boolean>();

function isValidTimeZone(tz: string): boolean {
  let valid = validZones.get(tz);
  if (valid === undefined) {
    try {
      // Accepts canonical names and aliases (e.g. both Asia/Kolkata and Asia/Calcutta).
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      valid = true;
    } catch {
      valid = false;
    }
    if (validZones.size < 1000) validZones.set(tz, valid);
  }
  return valid;
}

/** Returns a validated IANA time zone, defaulting to UTC. */
export function resolveTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  if (!isValidTimeZone(tz)) throw new AppError('VALIDATION_FAILED', 'Unknown time zone', { tz: 'Unknown time zone' });
  return tz;
}

/** Offset of `timeZone` from UTC at the given instant, in milliseconds. */
function zoneOffsetMs(timeZone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The UTC instant at which the calendar date `isoDate` (YYYY-MM-DD) begins in `timeZone`. */
export function startOfDayInZone(isoDate: string, timeZone: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(year, month - 1, day);
  let instant = naive - zoneOffsetMs(timeZone, naive);
  // Re-check once in case the offset differs at the corrected instant (DST transitions).
  instant = naive - zoneOffsetMs(timeZone, instant);
  return new Date(instant);
}

/** Adds whole days to a YYYY-MM-DD string. */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Today's calendar date in `timeZone`. */
export function todayInZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Inclusive date range → half-open UTC instant range [start, end). */
export function dateRangeToInstants(from: string | undefined, to: string | undefined, timeZone: string) {
  return {
    gte: from ? startOfDayInZone(from, timeZone) : undefined,
    lt: to ? startOfDayInZone(addDays(to, 1), timeZone) : undefined,
  };
}
