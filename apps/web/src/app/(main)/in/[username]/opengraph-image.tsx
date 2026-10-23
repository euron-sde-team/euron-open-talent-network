import type { Profile } from "@open-talent/types";
import { OG_SIZE, ogCard } from "@/lib/og-card";
import { serverEnv } from "@/lib/runtime-env";
import { serverGet } from "@/lib/server-api";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Talent page preview";

export default async function Image({ params }: { params: Promise<{ username: string }> }) {
  const username = decodeURIComponent((await params).username);
  const p = await serverGet<Profile>(`/profiles/${encodeURIComponent(username)}`, 600);
  const product = serverEnv().productName;
  if (!p || p.status !== "PUBLISHED") return ogCard({ product, title: product, subtitle: "A professional network" });
  const role = [p.currentTitle, p.currentCompany].filter(Boolean).join(" at ");
  return ogCard({ product, title: p.user.displayName, subtitle: p.headline ?? role, meta: p.location, badge: p.openToWork ? "Open to work" : null });
}
