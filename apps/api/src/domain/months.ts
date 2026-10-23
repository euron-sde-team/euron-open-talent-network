/**
 * Months as "YYYY-MM" on the wire and the first of the month (a DATE) in the database.
 * The source stored free-text dates ("Jan 2020 - now"), which could not be sorted or
 * validated and made "current role" a guess.
 */
const YM = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseYearMonth(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = YM.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1900 || year > 2100) return null;
  return new Date(Date.UTC(year, Number(m[2]) - 1, 1));
}

export function toYearMonth(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Whole years of experience across roles, overlapping periods counted once. */
export function yearsFromRoles(roles: { start: Date; end: Date | null }[], now = new Date()): number {
  const spans = roles
    .map((r) => [r.start.getTime(), (r.end ?? now).getTime()] as const)
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [a, b] of spans) {
    if (a > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = a;
      curEnd = b;
    } else curEnd = Math.max(curEnd, b);
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return Math.floor(total / (365.25 * 86400_000));
}
