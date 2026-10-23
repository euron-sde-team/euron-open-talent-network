/**
 * The two visibility rules every read must apply, as reusable Kysely expressions, so
 * no query can forget them:
 *
 *   1. Blocks hide both ways: content by someone you blocked, or who blocked you, is
 *      invisible to you (feed, comments, search, profiles, members, mentions).
 *   2. CONNECTIONS-only posts: readable by the author's connections (and platform
 *      staff, for moderation); everyone else, signed out included, sees PUBLIC posts.
 *
 *   exec.selectFrom("posts")
 *     .where(notBlocked(viewerId, "posts.author_id"))
 *     .where(canReadPost(viewer))
 */
import { sql, type Expression, type ExpressionBuilder, type SqlBool } from "kysely";
import type { Actor } from "../core/context";
import { isStaff } from "../core/context";
import { db, type Executor } from "../db/kysely";
import { pairKey } from "../domain/can-message";
import type { DB } from "../db/types";

type AnyEB = ExpressionBuilder<DB, any>;

/** True unless a block exists between the viewer and the user in `userColumn`. Public viewers see everything. */
export function notBlocked(viewerId: string | null | undefined, userColumn: string) {
  return (eb: AnyEB): Expression<SqlBool> => {
    if (!viewerId) return sql<boolean>`true`;
    const other = sql<string>`${sql.ref(userColumn)}`;
    return eb.not(
      eb.exists(
        eb
          .selectFrom("blocks")
          .select(sql`1`.as("x"))
          .where((w) =>
            w.or([
              w.and([w("blocks.blocker_id", "=", viewerId), w("blocks.blocked_id", "=", other)]),
              w.and([w("blocks.blocked_id", "=", viewerId), w("blocks.blocker_id", "=", other)]),
            ]),
          ),
      ),
    );
  };
}

/**
 * The viewer may read the post in `postAlias`: it is PUBLIC, or it is CONNECTIONS-only
 * and the viewer is its author or connected to the author, or the viewer is staff.
 * Signed-out readers see PUBLIC posts only.
 */
export function canReadPost(viewer: Actor | null | undefined, postAlias = "posts") {
  return (eb: AnyEB): Expression<SqlBool> => {
    const author = sql<string>`${sql.ref(`${postAlias}.author_id`)}`;
    const isPublic = sql<boolean>`${sql.ref(`${postAlias}.visibility`)} = 'PUBLIC'`;
    if (!viewer) return isPublic;
    if (isStaff(viewer)) return sql<boolean>`true`;
    return eb.or([
      isPublic,
      sql<boolean>`${author} = ${viewer.id}`,
      eb.exists(
        eb
          .selectFrom("connections as vk")
          .select(sql`1`.as("x"))
          .where("vk.status", "=", "ACCEPTED")
          .where("vk.pair_key", "=", sql<string>`CASE WHEN ${viewer.id} < ${author} THEN ${viewer.id} || ':' || ${author} ELSE ${author} || ':' || ${viewer.id} END`),
      ),
    ]);
  };
}

export async function isBlockedEitherWay(a: string, b: string, exec: Executor = db): Promise<boolean> {
  const row = await exec
    .selectFrom("blocks")
    .select("blocker_id")
    .where((w) => w.or([w.and([w("blocker_id", "=", a), w("blocked_id", "=", b)]), w.and([w("blocker_id", "=", b), w("blocked_id", "=", a)])]))
    .executeTakeFirst();
  return !!row;
}

/** Ids of everyone the viewer has blocked or been blocked by (for filtering small in-memory lists). */
export async function blockedSet(viewerId: string, exec: Executor = db): Promise<Set<string>> {
  const rows = await exec
    .selectFrom("blocks")
    .select(["blocker_id", "blocked_id"])
    .where((w) => w.or([w("blocker_id", "=", viewerId), w("blocked_id", "=", viewerId)]))
    .execute();
  return new Set(rows.map((r) => (r.blocker_id === viewerId ? r.blocked_id : r.blocker_id)));
}

export async function areConnected(a: string, b: string, exec: Executor = db): Promise<boolean> {
  const row = await exec.selectFrom("connections").select("id").where("pair_key", "=", pairKey(a, b)).where("status", "=", "ACCEPTED").executeTakeFirst();
  return !!row;
}

/** Ids among `others` that are connected to `viewerId`. */
export async function connectedSet(viewerId: string, others: readonly string[], exec: Executor = db): Promise<Set<string>> {
  if (!others.length) return new Set();
  const keys = [...new Set(others)].filter((o) => o !== viewerId).map((o) => pairKey(viewerId, o));
  if (!keys.length) return new Set();
  const rows = await exec.selectFrom("connections").select(["requester_id", "addressee_id"]).where("pair_key", "in", keys).where("status", "=", "ACCEPTED").execute();
  return new Set(rows.map((r) => (r.requester_id === viewerId ? r.addressee_id : r.requester_id)));
}
