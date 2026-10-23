/**
 * Trust: engagements (work that came out of an accepted approach or a hire), double-
 * blind ratings, and complaints.
 *
 * Engagements, fixing the source system:
 *   - Proposed by either side of an ACCEPTED approach, or by the team for a HIRED
 *     application. It becomes ACTIVE only when BOTH sides confirm (the source let
 *     one side confirm it alone).
 *   - Either side asks to mark it complete; the other confirms, or disputes it (which
 *     opens a complaint path). With no answer within trust.autoConfirmDays the
 *     housekeeping job completes it.
 * Ratings (domain/trust.ts): one per side per engagement, from completion until
 * trust.ratingWindowDays, hidden until both are in or the window closes, editable once
 * before reveal and never after. Revealed ratings update the ratee's average.
 * Complaints must name someone the complainant actually dealt with (an approach, an
 * application or an engagement between them); evidence is upload ids, never URLs (the
 * source accepted any *.amazonaws.com link).
 */
import type { Complaint, ComplaintCategory, Engagement, Rating, SubScores } from "@open-talent/types";
import { sql, type Selectable } from "kysely";
import type { Complaints } from "../db/types";
import type { Actor } from "../core/context";
import { requireActive } from "../core/context";
import { withTransaction, type Effects } from "../core/effects";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { averageScore, ratingEditBlock, ratingWindowOpen } from "../domain/trust";
import { loadMedia, urlOf } from "../presenters/media.presenter";
import { loadSummaries } from "../presenters/user.presenter";
import { audit } from "./audit.service";
import { claimSingle } from "./media-attach.service";
import { notify } from "./notification.service";
import { getSettings } from "./settings.service";

type EngagementRow = Awaited<ReturnType<typeof loadEngagement>>;

async function loadEngagement(id: string, exec: Executor, lock = false) {
  let q = exec.selectFrom("engagements").selectAll().where("id", "=", id);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

function sideOf(e: NonNullable<EngagementRow>, userId: string): "CANDIDATE" | "RECRUITER" | null {
  if (e.candidate_id === userId) return "CANDIDATE";
  if (e.recruiter_user_id === userId) return "RECRUITER";
  return null;
}

async function presentEngagements(viewer: Actor, rows: NonNullable<EngagementRow>[], exec: Executor = db): Promise<Engagement[]> {
  if (!rows.length) return [];
  const settings = await getSettings(exec);
  const [people, companies, ratings] = await Promise.all([
    loadSummaries(rows.flatMap((r) => [r.candidate_id, r.recruiter_user_id]), exec),
    exec.selectFrom("companies").select(["id", "slug", "name", "logo_upload_id"]).where("id", "in", [...new Set(rows.map((r) => r.company_id))]).execute(),
    exec.selectFrom("ratings").select(["engagement_id", "rater_id"]).where("engagement_id", "in", rows.map((r) => r.id)).execute(),
  ]);
  const logos = await loadMedia(companies.map((c) => c.logo_upload_id), exec);
  const companyById = new Map(companies.map((c) => [c.id, { id: c.id, slug: String(c.slug), name: c.name, logoUrl: urlOf(logos, c.logo_upload_id, "thumb") }]));
  return rows.map((r) => {
    const viewerRated = ratings.some((x) => x.engagement_id === r.id && x.rater_id === viewer.id);
    const counterpart = r.candidate_id === viewer.id ? r.recruiter_user_id : r.candidate_id;
    const open = r.status === "COMPLETED" && ratingWindowOpen(r.completed_at, settings.trust.ratingWindowDays);
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      company: companyById.get(r.company_id) ?? { id: r.company_id, slug: "", name: "Unknown", logoUrl: null },
      recruiter: people.get(r.recruiter_user_id)!,
      candidate: people.get(r.candidate_id)!,
      approachId: r.approach_id,
      applicationId: r.application_id,
      candidateConfirmed: !!r.candidate_confirmed_at,
      recruiterConfirmed: !!r.recruiter_confirmed_at,
      completionRequestedBy: r.completion_requested_by,
      completionRequestedAt: r.completion_requested_at?.toISOString() ?? null,
      completedAt: r.completed_at?.toISOString() ?? null,
      rating: {
        viewerRated,
        counterpartRated: ratings.some((x) => x.engagement_id === r.id && x.rater_id === counterpart),
        windowClosesAt: r.completed_at ? new Date(r.completed_at.getTime() + settings.trust.ratingWindowDays * 86400_000).toISOString() : null,
        canRate: open && !viewerRated,
      },
      createdAt: r.created_at.toISOString(),
    };
  });
}

