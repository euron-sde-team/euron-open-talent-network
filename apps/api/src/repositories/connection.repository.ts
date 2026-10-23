/**
 * Connections: one row per pair (pair_key), PENDING until the addressee accepts.
 * users.connection_count moves in the same transaction as the accept or the removal.
 *
 * An IGNORED request stays on record so the requester cannot re-send immediately (the
 * service enforces the cooldown); the addressee never sees it again.
 */
import type { ConnectionState } from "@open-talent/types";
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";
import { pairKey } from "../domain/can-message";
import { atKey, olderThan, type TimeKey } from "./keyset";
import { notBlocked } from "./visibility";

export class ConnectionRepository {
  byPair(a: string, b: string, exec: Executor = db) {
    return exec.selectFrom("connections").selectAll().where("pair_key", "=", pairKey(a, b)).executeTakeFirst();
  }

  lockPair(a: string, b: string, exec: Executor) {
    return exec.selectFrom("connections").selectAll().where("pair_key", "=", pairKey(a, b)).forUpdate().executeTakeFirst();
  }

  byId(id: string, exec: Executor = db) {
    return exec.selectFrom("connections").selectAll().where("id", "=", id).executeTakeFirst();
  }

  /** The viewer's relationship with each of `others`, and the connection id when pending. */
  async states(viewerId: string, others: readonly string[], exec: Executor = db): Promise<Map<string, { state: ConnectionState; id: string | null; note: string | null }>> {
    const out = new Map<string, { state: ConnectionState; id: string | null; note: string | null }>();
    const ids = [...new Set(others)];
    for (const id of ids) out.set(id, { state: id === viewerId ? "SELF" : "NONE", id: null, note: null });
    const keys = ids.filter((o) => o !== viewerId).map((o) => pairKey(viewerId, o));
    if (!keys.length) return out;
    const rows = await exec.selectFrom("connections").select(["id", "requester_id", "addressee_id", "status", "note"]).where("pair_key", "in", keys).execute();
    for (const r of rows) {
      const other = r.requester_id === viewerId ? r.addressee_id : r.requester_id;
      if (r.status === "ACCEPTED") out.set(other, { state: "CONNECTED", id: r.id, note: null });
      else if (r.status === "PENDING") out.set(other, { state: r.requester_id === viewerId ? "PENDING_OUTGOING" : "PENDING_INCOMING", id: r.id, note: r.note });
      // IGNORED reads as NONE for both sides (the requester is not told).
      else if (r.requester_id === viewerId) out.set(other, { state: "PENDING_OUTGOING", id: r.id, note: r.note });
    }
    return out;
  }

  /** Mutual connections between the viewer and each of `others`. */
  async mutualCounts(viewerId: string, others: readonly string[], exec: Executor = db): Promise<Map<string, number>> {
    const ids = [...new Set(others)].filter((o) => o !== viewerId);
    if (!ids.length) return new Map();
    const r = await sql<{ other: string; n: number }>`
      WITH mine AS (
        SELECT CASE WHEN requester_id = ${viewerId} THEN addressee_id ELSE requester_id END AS uid
          FROM connections WHERE status = 'ACCEPTED' AND (requester_id = ${viewerId} OR addressee_id = ${viewerId})
      )
      SELECT o.other, count(*)::int AS n FROM unnest(${ids}::text[]) AS o(other)
        JOIN connections k ON k.status = 'ACCEPTED' AND (k.requester_id = o.other OR k.addressee_id = o.other)
        JOIN mine m ON m.uid = CASE WHEN k.requester_id = o.other THEN k.addressee_id ELSE k.requester_id END
       GROUP BY o.other`.execute(exec);
    return new Map(r.rows.map((x) => [x.other, Number(x.n)]));
  }

  /** Accepted connections of a user, newest first, minus anyone the viewer has a block with. */
  list(userId: string, viewerId: string | null, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    const other = sql<string>`CASE WHEN k.requester_id = ${userId} THEN k.addressee_id ELSE k.requester_id END`;
    return exec
      .selectFrom("connections as k")
      .innerJoin("users as u", (j) => j.on(sql<boolean>`u.id = ${other}`))
      .select(["u.id", "k.responded_at", "k.id as connection_id"])
      .select(atKey("k.responded_at"))
      .where("k.status", "=", "ACCEPTED")
      .where((eb) => eb.or([eb("k.requester_id", "=", userId), eb("k.addressee_id", "=", userId)]))
      .where("u.status", "in", ["ACTIVE", "SUSPENDED"])
      .where(notBlocked(viewerId, "u.id"))
      .where(olderThan("k.responded_at", "u.id", cursor))
      .orderBy("k.responded_at", "desc")
      .orderBy("u.id", "desc")
      .limit(limit + 1)
      .execute();
  }

