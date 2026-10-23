/**
 * maintenance.talent-housekeeping (every 15 minutes, worker.ts). Each step is a
 * conditional UPDATE, so running twice (or on two workers) is harmless:
 *   - pending approaches past expires_at become EXPIRED
 *   - an engagement whose completion was requested and not answered within
 *     trust.autoConfirmDays completes
 *   - ratings of engagements whose window closed are revealed
 *   - AI import input older than import.retentionHours is purged
 *   - recruiter email codes past their expiry are deleted
 */
import { sql } from "kysely";
import { withTransaction } from "../core/effects";
import { db } from "../db/kysely";
import { purgeExpired } from "./import.service";
import { getSettings } from "./settings.service";
import { revealRatings } from "./trust.service";

export async function runHousekeeping(): Promise<Record<string, number>> {
  const settings = await getSettings();
  const out: Record<string, number> = {};

  const expired = await db.updateTable("approaches").set({ status: "EXPIRED" }).where("status", "=", "PENDING").where("expires_at", "<=", new Date()).executeTakeFirst();
  out.approachesExpired = Number(expired.numUpdatedRows);

  const completed = await db
    .updateTable("engagements")
    .set({ status: "COMPLETED", completed_at: new Date(), updated_at: new Date() })
    .where("status", "=", "ACTIVE")
    .where("completion_requested_at", "<", new Date(Date.now() - settings.trust.autoConfirmDays * 86400_000))
    .executeTakeFirst();
  out.engagementsAutoCompleted = Number(completed.numUpdatedRows);

  const due = await sql<{ engagement_id: string }>`
    SELECT DISTINCT r.engagement_id FROM ratings r JOIN engagements e ON e.id = r.engagement_id
     WHERE r.revealed_at IS NULL AND e.completed_at < now() - make_interval(days => ${settings.trust.ratingWindowDays})
     LIMIT 500`.execute(db);
  for (const { engagement_id } of due.rows) await withTransaction((trx, fx) => revealRatings(engagement_id, trx, fx));
  out.ratingsRevealed = due.rows.length;

  out.importsPurged = await purgeExpired();

  const codes = await db.deleteFrom("recruiter_email_codes").where("expires_at", "<", new Date(Date.now() - 86400_000)).executeTakeFirst();
  out.codesDeleted = Number(codes.numDeletedRows);
  return out;
}
