import type { Company } from "@open-talent/types";
import { OG_SIZE, ogCard } from "@/lib/og-card";
import { serverEnv } from "@/lib/runtime-env";
import { serverGet } from "@/lib/server-api";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Company page preview";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const slug = decodeURIComponent((await params).slug);
  const c = await serverGet<Company>(`/companies/${encodeURIComponent(slug)}`, 600);
  const product = serverEnv().productName;
  if (!c || c.status === "SUSPENDED") return ogCard({ product, title: product, subtitle: "A professional network" });
  const meta = [c.industry, c.headquarters, c.openJobCount ? `${c.openJobCount} open ${c.openJobCount === 1 ? "job" : "jobs"}` : null].filter(Boolean).join(", ");
  return ogCard({ product, title: c.name, subtitle: c.tagline, meta, badge: c.status === "VERIFIED" ? "Verified" : null, square: true });
}
