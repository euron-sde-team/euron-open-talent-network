/**
 * Becoming a recruiter: register for an existing company page or create a new one,
 * confirm the work email with a one-time code, then wait for review (or be approved at
 * once when a VERIFIED company allows domain auto-approval and the email is on its
 * domain). Approval and rejection happen in the /admin queue (admin.service.ts).
 *
 * Fixes over the source system:
 *   - Identity comes from the session only; the source spread the request body over
 *     the user id, so anyone could register (or overwrite) another person's recruiter.
 *   - Attempts on a code are counted with one atomic UPDATE ... RETURNING, so parallel
 *     guesses cannot get past the cap; a code is single-use and bound to its recruiter.
 *   - The code itself is never stored or queued in plain text: only an HMAC is.
 *   - Free-mail domains can apply but never auto-approve, and the reviewer sees it.
 *   - Phone verification is off (no SMS toll-fraud surface) unless a deployment adds a
 *     provider; nothing here depends on it.
 */
import type { RecruiterAccount } from "@open-talent/types";
import crypto from "node:crypto";
import { sql } from "kysely";
import { config } from "../core/config";
import type { Actor } from "../core/context";
import { requireActive } from "../core/context";
import { withTransaction, type Effects } from "../core/effects";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { EMAIL_CODE_MAX_ATTEMPTS, EMAIL_CODE_TTL_MS, emailDomain, isFreeMail, newEmailCode, reviewRoute } from "../domain/recruiter-verification";
import { baseDomain, safeUrl } from "../domain/safe-url";
import { slugify } from "../domain/slug";
import { sendMail } from "../integrations/mail/mailer";
import * as templates from "../integrations/mail/templates";
import { consume } from "../middleware/rate-limit";
import { presentCompanySummaries } from "../presenters/company.presenter";
import { rooms } from "../realtime/port";
import { audit } from "./audit.service";
import { notify } from "./notification.service";
import { getSettings, networkName } from "./settings.service";

function codeHash(recruiterId: string, code: string): string {
  return crypto.createHmac("sha256", Buffer.from(config.TOTP_ENCRYPTION_KEY, "base64")).update(`recruiter-code:${recruiterId}:${code}`).digest("hex");
}

export interface NewCompanyInput {
  name: string;
  website?: string | null;
  industry?: string | null;
  sizeBand?: string | null;
  headquarters?: string | null;
}

export interface RegisterInput {
  /** Join this existing company page... */
  companySlug?: string;
  /** ...or create a new one (you become its OWNER). */
  newCompany?: NewCompanyInput;
  workEmail: string;
  title?: string | null;
  note?: string | null;
}

async function uniqueSlug(name: string, exec: Executor): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await exec.selectFrom("companies").select("id").where("slug", "=", slug).executeTakeFirst())) return slug;
  }
  return `${base}-${newId().slice(-6).toLowerCase()}`;
}

async function sendCode(recruiterId: string, exec: Executor): Promise<void> {
  const r = await exec
    .selectFrom("recruiters as r")
    .innerJoin("companies as c", "c.id", "r.company_id")
    .innerJoin("users as u", "u.id", "r.user_id")
    .select(["r.id", "r.work_email", "c.name as company", "u.display_name"])
    .where("r.id", "=", recruiterId)
    .executeTakeFirstOrThrow();
  const code = newEmailCode((max) => crypto.randomInt(max));
  await exec.updateTable("recruiter_email_codes").set({ consumed_at: new Date() }).where("recruiter_id", "=", recruiterId).where("consumed_at", "is", null).execute();
  await exec
    .insertInto("recruiter_email_codes")
    .values({ id: newId(), recruiter_id: recruiterId, email: r.work_email, code_hash: codeHash(recruiterId, code), expires_at: new Date(Date.now() + EMAIL_CODE_TTL_MS) })
    .execute();
  // Sent directly (not through a queue) so the code never sits in Redis.
  await sendMail(templates.recruiterCode(await networkName(exec), String(r.work_email), r.display_name, r.company, code));
}