export async function list(actor: Actor): Promise<Engagement[]> {
  const rows = await db
    .selectFrom("engagements")
    .selectAll()
    .where((eb) => eb.or([eb("candidate_id", "=", actor.id), eb("recruiter_user_id", "=", actor.id)]))
    .orderBy("created_at", "desc")
    .limit(200)
    .execute();
  return presentEngagements(actor, rows);
}

/** Propose an engagement from an accepted approach (either side) or a hired application (the team). */
export async function propose(actor: Actor, input: { approachId?: string; applicationId?: string; title: string }): Promise<Engagement> {
  requireActive(actor);
  if (!!input.approachId === !!input.applicationId) throw badRequest("Propose from one approach or one application", "SOURCE_REQUIRED");
  const row = await withTransaction(async (trx, fx) => {
    let base: { company_id: string; recruiter_user_id: string; candidate_id: string };
    if (input.approachId) {
      const a = await trx.selectFrom("approaches as a").innerJoin("recruiters as r", "r.id", "a.recruiter_id").select(["a.company_id", "a.candidate_id", "a.status", "r.user_id"]).where("a.id", "=", input.approachId).executeTakeFirst();
      if (!a || (a.candidate_id !== actor.id && a.user_id !== actor.id)) throw notFound("Approach not found", "APPROACH_NOT_FOUND");
      if (a.status !== "ACCEPTED") throw conflict("Only an accepted approach can become an engagement", "APPROACH_NOT_ACCEPTED");
      base = { company_id: a.company_id, recruiter_user_id: a.user_id, candidate_id: a.candidate_id };
    } else {
      const app = await trx.selectFrom("applications").select(["company_id", "candidate_id", "stage", "job_id"]).where("id", "=", input.applicationId as string).executeTakeFirst();
      if (!app) throw notFound("Application not found", "APPLICATION_NOT_FOUND");
      const team = await trx.selectFrom("recruiters").select("user_id").where("user_id", "=", actor.id).where("company_id", "=", app.company_id).where("status", "=", "ACTIVE").executeTakeFirst();
      if (!team) throw forbidden("Only the hiring team can propose this", "NOT_HIRING_TEAM");
      if (app.stage !== "HIRED") throw conflict("Mark the application as hired first", "NOT_HIRED");
      base = { company_id: app.company_id, recruiter_user_id: actor.id, candidate_id: app.candidate_id };
    }
    const now = new Date();
    const mine = actor.id === base.candidate_id ? { candidate_confirmed_at: now } : { recruiter_confirmed_at: now };
    const inserted = await trx
      .insertInto("engagements")
      .values({ id: newId(), approach_id: input.approachId ?? null, application_id: input.applicationId ?? null, ...base, title: input.title, proposed_by: actor.id, ...mine })
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .executeTakeFirst();
    if (!inserted) throw conflict("An engagement already exists for this", "ENGAGEMENT_EXISTS");
    const other = actor.id === base.candidate_id ? base.recruiter_user_id : base.candidate_id;
    await notify({ recipientId: other, actorId: actor.id, type: "ENGAGEMENT_PROPOSED", entityType: "engagement", entityId: inserted.id, snippet: input.title, data: { engagementId: inserted.id } }, fx, trx);
    return inserted;
  });
  return (await presentEngagements(actor, [row]))[0]!;
}

async function act(actor: Actor, id: string, fn: (e: NonNullable<EngagementRow>, side: "CANDIDATE" | "RECRUITER", trx: Executor, fx: Effects) => Promise<string | null>): Promise<Engagement> {
  requireActive(actor);
  await withTransaction(async (trx, fx) => {
    const e = await loadEngagement(id, trx, true);
    const side = e ? sideOf(e, actor.id) : null;
    if (!e || !side) throw notFound("Engagement not found", "ENGAGEMENT_NOT_FOUND");
    const snippet = await fn(e, side, trx, fx);
    if (snippet) {
      const other = side === "CANDIDATE" ? e.recruiter_user_id : e.candidate_id;
      await notify({ recipientId: other, actorId: actor.id, type: "ENGAGEMENT_UPDATED", entityType: "engagement", entityId: e.id, snippet, data: { engagementId: e.id } }, fx, trx);
    }
  });
  const fresh = await loadEngagement(id, db);
  return (await presentEngagements(actor, [fresh!]))[0]!;
}

