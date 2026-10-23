/**
 * Recruiter approaches and consent-based contact unlock.
 *
 *   recruiter sends -> PENDING -> candidate accepts (choosing channels) -> ACCEPTED
 *                                 + a contact_unlock with exactly those channels
 *                                 + a DM thread, both sides ACTIVE
 *                              -> candidate declines (optional reason) -> DECLINED,
 *                                 the recruiter waits declineCooldownDays to try again
 *                              -> candidate blocks -> BLOCKED (and a user block)
 *                              -> recruiter withdraws -> WITHDRAWN
 *                              -> nobody acts by expires_at -> EXPIRED (housekeeping)
 *
 * The candidate can revoke a live unlock at any time; every reveal is logged and shown
 * to them. Fixes over the source system: identity from the session only (the body
 * could name any recruiter), status changes are conditional (`WHERE status = 'PENDING'`
 * so accept and withdraw cannot both win), accept checks expires_at itself, quota is
 * counted from the rows (an approach the classifier rejected does not count), and the
 * candidate is never told a block exists.
 */
import type { Approach, ApproachStatus, ContactChannel, ContactReveal, Page } from "@open-talent/types";
import crypto from "node:crypto";
import { sql } from "kysely";
import { config } from "../core/config";
import type { Actor } from "../core/context";
import { requireActive } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { approachBlock } from "../domain/trust";
import { presentApproaches } from "../presenters/approach.presenter";
import { realtime, rooms } from "../realtime/port";
import { blockRepo } from "../repositories/block.repository";
import { decodeTime, encodeTime, pageBy } from "../repositories/keyset";
import { atKey, olderThan } from "../repositories/keyset";
import { isBlockedEitherWay } from "../repositories/visibility";
import { audit } from "./audit.service";
import { openContextThread } from "./dm.service";
import { notify } from "./notification.service";
import { requireRecruiter } from "./recruiter.service";
import { getSettings } from "./settings.service";

export interface SendApproachInput {
  username: string;
  roleTitle: string;
  message: string;
  jobId?: string | null;
  employmentType?: Approach["employmentType"];
  salary?: { min: number | null; max: number | null; currency: string | null; period: NonNullable<Approach["salary"]>["period"] } | null;
}

const BLOCK_COPY = {
  NOT_PUBLISHED: "This profile is not open to approaches.",
  BLOCKED: "This profile is not open to approaches.",
  ALREADY_PENDING: "You already have a pending approach with this person.",
  COOLDOWN: "This person declined recently. You can try again later.",
  QUOTA: "You have reached your daily approach limit.",
  SELF: "You cannot approach yourself.",
} as const;

