/**
 * Recruiter verification, pure. The source auto-activated anyone who confirmed any email
 * and a phone number; here a work email is confirmed by a one-time code and then a
 * human reviews the application, unless the company is VERIFIED, allows domain
 * auto-approval, and the confirmed email is on one of its domains.
 */
import { baseDomain } from "./safe-url";

export interface DomainFacts {
  workEmail: string;
  companyDomains: readonly string[];
  freeMailDomains: readonly string[];
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
}

export function isFreeMail(email: string, freeMailDomains: readonly string[]): boolean {
  const d = emailDomain(email);
  if (!d) return true;
  const set = new Set(freeMailDomains.map((x) => x.toLowerCase()));
  return set.has(d) || set.has(baseDomain(d) ?? d);
}

/** The work email sits on one of the company's domains (sub-domains count). */
export function domainMatches(f: DomainFacts): boolean {
  const d = emailDomain(f.workEmail);
  if (!d || isFreeMail(f.workEmail, f.freeMailDomains)) return false;
  return f.companyDomains.some((cd) => {
    const c = cd.toLowerCase();
    return d === c || d.endsWith(`.${c}`);
  });
}

export type ReviewRoute = "AUTO_APPROVE" | "REVIEW";

/** Where a recruiter goes once their work email is confirmed. */
export function reviewRoute(f: DomainFacts & { companyVerified: boolean; companyAllowsAuto: boolean; platformAllowsAuto: boolean }): ReviewRoute {
  if (f.companyVerified && f.companyAllowsAuto && f.platformAllowsAuto && domainMatches(f)) return "AUTO_APPROVE";
  return "REVIEW";
}

/** Six digits, uniformly drawn. */
export function newEmailCode(random: (max: number) => number): string {
  return String(random(1_000_000)).padStart(6, "0");
}

export const EMAIL_CODE_TTL_MS = 15 * 60_000;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
