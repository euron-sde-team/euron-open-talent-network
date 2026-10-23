import type { MetadataRoute } from "next";
import { publicOrigin, serverGet } from "@/lib/server-api";

type Entry = { path: string; updatedAt: string };
type SitemapPage = { items: Entry[]; nextCursor: string | null };

// A single sitemap file may list at most 50,000 URLs; stay well under it.
const MAX_PER_TYPE = 15_000;

async function all(type: "profiles" | "companies" | "jobs"): Promise<Entry[]> {
  const out: Entry[] = [];
  let cursor: string | null = null;
  do {
    const qs: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const page: SitemapPage | null = await serverGet<SitemapPage>(`/meta/sitemap?type=${type}${qs}`, 600);
    if (!page) break;
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && out.length < MAX_PER_TYPE);
  return out.slice(0, MAX_PER_TYPE);
}

export const revalidate = 600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await publicOrigin();
  const [profiles, companies, jobs] = await Promise.all([all("profiles"), all("companies"), all("jobs")]);
  const fixed: MetadataRoute.Sitemap = ["/", "/jobs", "/companies", "/talent"].map((p) => ({ url: `${origin}${p}`, changeFrequency: "daily", priority: p === "/" ? 1 : 0.8 }));
  const dyn = (list: Entry[], priority: number): MetadataRoute.Sitemap => list.map((e) => ({ url: `${origin}${e.path}`, lastModified: e.updatedAt, priority }));
  return [...fixed, ...dyn(profiles, 0.7), ...dyn(companies, 0.6), ...dyn(jobs, 0.6)];
}
