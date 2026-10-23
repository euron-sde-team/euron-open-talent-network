import type { EmploymentType, PayPeriod, Salary, Seniority, WorkplaceType } from "@open-talent/types";

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  FREELANCE: "Freelance",
  INTERNSHIP: "Internship",
  TEMPORARY: "Temporary",
};

export const WORKPLACE_LABEL: Record<WorkplaceType, string> = { ONSITE: "On-site", HYBRID: "Hybrid", REMOTE: "Remote" };

export const SENIORITY_LABEL: Record<Seniority, string> = {
  INTERN: "Internship",
  ENTRY: "Entry level",
  MID: "Mid level",
  SENIOR: "Senior",
  LEAD: "Lead",
  DIRECTOR: "Director",
  EXECUTIVE: "Executive",
};

const PERIOD_SUFFIX: Record<PayPeriod, string> = { HOUR: "/hr", DAY: "/day", MONTH: "/mo", YEAR: "/yr", PROJECT: " per project" };

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0, notation: n >= 100_000 ? "compact" : "standard" }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString()}`;
  }
}

/** "$120K to $150K/yr", "From $60/hr", or null when no pay is set. */
export function formatSalary(s: Salary | null | undefined): string | null {
  if (!s || (s.min == null && s.max == null) || !s.currency) return null;
  const suffix = s.period ? PERIOD_SUFFIX[s.period] : "";
  if (s.min != null && s.max != null && s.min !== s.max) return `${money(s.min, s.currency)} to ${money(s.max, s.currency)}${suffix}`;
  if (s.min != null && s.max != null) return `${money(s.min, s.currency)}${suffix}`;
  if (s.min != null) return `From ${money(s.min, s.currency)}${suffix}`;
  return `Up to ${money(s.max!, s.currency)}${suffix}`;
}

/** "Berlin (Hybrid)" or "Remote". */
export function formatPlace(location: string | null, workplace: WorkplaceType): string {
  if (!location) return WORKPLACE_LABEL[workplace];
  // "Remote (Remote)" says nothing twice; a remote job with a region keeps the region.
  if (location.trim().toLowerCase() === WORKPLACE_LABEL[workplace].toLowerCase()) return WORKPLACE_LABEL[workplace];
  return `${location} (${WORKPLACE_LABEL[workplace]})`;
}

/** "2019-03" -> "Mar 2019". */
export function formatMonth(ym: string | null | undefined): string {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

/** "Mar 2019 to Present, 5 yrs 2 mos". */
export function formatSpan(start: string | null, end: string | null, now = new Date()): string {
  if (!start) return "";
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end ? end.split("-").map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const months = Math.max(1, (ey! - sy!) * 12 + (em! - sm!) + 1);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const dur = [y ? `${y} yr${y > 1 ? "s" : ""}` : "", m ? `${m} mo${m > 1 ? "s" : ""}` : ""].filter(Boolean).join(" ");
  return `${formatMonth(start)} to ${end ? formatMonth(end) : "Present"}, ${dur}`;
}
