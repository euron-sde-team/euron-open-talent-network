/**
 * The talent page for one viewer. Everything private is decided here, in one place:
 *   - sections whose audience the viewer is outside are emptied and listed in
 *     `hiddenSections` (domain/profile.ts)
 *   - the open-to-work signal follows its mode (OFF, RECRUITERS, PUBLIC)
 *   - contact details are never part of a Profile; they exist only in MyProfile (the
 *     owner) and in a logged ContactReveal (approach.service.ts: revealContact)
 *   - badges the owner hid are shown to the owner and staff only
 */
import type { Badge, Certification, Education, Experience, MyProfile, Profile, ProfileLink, ProfileViewer, Project, Skill } from "@open-talent/types";
import type { Actor } from "../core/context";
import { isStaff } from "../core/context";
import { db, type Executor } from "../db/kysely";
import { toEligibility } from "../domain/can-message";
import { toYearMonth } from "../domain/months";
import { displayRating, hiddenSections, readAudience, showsOpenToWork, type ViewerRelation } from "../domain/profile";
import { youtubeId } from "../domain/safe-url";
import { approachBlock } from "../domain/trust";
import { connectionRepo } from "../repositories/connection.repository";
import { followRepo } from "../repositories/follow.repository";
import { isActiveRecruiter, messagingDecision } from "../repositories/messaging-facts";
import { profileRepo, type ProfileRow, type Sections } from "../repositories/profile.repository";
import { getSettings } from "../services/settings.service";
import { loadMedia, urlOf } from "./media.presenter";
import { summaryOf } from "./user.presenter";

export interface ProfileContext {
  row: ProfileRow & { username: string; display_name: string; cover_upload_id: string | null; connection_count: number; follower_count: number };
  sections: Sections;
  badges: Awaited<ReturnType<typeof profileRepo.badges>>;
}

/** The viewer's ACTIVE recruiter record (company not suspended), if any. */
export async function activeRecruiterOf(userId: string, exec: Executor = db) {
  return exec
    .selectFrom("recruiters as r")
    .innerJoin("companies as c", "c.id", "r.company_id")
    .select(["r.id", "r.company_id", "r.role", "r.approach_quota_daily", "c.name as company_name", "c.slug as company_slug"])
    .where("r.user_id", "=", userId)
    .where("r.status", "=", "ACTIVE")
    .where("c.status", "<>", "SUSPENDED")
    .executeTakeFirst();
}

export async function relationTo(viewer: Actor | null, userId: string, exec: Executor = db): Promise<ViewerRelation & { connection: ProfileViewer["connection"]; connectionId: string | null }> {
  if (!viewer) return { isSelf: false, isStaff: false, connected: false, isRecruiter: false, connection: "NONE", connectionId: null };
  if (viewer.id === userId) return { isSelf: true, isStaff: isStaff(viewer), connected: false, isRecruiter: false, connection: "SELF", connectionId: null };
  const [states, recruiter] = await Promise.all([connectionRepo.states(viewer.id, [userId], exec), isActiveRecruiter(viewer.id, exec)]);
  const st = states.get(userId) ?? { state: "NONE" as const, id: null };
  return { isSelf: false, isStaff: isStaff(viewer), connected: st.state === "CONNECTED", isRecruiter: recruiter, connection: st.state, connectionId: st.id };
}

