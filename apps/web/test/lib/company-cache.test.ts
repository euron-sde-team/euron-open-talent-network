import { describe, expect, it } from "vitest";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import type { CompanySummary, Page, SearchResults } from "@open-talent/types";
import { patchCompanyEverywhere, restoreCompanySnapshot } from "@/lib/company-cache";

const company = (slug: string, over: Partial<CompanySummary> = {}): CompanySummary => ({
  id: `id-${slug}`,
  slug,
  name: `Company ${slug}`,
  tagline: null,
  logoUrl: null,
  industry: null,
  sizeBand: null,
  headquarters: null,
  status: "UNVERIFIED",
  followerCount: 3,
  openJobCount: 0,
  viewerFollowing: false,
  ...over,
});
const inf = (...items: CompanySummary[]): InfiniteData<Page<CompanySummary>> => ({ pages: [{ items, nextCursor: null }], pageParams: [undefined] });

describe("company cache", () => {
  it("patches the follow state in directory pages, the landing strip and search results, and rolls back", () => {
    const qc = new QueryClient();
    qc.setQueryData(["companies", { q: "", industry: "" }], inf(company("acme"), company("other")));
    qc.setQueryData(["companies", { landing: true }], { items: [company("acme")], nextCursor: null });
    qc.setQueryData(["search-all", "acme"], { people: [], jobs: [], companies: [company("acme")] } satisfies SearchResults);
    qc.setQueryData(["company", "acme"], { slug: "acme", viewerFollowing: false });

    const snap = patchCompanyEverywhere(qc, "acme", { viewerFollowing: true, followerCount: 4 });
    const dir = qc.getQueryData<InfiniteData<Page<CompanySummary>>>(["companies", { q: "", industry: "" }])!;
    expect(dir.pages[0]!.items.map((c) => [c.slug, c.viewerFollowing, c.followerCount])).toEqual([
      ["acme", true, 4],
      ["other", false, 3],
    ]);
    expect(qc.getQueryData<Page<CompanySummary>>(["companies", { landing: true }])!.items[0]).toMatchObject({ viewerFollowing: true, followerCount: 4 });
    expect(qc.getQueryData<SearchResults>(["search-all", "acme"])!.companies[0]).toMatchObject({ viewerFollowing: true, followerCount: 4 });
    // The full page cache is not a summary list; the follow hook sets it from the API answer.
    expect(qc.getQueryData(["company", "acme"])).toEqual({ slug: "acme", viewerFollowing: false });

    restoreCompanySnapshot(qc, snap);
    expect(qc.getQueryData<InfiniteData<Page<CompanySummary>>>(["companies", { q: "", industry: "" }])!.pages[0]!.items[0]).toMatchObject({ viewerFollowing: false, followerCount: 3 });
  });
});
