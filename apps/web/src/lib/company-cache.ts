/**
 * A company summary sits in several caches at once (the directory pages, the landing
 * strip, the "All" search tab). Following from any card patches it everywhere, so the
 * button and the follower count agree without a refetch.
 */
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { CompanySummary, Page, SearchResults } from "@open-talent/types";

type Snapshot = [readonly unknown[], unknown][];
type Patch = Pick<CompanySummary, "viewerFollowing" | "followerCount">;

const ROOTS = new Set(["companies", "search-all"]);

const patchList = (items: CompanySummary[], slug: string, patch: Patch) => items.map((c) => (c.slug === slug ? { ...c, ...patch } : c));

function transform(data: unknown, slug: string, patch: Patch): unknown {
  if (!data || typeof data !== "object") return data;
  const d = data as Record<string, unknown>;
  // Infinite query of Page<CompanySummary>
  if (Array.isArray(d.pages)) {
    const inf = data as InfiniteData<Page<CompanySummary>>;
    return { ...inf, pages: inf.pages.map((p) => ({ ...p, items: patchList(p.items, slug, patch) })) };
  }
  // A single Page<CompanySummary> (the landing strip)
  if (Array.isArray(d.items)) return { ...d, items: patchList(d.items as CompanySummary[], slug, patch) };
  // Search results { companies: CompanySummary[] }
  if (Array.isArray(d.companies)) return { ...d, companies: patchList((d as unknown as SearchResults).companies, slug, patch) };
  return data;
}

/** Set the follow state of the company with `slug` in every summary cache; returns a snapshot for rollback. */
export function patchCompanyEverywhere(qc: QueryClient, slug: string, patch: Patch): Snapshot {
  const snapshot: Snapshot = [];
  for (const [key, data] of qc.getQueriesData({ predicate: (q) => typeof q.queryKey[0] === "string" && ROOTS.has(q.queryKey[0]) })) {
    snapshot.push([key, data]);
    qc.setQueryData(key, transform(data, slug, patch));
  }
  return snapshot;
}

export function restoreCompanySnapshot(qc: QueryClient, snapshot: Snapshot) {
  for (const [key, data] of snapshot) qc.setQueryData(key, data);
}
