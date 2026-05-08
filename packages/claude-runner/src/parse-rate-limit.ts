/**
 * Best-effort parser for the human-readable reset clock the Claude CLI prints
 * when a subscription rate-limit is hit (ADR-0026).
 *
 *   "You've hit your session limit · resets 3:45pm"
 *   "You've hit your Opus limit · resets 3:45pm"
 *   "You've hit your weekly limit · resets Mon 12:00am"
 *
 * Returns the next future Date matching the parsed clock in local server time,
 * or null if neither pattern matches.
 */

const SHORT_RESET_RE = /\bresets (\d{1,2}):(\d{2})\s*(am|pm)\b/i;
const WEEKDAY_RESET_RE =
  /\bresets (mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+(\d{1,2}):(\d{2})\s*(am|pm)\b/i;

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function to24h(hour: number, ampm: string): number {
  const h12 = hour % 12;
  return ampm.toLowerCase() === 'pm' ? h12 + 12 : h12;
}

function nextDayAt(now: Date, h24: number, m: number): Date {
  const d = new Date(now);
  d.setHours(h24, m, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

function nextWeekdayAt(now: Date, targetIdx: number, h24: number, m: number): Date {
  const d = new Date(now);
  d.setHours(h24, m, 0, 0);
  const diff = (targetIdx - d.getDay() + 7) % 7;
  if (diff > 0) d.setDate(d.getDate() + diff);
  if (diff === 0 && d.getTime() <= now.getTime()) d.setDate(d.getDate() + 7);
  return d;
}

export function parseRateLimitReset(text: string, now: Date = new Date()): Date | null {
  const wMatch = WEEKDAY_RESET_RE.exec(text);
  if (wMatch) {
    const day = wMatch[1]!.slice(0, 3).toLowerCase();
    const idx = WEEKDAYS.indexOf(day as (typeof WEEKDAYS)[number]);
    if (idx >= 0) {
      const h = Number.parseInt(wMatch[2]!, 10);
      const m = Number.parseInt(wMatch[3]!, 10);
      return nextWeekdayAt(now, idx, to24h(h, wMatch[4]!), m);
    }
  }
  const sMatch = SHORT_RESET_RE.exec(text);
  if (sMatch) {
    const h = Number.parseInt(sMatch[1]!, 10);
    const m = Number.parseInt(sMatch[2]!, 10);
    return nextDayAt(now, to24h(h, sMatch[3]!), m);
  }
  return null;
}
