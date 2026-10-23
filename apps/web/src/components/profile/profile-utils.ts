import type {
  BadgeKind,
  Certification,
  Education,
  EmploymentType,
  Experience,
  LinkKind,
  OpenToWorkMode,
  Profile,
  ProfileLink,
  ProfileSection,
  ProfileStatus,
  Project,
  SectionAudience,
  Skill,
  WorkplaceType,
} from "@open-talent/types";
import type { CertificationInput, EducationInput, ExperienceInput, LinkInput, ProjectInput, SectionItems, SkillInput } from "@open-talent/api-client";

export const SECTION_LABEL: Record<ProfileSection, string> = {
  experience: "Experience",
  education: "Education",
  projects: "Projects",
  skills: "Skills",
  certifications: "Licenses and certifications",
  links: "Links",
};

/** Singular noun for "Add ..." buttons. */
export const SECTION_ITEM: Record<ProfileSection, string> = {
  experience: "role",
  education: "school",
  projects: "project",
  skills: "skill",
  certifications: "certification",
  links: "link",
};

export const SECTION_LIMIT: Record<ProfileSection, number> = { experience: 30, education: 15, projects: 20, skills: 50, certifications: 30, links: 15 };

export const AUDIENCE_LABEL: Record<SectionAudience, string> = {
  PUBLIC: "Everyone",
  CONNECTIONS: "Connections only",
  RECRUITERS: "Connections and verified recruiters",
};

export const AUDIENCE_SHORT: Record<SectionAudience, string> = { PUBLIC: "Public", CONNECTIONS: "Connections", RECRUITERS: "Recruiters" };

export const STATUS_LABEL: Record<ProfileStatus, string> = { DRAFT: "Draft", PUBLISHED: "Published", UNLISTED: "Unlisted", SUSPENDED: "Suspended" };

export const STATUS_HINT: Record<ProfileStatus, string> = {
  DRAFT: "Only you can see this page. Publish it when you are ready for people and recruiters to find you.",
  PUBLISHED: "Anyone can open this page, and it appears in search and the talent directory.",
  UNLISTED: "People with the link can open this page, but it stays out of search and the directory.",
  SUSPENDED: "A moderator is reviewing this page. It is hidden from everyone else until then.",
};

export const OPEN_TO_WORK_LABEL: Record<OpenToWorkMode, string> = {
  OFF: "Not looking",
  RECRUITERS: "Verified recruiters only",
  PUBLIC: "Everyone",
};

export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  WEBSITE: "Website",
  GITHUB: "GitHub",
  LINKEDIN: "Professional network",
  X: "X",
  YOUTUBE: "YouTube",
  MEDIUM: "Medium",
  KAGGLE: "Kaggle",
  HUGGINGFACE: "Hugging Face",
  BEHANCE: "Behance",
  DRIBBBLE: "Dribbble",
  OTHER: "Other",
};

export const BADGE_KIND_LABEL: Record<BadgeKind, string> = {
  SENIORITY: "Seniority",
  ROLE_FIT: "Role fit",
  SKILL_PERCENTILE: "Skill",
  DOMAIN: "Domain",
  ACHIEVEMENT: "Achievement",
  VERIFICATION: "Verification",
};

/**
 * Enum arrays can arrive as a Postgres array literal ("{FULL_TIME,PART_TIME}") instead of
 * a JSON array; accept both so the page never crashes on either shape.
 */
export function asList<T extends string>(v: unknown): T[] {
  if (Array.isArray(v)) return v.filter((x): x is T => typeof x === "string");
  if (typeof v === "string") {
    const inner = v.trim().replace(/^\{|\}$/g, "");
    return inner ? (inner.split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean) as T[]) : [];
  }
  return [];
}

type OtwShape = { roles: string[]; employmentTypes: EmploymentType[]; workplaceTypes: WorkplaceType[]; availableFrom: string | null };

function fixOtw<T extends OtwShape | null>(o: T): T {
  if (!o) return o;
  return { ...o, roles: asList<string>(o.roles), employmentTypes: asList<EmploymentType>(o.employmentTypes), workplaceTypes: asList<WorkplaceType>(o.workplaceTypes) };
}

/** Normalise list fields so every component can trust the types. */
export function normalizeProfile<P extends Profile>(p: P): P {
  const out: P = { ...p, openToWork: fixOtw(p.openToWork), languages: asList<string>(p.languages) };
  const settings = (p as unknown as { openToWorkSettings?: OtwShape }).openToWorkSettings;
  if (settings) (out as unknown as { openToWorkSettings: OtwShape }).openToWorkSettings = fixOtw(settings);
  return out;
}

/** "2014 to 2018", "2018", or "". */
export function yearRange(start: number | null, end: number | null): string {
  if (start && end) return start === end ? String(start) : `${start} to ${end}`;
  return String(start ?? end ?? "");
}

const nn = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

// ─── Item to input mappers (a section save sends the full list) ─────────────