async function presentSections(viewer: Actor | null, s: Sections, exec: Executor) {
  const companyIds = s.experience.map((e) => e.company_id).filter((x): x is string => !!x);
  const [companies, media, endorsed] = await Promise.all([
    companyIds.length ? exec.selectFrom("companies").select(["id", "slug", "name", "logo_upload_id", "status"]).where("id", "in", companyIds).where("status", "<>", "SUSPENDED").execute() : Promise.resolve([]),
    loadMedia(s.projects.map((p) => p.cover_upload_id), exec),
    viewer && s.skills.length
      ? exec
          .selectFrom("skill_endorsements")
          .select("skill_id")
          .where("endorser_id", "=", viewer.id)
          .where(
            "skill_id",
            "in",
            s.skills.map((k) => k.id),
          )
          .execute()
          .then((rows) => new Set(rows.map((r) => r.skill_id)))
      : Promise.resolve(new Set<string>()),
  ]);
  const logos = await loadMedia(companies.map((c) => c.logo_upload_id), exec);
  const companyById = new Map(companies.map((c) => [c.id, { id: c.id, slug: String(c.slug), name: c.name, logoUrl: urlOf(logos, c.logo_upload_id, "thumb") }]));

  const experience: Experience[] = s.experience.map((e) => ({
    id: e.id,
    title: e.title,
    companyName: e.company_name,
    company: e.company_id ? (companyById.get(e.company_id) ?? null) : null,
    employmentType: e.employment_type,
    workplaceType: e.workplace_type,
    location: e.location,
    startMonth: toYearMonth(e.start_month) as string,
    endMonth: toYearMonth(e.end_month),
    description: e.description,
    skills: e.skills,
  }));
  const education: Education[] = s.education.map((e) => ({ id: e.id, institution: e.institution, degree: e.degree, field: e.field, startYear: e.start_year, endYear: e.end_year, grade: e.grade, description: e.description }));
  const projects: Project[] = s.projects.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    url: p.url,
    repoUrl: p.repo_url,
    cover: p.cover_upload_id ? (media.get(p.cover_upload_id) ?? null) : null,
    skills: p.skills,
    startMonth: toYearMonth(p.start_month),
    endMonth: toYearMonth(p.end_month),
  }));
  const skills: Skill[] = s.skills.map((k) => ({ id: k.id, name: String(k.name), category: k.category, years: k.years, endorsementCount: k.endorsement_count, endorsedByViewer: endorsed.has(k.id) }));
  const certifications: Certification[] = s.certifications.map((c) => ({
    id: c.id,
    name: c.name,
    issuer: c.issuer,
    issuedMonth: toYearMonth(c.issued_month),
    expiresMonth: toYearMonth(c.expires_month),
    credentialId: c.credential_id,
    credentialUrl: c.credential_url,
  }));
  const links: ProfileLink[] = s.links.map((l) => ({ id: l.id, kind: l.kind, url: l.url, label: l.label, featured: l.featured, embedId: l.kind === "YOUTUBE" ? youtubeId(l.url) : null }));
  return { experience, education, projects, skills, certifications, links };
}

export function toBadge(b: ProfileContext["badges"][number]): Badge {
  return {
    id: b.id,
    kind: b.kind,
    source: b.source,
    slug: b.slug,
    label: b.label,
    rationale: b.rationale,
    evidenceQuote: b.evidence_quote,
    confidence: b.confidence === null ? null : Number(b.confidence),
    percentile: b.percentile,
    isVisible: b.is_visible,
  };
}

export async function presentProfile(viewer: Actor | null, ctx: ProfileContext, exec: Executor = db): Promise<Profile> {
  const { row } = ctx;
  const rel = await relationTo(viewer, row.user_id, exec);
  const [user, media, sections, following, mutual] = await Promise.all([
    summaryOf(row.user_id, exec),
    loadMedia([row.cover_upload_id], exec),
    presentSections(viewer, ctx.sections, exec),
    viewer && !rel.isSelf ? followRepo.relation(viewer.id, row.user_id, exec).then((r) => r.following) : Promise.resolve(false),
    viewer && !rel.isSelf ? connectionRepo.mutualCounts(viewer.id, [row.user_id], exec).then((m) => m.get(row.user_id) ?? 0) : Promise.resolve(0),
  ]);
  if (!user) throw new Error(`profile owner ${row.user_id} is missing`);

  const hidden = hiddenSections(row.section_visibility, rel);
  const showOtw = showsOpenToWork(row.open_to_work, rel);
  const blank = (s: (typeof hidden)[number]) => hidden.includes(s);
  const currentRole = ctx.sections.experience.find((e) => !e.end_month);
  const viewerBlock = await viewerFacts(viewer, row, rel, exec);

  return {
    user: { ...user, openToWork: showOtw },
    status: row.status,
    coverUrl: urlOf(media, row.cover_upload_id, "full"),
    headline: row.headline,
    about: row.about,
    // Only what the owner typed is stored; otherwise the current role stands in, but only
    // for viewers who may see the experience section (it would reveal the employer).
    currentTitle: row.current_title ?? (blank("experience") ? null : (currentRole?.title ?? null)),
    currentCompany: row.current_company ?? (blank("experience") ? null : (currentRole?.company_name ?? null)),
    location: row.location,
    countryCode: row.country_code,
    yearsExperience: row.years_experience,
    languages: row.languages,
    openToWork: showOtw ? { roles: row.open_to_roles, employmentTypes: row.employment_types, workplaceTypes: row.workplace_types, availableFrom: row.available_from ? new Date(row.available_from).toISOString().slice(0, 10) : null } : null,
    rate: row.rate_min !== null || row.rate_max !== null ? { min: row.rate_min, max: row.rate_max, currency: row.rate_currency, period: row.rate_period } : null,
    experience: blank("experience") ? [] : sections.experience,
    education: blank("education") ? [] : sections.education,
    projects: blank("projects") ? [] : sections.projects,
    skills: blank("skills") ? [] : sections.skills,
    certifications: blank("certifications") ? [] : sections.certifications,
    links: blank("links") ? [] : sections.links,
    badges: ctx.badges.filter((b) => b.is_visible || rel.isSelf || rel.isStaff).map(toBadge),
    hiddenSections: hidden,
    rating: { average: displayRating(row.rating_avg === null ? null : Number(row.rating_avg), row.rating_count), count: row.rating_count },
    connectionCount: row.connection_count,
    followerCount: row.follower_count,
    completeness: row.completeness,
    publishedAt: row.published_at?.toISOString() ?? null,
    viewer: {
      isSelf: rel.isSelf,
      signedIn: !!viewer,
      connection: rel.connection,
      connectionId: rel.connectionId,
      following,
      blocked: false,
      mutualCount: mutual,
      messaging: viewer && !rel.isSelf ? toEligibility(await messagingDecision(viewer, row.user_id, exec)) : { canMessage: false, canRequest: false, reason: rel.isSelf ? "SELF" : null },
      recruiter: viewerBlock,
    },
  };
}

