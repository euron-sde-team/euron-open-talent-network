/** Public facts about the network: what the web app needs before anyone signs in. */
import type { NetworkMeta } from "@open-talent/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { aiAvailable } from "../core/config";
import { parse } from "../core/validate";
import { db } from "../db/kysely";
import { atKey, decodeTime, encodeTime, olderThan, pageBy } from "../repositories/keyset";
import { getSettings, networkName } from "../services/settings.service";

export async function meta(_req: Request, res: Response) {
  const settings = await getSettings();
  const ai = aiAvailable();
  const body: NetworkMeta = { networkName: await networkName(), registration: settings.registration, ai: { import: ai && settings.import.enabled, polish: ai } };
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json(body);
}

const sitemapQuery = z.object({ type: z.enum(["profiles", "companies", "jobs"]), cursor: z.string().max(200).optional() }).strict();
const SITEMAP_PAGE = 1000;

/**
 * GET /api/meta/sitemap?type=profiles|companies|jobs: public paths for the web app's
 * sitemap, newest change first, 1000 per keyset page. Only what a signed-out visitor
 * may open: published profiles of active accounts, companies that are not suspended,
 * open jobs that passed moderation.
 */
export async function sitemap(req: Request, res: Response) {
  const q = parse(sitemapQuery, req.query);
  const cursor = decodeTime(q.cursor);
  let rows: { key: string; id: string; _at: string }[];
  if (q.type === "profiles") {
    rows = await db
      .selectFrom("talent_profiles as p")
      .innerJoin("users as u", "u.id", "p.user_id")
      .select(["u.username as key", "p.id", atKey("p.updated_at")])
      .where("p.status", "=", "PUBLISHED")
      .where("u.status", "=", "ACTIVE")
      .where(olderThan("p.updated_at", "p.id", cursor))
      .orderBy("p.updated_at", "desc")
      .orderBy("p.id", "desc")
      .limit(SITEMAP_PAGE + 1)
      .execute();
  } else if (q.type === "companies") {
    rows = await db
      .selectFrom("companies as c")
      .select(["c.slug as key", "c.id", atKey("c.updated_at")])
      .where("c.status", "<>", "SUSPENDED")
      .where(olderThan("c.updated_at", "c.id", cursor))
      .orderBy("c.updated_at", "desc")
      .orderBy("c.id", "desc")
      .limit(SITEMAP_PAGE + 1)
      .execute();
  } else {
    rows = await db
      .selectFrom("jobs as j")
      .select(["j.id as key", "j.id", atKey("j.updated_at")])
      .where("j.status", "=", "OPEN")
      .where("j.content_status", "=", "PUBLISHED")
      .where(olderThan("j.updated_at", "j.id", cursor))
      .orderBy("j.updated_at", "desc")
      .orderBy("j.id", "desc")
      .limit(SITEMAP_PAGE + 1)
      .execute();
  }
  const page = pageBy(rows, SITEMAP_PAGE, (r) => encodeTime(r._at, r.id));
  const prefix = q.type === "profiles" ? "/in/" : q.type === "companies" ? "/company/" : "/jobs?job=";
  res.setHeader("Cache-Control", "public, max-age=600");
  res.json({ items: page.items.map((r) => ({ path: `${prefix}${encodeURIComponent(String(r.key))}`, updatedAt: r._at })), nextCursor: page.nextCursor });
}
