import type { Me, UserSummary } from "@open-talent/types";
import { type Executor, db } from "../db/kysely";
import { userRepo, type SummaryRow, type UserRow } from "../repositories/user.repository";
import { loadMedia, urlOf } from "./media.presenter";

export type { SummaryRow };

/**
 * The member card. `openToWork` is the public signal only; the recruiter-only mode is
 * revealed by the profile and directory presenters, which know who is looking.
 */
export function toSummary(row: SummaryRow, avatarUrl: string | null): UserSummary {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl,
    headline: row.headline,
    role: row.role,
    openToWork: row.open_to_work === "PUBLIC",
    recruiterAt: row.recruiter_company_slug && row.recruiter_company_name ? { slug: row.recruiter_company_slug, name: row.recruiter_company_name } : null,
  };
}

/** Batch-load UserSummary DTOs for a set of user ids. */
export async function loadSummaries(ids: readonly (string | null | undefined)[], exec: Executor = db): Promise<Map<string, UserSummary>> {
  const wanted = ids.filter((x): x is string => !!x);
  const rows = await userRepo.findSummaries(wanted, exec);
  const media = await loadMedia(rows.map((r) => r.avatar_upload_id), exec);
  return new Map(rows.map((r) => [r.id, toSummary(r, urlOf(media, r.avatar_upload_id, "thumb"))]));
}

export async function summaryOf(id: string, exec: Executor = db): Promise<UserSummary | null> {
  return (await loadSummaries([id], exec)).get(id) ?? null;
}

export async function toMe(row: UserRow, exec: Executor = db): Promise<Me> {
  const [summary, extra] = await Promise.all([
    summaryOf(row.id, exec),
    exec
      .selectFrom("talent_profiles as p")
      .leftJoin("recruiters as r", "r.user_id", "p.user_id")
      .leftJoin("companies as c", "c.id", "r.company_id")
      .select(["p.status as profile_status", "p.completeness", "r.id as recruiter_id", "r.status as recruiter_status", "r.role as recruiter_role", "c.id as company_id", "c.slug as company_slug", "c.name as company_name", "c.logo_upload_id", "c.status as company_status"])
      .where("p.user_id", "=", row.id)
      .executeTakeFirst(),
  ]);
  const logos = await loadMedia([extra?.logo_upload_id], exec);
  return {
    ...(summary as UserSummary),
    email: row.email,
    status: row.status,
    suspendedUntil: row.status === "SUSPENDED" && row.suspended_until ? row.suspended_until.toISOString() : null,
    emailVerified: !!row.email_verified_at,
    totpEnabled: row.totp_enabled,
    messageRequestPolicy: row.message_request_policy,
    emailDigest: row.email_digest,
    profileStatus: extra?.profile_status ?? "DRAFT",
    profileCompleteness: extra?.completeness ?? 0,
    recruiter:
      extra?.recruiter_id && extra.recruiter_status && extra.recruiter_role && extra.company_id && extra.company_slug && extra.company_name && extra.company_status
        ? {
            id: extra.recruiter_id,
            status: extra.recruiter_status,
            role: extra.recruiter_role,
            company: { id: extra.company_id, slug: extra.company_slug, name: extra.company_name, logoUrl: urlOf(logos, extra.logo_upload_id, "thumb"), status: extra.company_status },
          }
        : null,
    connectionCount: row.connection_count,
  };
}
