import type { MetadataRoute } from "next";
import { publicOrigin } from "@/lib/server-api";

/** Public pages are crawlable; private areas and the API are not. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await publicOrigin();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/moderation", "/dashboard", "/recruiter", "/messaging", "/notifications", "/settings", "/account", "/profile/setup", "/saved"] }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
