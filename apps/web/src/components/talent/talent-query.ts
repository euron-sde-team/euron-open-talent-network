import { EMPLOYMENT_TYPES, WORKPLACE_TYPES, type EmploymentType, type Page, type TalentCard, type WorkplaceType } from "@open-talent/types";
import type { DirectoryQuery } from "@open-talent/api-client";
import { api } from "@/lib/api";

export type TalentSort = NonNullable<DirectoryQuery["sort"]>;
export type TalentFilters = Omit<DirectoryQuery, "cursor" | "limit">;
/** A directory card keyed by the person, so it fits `usePagedList`. */
export type TalentRow = TalentCard & { id: string };

export const YEARS_MAX = 30;

const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const num = (v: string | null) => {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(70, Math.floor(n)) : undefined;
};

/** URL search params are the source of truth for the directory filters (shareable, back button works). */
export function filtersFromParams(p: URLSearchParams): TalentFilters {
  const sort = p.get("sort");
  return {
    q: p.get("q")?.trim() || undefined,
    skills: list(p.get("skills")).slice(0, 10),
    location: p.get("location")?.trim() || undefined,
    openToWork: p.get("openToWork") === "1" || undefined,
    employment: list(p.get("employment")).filter((x): x is EmploymentType => (EMPLOYMENT_TYPES as readonly string[]).includes(x)),
    workplace: list(p.get("workplace")).filter((x): x is WorkplaceType => (WORKPLACE_TYPES as readonly string[]).includes(x)),
    minYears: num(p.get("minYears")),
    maxYears: num(p.get("maxYears")),
    sort: sort === "relevance" || sort === "recent" || sort === "experience" ? sort : undefined,
  };
}

export function paramsFromFilters(f: TalentFilters, base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams();
  const view = base?.get("view");
  if (f.q) p.set("q", f.q);
  if (f.skills?.length) p.set("skills", f.skills.join(","));
  if (f.location) p.set("location", f.location);
  if (f.openToWork) p.set("openToWork", "1");
  if (f.employment?.length) p.set("employment", f.employment.join(","));
  if (f.workplace?.length) p.set("workplace", f.workplace.join(","));
  if (f.minYears != null) p.set("minYears", String(f.minYears));
  if (f.maxYears != null) p.set("maxYears", String(f.maxYears));
  if (f.sort) p.set("sort", f.sort);
  if (view) p.set("view", view);
  return p;
}

export function activeFilterCount(f: TalentFilters): number {
  return (
    (f.skills?.length ?? 0) +
    (f.location ? 1 : 0) +
    (f.openToWork ? 1 : 0) +
    (f.employment?.length ?? 0) +
    (f.workplace?.length ?? 0) +
    (f.minYears != null || f.maxYears != null ? 1 : 0)
  );
}

/** A stable key object for the query cache (no undefined or empty values). */
export function filterKey(f: TalentFilters): Record<string, unknown> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));
}

export async function fetchPeoplePage(f: TalentFilters, cursor: string | undefined, signal?: AbortSignal): Promise<Page<TalentRow>> {
  const page = await api().search.people({ ...f, cursor, limit: 20 }, signal);
  return { ...page, items: page.items.map((c) => ({ ...c, id: c.user.id })) };
}
