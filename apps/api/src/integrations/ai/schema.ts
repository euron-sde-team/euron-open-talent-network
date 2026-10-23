/**
 * The shape the AI must return, as a JSON schema (sent to the model, which then has to
 * produce exactly this) and as a sanitiser for what comes back. Nothing a model writes
 * is trusted: URLs go through safeUrl(), months through parseYearMonth(), lengths are
 * clamped, skills de-duplicated, and personal contact details (emails, phone numbers)
 * are stripped from every text field, because a profile's contact data is private and
 * only the owner may enter it.
 */
import type { LinkKind, ProposedProfile } from "@open-talent/types";
import { LINK_KINDS, EMPLOYMENT_TYPES, WORKPLACE_TYPES } from "@open-talent/types";
import { parseYearMonth, toYearMonth } from "../../domain/months";
import { safeUrl } from "../../domain/safe-url";
import { uniqueSkills } from "../../domain/search-text";

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, "null"], ...extra });
const str = (max: number) => nullable("string", { maxLength: max });

/** Strict JSON schema (OpenAI structured outputs, Gemini responseSchema). */
export const PORTFOLIO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "about", "currentTitle", "location", "yearsExperience", "experience", "education", "projects", "skills", "certifications", "links", "missingInfo"],
  properties: {
    headline: str(160),
    about: str(2000),
    currentTitle: str(120),
    location: str(120),
    yearsExperience: nullable("integer"),
    experience: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "companyName", "employmentType", "workplaceType", "location", "startMonth", "endMonth", "description", "skills"],
        properties: {
          title: { type: "string" },
          companyName: { type: "string" },
          employmentType: nullable("string", { enum: [...EMPLOYMENT_TYPES, null] }),
          workplaceType: nullable("string", { enum: [...WORKPLACE_TYPES, null] }),
          location: str(120),
          startMonth: { type: "string", description: "YYYY-MM" },
          endMonth: nullable("string", { description: "YYYY-MM, or null for a current role" }),
          description: str(3000),
          skills: { type: "array", items: { type: "string" } },
        },
      },
    },
    education: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["institution", "degree", "field", "startYear", "endYear", "grade", "description"],
        properties: { institution: { type: "string" }, degree: str(120), field: str(120), startYear: nullable("integer"), endYear: nullable("integer"), grade: str(40), description: str(2000) },
      },
    },
    projects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "url", "repoUrl", "skills", "startMonth", "endMonth"],
        properties: { name: { type: "string" }, description: str(3000), url: str(500), repoUrl: str(500), skills: { type: "array", items: { type: "string" } }, startMonth: str(7), endMonth: str(7) },
      },
    },
    skills: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["name", "category", "years"], properties: { name: { type: "string" }, category: str(60), years: nullable("integer") } },
    },
    certifications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "issuer", "issuedMonth", "expiresMonth", "credentialId", "credentialUrl"],
        properties: { name: { type: "string" }, issuer: str(120), issuedMonth: str(7), expiresMonth: str(7), credentialId: str(120), credentialUrl: str(500) },
      },
    },
    links: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["kind", "url", "label", "featured"], properties: { kind: { type: "string", enum: [...LINK_KINDS] }, url: { type: "string" }, label: str(80), featured: { type: "boolean" } } },
    },
    missingInfo: { type: "array", items: { type: "string" } },
  },
} as const;

export const BADGES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["badges"],
  properties: {
    badges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "slug", "label", "rationale", "evidenceQuote", "confidence"],
        properties: {
          kind: { type: "string", enum: ["ROLE_FIT", "DOMAIN", "ACHIEVEMENT"] },
          slug: { type: "string" },
          label: { type: "string" },
          rationale: { type: "string" },
          evidenceQuote: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
} as const;

export const POLISH_SCHEMA = { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } } as const;

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;