async function sentToday(recruiterId: string, exec: Executor): Promise<number> {
  const r = await exec
    .selectFrom("approaches")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("recruiter_id", "=", recruiterId)
    .where("created_at", ">=", new Date(new Date().setUTCHours(0, 0, 0, 0)))
    // The classifier or a moderator taking one down refunds it (moderation/targets.ts).
    .where("moderation_state", "<>", "FLAGGED")
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

export async function send(actor: Actor, input: SendApproachInput): Promise<Approach> {
  const recruiter = await requireRecruiter(actor);
  const settings = await getSettings();
  const row = await withTransaction(async (trx, fx) => {
    const target = await trx
      .selectFrom("users as u")
      .innerJoin("talent_profiles as p", "p.user_id", "u.id")
      .select(["u.id", "u.status", "p.status as profile_status"])
      .where("u.username", "=", input.username)
      .executeTakeFirst();
    if (!target || target.status !== "ACTIVE") throw notFound("Profile not found", "PROFILE_NOT_FOUND");
    // Serialize sends per recruiter so the quota and the pending check are exact.
    await trx.selectFrom("recruiters").select("id").where("id", "=", recruiter.id).forUpdate().execute();
    const [blocked, pending, lastDeclined, today] = await Promise.all([
      isBlockedEitherWay(actor.id, target.id, trx),
      trx.selectFrom("approaches").select("id").where("recruiter_id", "=", recruiter.id).where("candidate_id", "=", target.id).where("status", "=", "PENDING").executeTakeFirst(),
      trx.selectFrom("approaches").select("responded_at").where("recruiter_id", "=", recruiter.id).where("candidate_id", "=", target.id).where("status", "=", "DECLINED").orderBy("responded_at", "desc").executeTakeFirst(),
      sentToday(recruiter.id, trx),
    ]);
    const decision = approachBlock({
      recruiterUserId: actor.id,
      candidateId: target.id,
      profileStatus: target.profile_status,
      blocked,
      pending: !!pending,
      lastDeclinedAt: lastDeclined?.responded_at ?? null,
      sentToday: today,
      quota: recruiter.approach_quota_daily ?? settings.recruiter.approachesPerDay,
      cooldownDays: settings.recruiter.declineCooldownDays,
    });
    if (decision.block) {
      // A block reads as NOT_PUBLISHED so a blocked recruiter learns nothing.
      const code = decision.block === "BLOCKED" ? "NOT_PUBLISHED" : decision.block;
      throw new HttpError(decision.block === "QUOTA" ? 429 : 409, BLOCK_COPY[decision.block], `APPROACH_${code}`, decision.cooldownUntil ? { cooldownUntil: decision.cooldownUntil.toISOString() } : undefined);
    }
    let jobId: string | null = null;
    if (input.jobId) {
      const job = await trx.selectFrom("jobs").select(["id"]).where("id", "=", input.jobId).where("company_id", "=", recruiter.company_id).where("status", "=", "OPEN").executeTakeFirst();
      if (!job) throw badRequest("Choose an open job of your company", "JOB_NOT_SHAREABLE");
      jobId = job.id;
    }
    const s = input.salary;
    if (s && s.min !== null && s.max !== null && s.max < s.min) throw badRequest("The upper salary is below the lower one", "SALARY_INVALID");
    const inserted = await trx
      .insertInto("approaches")
      .values({
        id: newId(),
        recruiter_id: recruiter.id,
        company_id: recruiter.company_id,
        candidate_id: target.id,
        job_id: jobId,
        role_title: input.roleTitle,
        message: input.message,
        employment_type: input.employmentType ?? null,
        salary_min: s?.min ?? null,
        salary_max: s?.max ?? null,
        salary_currency: s?.currency?.toUpperCase() ?? null,
        pay_period: s?.period ?? null,
        expires_at: new Date(Date.now() + settings.recruiter.approachExpiryDays * 86400_000),
      })
      .onConflict((oc) => oc.columns(["recruiter_id", "candidate_id"]).where("status", "=", "PENDING").doNothing())
      .returningAll()
      .executeTakeFirst();
    if (!inserted) throw conflict(BLOCK_COPY.ALREADY_PENDING, "APPROACH_ALREADY_PENDING");
    await trx.updateTable("recruiters").set({ approaches_sent: sql`approaches_sent + 1` }).where("id", "=", recruiter.id).execute();
    await trx.updateTable("talent_profiles").set({ approach_count: sql`approach_count + 1` }).where("user_id", "=", target.id).execute();
    await notify({ recipientId: target.id, actorId: actor.id, type: "APPROACH_RECEIVED", entityType: "approach", entityId: inserted.id, snippet: `${input.roleTitle} at ${recruiter.company_name}`, data: { audience: "candidate" } }, fx, trx);
    fx.job("moderation.scan", { targetType: "APPROACH", targetId: inserted.id });
    fx.after(async () => {
      const [dto] = await presentApproaches(null, [inserted]);
      if (dto) realtime.emit([rooms.user(target.id)], "approach:new", { approach: dto });
    });
    return inserted;
  });
  return (await presentApproaches(actor, [row]))[0]!;
}

// ─── Lists ──────────────────────────────────────────────────────────────────

export async function listForCandidate(actor: Actor, q: { status?: ApproachStatus; cursor?: string; limit: number }): Promise<Page<Approach>> {
  let query = db
    .selectFrom("approaches as a")
    .selectAll("a")
    .select(atKey("a.created_at"))
    .where("a.candidate_id", "=", actor.id)
    // An approach the classifier took down never reaches the candidate.
    .where("a.moderation_state", "<>", "FLAGGED");
  if (q.status) query = query.where("a.status", "=", q.status);
  const rows = await query.where(olderThan("a.created_at", "a.id", decodeTime(q.cursor))).orderBy("a.created_at", "desc").orderBy("a.id", "desc").limit(q.limit + 1).execute();
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  return { items: await presentApproaches(actor, page.items), nextCursor: page.nextCursor };
}

export async function listForRecruiter(actor: Actor, q: { status?: ApproachStatus; cursor?: string; limit: number }): Promise<Page<Approach>> {
  const recruiter = await requireRecruiter(actor);
  let query = db.selectFrom("approaches as a").selectAll("a").select(atKey("a.created_at")).where("a.recruiter_id", "=", recruiter.id);
  if (q.status) query = query.where("a.status", "=", q.status);
  const rows = await query.where(olderThan("a.created_at", "a.id", decodeTime(q.cursor))).orderBy("a.created_at", "desc").orderBy("a.id", "desc").limit(q.limit + 1).execute();
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  return { items: await presentApproaches(actor, page.items), nextCursor: page.nextCursor };
}

async function candidateApproach(actor: Actor, id: string, exec: Executor, lock = false) {
  let q = exec.selectFrom("approaches").selectAll().where("id", "=", id).where("candidate_id", "=", actor.id);
  if (lock) q = q.forUpdate();
  const a = await q.executeTakeFirst();
  if (!a || a.moderation_state === "FLAGGED") throw notFound("Approach not found", "APPROACH_NOT_FOUND");
  return a;
}

export async function get(actor: Actor, id: string): Promise<Approach> {
  const row = await db.selectFrom("approaches as a").innerJoin("recruiters as r", "r.id", "a.recruiter_id").selectAll("a").where("a.id", "=", id).where((eb) => eb.or([eb("a.candidate_id", "=", actor.id), eb("r.user_id", "=", actor.id)])).executeTakeFirst();
  if (!row || (row.candidate_id === actor.id && row.moderation_state === "FLAGGED")) throw notFound("Approach not found", "APPROACH_NOT_FOUND");
  return (await presentApproaches(actor, [row]))[0]!;
}

// ─── Candidate responses ────────────────────────────────────────────────────

export async function markViewed(actor: Actor, id: string): Promise<void> {
  await db.updateTable("approaches").set({ viewed_at: new Date() }).where("id", "=", id).where("candidate_id", "=", actor.id).where("viewed_at", "is", null).execute();
}

async function recruiterUserOf(recruiterId: string, exec: Executor): Promise<string> {
  return (await exec.selectFrom("recruiters").select("user_id").where("id", "=", recruiterId).executeTakeFirstOrThrow()).user_id;
}

async function pushUpdated(id: string, userIds: string[]): Promise<void> {
  const row = await db.selectFrom("approaches").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) return;
  const [dto] = await presentApproaches(null, [row]);
  if (dto) realtime.emit(userIds.map(rooms.user), "approach:updated", { approach: dto });
}