  /** Pending invitations: received (to the user) or sent (by the user). */
  pending(userId: string, direction: "received" | "sent", cursor: TimeKey | null, limit: number, exec: Executor = db) {
    const self = direction === "received" ? "k.addressee_id" : "k.requester_id";
    const other = direction === "received" ? "k.requester_id" : "k.addressee_id";
    return exec
      .selectFrom("connections as k")
      .innerJoin("users as u", "u.id", other)
      .select(["k.id", "k.note", "k.created_at", sql<string>`${sql.ref(other)}`.as("other_id")])
      .select(atKey("k.created_at"))
      .where(self, "=", userId)
      .where("k.status", "=", "PENDING")
      .where("u.status", "=", "ACTIVE")
      .where(notBlocked(userId, other))
      .where(olderThan("k.created_at", "k.id", cursor))
      .orderBy("k.created_at", "desc")
      .orderBy("k.id", "desc")
      .limit(limit + 1)
      .execute();
  }

  async bumpCount(userIds: string[], delta: number, exec: Executor): Promise<void> {
    await exec.updateTable("users").set({ connection_count: sql`greatest(0, connection_count + ${delta})` }).where("id", "in", userIds).execute();
  }

  /**
   * People you may know: second-degree connections ranked by mutual count, then people
   * at the same current company, then people sharing your skills. Never yourself, your
   * connections, pending invitations either way, or anyone with a block.
   */
  async suggestions(userId: string, limit: number, exec: Executor = db): Promise<{ id: string; mutual: number }[]> {
    const r = await sql<{ id: string; mutual: number }>`
      WITH mine AS (
        SELECT CASE WHEN requester_id = ${userId} THEN addressee_id ELSE requester_id END AS uid
          FROM connections WHERE status = 'ACCEPTED' AND (requester_id = ${userId} OR addressee_id = ${userId})
      ), me AS (
        SELECT current_company, skill_names FROM talent_profiles WHERE user_id = ${userId}
      ), second AS (
        SELECT CASE WHEN k.requester_id = m.uid THEN k.addressee_id ELSE k.requester_id END AS uid, count(*)::int AS mutual
          FROM mine m JOIN connections k ON k.status = 'ACCEPTED' AND (k.requester_id = m.uid OR k.addressee_id = m.uid)
         GROUP BY 1
      ), pool AS (
        SELECT uid, mutual, 3 AS tier FROM second
        UNION ALL
        SELECT p.user_id, 0, 2 FROM talent_profiles p, me
         WHERE me.current_company IS NOT NULL AND p.current_company = me.current_company
        UNION ALL
        SELECT p.user_id, 0, 1 FROM talent_profiles p, me
         WHERE p.status = 'PUBLISHED' AND p.skill_names && me.skill_names
      ), ranked AS (
        SELECT uid, max(mutual) AS mutual, max(tier) AS tier FROM pool GROUP BY uid
      )
      SELECT r.uid AS id, r.mutual FROM ranked r JOIN users u ON u.id = r.uid
       WHERE r.uid <> ${userId} AND u.status = 'ACTIVE'
         AND NOT EXISTS (SELECT 1 FROM mine WHERE mine.uid = r.uid)
         AND NOT EXISTS (SELECT 1 FROM connections c WHERE c.pair_key = CASE WHEN ${userId} < r.uid THEN ${userId} || ':' || r.uid ELSE r.uid || ':' || ${userId} END)
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${userId} AND b.blocked_id = r.uid) OR (b.blocked_id = ${userId} AND b.blocker_id = r.uid))
       ORDER BY r.tier DESC, r.mutual DESC, u.connection_count DESC, r.uid
       LIMIT ${limit}`.execute(exec);
    return r.rows.map((x) => ({ id: x.id, mutual: Number(x.mutual) }));
  }
}

export const connectionRepo = new ConnectionRepository();
