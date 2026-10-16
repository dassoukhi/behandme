export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 1440 * MINUTE;

/** Start of the period that contains `now` (periods are aligned on the Unix epoch, UTC). */
export function periodStart(now: Date, everyMs: number): Date {
  return new Date(Math.floor(now.getTime() / everyMs) * everyMs);
}