/** Accept, sharing exactly the chosen channels. Each must be one the candidate has filled in. */
export async function accept(actor: Actor, id: string, channels: ContactChannel[]): Promise<Approach> {
  requireActive(actor);
  const chosen = [...new Set(channels)];
  if (!chosen.length) throw badRequest("Choose at least one way to be contacted", "CHANNELS_REQUIRED");
  const recruiterUser = await withTransaction(async (trx, fx) => {
    const a = await candidateApproach(actor, id, trx, true);
    if (a.status !== "PENDING") throw conflict("This approach is no longer open", "APPROACH_NOT_PENDING");
    if (a.expires_at <= new Date()) throw conflict("This approach has expired", "APPROACH_EXPIRED");
    const profile = await trx.selectFrom("talent_profiles").select(["contact_email", "contact_phone", "whatsapp_phone"]).where("user_id", "=", actor.id).executeTakeFirstOrThrow();
    const have: Record<ContactChannel, boolean> = { EMAIL: !!profile.contact_email, PHONE: !!profile.contact_phone, WHATSAPP: !!profile.whatsapp_phone };
    const missing = chosen.filter((c) => !have[c]);
    if (missing.length) throw badRequest("Add these contact details to your profile first", "CHANNEL_NOT_SET", { missing });
    const recruiterUser = await recruiterUserOf(a.recruiter_id, trx);
    if (await isBlockedEitherWay(actor.id, recruiterUser, trx)) throw notFound("Approach not found", "APPROACH_NOT_FOUND");
    const threadId = await openContextThread(recruiterUser, actor.id, "APPROACH", a.id, trx);
    const now = new Date();
    const res = await trx.updateTable("approaches").set({ status: "ACCEPTED", responded_at: now, viewed_at: a.viewed_at ?? now, thread_id: threadId }).where("id", "=", a.id).where("status", "=", "PENDING").executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1) throw conflict("This approach is no longer open", "APPROACH_NOT_PENDING");
    await trx.insertInto("contact_unlocks").values({ id: newId(), approach_id: a.id, recruiter_id: a.recruiter_id, candidate_id: actor.id, channels: chosen }).execute();
    await notify({ recipientId: recruiterUser, actorId: actor.id, type: "APPROACH_ACCEPTED", entityType: "approach", entityId: a.id, snippet: a.role_title, data: { audience: "recruiter", threadId } }, fx, trx);
    await audit({ actorId: actor.id, action: "approach.accept", entityType: "approach", entityId: a.id, data: { channels: chosen } }, trx);
    return recruiterUser;
  });
  await pushUpdated(id, [actor.id, recruiterUser]);
  return get(actor, id);
}

