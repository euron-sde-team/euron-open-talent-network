/**
 * AI profile import: text, a document (PDF, DOCX, a photo of a resume) or a voice note
 * becomes a proposed profile that its owner reviews section by section. Nothing is
 * applied until they choose to, and nothing is ever published by the import.
 *
 *   QUEUED -> EXTRACTING (read the document, transcribe audio)
 *          -> GENERATING (the model drafts the proposal, schema-constrained)
 *          -> SCORING    (badges, kept only with verbatim evidence: domain/badges.ts)
 *          -> READY      (the owner reviews) -> APPLIED
 *          -> FAILED     (with a reason the owner can read)
 *
 * Each stage is pushed live ("import:status") so the wizard shows real progress.
 * Privacy, fixing the source system: the file goes to storage by upload id and the job
 * payload carries only the import id (the source put base64 resumes into Redis); the raw
 * input text and the upload link are purged once applied or after
 * settings.import.retentionHours, and the proposal never contains contact details.
 */
import type { ProfileImport, ProfileSection } from "@open-talent/types";
import type { Actor } from "../core/context";
import { requireActive } from "../core/context";
import { withEffects, withTransaction } from "../core/effects";
import { badRequest, conflict, HttpError, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { captureError, logger } from "../core/logger";
import { db } from "../db/kysely";
import { gateBadges, seniorityBadge, type CandidateBadge } from "../domain/badges";
import { yearsFromRoles } from "../domain/months";
import { parseYearMonth } from "../domain/months";
import { aiProvider, AiUnavailableError } from "../integrations/ai";
import { documentText } from "../integrations/ai/extract-text";
import { PROMPT_VERSION } from "../integrations/ai/prompts";
import { readBadges, sanitizeProposal } from "../integrations/ai/schema";
import { storage } from "../integrations/storage";
import { consume } from "../middleware/rate-limit";
import { realtime, rooms } from "../realtime/port";
import { profileRepo } from "../repositories/profile.repository";
import { audit } from "./audit.service";
import { notify } from "./notification.service";
import * as profiles from "./profile.service";
import { getSettings } from "./settings.service";

type ImportRow = NonNullable<Awaited<ReturnType<typeof loadOwn>>>;

function loadOwn(actor: Actor, id: string) {
  return db.selectFrom("profile_imports").selectAll().where("id", "=", id).where("user_id", "=", actor.id).executeTakeFirst();
}

function present(r: ImportRow): ProfileImport {
  const extracted = (r.extracted ?? null) as { proposal?: ProfileImport["proposal"] } | null;
  return {
    id: r.id,
    source: r.source,
    status: r.status,
    proposal: extracted?.proposal ?? null,
    proposedBadges: (Array.isArray(r.proposed_badges) ? r.proposed_badges : []) as ProfileImport["proposedBadges"],
    missingInfo: r.missing_info,
    error: r.error,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function start(actor: Actor, input: { text?: string | null; uploadId?: string | null }): Promise<ProfileImport> {
  requireActive(actor);
  const settings = await getSettings();
  if (!settings.import.enabled) throw new HttpError(503, "AI import is turned off on this network", "IMPORT_DISABLED");
  try {
    aiProvider();
  } catch (err) {
    if (err instanceof AiUnavailableError) throw new HttpError(503, "AI import is not available on this server", "AI_UNAVAILABLE");
    throw err;
  }
  const text = input.text?.trim() || null;
  if (!text && !input.uploadId) throw badRequest("Paste some text or attach a file", "IMPORT_EMPTY");
  if (text && text.length < 60 && !input.uploadId) throw badRequest("Tell us a bit more (at least a few sentences)", "IMPORT_TOO_SHORT");
  await consume("profile-import", `u:${actor.id}`, settings.import.perDay, 86400);

  let source: "TEXT" | "FILE" | "AUDIO" = "TEXT";
  if (input.uploadId) {
    const up = await db.selectFrom("media_uploads").select(["id", "owner_id", "purpose", "status", "kind"]).where("id", "=", input.uploadId).executeTakeFirst();
    if (!up || up.owner_id !== actor.id || up.purpose !== "IMPORT") throw badRequest("File not found", "MEDIA_INVALID");
    if (up.status !== "COMPLETE" && up.status !== "READY") throw badRequest("The file has not finished uploading", "MEDIA_NOT_READY");
    source = up.kind === "AUDIO" ? "AUDIO" : "FILE";
  }
  const row = await withEffects(async (fx) => {
    const r = await db
      .insertInto("profile_imports")
      .values({ id: newId(), user_id: actor.id, source, upload_id: input.uploadId ?? null, input_text: text, provider: null })
      .returningAll()
      .executeTakeFirstOrThrow();
    fx.job("import.run", { importId: r.id });
    return r;
  });
  return present((await loadOwn(actor, row.id)) ?? row);
}

export async function get(actor: Actor, id: string): Promise<ProfileImport> {
  const r = await loadOwn(actor, id);
  if (!r) throw notFound("Import not found", "IMPORT_NOT_FOUND");
  return present(r);
}

export async function latest(actor: Actor): Promise<ProfileImport | null> {
  const r = await db.selectFrom("profile_imports").selectAll().where("user_id", "=", actor.id).orderBy("created_at", "desc").executeTakeFirst();
  return r ? present(r) : null;
}

async function setStatus(id: string, userId: string, status: ImportRow["status"], patch: Record<string, unknown> = {}): Promise<void> {
  await db.updateTable("profile_imports").set({ status, ...patch, updated_at: new Date() }).where("id", "=", id).execute();
  realtime.emit([rooms.user(userId)], "import:status", { importId: id, status });
}

/** The import.run job. Idempotent: only a QUEUED import is picked up. */
export async function run(importId: string): Promise<void> {
  const claimed = await db.updateTable("profile_imports").set({ status: "EXTRACTING", updated_at: new Date() }).where("id", "=", importId).where("status", "=", "QUEUED").returningAll().executeTakeFirst();
  if (!claimed) return;
  const r = claimed;
  realtime.emit([rooms.user(r.user_id)], "import:status", { importId, status: "EXTRACTING" });
  try {
    const provider = aiProvider();
    let text = r.input_text ?? "";
    let image: { buffer: Buffer; mime: string } | undefined;
    if (r.upload_id) {
      const up = await db.selectFrom("media_uploads").select(["storage_key", "mime_type", "kind", "file_name"]).where("id", "=", r.upload_id).executeTakeFirstOrThrow();
      const buffer = await storage().get(up.storage_key);
      if (up.kind === "AUDIO") {
        const t = await provider.transcribe({ buffer, mime: up.mime_type, fileName: up.file_name });
        text = [text, t.text].filter(Boolean).join("\n\n");
      } else if (up.kind === "IMAGE") image = { buffer, mime: up.mime_type };
      else text = [text, await documentText(buffer, up.mime_type)].filter(Boolean).join("\n\n");
    }
    if (!text.trim() && !image) throw new Error("We could not read any text in that file");

    await setStatus(r.id, r.user_id, "GENERATING");
    const extracted = await provider.extract({ text, image });
    const { proposal, missingInfo } = sanitizeProposal(extracted.raw);
    if (!proposal.experience.length && !proposal.skills.length && !proposal.headline) throw new Error("We could not find anything about your work in that input");

    await setStatus(r.id, r.user_id, "SCORING");
    const proposalJson = JSON.stringify(proposal);
    let badges: CandidateBadge[] = [];
    try {
      badges = gateBadges(readBadges((await provider.badges(proposalJson)).raw), `${text}\n${proposalJson}`);
    } catch (err) {
      // Badges are a bonus: a failure here never fails the import.
      captureError(err, { where: "import.badges", importId });
    }
    const years = proposal.yearsExperience ?? (proposal.experience.length ? yearsFromRoles(proposal.experience.map((e) => ({ start: parseYearMonth(e.startMonth)!, end: parseYearMonth(e.endMonth) }))) : null);
    proposal.yearsExperience = years;
    const seniority = seniorityBadge(years);

    await setStatus(r.id, r.user_id, "READY", {
      extracted: JSON.stringify({ proposal, promptVersion: PROMPT_VERSION }),
      proposed_badges: JSON.stringify([
        ...(seniority ? [{ kind: "SENIORITY", slug: seniority.slug, label: seniority.label, rationale: seniority.rationale, evidenceQuote: null, confidence: 1 }] : []),
        ...badges.map((b) => ({ kind: b.kind, slug: b.slug, label: b.label, rationale: b.rationale, evidenceQuote: b.evidenceQuote, confidence: b.confidence })),
      ]),
      missing_info: missingInfo,
      provider: provider.name,
      model: extracted.usage.model,
      tokens_in: extracted.usage.tokensIn,
      tokens_out: extracted.usage.tokensOut,
      error: null,
    });
    await withEffects((fx) => notify({ recipientId: r.user_id, actorId: null, type: "IMPORT_READY", entityType: "profile_import", entityId: r.id, snippet: "Your profile draft is ready to review" }, fx));
  } catch (err) {
    logger.warn({ importId, err: (err as Error).message }, "profile import failed");
    const message = err instanceof AiUnavailableError ? "AI is not available on this server" : (err as Error).message.startsWith("We could") ? (err as Error).message : "The AI could not process this input. Try pasting the text instead.";
    await setStatus(r.id, r.user_id, "FAILED", { error: message });
  }
}

/**
 * Apply the sections the owner picked (and the basics when `basics` is set). Each picked
 * section replaces the current one, exactly like saving it in the editor; AI badges
 * replace earlier AI badges, ADMIN and SYSTEM ones stay. The raw input is purged.
 */
export async function apply(actor: Actor, id: string, input: { sections: ProfileSection[]; basics: boolean; badges: boolean }): Promise<ProfileImport> {
  requireActive(actor);
  const r = await loadOwn(actor, id);
  if (!r) throw notFound("Import not found", "IMPORT_NOT_FOUND");
  if (r.status !== "READY") throw conflict(r.status === "APPLIED" ? "This draft was already applied" : "This draft is not ready yet", "IMPORT_NOT_READY");
  const proposal = ((r.extracted ?? {}) as { proposal?: NonNullable<ProfileImport["proposal"]> }).proposal;
  if (!proposal) throw conflict("This draft has no content", "IMPORT_NOT_READY");

  if (input.basics) {
    await profiles.updateBasics(actor, {
      ...(proposal.headline ? { headline: proposal.headline } : {}),
      ...(proposal.about ? { about: proposal.about } : {}),
      ...(proposal.currentTitle ? { currentTitle: proposal.currentTitle } : {}),
      ...(proposal.location ? { location: proposal.location } : {}),
      ...(proposal.yearsExperience !== null ? { yearsExperience: proposal.yearsExperience } : {}),
    });
  }
  for (const section of new Set(input.sections)) {
    switch (section) {
      case "experience":
        await profiles.replaceSection(actor, { section, items: proposal.experience.map((e) => ({ ...e, companySlug: null })) });
        break;
      case "education":
        await profiles.replaceSection(actor, { section, items: proposal.education });
        break;
      case "projects":
        await profiles.replaceSection(actor, { section, items: proposal.projects.map((p) => ({ ...p, coverUploadId: null })) });
        break;
      case "skills":
        await profiles.replaceSection(actor, { section, items: proposal.skills });
        break;
      case "certifications":
        await profiles.replaceSection(actor, { section, items: proposal.certifications });
        break;
      case "links":
        await profiles.replaceSection(actor, { section, items: proposal.links });
        break;
    }
  }
  await withTransaction(async (trx) => {
    if (input.badges) {
      const profile = await profileRepo.byUserId(actor.id, trx);
      if (profile) {
        const proposed = (Array.isArray(r.proposed_badges) ? r.proposed_badges : []) as { kind: string; slug: string; label: string; rationale: string | null; evidenceQuote: string | null; confidence: number | null }[];
        await trx.deleteFrom("profile_badges").where("profile_id", "=", profile.id).where("source", "in", ["AI", "SYSTEM"]).execute();
        for (const b of proposed) {
          await trx
            .insertInto("profile_badges")
            .values({ id: newId(), profile_id: profile.id, kind: b.kind as "SENIORITY", source: b.kind === "SENIORITY" ? "SYSTEM" : "AI", slug: b.slug, label: b.label, rationale: b.rationale, evidence_quote: b.evidenceQuote, confidence: b.confidence })
            .onConflict((oc) => oc.columns(["profile_id", "slug"]).doNothing())
            .execute();
        }
      }
    }
    await trx.updateTable("profile_imports").set({ status: "APPLIED", applied_at: new Date(), input_text: null, upload_id: null, purged_at: new Date(), updated_at: new Date() }).where("id", "=", r.id).execute();
    await audit({ actorId: actor.id, action: "profile.import_apply", entityType: "profile_import", entityId: r.id, data: { sections: input.sections, basics: input.basics, badges: input.badges } }, trx);
  });
  return get(actor, id);
}

/** Rewrite one field. Rate limited; the result is a suggestion the editor shows, never saved here. */
export async function polish(actor: Actor, field: "headline" | "about" | "experience" | "project", text: string): Promise<{ text: string }> {
  requireActive(actor);
  await consume("ai-polish", `u:${actor.id}`, 50, 86400);
  try {
    const out = await aiProvider().polish(field, text);
    return { text: out.text.trim().slice(0, field === "headline" ? 160 : 4000) };
  } catch (err) {
    if (err instanceof AiUnavailableError) throw new HttpError(503, "AI is not available on this server", "AI_UNAVAILABLE");
    captureError(err, { where: "ai.polish" });
    throw new HttpError(502, "The AI could not rewrite that just now", "AI_FAILED");
  }
}

/** Housekeeping: drop raw input and file links of imports older than the retention window. */
export async function purgeExpired(): Promise<number> {
  const hours = (await getSettings()).import.retentionHours;
  const res = await db
    .updateTable("profile_imports")
    .set({ input_text: null, upload_id: null, extracted: null, proposed_badges: null, purged_at: new Date(), status: "FAILED", error: "Expired" })
    .where("purged_at", "is", null)
    .where("status", "<>", "APPLIED")
    .where("created_at", "<", new Date(Date.now() - hours * 3600_000))
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}