export async function register(actor: Actor, input: RegisterInput): Promise<RecruiterAccount> {
  requireActive(actor);
  if (!!input.companySlug === !!input.newCompany) throw badRequest("Choose an existing company or create a new one", "COMPANY_CHOICE");
  const workEmail = input.workEmail.trim().toLowerCase();
  if (!emailDomain(workEmail)) throw badRequest("Enter a valid work email", "EMAIL_INVALID");
  await consume("recruiter-register", `u:${actor.id}`, 10, 86400);
  const settings = await getSettings();

  await withTransaction(async (trx) => {
    const existing = await trx.selectFrom("recruiters").selectAll().where("user_id", "=", actor.id).forUpdate().executeTakeFirst();
    if (existing && !["REJECTED", "EMAIL_PENDING", "LEFT"].includes(existing.status)) throw conflict("You already have a recruiter account", "ALREADY_RECRUITER");
    const emailOwner = await trx.selectFrom("recruiters").select("user_id").where("work_email", "=", workEmail).executeTakeFirst();
    if (emailOwner && emailOwner.user_id !== actor.id) throw conflict("That work email is already used by another recruiter", "WORK_EMAIL_TAKEN");

    let companyId: string;
    let role: "OWNER" | "RECRUITER";
    if (input.companySlug) {
      const company = await trx.selectFrom("companies").select(["id", "status"]).where("slug", "=", input.companySlug).executeTakeFirst();
      if (!company) throw notFound("Company not found", "COMPANY_NOT_FOUND");
      if (company.status === "SUSPENDED") throw forbidden("This company page is not accepting recruiters", "COMPANY_SUSPENDED");
      companyId = company.id;
      const hasOwner = await trx.selectFrom("recruiters").select("id").where("company_id", "=", company.id).where("role", "=", "OWNER").where("status", "in", ["ACTIVE", "PENDING_REVIEW"]).executeTakeFirst();
      role = hasOwner ? "RECRUITER" : "OWNER";
    } else {
      const c = input.newCompany!;
      const website = c.website ? safeUrl(c.website) : null;
      if (c.website && !website) throw badRequest("The company website is not a valid address", "URL_INVALID");
      // The company's own domains: its website's, and the work email's when it is not free mail.
      const domains = [...new Set([website ? baseDomain(new URL(website).hostname) : null, isFreeMail(workEmail, settings.recruiter.freeMailDomains) ? null : baseDomain(workEmail)].filter((d): d is string => !!d))];
      const company = await trx
        .insertInto("companies")
        .values({ id: newId(), slug: await uniqueSlug(c.name, trx), name: c.name, website, industry: c.industry ?? null, size_band: c.sizeBand ?? null, headquarters: c.headquarters ?? null, domains, created_by: actor.id })
        .returning("id")
        .executeTakeFirstOrThrow();
      companyId = company.id;
      role = "OWNER";
      await audit({ actorId: actor.id, action: "company.create", entityType: "company", entityId: company.id, data: { name: c.name } }, trx);
    }

    const values = { company_id: companyId, role, status: "EMAIL_PENDING" as const, title: input.title ?? null, work_email: workEmail, work_email_verified_at: null, application_note: input.note ?? null, review_note: null, reviewed_at: null, reviewed_by: null, updated_at: new Date() };
    const recruiterId = existing
      ? (await trx.updateTable("recruiters").set(values).where("id", "=", existing.id).returning("id").executeTakeFirstOrThrow()).id
      : (await trx.insertInto("recruiters").values({ id: newId(), user_id: actor.id, ...values }).returning("id").executeTakeFirstOrThrow()).id;
    await audit({ actorId: actor.id, action: "recruiter.register", entityType: "recruiter", entityId: recruiterId, data: { companyId, role } }, trx);
    await sendCode(recruiterId, trx);
  });
  return me(actor);
}

export async function resendCode(actor: Actor): Promise<void> {
  const r = await db.selectFrom("recruiters").select(["id", "status"]).where("user_id", "=", actor.id).executeTakeFirst();
  if (!r || r.status !== "EMAIL_PENDING") throw badRequest("There is no work email waiting for a code", "NOT_EMAIL_PENDING");
  await consume("recruiter-code", `u:${actor.id}`, 5, 3600);
  await sendCode(r.id, db);
}