export async function decline(actor: Actor, id: string, reason: string | null): Promise<Approach> {
  const recruiterUser = await withTransaction(async (trx, fx) => {
    const a = await candidateApproach(actor, id, trx, true);
    const res = await trx.updateTable("approaches").set({ status: "DECLINED", responded_at: new Date(), decline_reason: reason }).where("id", "=", a.id).where("status", "=", "PENDING").executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1) throw conflict("This approach is no longer open", "APPROACH_NOT_PENDING");
    const recruiterUser = await recruiterUserOf(a.recruiter_id, trx);
    await notify({ recipientId: recruiterUser, actorId: actor.id, type: "APPROACH_DECLINED", entityType: "approach", entityId: a.id, snippet: reason ?? a.role_title, data: { audience: "recruiter" } }, fx, trx);
    return recruiterUser;
  });
  await pushUpdated(id, [actor.id, recruiterUser]);
  return get(actor, id);
}

/** Decline and block the recruiter in one step. */
export async function blockFromApproach(actor: Actor, id: string): Promise<void> {
  await withTransaction(async (trx) => {
    const a = await candidateApproach(actor, id, trx, true);
    const recruiterUser = await recruiterUserOf(a.recruiter_id, trx);
    await trx.updateTable("approaches").set({ status: "BLOCKED", responded_at: new Date() }).where("id", "=", a.id).where("status", "in", ["PENDING", "ACCEPTED"]).execute();
    await blockRepo.block(actor.id, recruiterUser, trx);
    await audit({ actorId: actor.id, action: "approach.block", entityType: "approach", entityId: a.id }, trx);
  });
}

/** Take the shared details back. The conversation stays; the reveal stops working. */
export async function revoke(actor: Actor, id: string): Promise<Approach> {
  const recruiterUser = await withTransaction(async (trx, fx) => {
    const a = await candidateApproach(actor, id, trx);
    const res = await trx.updateTable("contact_unlocks").set({ revoked_at: new Date(), revoked_reason: "Taken back by the candidate" }).where("approach_id", "=", a.id).where("revoked_at", "is", null).executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1) throw conflict("There is nothing shared to take back", "NOTHING_SHARED");
    const recruiterUser = await recruiterUserOf(a.recruiter_id, trx);
    await notify({ recipientId: recruiterUser, actorId: actor.id, type: "CONTACT_REVOKED", entityType: "approach", entityId: a.id, snippet: a.role_title, data: { audience: "recruiter" } }, fx, trx);
    await audit({ actorId: actor.id, action: "approach.revoke", entityType: "approach", entityId: a.id }, trx);
    return recruiterUser;
  });
  await pushUpdated(id, [actor.id, recruiterUser]);
  return get(actor, id);
}

