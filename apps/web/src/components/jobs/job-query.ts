import type { JobQuery } from "@open-talent/api-client";
import { EMPLOYMENT_TYPES, SENIORITIES, WORKPLACE_TYPES, type EmploymentType, type Seniority, type WorkplaceType } from "@open-talent/types";

/** The job search filters as they live in the URL (shareable links). */
export interface JobFilters {
  q: string;
  location: string;
  workplace: WorkplaceType[];
  employment: EmploymentType[];
  seniority: Seniority[];
  postedWithinDays: number | null;
  salaryMin: number | null;
  sort: "recent" | "relevance";
}

export const POSTED_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Any time" },
  { value: 1, label: "Past 24 hours" },
  { value: 7, label: "Past week" },
  { value: 30, label: "Past month" },
];

function list<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const set = new Set(allowed as readonly string[]);
  return [...new Set(raw.split(",").map((s) => s.trim().toUpperCase()))].filter((s): s is T => set.has(s));
}

function positiveInt(raw: string | null, max: number): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= max ? n : null;
}

export function parseFilters(sp: URLSearchParams): JobFilters {
  return {
    q: (sp.get("q") ?? "").slice(0, 100),
    location: (sp.get("location") ?? "").slice(0, 120),
    workplace: list(sp.get("workplace"), WORKPLACE_TYPES),
    employment: list(sp.get("employment"), EMPLOYMENT_TYPES),
    seniority: list(sp.get("seniority"), SENIORITIES),
    postedWithinDays: positiveInt(sp.get("posted"), 90),
    salaryMin: positiveInt(sp.get("salary"), 100_000_000),
    sort: sp.get("sort") === "relevance" ? "relevance" : "recent",
  };
}

/** Writes the filters onto a copy of `base`, keeping unrelated params (but not the selected job). */
export function filtersToParams(f: JobFilters, base?: URLSearchParams): URLSearchParams {
  const sp = new URLSearchParams(base);
  const set = (k: string, v: string | null) => (v ? sp.set(k, v) : sp.delete(k));
  set("q", f.q.trim() || null);
  set("location", f.location.trim() || null);
  set("workplace", f.workplace.join(",") || null);
  set("employment", f.employment.join(",") || null);
  set("seniority", f.seniority.join(",") || null);
  set("posted", f.postedWithinDays ? String(f.postedWithinDays) : null);
  set("salary", f.salaryMin ? String(f.salaryMin) : null);
  set("sort", f.sort === "relevance" ? "relevance" : null);
  sp.delete("job");
  sp.delete("apply");
  return sp;
}

export function toJobQuery(f: JobFilters): JobQuery {
  return {
    q: f.q.trim() || undefined,
    location: f.location.trim() || undefined,
    workplace: f.workplace.length ? f.workplace : undefined,
    employment: f.employment.length ? f.employment : undefined,
    seniority: f.seniority.length ? f.seniority : undefined,
    postedWithinDays: f.postedWithinDays ?? undefined,
    salaryMin: f.salaryMin ?? undefined,
    // Relevance needs keywords to rank by; the API falls back to recency otherwise.
    sort: f.sort === "relevance" && f.q.trim() ? "relevance" : "recent",
  };
}

export function hasAnyFilter(f: JobFilters): boolean {
  return !!(f.q.trim() || f.location.trim() || f.workplace.length || f.employment.length || f.seniority.length || f.postedWithinDays || f.salaryMin);
}

export const EMPTY_FILTERS: JobFilters = { q: "", location: "", workplace: [], employment: [], seniority: [], postedWithinDays: null, salaryMin: null, sort: "recent" };

export const jobHref = (id: string) => `/jobs?job=${encodeURIComponent(id)}`;