/** Confirm the start. ACTIVE once both have confirmed. */
export function confirm(actor: Actor, id: string): Promise<Engagement> {
  return act(actor, id, async (e, side, trx) => {
    if (e.status !== "PROPOSED") throw conflict("This engagement is not waiting for confirmation", "ENGAGEMENT_STATE");
    const now = new Date();
    const patch = side === "CANDIDATE" ? { candidate_confirmed_at: e.candidate_confirmed_at ?? now } : { recruiter_confirmed_at: e.recruiter_confirmed_at ?? now };
    const both = (side === "CANDIDATE" ? true : !!e.candidate_confirmed_at) && (side === "RECRUITER" ? true : !!e.recruiter_confirmed_at);
    await trx.updateTable("engagements").set({ ...patch, ...(both ? { status: "ACTIVE" as const } : {}), updated_at: now }).where("id", "=", e.id).where("status", "=", "PROPOSED").execute();
    return both ? `${e.title}: started` : null;
  });
}

export function cancel(actor: Actor, id: string): Promise<Engagement> {
  return act(actor, id, async (e, _side, trx) => {
    if (e.status !== "PROPOSED") throw conflict("Only a proposed engagement can be cancelled", "ENGAGEMENT_STATE");
    await trx.updateTable("engagements").set({ status: "CANCELLED", updated_at: new Date() }).where("id", "=", e.id).execute();
    return `${e.title}: cancelled`;
  });
}

/** Ask to mark it complete, or confirm the other side's request (which completes it). */
export function complete(actor: Actor, id: string): Promise<Engagement> {
  return act(actor, id, async (e, _side, trx) => {
    if (e.status !== "ACTIVE") throw conflict("This engagement is not active", "ENGAGEMENT_STATE");
    const now = new Date();
    if (e.completion_requested_by && e.completion_requested_by !== actor.id) {
      await trx.updateTable("engagements").set({ status: "COMPLETED", completed_at: now, updated_at: now }).where("id", "=", e.id).where("status", "=", "ACTIVE").execute();
      return `${e.title}: completed. You can now rate each other.`;
    }
    if (!e.completion_requested_by) await trx.updateTable("engagements").set({ completion_requested_by: actor.id, completion_requested_at: now, updated_at: now }).where("id", "=", e.id).execute();
    return `${e.title}: marked complete, waiting for you to confirm`;
  });
}

/** Dispute a completion request; the engagement stops and a complaint can follow. */
export function dispute(actor: Actor, id: string): Promise<Engagement> {
  return act(actor, id, async (e, _side, trx) => {
    if (e.status !== "ACTIVE" || !e.completion_requested_by || e.completion_requested_by === actor.id) throw conflict("There is nothing to dispute", "ENGAGEMENT_STATE");
    await trx.updateTable("engagements").set({ status: "DISPUTED", disputed_at: new Date(), updated_at: new Date() }).where("id", "=", e.id).execute();
    return `${e.title}: disputed`;
  });
}

// ─── Ratings ────────────────────────────────────────────────────────────────

export async function rate(actor: Actor, engagementId: string, input: { score: number; subScores?: Partial<SubScores>; comment?: string | null }): Promise<{ id: string; revealed: boolean }> {
  requireActive(actor);
  const settings = await getSettings();
  return withTransaction(async (trx, fx) => {
    const e = await loadEngagement(engagementId, trx, true);
    const side = e ? sideOf(e, actor.id) : null;
    if (!e || !side) throw notFound("Engagement not found", "ENGAGEMENT_NOT_FOUND");
    if (e.status !== "COMPLETED") throw conflict("Ratings open once the work is complete", "ENGAGEMENT_NOT_COMPLETE");
    if (!ratingWindowOpen(e.completed_at, settings.trust.ratingWindowDays)) throw conflict("The rating window has closed", "RATING_WINDOW_CLOSED");
    const direction = side === "CANDIDATE" ? "CANDIDATE_TO_RECRUITER" : "RECRUITER_TO_CANDIDATE";
    const ratee = side === "CANDIDATE" ? e.recruiter_user_id : e.candidate_id;
    const existing = await trx.selectFrom("ratings").selectAll().where("engagement_id", "=", e.id).where("direction", "=", direction).forUpdate().executeTakeFirst();
    const values = { score: input.score, sub_scores: JSON.stringify(input.subScores ?? {}), comment: input.comment ?? null };
    let id: string;
    if (existing) {
      const block = ratingEditBlock({ revealedAt: existing.revealed_at, editedAt: existing.edited_at });
      if (block) throw conflict(block === "REVEALED" ? "Revealed ratings cannot be changed" : "You can edit a rating once", `RATING_${block}`);
      await trx.updateTable("ratings").set({ ...values, edited_at: new Date() }).where("id", "=", existing.id).execute();
      id = existing.id;
    } else {
      id = (await trx.insertInto("ratings").values({ id: newId(), engagement_id: e.id, direction, rater_id: actor.id, ratee_id: ratee, ...values }).returning("id").executeTakeFirstOrThrow()).id;
    }
    const both = await trx.selectFrom("ratings").select("id").where("engagement_id", "=", e.id).execute();
    let revealed = false;
    if (both.length >= 2) {
      await revealRatings(e.id, trx, fx);
      revealed = true;
    }
    await audit({ actorId: actor.id, action: existing ? "rating.edit" : "rating.create", entityType: "engagement", entityId: e.id }, trx);
    return { id, revealed };
  });
}