/** Free text with personal contact details removed, trimmed and clamped. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(EMAIL, "").replace(PHONE, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max).trim();
  return s || null;
}

const month = (v: unknown): string | null => (typeof v === "string" ? toYearMonth(parseYearMonth(v)) : null);
const int = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);

export function sanitizeProposal(raw: unknown): { proposal: ProposedProfile; missingInfo: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const experience = arr(r.experience)
    .map((e) => ({
      title: cleanText(e.title, 120),
      companyName: cleanText(e.companyName, 120),
      employmentType: oneOf(e.employmentType, EMPLOYMENT_TYPES),
      workplaceType: oneOf(e.workplaceType, WORKPLACE_TYPES),
      location: cleanText(e.location, 120),
      startMonth: month(e.startMonth),
      endMonth: month(e.endMonth),
      description: cleanText(e.description, 3000),
      skills: uniqueSkills(Array.isArray(e.skills) ? e.skills.map(String) : [], 20),
    }))
    .filter((e): e is typeof e & { title: string; companyName: string; startMonth: string } => !!e.title && !!e.companyName && !!e.startMonth)
    .map((e) => (e.endMonth && e.endMonth < e.startMonth ? { ...e, endMonth: null } : e))
    .slice(0, 30);
  const education = arr(r.education)
    .map((e) => ({ institution: cleanText(e.institution, 160), degree: cleanText(e.degree, 120), field: cleanText(e.field, 120), startYear: int(e.startYear, 1900, 2100), endYear: int(e.endYear, 1900, 2100), grade: cleanText(e.grade, 40), description: cleanText(e.description, 2000) }))
    .filter((e): e is typeof e & { institution: string } => !!e.institution)
    .slice(0, 15);
  const projects = arr(r.projects)
    .map((p) => ({ name: cleanText(p.name, 120), description: cleanText(p.description, 3000), url: safeUrl(typeof p.url === "string" ? p.url : null), repoUrl: safeUrl(typeof p.repoUrl === "string" ? p.repoUrl : null), skills: uniqueSkills(Array.isArray(p.skills) ? p.skills.map(String) : [], 20), startMonth: month(p.startMonth), endMonth: month(p.endMonth) }))
    .filter((p): p is typeof p & { name: string } => !!p.name)
    .slice(0, 20);
  const skillNames = uniqueSkills(arr(r.skills).map((s) => String(s.name ?? "")), 50);
  // The first spelling wins (as in uniqueSkills), and so do its category and years.
  const skillMeta = new Map([...arr(r.skills)].reverse().map((s) => [String(s.name ?? "").trim().toLowerCase(), s]));
  const skills = skillNames.map((name) => {
    const m = skillMeta.get(name.toLowerCase()) ?? {};
    return { name, category: cleanText(m.category, 60), years: int(m.years, 0, 60) };
  });
  const certifications = arr(r.certifications)
    .map((c) => ({ name: cleanText(c.name, 160), issuer: cleanText(c.issuer, 120), issuedMonth: month(c.issuedMonth), expiresMonth: month(c.expiresMonth), credentialId: cleanText(c.credentialId, 120), credentialUrl: safeUrl(typeof c.credentialUrl === "string" ? c.credentialUrl : null) }))
    .filter((c): c is typeof c & { name: string } => !!c.name)
    .slice(0, 30);
  const links = arr(r.links)
    .map((l) => ({ kind: (oneOf(l.kind, LINK_KINDS) ?? "WEBSITE") as LinkKind, url: safeUrl(typeof l.url === "string" ? l.url : null), label: cleanText(l.label, 80), featured: l.featured === true }))
    .filter((l): l is typeof l & { url: string } => !!l.url)
    .slice(0, 15);
  return {
    proposal: {
      headline: cleanText(r.headline, 160),
      about: cleanText(r.about, 4000),
      currentTitle: cleanText(r.currentTitle, 120),
      location: cleanText(r.location, 120),
      yearsExperience: int(r.yearsExperience, 0, 70),
      experience,
      education,
      projects,
      skills,
      certifications,
      links,
    },
    missingInfo: (Array.isArray(r.missingInfo) ? r.missingInfo : []).map((m) => cleanText(m, 120)).filter((m): m is string => !!m).slice(0, 8),
  };
}

export interface RawBadge {
  kind: "ROLE_FIT" | "DOMAIN" | "ACHIEVEMENT";
  slug: string;
  label: string;
  rationale: string;
  evidenceQuote: string;
  confidence: number;
}

export function readBadges(raw: unknown): RawBadge[] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return arr(r.badges)
    .map((b) => ({
      kind: oneOf(b.kind, ["ROLE_FIT", "DOMAIN", "ACHIEVEMENT"] as const) ?? "DOMAIN",
      slug: String(b.slug ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60),
      label: cleanText(b.label, 60) ?? "",
      rationale: cleanText(b.rationale, 500) ?? "",
      evidenceQuote: cleanText(b.evidenceQuote, 500) ?? "",
      confidence: typeof b.confidence === "number" ? Math.max(0, Math.min(1, b.confidence)) : 0,
    }))
    .filter((b) => b.slug && b.label && b.evidenceQuote)
    .slice(0, 8);
}
