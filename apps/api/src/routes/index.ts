/**
 * Every router and where it is mounted. scripts/gen-openapi.ts reads this file, so keep
 * one `[prefix, router]` entry per line.
 */
import type { Express } from "express";
import { router as admin } from "./admin.routes";
import { router as applications } from "./applications.routes";
import { router as approaches } from "./approaches.routes";
import { router as auth } from "./auth.routes";
import { router as comments } from "./comments.routes";
import { router as companies } from "./companies.routes";
import { router as dms } from "./dms.routes";
import { router as jobs } from "./jobs.routes";
import { router as media } from "./media.routes";
import { router as meta } from "./meta.routes";
import { router as moderation } from "./moderation.routes";
import { router as network } from "./network.routes";
import { router as notifications } from "./notifications.routes";
import { router as posts } from "./posts.routes";
import { router as profiles } from "./profiles.routes";
import { router as recruiter } from "./recruiter.routes";
import { router as reports } from "./reports.routes";
import { router as search } from "./search.routes";
import { router as trust } from "./trust.routes";
import { router as users } from "./users.routes";

export const MOUNTS = [
  ["/api/auth", auth],
  ["/api/users", users],
  ["/api/profiles", profiles],
  ["/api/network", network],
  ["/api/companies", companies],
  ["/api/recruiter", recruiter],
  ["/api/approaches", approaches],
  ["/api/jobs", jobs],
  ["/api/applications", applications],
  ["/api/trust", trust],
  ["/api/search", search],
  ["/api/posts", posts],
  ["/api/comments", comments],
  ["/api/dms", dms],
  ["/api/media", media],
  ["/api/notifications", notifications],
  ["/api/reports", reports],
  ["/api/moderation", moderation],
  ["/api/admin", admin],
  ["/api/meta", meta],
] as const;

export function mountRoutes(app: Express): void {
  for (const [prefix, router] of MOUNTS) app.use(prefix, router);
}
