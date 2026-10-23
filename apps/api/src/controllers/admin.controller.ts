/** The /admin control plane endpoints. Settings are validated strictly: a bad threshold must never reach the scanner. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, pageQuery, parse, text } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as admin from "../services/admin.service";

const threshold = z
  .object({ review: z.number().min(0).max(1), hide: z.number().min(0).max(1) })
  .refine((t) => t.review <= t.hide, { message: "review must be at most hide" });

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const settingsPatch = z
  .object({
    networkName: z.string().trim().min(1).max(80),
    registration: z.enum(["OPEN", "CLOSED"]),
    profile: z.object({ publishThreshold: int(0, 100), usernameCooldownDays: int(0, 365) }).partial().strict(),
    recruiter: z
      .object({
        approachesPerDay: int(0, 1000),
        approachExpiryDays: int(1, 90),
        declineCooldownDays: int(0, 365),
        maxOpenJobsPerCompany: int(1, 10000),
        freeMailDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(2000),
        allowDomainAutoApprove: z.boolean(),
      })
      .partial()
      .strict(),
    messaging: z.object({ requestsPerDay: int(0, 1000), requestMessageCap: int(1, 20) }).partial().strict(),
    trust: z.object({ autoConfirmDays: int(1, 90), ratingWindowDays: int(1, 365), complaintsPer30Days: int(1, 100) }).partial().strict(),
    import: z.object({ enabled: z.boolean(), perDay: int(0, 100), retentionHours: int(1, 24 * 30) }).partial().strict(),
    analytics: z.object({ timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "unknown timezone") }).strict(),
    moderation: z
      .object({
        enabled: z.boolean(),
        provider: z.enum(["rules", "openai", "stub"]),
        thresholds: z.record(z.string().min(1).max(60), threshold).refine((t) => Object.keys(t).length <= 50, { message: "at most 50 categories" }),
        premoderateNewAccounts: z.object({ enabled: z.boolean(), firstPosts: int(0, 100), accountAgeDays: int(0, 365) }).partial().strict(),
        blockedTerms: z.array(z.string().trim().min(1).max(100)).max(500),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

const range = z.object({ from: z.string().date().optional(), to: z.string().date().optional() });
const reason = text(1000, 1);
const lim = (req: Request) => {
  const q = parse(pageQuery, req.query);
  return { cursor: q.cursor, limit: q.limit ?? 25 };
};

export async function me(req: Request, res: Response) {
  res.json(admin.permissions(actorOf(req)));
}

export async function getSettings(req: Request, res: Response) {
  res.json(await admin.readSettings(actorOf(req)));
}

export async function patchSettings(req: Request, res: Response) {
  const patch = parse(settingsPatch, req.body);
  res.json(await admin.updateSettings(actorOf(req), patch as Parameters<typeof admin.updateSettings>[1], meta(req).ip));
}

export async function stats(req: Request, res: Response) {
  res.json(await admin.stats(actorOf(req), parse(range, req.query)));
}

export async function statsCsv(req: Request, res: Response) {
  const csv = await admin.statsCsv(actorOf(req), parse(range, req.query));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="overview.csv"');
  res.end(csv);
}

const userQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "BANNED", "DEACTIVATED"]).optional(),
  role: z.enum(["USER", "MODERATOR", "RECRUITER_OPS", "ADMIN"]).optional(),
});

export async function users(req: Request, res: Response) {
  res.json(await admin.listUsers(actorOf(req), { ...parse(userQuery, req.query), ...lim(req) }));
}

export async function patchUser(req: Request, res: Response) {
  const { role } = parse(z.object({ role: z.enum(["USER", "MODERATOR", "RECRUITER_OPS", "ADMIN"]) }).strict(), req.body);
  res.json(await admin.changeRole(actorOf(req), parse(idParam, req.params).id, role, meta(req).ip));
}

export async function suspend(req: Request, res: Response) {
  const body = parse(z.object({ days: int(1, 3650), reason }).strict(), req.body);
  res.json(await admin.accountAction(actorOf(req), parse(idParam, req.params).id, "SUSPEND", body, meta(req).ip));
}
export async function unsuspend(req: Request, res: Response) {
  res.json(await admin.accountAction(actorOf(req), parse(idParam, req.params).id, "UNSUSPEND", {}, meta(req).ip));
}
export async function warn(req: Request, res: Response) {
  const body = parse(z.object({ reason }).strict(), req.body);
  res.json(await admin.accountAction(actorOf(req), parse(idParam, req.params).id, "WARN", body, meta(req).ip));
}
export async function ban(req: Request, res: Response) {
  const body = parse(z.object({ reason }).strict(), req.body);
  res.json(await admin.accountAction(actorOf(req), parse(idParam, req.params).id, "BAN", body, meta(req).ip));
}
export async function unban(req: Request, res: Response) {
  res.json(await admin.accountAction(actorOf(req), parse(idParam, req.params).id, "UNBAN", {}, meta(req).ip));
}
export async function suspendProfile(req: Request, res: Response) {
  res.json(await admin.suspendProfile(actorOf(req), parse(idParam, req.params).id, parse(z.object({ reason }).strict(), req.body).reason, meta(req).ip));
}
export async function restoreProfile(req: Request, res: Response) {
  res.json(await admin.restoreProfile(actorOf(req), parse(idParam, req.params).id, meta(req).ip));
}
export async function grantBadge(req: Request, res: Response) {
  const body = parse(z.object({ label: text(40, 2), rationale: z.string().trim().max(500).nullable().optional() }).strict(), req.body);
  res.status(201).json(await admin.grantBadge(actorOf(req), parse(idParam, req.params).id, body, meta(req).ip));
}
export async function revokeBadge(req: Request, res: Response) {
  await admin.revokeBadge(actorOf(req), parse(idParam, req.params).id, meta(req).ip);
  res.status(204).end();
}
export async function erase(req: Request, res: Response) {
  await admin.eraseUser(actorOf(req), parse(idParam, req.params).id, parse(z.object({ reason }).strict(), req.body).reason, meta(req).ip);
  res.status(204).end();
}

export async function recruiters(req: Request, res: Response) {
  const q = parse(z.object({ status: z.enum(["EMAIL_PENDING", "PENDING_REVIEW", "ACTIVE", "REJECTED", "SUSPENDED", "LEFT"]).optional(), q: z.string().trim().max(100).optional() }), req.query);
  res.json(await admin.listRecruiters(actorOf(req), { ...q, ...lim(req) }));
}
export async function reviewRecruiter(req: Request, res: Response) {
  const body = parse(z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(1000).nullable().optional() }).strict(), req.body);
  await admin.reviewRecruiter(actorOf(req), parse(idParam, req.params).id, body.decision, body.note || null, meta(req).ip);
  res.status(204).end();
}
export async function suspendRecruiter(req: Request, res: Response) {
  await admin.suspendRecruiter(actorOf(req), parse(idParam, req.params).id, parse(z.object({ reason }).strict(), req.body).reason, meta(req).ip);
  res.status(204).end();
}
export async function reinstateRecruiter(req: Request, res: Response) {
  await admin.reinstateRecruiter(actorOf(req), parse(idParam, req.params).id, meta(req).ip);
  res.status(204).end();
}
export async function recruiterQuota(req: Request, res: Response) {
  const { quota } = parse(z.object({ quota: int(0, 1000).nullable() }).strict(), req.body);
  await admin.setRecruiterQuota(actorOf(req), parse(idParam, req.params).id, quota, meta(req).ip);
  res.status(204).end();
}

export async function companies(req: Request, res: Response) {
  const q = parse(z.object({ status: z.enum(["UNVERIFIED", "VERIFIED", "SUSPENDED"]).optional(), q: z.string().trim().max(100).optional() }), req.query);
  res.json(await admin.listCompanies(actorOf(req), { ...q, ...lim(req) }));
}
export async function patchCompany(req: Request, res: Response) {
  const body = parse(z.object({ status: z.enum(["VERIFIED", "UNVERIFIED", "SUSPENDED"]).optional(), reason: z.string().trim().max(500).nullable().optional(), domains: z.array(z.string().trim().max(120)).max(10).optional(), autoApproveDomain: z.boolean().optional() }).strict(), req.body);
  res.json(await admin.updateCompany(actorOf(req), parse(idParam, req.params).id, body, meta(req).ip));
}

export async function jobs(req: Request, res: Response) {
  const q = parse(z.object({ status: z.enum(["DRAFT", "OPEN", "CLOSED", "FILLED"]).optional(), q: z.string().trim().max(100).optional() }), req.query);
  res.json(await admin.listJobs(actorOf(req), { ...q, ...lim(req) }));
}
export async function closeJob(req: Request, res: Response) {
  await admin.closeJob(actorOf(req), parse(idParam, req.params).id, parse(z.object({ reason }).strict(), req.body).reason, meta(req).ip);
  res.status(204).end();
}

export async function complaints(req: Request, res: Response) {
  const q = parse(z.object({ status: z.enum(["OPEN", "UNDER_REVIEW", "ACTION_TAKEN", "DISMISSED"]).optional() }), req.query);
  res.json(await admin.listComplaints(actorOf(req), { ...q, ...lim(req) }));
}
export async function resolveComplaint(req: Request, res: Response) {
  const body = parse(
    z.object({ status: z.enum(["UNDER_REVIEW", "ACTION_TAKEN", "DISMISSED"]), note: z.string().trim().max(1000).nullable().optional(), action: z.object({ kind: z.enum(["WARN", "SUSPEND"]), days: int(1, 3650).optional() }).strict().optional() }).strict(),
    req.body,
  );
  await admin.resolveComplaint(actorOf(req), parse(idParam, req.params).id, { status: body.status, note: body.note || null, action: body.action }, meta(req).ip);
  res.status(204).end();
}
export async function hideRating(req: Request, res: Response) {
  await admin.hideRating(actorOf(req), parse(idParam, req.params).id, parse(z.object({ reason }).strict(), req.body).reason, meta(req).ip);
  res.status(204).end();
}

export async function auditLog(req: Request, res: Response) {
  const q = parse(z.object({ action: z.string().max(80).optional(), actorId: id().optional(), entityType: z.string().max(40).optional(), entityId: z.string().max(40).optional() }), req.query);
  res.json(await admin.listAudit(actorOf(req), { ...q, ...lim(req) }));
}
