/**
 * Talent profiles and their sections. A section save replaces the whole list in one
 * transaction (positions are the list order), then `refreshDerived` rebuilds the
 * denormalised search text, the skill array and the completeness score from the rows,
 * so search and the progress ring can never drift from what is on the page.
 */
import type { Insertable, Selectable, Updateable } from "kysely";
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";
import type {
  ProfileCertifications,
  ProfileEducations,
  ProfileExperiences,
  ProfileLinks,
  ProfileProjects,
  ProfileSkills,
  TalentProfiles,
} from "../db/types";
import type { ProfileSection } from "@open-talent/types";
import { completeness, readAudience } from "../domain/profile";

export type ProfileRow = Selectable<TalentProfiles>;
export type ExperienceRow = Selectable<ProfileExperiences>;
export type EducationRow = Selectable<ProfileEducations>;
export type ProjectRow = Selectable<ProfileProjects>;
export type SkillRow = Selectable<ProfileSkills>;
export type CertificationRow = Selectable<ProfileCertifications>;
export type LinkRow = Selectable<ProfileLinks>;

export interface Sections {
  experience: ExperienceRow[];
  education: EducationRow[];
  projects: ProjectRow[];
  skills: SkillRow[];
  certifications: CertificationRow[];
  links: LinkRow[];
}

type SectionTable = "profile_experiences" | "profile_educations" | "profile_projects" | "profile_skills" | "profile_certifications" | "profile_links";

export async function usernameHeldByHistory(username: string, exec: Executor = db): Promise<boolean> {
  return !!(await exec.selectFrom("username_history").select("user_id").where("old_username", "=", username).executeTakeFirst());
}

export class ProfileRepository {
  byUserId(userId: string, exec: Executor = db) {
    return exec.selectFrom("talent_profiles").selectAll().where("user_id", "=", userId).executeTakeFirst();
  }

  byId(id: string, exec: Executor = db) {
    return exec.selectFrom("talent_profiles").selectAll().where("id", "=", id).executeTakeFirst();
  }

  lockByUserId(userId: string, exec: Executor) {
    return exec.selectFrom("talent_profiles").selectAll().where("user_id", "=", userId).forUpdate().executeTakeFirst();
  }

  /** The profile and its owner by current username, or the user a renamed handle now belongs to. */
  async byUsername(username: string, exec: Executor = db) {
    const row = await exec
      .selectFrom("users as u")
      .innerJoin("talent_profiles as p", "p.user_id", "u.id")
      .selectAll("p")
      .select(["u.username", "u.display_name", "u.status as user_status", "u.role", "u.avatar_upload_id", "u.cover_upload_id", "u.connection_count", "u.follower_count"])
      .where("u.username", "=", username)
      .executeTakeFirst();
    if (row) return { row, renamedTo: null };
    const moved = await exec
      .selectFrom("username_history as h")
      .innerJoin("users as u", "u.id", "h.user_id")
      .select("u.username")
      .where("h.old_username", "=", username)
      .executeTakeFirst();
    return { row: undefined, renamedTo: moved ? String(moved.username) : null };
  }