/** Reveal both ratings of an engagement and refresh both averages. Idempotent. */
export async function revealRatings(engagementId: string, trx: Executor, fx: Effects): Promise<void> {
  const rows = await trx.updateTable("ratings").set({ revealed_at: new Date() }).where("engagement_id", "=", engagementId).where("revealed_at", "is", null).returning(["ratee_id", "rater_id", "direction"]).execute();
  for (const r of rows) {
    await refreshAverage(r.ratee_id, r.direction, trx);
    await notify({ recipientId: r.ratee_id, actorId: null, type: "RATING_RECEIVED", entityType: "engagement", entityId: engagementId, snippet: "You received a rating", data: { engagementId } }, fx, trx);
  }
}

/** Candidates' averages live on their profile; recruiters' roll up to their company. */
async function refreshAverage(userId: string, direction: "RECRUITER_TO_CANDIDATE" | "CANDIDATE_TO_RECRUITER", trx: Executor): Promise<void> {
  if (direction === "RECRUITER_TO_CANDIDATE") {
    const scores = await trx.selectFrom("ratings").select("score").where("ratee_id", "=", userId).where("direction", "=", direction).where("revealed_at", "is not", null).where("hidden_at", "is", null).execute();
    await trx.updateTable("talent_profiles").set({ rating_avg: averageScore(scores.map((s) => s.score)), rating_count: scores.length }).where("user_id", "=", userId).execute();
    return;
  }
  const company = await trx.selectFrom("recruiters").select("company_id").where("user_id", "=", userId).executeTakeFirst();
  if (!company) return;
  const r = await sql<{ avg: number | null; n: number }>`
    SELECT avg(rt.score)::float8 AS avg, count(*)::int AS n FROM ratings rt JOIN engagements e ON e.id = rt.engagement_id
     WHERE e.company_id = ${company.company_id} AND rt.direction = 'CANDIDATE_TO_RECRUITER' AND rt.revealed_at IS NOT NULL AND rt.hidden_at IS NULL`.execute(trx);
  const row = r.rows[0];
  await trx.updateTable("companies").set({ rating_avg: row?.avg === null || row?.avg === undefined ? null : Math.round(row.avg * 100) / 100, rating_count: row?.n ?? 0 }).where("id", "=", company.company_id).execute();
}

export async function ratingsFor(username: string): Promise<Rating[]> {
  const user = await db.selectFrom("users").select("id").where("username", "=", username).executeTakeFirst();
  if (!user) throw notFound("User not found");
  const rows = await db
    .selectFrom("ratings")
    .selectAll()
    .where("ratee_id", "=", user.id)
    .where("direction", "=", "RECRUITER_TO_CANDIDATE")
    .where("revealed_at", "is not", null)
    .where("hidden_at", "is", null)
    .orderBy("revealed_at", "desc")
    .limit(50)
    .execute();
  const raters = await loadSummaries(rows.map((r) => r.rater_id));
  return rows
    .filter((r) => raters.has(r.rater_id))
    .map((r) => ({ id: r.id, engagementId: r.engagement_id, rater: raters.get(r.rater_id)!, score: r.score, subScores: (r.sub_scores ?? {}) as Partial<SubScores>, comment: r.comment, revealedAt: r.revealed_at?.toISOString() ?? null, createdAt: r.created_at.toISOString() }));
}

// ─── Complaints ─────────────────────────────────────────────────────────────

export interface ComplaintInput {
  againstUsername: string;
  category: ComplaintCategory;
  description: string;
  engagementId?: string | null;
  approachId?: string | null;
  applicationId?: string | null;
  evidenceUploadIds?: string[];
}