/** The recruiter part of ProfileViewer: saved, can I approach, is a contact unlock live. */
async function viewerFacts(viewer: Actor | null, row: ProfileRow, rel: ViewerRelation, exec: Executor): Promise<ProfileViewer["recruiter"]> {
  if (!viewer || rel.isSelf || !rel.isRecruiter) return null;
  const recruiter = await activeRecruiterOf(viewer.id, exec);
  if (!recruiter) return null;
  const settings = await getSettings(exec);
  const [saved, pending, lastDeclined, sentToday, unlock] = await Promise.all([
    exec.selectFrom("saved_candidates").select("profile_id").where("recruiter_id", "=", recruiter.id).where("profile_id", "=", row.id).executeTakeFirst(),
    exec.selectFrom("approaches").select("id").where("recruiter_id", "=", recruiter.id).where("candidate_id", "=", row.user_id).where("status", "=", "PENDING").executeTakeFirst(),
    exec.selectFrom("approaches").select("responded_at").where("recruiter_id", "=", recruiter.id).where("candidate_id", "=", row.user_id).where("status", "=", "DECLINED").orderBy("responded_at", "desc").executeTakeFirst(),
    exec
      .selectFrom("approaches")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("recruiter_id", "=", recruiter.id)
      .where("created_at", ">=", new Date(new Date().setUTCHours(0, 0, 0, 0)))
      .executeTakeFirstOrThrow(),
    exec
      .selectFrom("contact_unlocks")
      .select("approach_id")
      .where("recruiter_id", "=", recruiter.id)
      .where("candidate_id", "=", row.user_id)
      .where("revoked_at", "is", null)
      .orderBy("created_at", "desc")
      .executeTakeFirst(),
  ]);
  const decision = approachBlock({
    recruiterUserId: viewer.id,
    candidateId: row.user_id,
    profileStatus: row.status,
    // A block would have made the profile a 404 already.
    blocked: false,
    pending: !!pending,
    lastDeclinedAt: lastDeclined?.responded_at ?? null,
    sentToday: Number(sentToday.n),
    quota: recruiter.approach_quota_daily ?? settings.recruiter.approachesPerDay,
    cooldownDays: settings.recruiter.declineCooldownDays,
  });
  const visibleBlock = decision.block === "BLOCKED" || decision.block === "SELF" ? null : decision.block;
  return { saved: !!saved, approachBlockedReason: visibleBlock, cooldownUntil: decision.cooldownUntil?.toISOString() ?? null, unlockedApproachId: unlock?.approach_id ?? null };
}

/** The owner's view: everything, including private contact and the editor's hints. */
export async function presentMyProfile(actor: Actor, ctx: ProfileContext, missing: string[], publishThreshold: number, exec: Executor = db): Promise<MyProfile> {
  const base = await presentProfile(actor, ctx, exec);
  const { row } = ctx;
  return {
    ...base,
    contact: { email: row.contact_email ? String(row.contact_email) : null, phone: row.contact_phone, whatsapp: row.whatsapp_phone },
    openToWorkMode: row.open_to_work,
    openToWorkSettings: { roles: row.open_to_roles, employmentTypes: row.employment_types, workplaceTypes: row.workplace_types, availableFrom: row.available_from ? new Date(row.available_from).toISOString().slice(0, 10) : null },
    sectionVisibility: Object.fromEntries((["experience", "education", "projects", "skills", "certifications", "links"] as const).map((s) => [s, readAudience(row.section_visibility, s)])),
    publishThreshold,
    missing,
  };
}