  update(id: string, patch: Updateable<TalentProfiles>, exec: Executor = db) {
    return exec
      .updateTable("talent_profiles")
      .set({ ...patch, updated_at: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async sections(profileId: string, exec: Executor = db): Promise<Sections> {
    const [experience, education, projects, skills, certifications, links] = await Promise.all([
      exec.selectFrom("profile_experiences").selectAll().where("profile_id", "=", profileId).orderBy("position").execute(),
      exec.selectFrom("profile_educations").selectAll().where("profile_id", "=", profileId).orderBy("position").execute(),
      exec.selectFrom("profile_projects").selectAll().where("profile_id", "=", profileId).orderBy("position").execute(),
      exec.selectFrom("profile_skills").selectAll().where("profile_id", "=", profileId).orderBy("position").execute(),
      exec.selectFrom("profile_certifications").selectAll().where("profile_id", "=", profileId).orderBy("position").execute(),
      exec.selectFrom("profile_links").selectAll().where("profile_id", "=", profileId).orderBy("position").execute(),
    ]);
    return { experience, education, projects, skills, certifications, links };
  }

  badges(profileId: string, exec: Executor = db) {
    return exec.selectFrom("profile_badges").selectAll().where("profile_id", "=", profileId).orderBy("created_at").execute();
  }

  /**
   * Replace a section. Skills keep their ids (and so their endorsements) when the same
   * name is saved again; every other section is rewritten.
   */
  async replace(table: SectionTable, profileId: string, rows: Record<string, unknown>[], exec: Executor): Promise<void> {
    if (table === "profile_skills") {
      const keep = rows.map((r) => String(r.name).toLowerCase());
      await sql`DELETE FROM profile_skills WHERE profile_id = ${profileId} AND NOT (lower(name::text) = ANY(${keep}::text[]))`.execute(exec);
      for (const [i, r] of rows.entries()) {
        await exec
          .insertInto("profile_skills")
          .values({ ...(r as Insertable<ProfileSkills>), profile_id: profileId, position: i })
          .onConflict((oc) => oc.columns(["profile_id", "name"]).doUpdateSet({ category: r.category as string | null, years: r.years as number | null, position: i }))
          .execute();
      }
      return;
    }
    await exec.deleteFrom(table).where("profile_id", "=", profileId).execute();
    if (rows.length) await exec.insertInto(table).values(rows.map((r, i) => ({ ...r, profile_id: profileId, position: i })) as never).execute();
  }

  /** Rebuild search_text, skill_names and completeness from the rows (inside the caller's transaction). */
  async refreshDerived(profileId: string, exec: Executor): Promise<{ score: number; missing: string[] }> {
    const profile = await exec
      .selectFrom("talent_profiles as p")
      .innerJoin("users as u", "u.id", "p.user_id")
      .select(["p.id", "p.headline", "p.about", "p.contact_email", "p.contact_phone", "p.whatsapp_phone", "p.section_visibility", "u.avatar_upload_id"])
      .where("p.id", "=", profileId)
      .executeTakeFirstOrThrow();
    const s = await this.sections(profileId, exec);
    // Full-text search is open to everyone, so it only indexes sections whose audience is
    // PUBLIC: matching on a hidden section would let a search reveal what it hides.
    const open = (section: ProfileSection) => readAudience(profile.section_visibility, section) === "PUBLIC";
    const text = [
      ...(open("experience") ? s.experience.flatMap((e) => [e.title, e.company_name, e.location, e.description, ...e.skills]) : []),
      ...(open("education") ? s.education.flatMap((e) => [e.institution, e.degree, e.field]) : []),
      ...(open("projects") ? s.projects.flatMap((p) => [p.name, p.description, ...p.skills]) : []),
      ...(open("skills") ? s.skills.map((k) => String(k.name)) : []),
      ...(open("certifications") ? s.certifications.flatMap((c) => [c.name, c.issuer]) : []),
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 20000);
    const result = completeness({
      headline: !!profile.headline?.trim(),
      about: !!profile.about?.trim(),
      avatar: !!profile.avatar_upload_id,
      skills: s.skills.length > 0,
      experience: s.experience.length > 0,
      projects: s.projects.length > 0,
      education: s.education.length > 0,
      links: s.links.length > 0,
      contact: !!(profile.contact_email || profile.contact_phone || profile.whatsapp_phone),
    });
    await exec
      .updateTable("talent_profiles")
      .set({
        search_text: text,
        skill_names: s.skills.map((k) => String(k.name)),
        completeness: result.score,
        updated_at: new Date(),
      })
      .where("id", "=", profileId)
      .execute();
    return result;
  }

  async recordView(row: { profile_id: string; viewer_key: string; viewer_id: string | null; viewer_company: string | null }, exec: Executor = db): Promise<boolean> {
    const day = new Date().toISOString().slice(0, 10);
    const inserted = await exec
      .insertInto("profile_views")
      .values({ ...row, day })
      .onConflict((oc) => oc.columns(["profile_id", "viewer_key", "day"]).doNothing())
      .returning("profile_id")
      .executeTakeFirst();
    if (inserted) await exec.updateTable("talent_profiles").set({ view_count: sql`view_count + 1` }).where("id", "=", row.profile_id).execute();
    return !!inserted;
  }
}

export const profileRepo = new ProfileRepository();