export const toExperienceInput = (e: Experience): ExperienceInput => ({
  title: e.title,
  companyName: e.companyName,
  companySlug: e.company?.slug ?? null,
  employmentType: e.employmentType,
  workplaceType: e.workplaceType,
  location: e.location,
  startMonth: e.startMonth,
  endMonth: e.endMonth,
  description: e.description,
  skills: e.skills,
});
export const toEducationInput = (e: Education): EducationInput => ({
  institution: e.institution,
  degree: e.degree,
  field: e.field,
  startYear: e.startYear,
  endYear: e.endYear,
  grade: e.grade,
  description: e.description,
});
export const toProjectInput = (p: Project): ProjectInput => ({
  name: p.name,
  description: p.description,
  url: p.url,
  repoUrl: p.repoUrl,
  coverUploadId: p.cover?.id ?? null,
  skills: p.skills,
  startMonth: p.startMonth,
  endMonth: p.endMonth,
});
export const toSkillInput = (s: Skill): SkillInput => ({ name: s.name, category: s.category, years: s.years });
export const toCertificationInput = (c: Certification): CertificationInput => ({
  name: c.name,
  issuer: c.issuer,
  issuedMonth: c.issuedMonth,
  expiresMonth: c.expiresMonth,
  credentialId: c.credentialId,
  credentialUrl: c.credentialUrl,
});
export const toLinkInput = (l: ProfileLink): LinkInput => ({ kind: l.kind, url: l.url, label: l.label, featured: l.featured });

export function sectionInputs<S extends ProfileSection>(p: Profile, section: S): SectionItems[S] {
  const map: { [K in ProfileSection]: () => SectionItems[K] } = {
    experience: () => p.experience.map(toExperienceInput),
    education: () => p.education.map(toEducationInput),
    projects: () => p.projects.map(toProjectInput),
    skills: () => p.skills.map(toSkillInput),
    certifications: () => p.certifications.map(toCertificationInput),
    links: () => p.links.map(toLinkInput),
  };
  return map[section]();
}

/** Trim strings and turn blanks into null before a save, so the API validators see clean input. */
export function cleanInput<T extends object>(item: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if (typeof v === "string") out[k] = nn(v);
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === "string" ? x.trim() : x)).filter((x) => x !== "");
    else out[k] = v;
  }
  return out as T;
}

export function blankItem<S extends ProfileSection>(section: S): SectionItems[S][number] {
  const blanks: { [K in ProfileSection]: SectionItems[K][number] } = {
    experience: { title: "", companyName: "", companySlug: null, employmentType: null, workplaceType: null, location: null, startMonth: "", endMonth: null, description: null, skills: [] },
    education: { institution: "", degree: null, field: null, startYear: null, endYear: null, grade: null, description: null },
    projects: { name: "", description: null, url: null, repoUrl: null, coverUploadId: null, skills: [], startMonth: null, endMonth: null },
    skills: { name: "", category: null, years: null },
    certifications: { name: "", issuer: null, issuedMonth: null, expiresMonth: null, credentialId: null, credentialUrl: null },
    links: { kind: "WEBSITE", url: "", label: null, featured: false },
  };
  return blanks[section];
}

/** Client-side checks mirroring the API validators; returns field errors keyed by field name. */
export function validateItem(section: ProfileSection, item: Record<string, unknown>): Record<string, string> {
  const e: Record<string, string> = {};
  const str = (k: string) => (typeof item[k] === "string" ? (item[k] as string).trim() : "");
  const isUrl = (s: string) => /^https?:\/\/\S+\.\S+/i.test(s);
  switch (section) {
    case "experience":
      if (!str("title")) e.title = "Add a title";
      if (!str("companyName")) e.companyName = "Add the company";
      if (!str("startMonth")) e.startMonth = "Add a start month";
      if (str("endMonth") && str("startMonth") && str("endMonth") < str("startMonth")) e.endMonth = "The end must come after the start";
      break;
    case "education": {
      if (!str("institution")) e.institution = "Add the school";
      const s = item.startYear as number | null;
      const en = item.endYear as number | null;
      if (s && (s < 1900 || s > 2100)) e.startYear = "Use a year between 1900 and 2100";
      if (en && (en < 1900 || en > 2100)) e.endYear = "Use a year between 1900 and 2100";
      if (s && en && en < s) e.endYear = "The end must come after the start";
      break;
    }
    case "projects":
      if (!str("name")) e.name = "Add a name";
      if (str("url") && !isUrl(str("url"))) e.url = "Use a full link starting with https://";
      if (str("repoUrl") && !isUrl(str("repoUrl"))) e.repoUrl = "Use a full link starting with https://";
      if (str("endMonth") && str("startMonth") && str("endMonth") < str("startMonth")) e.endMonth = "The end must come after the start";
      break;
    case "skills":
      if (!str("name")) e.name = "Add a skill";
      break;
    case "certifications":
      if (!str("name")) e.name = "Add a name";
      if (str("credentialUrl") && !isUrl(str("credentialUrl"))) e.credentialUrl = "Use a full link starting with https://";
      break;
    case "links":
      if (!str("url")) e.url = "Add the link";
      else if (!isUrl(str("url"))) e.url = "Use a full link starting with https://";
      break;
  }
  return e;
}

/** A display name for one list item in the editor's collapsed row. */
export function itemTitle(section: ProfileSection, item: Record<string, unknown>): { title: string; sub: string } {
  const s = (k: string) => (typeof item[k] === "string" ? (item[k] as string) : "");
  switch (section) {
    case "experience":
      return { title: s("title") || "New role", sub: s("companyName") };
    case "education":
      return { title: s("institution") || "New school", sub: [s("degree"), s("field")].filter(Boolean).join(", ") };
    case "projects":
      return { title: s("name") || "New project", sub: s("url") };
    case "skills":
      return { title: s("name") || "New skill", sub: item.years ? `${String(item.years)} yrs` : "" };
    case "certifications":
      return { title: s("name") || "New certification", sub: s("issuer") };
    case "links":
      return { title: s("label") || s("url") || "New link", sub: LINK_KIND_LABEL[(item.kind as LinkKind) ?? "OTHER"] };
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