/** Check a code. Attempts are counted atomically before the comparison. */
export async function verifyCode(actor: Actor, code: string): Promise<RecruiterAccount> {
  requireActive(actor);
  const settings = await getSettings();
  const outcome = await withTransaction(async (trx, fx) => {
    const r = await trx.selectFrom("recruiters").selectAll().where("user_id", "=", actor.id).forUpdate().executeTakeFirst();
    if (!r || r.status !== "EMAIL_PENDING") throw badRequest("There is no work email waiting for a code", "NOT_EMAIL_PENDING");
    const attempt = await trx
      .updateTable("recruiter_email_codes")
      .set({ attempts: sql`attempts + 1` })
      .where("recruiter_id", "=", r.id)
      .where("consumed_at", "is", null)
      .where("expires_at", ">", new Date())
      .returning(["id", "attempts", "code_hash", "email"])
      .executeTakeFirst();
    if (!attempt) return { kind: "EXPIRED" as const };
    if (attempt.attempts > EMAIL_CODE_MAX_ATTEMPTS) return { kind: "LOCKED" as const };
    const ok = crypto.timingSafeEqual(Buffer.from(attempt.code_hash, "hex"), Buffer.from(codeHash(r.id, code.trim()), "hex"));
    if (!ok || String(attempt.email) !== String(r.work_email)) return { kind: "WRONG" as const, left: EMAIL_CODE_MAX_ATTEMPTS - attempt.attempts };
    await trx.updateTable("recruiter_email_codes").set({ consumed_at: new Date() }).where("id", "=", attempt.id).execute();

    const company = await trx.selectFrom("companies").select(["id", "status", "domains", "auto_approve_domain", "name"]).where("id", "=", r.company_id).executeTakeFirstOrThrow();
    const route = reviewRoute({
      workEmail: String(r.work_email),
      companyDomains: company.domains.map(String),
      freeMailDomains: settings.recruiter.freeMailDomains,
      companyVerified: company.status === "VERIFIED",
      companyAllowsAuto: company.auto_approve_domain,
      platformAllowsAuto: settings.recruiter.allowDomainAutoApprove,
    });
    const now = new Date();
    if (route === "AUTO_APPROVE") {
      await trx.updateTable("recruiters").set({ status: "ACTIVE", work_email_verified_at: now, reviewed_at: now, review_note: "Approved automatically: confirmed work email on the company domain", updated_at: now }).where("id", "=", r.id).execute();
      await trx.updateTable("companies").set({ member_count: sql`member_count + 1` }).where("id", "=", company.id).execute();
      await notify({ recipientId: actor.id, actorId: null, type: "RECRUITER_APPROVED", entityType: "recruiter", entityId: r.id, snippet: company.name }, fx, trx);
    } else {
      await trx.updateTable("recruiters").set({ status: "PENDING_REVIEW", work_email_verified_at: now, updated_at: now }).where("id", "=", r.id).execute();
    }
    await audit({ actorId: actor.id, action: "recruiter.email_verified", entityType: "recruiter", entityId: r.id, data: { route } }, trx);
    return { kind: "OK" as const };
  });
  if (outcome.kind === "EXPIRED") throw badRequest("This code has expired. Ask for a new one.", "CODE_EXPIRED");
  if (outcome.kind === "LOCKED") throw new HttpError(429, "Too many wrong codes. Ask for a new one.", "CODE_LOCKED");
  if (outcome.kind === "WRONG") throw badRequest("That code is not right", "CODE_WRONG", { attemptsLeft: Math.max(0, outcome.left) });
  return me(actor);
}

export async function me(actor: Actor): Promise<RecruiterAccount> {
  const r = await db.selectFrom("recruiters").selectAll().where("user_id", "=", actor.id).executeTakeFirst();
  if (!r) throw notFound("You have no recruiter account", "NOT_A_RECRUITER");
  const company = await db.selectFrom("companies").selectAll().where("id", "=", r.company_id).executeTakeFirstOrThrow();
  const [summary] = await presentCompanySummaries([company], actor);
  const settings = await getSettings();
  const used = await db
    .selectFrom("approaches")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("recruiter_id", "=", r.id)
    .where("created_at", ">=", new Date(new Date().setUTCHours(0, 0, 0, 0)))
    .executeTakeFirstOrThrow();
  return {
    id: r.id,
    status: r.status,
    role: r.role,
    title: r.title,
    workEmail: String(r.work_email),
    workEmailVerified: !!r.work_email_verified_at,
    company: summary!,
    reviewNote: r.status === "REJECTED" || r.status === "SUSPENDED" ? (r.review_note ?? r.suspended_reason) : null,
    quota: { approachesPerDay: r.approach_quota_daily ?? settings.recruiter.approachesPerDay, usedToday: Number(used.n) },
    createdAt: r.created_at.toISOString(),
  };
}

export async function updateMe(actor: Actor, patch: { title?: string | null }): Promise<RecruiterAccount> {
  const res = await db.updateTable("recruiters").set({ ...(patch.title !== undefined ? { title: patch.title } : {}), updated_at: new Date() }).where("user_id", "=", actor.id).executeTakeFirst();
  if (Number(res.numUpdatedRows) !== 1) throw notFound("You have no recruiter account", "NOT_A_RECRUITER");
  return me(actor);
}