/** Is there a real dealing between the two (an approach, an application or an engagement)? */
async function linked(a: string, b: string, input: ComplaintInput, exec: Executor): Promise<boolean> {
  if (input.engagementId) {
    const e = await exec.selectFrom("engagements").select(["candidate_id", "recruiter_user_id"]).where("id", "=", input.engagementId).executeTakeFirst();
    return !!e && [e.candidate_id, e.recruiter_user_id].sort().join() === [a, b].sort().join();
  }
  if (input.approachId) {
    const ap = await exec.selectFrom("approaches as x").innerJoin("recruiters as r", "r.id", "x.recruiter_id").select(["x.candidate_id", "r.user_id"]).where("x.id", "=", input.approachId).executeTakeFirst();
    return !!ap && [ap.candidate_id, ap.user_id].sort().join() === [a, b].sort().join();
  }
  if (input.applicationId) {
    const app = await exec.selectFrom("applications").select(["candidate_id", "company_id"]).where("id", "=", input.applicationId).executeTakeFirst();
    if (!app) return false;
    const other = app.candidate_id === a ? b : app.candidate_id === b ? a : null;
    if (!other) return false;
    return !!(await exec.selectFrom("recruiters").select("id").where("user_id", "=", other).where("company_id", "=", app.company_id).executeTakeFirst());
  }
  return false;
}

export async function fileComplaint(actor: Actor, input: ComplaintInput): Promise<{ id: string }> {
  requireActive(actor);
  const settings = await getSettings();
  const against = await db.selectFrom("users").select("id").where("username", "=", input.againstUsername).executeTakeFirst();
  if (!against || against.id === actor.id) throw notFound("User not found");
  if (!input.engagementId && !input.approachId && !input.applicationId) throw badRequest("Say which approach, application or engagement this is about", "CONTEXT_REQUIRED");
  if (!(await linked(actor.id, against.id, input, db))) throw notFound("We could not find a dealing between you and this person", "NO_RELATIONSHIP");
  const recent = await db.selectFrom("complaints").select((eb) => eb.fn.countAll<number>().as("n")).where("complainant_id", "=", actor.id).where("created_at", ">", new Date(Date.now() - 30 * 86400_000)).executeTakeFirstOrThrow();
  if (Number(recent.n) >= settings.trust.complaintsPer30Days) throw new HttpError(429, "You have filed several complaints recently. Our team will get to them.", "COMPLAINT_LIMIT");
  const evidence: string[] = [];
  for (const id of [...new Set(input.evidenceUploadIds ?? [])].slice(0, 10)) evidence.push((await claimSingle(actor.id, id, "EVIDENCE")) as string);
  return withTransaction(async (trx) => {
    const row = await trx
      .insertInto("complaints")
      .values({ id: newId(), complainant_id: actor.id, against_user_id: against.id, engagement_id: input.engagementId ?? null, approach_id: input.approachId ?? null, application_id: input.applicationId ?? null, category: input.category, description: input.description, evidence_upload_ids: evidence })
      .onConflict((oc) => oc.doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!row) throw conflict("You already have an open complaint about this engagement", "COMPLAINT_EXISTS");
    await audit({ actorId: actor.id, action: "complaint.file", entityType: "complaint", entityId: row.id, data: { category: input.category } }, trx);
    return { id: row.id };
  });
}

export async function myComplaints(actor: Actor): Promise<Complaint[]> {
  const rows = await db.selectFrom("complaints").selectAll().where("complainant_id", "=", actor.id).orderBy("created_at", "desc").limit(100).execute();
  return presentComplaints(rows);
}

export async function presentComplaints(rows: readonly Selectable<Complaints>[]): Promise<Complaint[]> {
  const people = await loadSummaries(rows.flatMap((r) => [r.complainant_id, r.against_user_id]));
  const media = await loadMedia(rows.flatMap((r) => r.evidence_upload_ids));
  return rows.map((r) => ({
    id: r.id,
    complainant: people.get(r.complainant_id)!,
    against: people.get(r.against_user_id)!,
    category: r.category,
    description: r.description,
    evidence: r.evidence_upload_ids.map((id) => media.get(id)).filter((m): m is NonNullable<typeof m> => !!m),
    status: r.status,
    adminNote: r.admin_note,
    engagementId: r.engagement_id,
    approachId: r.approach_id,
    applicationId: r.application_id,
    resolvedAt: r.resolved_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  }));
}