// ─── Recruiter actions ──────────────────────────────────────────────────────

export async function withdraw(actor: Actor, id: string): Promise<Approach> {
  const recruiter = await requireRecruiter(actor);
  const candidate = await withTransaction(async (trx) => {
    const a = await trx.selectFrom("approaches").select(["id", "candidate_id"]).where("id", "=", id).where("recruiter_id", "=", recruiter.id).executeTakeFirst();
    if (!a) throw notFound("Approach not found", "APPROACH_NOT_FOUND");
    const res = await trx.updateTable("approaches").set({ status: "WITHDRAWN", responded_at: new Date() }).where("id", "=", a.id).where("status", "=", "PENDING").executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1) throw conflict("This approach is no longer open", "APPROACH_NOT_PENDING");
    return a.candidate_id;
  });
  await pushUpdated(id, [actor.id, candidate]);
  return get(actor, id);
}

function ipHash(ip: string | null): string | null {
  return ip ? crypto.createHmac("sha256", config.VIEW_HASH_SALT).update(ip).digest("hex").slice(0, 32) : null;
}

/**
 * Reveal the channels the candidate shared. Requires an ACTIVE recruiter of the same
 * recruiter record, an ACCEPTED approach and an unrevoked unlock; every channel shown
 * is logged (and the candidate sees the log).
 */
export async function revealContact(actor: Actor, id: string, meta: { ip: string | null; userAgent: string | null }): Promise<ContactReveal> {
  const recruiter = await requireRecruiter(actor);
  return withTransaction(async (trx) => {
    const unlock = await trx
      .selectFrom("contact_unlocks as u")
      .innerJoin("approaches as a", "a.id", "u.approach_id")
      .select(["u.id", "u.channels", "u.candidate_id", "a.status"])
      .where("u.approach_id", "=", id)
      .where("u.recruiter_id", "=", recruiter.id)
      .where("u.revoked_at", "is", null)
      .executeTakeFirst();
    if (!unlock || unlock.status !== "ACCEPTED") throw forbidden("These details are not shared with you", "CONTACT_NOT_SHARED");
    if (await isBlockedEitherWay(actor.id, unlock.candidate_id, trx)) throw forbidden("These details are not shared with you", "CONTACT_NOT_SHARED");
    const p = await trx.selectFrom("talent_profiles").select(["contact_email", "contact_phone", "whatsapp_phone"]).where("user_id", "=", unlock.candidate_id).executeTakeFirstOrThrow();
    const shared = new Set(unlock.channels);
    const out: ContactReveal = {
      approachId: id,
      email: shared.has("EMAIL") && p.contact_email ? String(p.contact_email) : null,
      phone: shared.has("PHONE") ? p.contact_phone : null,
      whatsapp: shared.has("WHATSAPP") ? p.whatsapp_phone : null,
      whatsappLink: shared.has("WHATSAPP") && p.whatsapp_phone ? `https://wa.me/${p.whatsapp_phone.replace(/\D/g, "")}` : null,
    };
    const logged = (["EMAIL", "PHONE", "WHATSAPP"] as const).filter((c) => (c === "EMAIL" ? out.email : c === "PHONE" ? out.phone : out.whatsapp));
    if (logged.length) {
      await trx
        .insertInto("contact_access_log")
        .values(logged.map((channel) => ({ id: newId(), unlock_id: unlock.id, recruiter_id: recruiter.id, candidate_id: unlock.candidate_id, channel, ip_hash: ipHash(meta.ip), user_agent: meta.userAgent?.slice(0, 300) ?? null })))
        .execute();
    }
    return out;
  });
}