/**
 * Stop recruiting for the company. Pending approaches are withdrawn and live contact
 * unlocks end (the candidate consented to this recruiter at this company). The last
 * owner of a team with other members must hand over first.
 */
export async function leave(actor: Actor): Promise<void> {
  await withTransaction(async (trx, fx) => {
    const r = await trx.selectFrom("recruiters").selectAll().where("user_id", "=", actor.id).forUpdate().executeTakeFirst();
    if (!r) throw notFound("You have no recruiter account", "NOT_A_RECRUITER");
    if (r.role === "OWNER" && r.status === "ACTIVE") {
      const others = await trx.selectFrom("recruiters").select(["id", "role"]).where("company_id", "=", r.company_id).where("id", "<>", r.id).where("status", "=", "ACTIVE").execute();
      if (others.length && !others.some((o) => o.role === "OWNER")) throw conflict("Make another teammate an owner before you leave", "OWNER_MUST_TRANSFER");
    }
    const now = new Date();
    await trx.updateTable("approaches").set({ status: "WITHDRAWN", responded_at: now }).where("recruiter_id", "=", r.id).where("status", "=", "PENDING").execute();
    await trx.updateTable("contact_unlocks").set({ revoked_at: now, revoked_reason: "Recruiter left the company" }).where("recruiter_id", "=", r.id).where("revoked_at", "is", null).execute();
    // Jobs they posted stay with the company; reassign the poster to an owner when one exists.
    const owner = await trx.selectFrom("recruiters").select("id").where("company_id", "=", r.company_id).where("id", "<>", r.id).where("status", "=", "ACTIVE").orderBy("role").executeTakeFirst();
    if (owner) await trx.updateTable("jobs").set({ posted_by: owner.id }).where("posted_by", "=", r.id).execute();
    else await trx.updateTable("jobs").set({ status: "CLOSED", closed_at: now }).where("posted_by", "=", r.id).where("status", "=", "OPEN").execute();
    if (r.status === "ACTIVE") await trx.updateTable("companies").set({ member_count: sql`greatest(0, member_count - 1)` }).where("id", "=", r.company_id).execute();
    // The row stays as LEFT: approaches, unlocks and the candidate's contact access log
    // reference it, and deleting it would cascade those records away. Private working
    // lists go.
    await trx.deleteFrom("saved_candidates").where("recruiter_id", "=", r.id).execute();
    await trx.deleteFrom("saved_searches").where("recruiter_id", "=", r.id).execute();
    await trx.updateTable("recruiters").set({ status: "LEFT", updated_at: now }).where("id", "=", r.id).execute();
    await leaveCompanyJobRooms(fx, actor.id, r.company_id, trx);
    await audit({ actorId: actor.id, action: "recruiter.leave", entityType: "recruiter", entityId: r.id }, trx);
  });
}

/** The actor's ACTIVE recruiter row (company not suspended), or 403 RECRUITER_REQUIRED. */
export async function requireRecruiter(actor: Actor, exec: Executor = db) {
  requireActive(actor);
  const r = await exec
    .selectFrom("recruiters as r")
    .innerJoin("companies as c", "c.id", "r.company_id")
    .select(["r.id", "r.user_id", "r.company_id", "r.role", "r.approach_quota_daily", "c.name as company_name", "c.slug as company_slug", "c.status as company_status"])
    .where("r.user_id", "=", actor.id)
    .where("r.status", "=", "ACTIVE")
    .executeTakeFirst();
  if (!r || r.company_status === "SUSPENDED") throw forbidden("You need an approved recruiter account for this", "RECRUITER_REQUIRED");
  return r;
}

export type ActiveRecruiter = Awaited<ReturnType<typeof requireRecruiter>>;

/** Pipeline access ends with the recruiter role: take the user's sockets out of every job room of the company. */
export async function leaveCompanyJobRooms(fx: Effects, userId: string, companyId: string, exec: Executor): Promise<void> {
  const jobs = await exec.selectFrom("jobs").select("id").where("company_id", "=", companyId).execute();
  if (jobs.length) fx.leave([userId], jobs.map((j) => rooms.job(j.id)));
}

export function requireCompanyAdmin(r: ActiveRecruiter): void {
  if (r.role !== "OWNER" && r.role !== "ADMIN") throw forbidden("Only company page admins can do that", "NOT_COMPANY_ADMIN");
}
