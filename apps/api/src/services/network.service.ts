/**
 * The network: connection requests (with an optional note), accept, ignore, withdraw,
 * remove; lists of connections and invitations; people you may know.
 *
 * Rules:
 *   - No requests across a block (404, so the block is not revealed) or to accounts
 *     that are not ACTIVE.
 *   - Two people requesting each other at once is one row (pair_key): the second
 *     request accepts the first.
 *   - An ignored request blocks re-sending for IGNORE_COOLDOWN_DAYS; the requester sees
 *     it as still pending, so ignoring is quiet.
 *   - Sending is rate limited (per day) to keep the graph from being spammed.
 */
import type { NetworkEntry, Page } from "@open-talent/types";
import type { Actor } from "../core/context";
import { requireActive } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest, conflict, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { pairKey } from "../domain/can-message";
import { consume } from "../middleware/rate-limit";
import { loadSummaries, summaryOf } from "../presenters/user.presenter";
import { realtime, rooms } from "../realtime/port";
import { connectionRepo } from "../repositories/connection.repository";
import { decodeTime, encodeTime, pageBy } from "../repositories/keyset";
import { isBlockedEitherWay } from "../repositories/visibility";
import { notify, pushCounts } from "./notification.service";

export const IGNORE_COOLDOWN_DAYS = 21;
const REQUESTS_PER_DAY = 100;

async function activeTarget(actor: Actor, userId: string) {
  if (userId === actor.id) throw badRequest("You cannot connect with yourself", "SELF_ACTION");
  const target = await db.selectFrom("users").select(["id", "status", "username"]).where("id", "=", userId).executeTakeFirst();
  if (!target || target.status !== "ACTIVE" || (await isBlockedEitherWay(actor.id, userId))) throw notFound("User not found");
  return target;
}

export async function connect(actor: Actor, userId: string, note: string | null): Promise<{ state: "PENDING_OUTGOING" | "CONNECTED"; connectionId: string }> {
  requireActive(actor);
  await activeTarget(actor, userId);
  await consume("connection-request", `u:${actor.id}`, REQUESTS_PER_DAY, 86400);
  const result = await withTransaction(async (trx, fx) => {
    const existing = await connectionRepo.lockPair(actor.id, userId, trx);
    if (existing?.status === "ACCEPTED") return { state: "CONNECTED" as const, connectionId: existing.id };
    if (existing?.status === "PENDING" && existing.requester_id === userId) {
      // They asked first: this is an accept.
      await trx.updateTable("connections").set({ status: "ACCEPTED", responded_at: new Date() }).where("id", "=", existing.id).execute();
      await connectionRepo.bumpCount([actor.id, userId], 1, trx);
      await notify({ recipientId: userId, actorId: actor.id, type: "CONNECTION_ACCEPTED", entityType: "user", entityId: actor.id, data: { username: actor.username } }, fx, trx);
      return { state: "CONNECTED" as const, connectionId: existing.id };
    }
    if (existing?.status === "PENDING") return { state: "PENDING_OUTGOING" as const, connectionId: existing.id };
    if (existing?.status === "IGNORED") {
      const waitUntil = (existing.responded_at ?? existing.created_at).getTime() + IGNORE_COOLDOWN_DAYS * 86400_000;
      // Quiet: the requester sees "pending" until the cooldown passes.
      if (existing.requester_id === actor.id && waitUntil > Date.now()) return { state: "PENDING_OUTGOING" as const, connectionId: existing.id };
      await trx.deleteFrom("connections").where("id", "=", existing.id).execute();
    }
    const row = await trx
      .insertInto("connections")
      .values({ id: newId(), pair_key: pairKey(actor.id, userId), requester_id: actor.id, addressee_id: userId, note })
      .onConflict((oc) => oc.column("pair_key").doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!row) throw conflict("Try again", "CONNECTION_RACE");
    await notify({ recipientId: userId, actorId: actor.id, type: "CONNECTION_REQUEST", entityType: "connection", entityId: row.id, snippet: note, data: { username: actor.username } }, fx, trx);
    fx.after(async () => {
      const from = await summaryOf(actor.id);
      if (from) realtime.emit([rooms.user(userId)], "connection:request", { connectionId: row.id, from, note });
    });
    return { state: "PENDING_OUTGOING" as const, connectionId: row.id };
  });
  await pushCounts(userId);
  return result;
}

/** Respond to a request addressed to you. */
export async function respond(actor: Actor, connectionId: string, accept: boolean): Promise<void> {
  requireActive(actor);
  await withTransaction(async (trx, fx) => {
    const row = await trx.selectFrom("connections").selectAll().where("id", "=", connectionId).forUpdate().executeTakeFirst();
    if (!row || row.addressee_id !== actor.id || row.status !== "PENDING") throw notFound("Invitation not found");
    await trx.updateTable("connections").set({ status: accept ? "ACCEPTED" : "IGNORED", responded_at: new Date() }).where("id", "=", row.id).execute();
    if (accept) {
      await connectionRepo.bumpCount([row.requester_id, row.addressee_id], 1, trx);
      await notify({ recipientId: row.requester_id, actorId: actor.id, type: "CONNECTION_ACCEPTED", entityType: "user", entityId: actor.id, data: { username: actor.username } }, fx, trx);
      fx.after(async () => {
        const user = await summaryOf(actor.id);
        if (user) realtime.emit([rooms.user(row.requester_id)], "connection:accepted", { connectionId: row.id, user });
      });
    }
  });
  await pushCounts(actor.id);
}

/** Withdraw your own pending request. */
export async function withdraw(actor: Actor, connectionId: string): Promise<void> {
  const res = await db.deleteFrom("connections").where("id", "=", connectionId).where("requester_id", "=", actor.id).where("status", "in", ["PENDING", "IGNORED"]).returning("addressee_id").executeTakeFirst();
  if (!res) throw notFound("Invitation not found");
  await pushCounts(res.addressee_id);
}

/** Remove a connection (either side). The other person is not notified. */
export async function removeConnection(actor: Actor, userId: string): Promise<void> {
  await withTransaction(async (trx) => {
    const row = await connectionRepo.lockPair(actor.id, userId, trx);
    if (!row || row.status !== "ACCEPTED") throw notFound("Connection not found");
    await trx.deleteFrom("connections").where("id", "=", row.id).execute();
    await connectionRepo.bumpCount([actor.id, userId], -1, trx);
  });
}

async function entries(viewer: Actor | null, rows: { id: string; at: string; connectionId?: string | null; note?: string | null }[]): Promise<NetworkEntry[]> {
  const ids = rows.map((r) => r.id);
  const [users, states, mutual] = await Promise.all([
    loadSummaries(ids),
    viewer ? connectionRepo.states(viewer.id, ids) : Promise.resolve(new Map()),
    viewer ? connectionRepo.mutualCounts(viewer.id, ids) : Promise.resolve(new Map<string, number>()),
  ]);
  const out: NetworkEntry[] = [];
  for (const r of rows) {
    const user = users.get(r.id);
    if (!user) continue;
    const st = states.get(r.id);
    out.push({ user, connection: st?.state ?? "NONE", connectionId: r.connectionId ?? st?.id ?? null, note: r.note ?? st?.note ?? null, mutualCount: mutual.get(r.id) ?? 0, since: r.at });
  }
  return out;
}

export async function connections(viewer: Actor | null, userId: string, q: { cursor?: string; limit: number }): Promise<Page<NetworkEntry>> {
  const rows = await connectionRepo.list(userId, viewer?.id ?? null, decodeTime(q.cursor), q.limit);
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  return { items: await entries(viewer, page.items.map((r) => ({ id: r.id, at: r._at }))), nextCursor: page.nextCursor };
}

export async function invitations(actor: Actor, direction: "received" | "sent", q: { cursor?: string; limit: number }): Promise<Page<NetworkEntry>> {
  const rows = await connectionRepo.pending(actor.id, direction, decodeTime(q.cursor), q.limit);
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  return { items: await entries(actor, page.items.map((r) => ({ id: r.other_id, at: r._at, connectionId: r.id, note: r.note }))), nextCursor: page.nextCursor };
}

export async function suggestions(actor: Actor, limit = 12): Promise<NetworkEntry[]> {
  const rows = await connectionRepo.suggestions(actor.id, limit);
  return entries(
    actor,
    rows.map((r) => ({ id: r.id, at: new Date().toISOString() })),
  );
}

/** Mutual connections between the viewer and someone (the "12 mutual" link on a profile). */
export async function mutual(actor: Actor, userId: string, limit = 20): Promise<NetworkEntry[]> {
  const rows = await db
    .selectFrom("connections as a")
    .innerJoin("connections as b", (j) =>
      j.on((eb) =>
        eb.and([
          eb("b.status", "=", "ACCEPTED"),
          eb.or([
            eb.and([eb("b.requester_id", "=", userId), eb.or([eb("b.addressee_id", "=", eb.ref("a.requester_id")), eb("b.addressee_id", "=", eb.ref("a.addressee_id"))])]),
            eb.and([eb("b.addressee_id", "=", userId), eb.or([eb("b.requester_id", "=", eb.ref("a.requester_id")), eb("b.requester_id", "=", eb.ref("a.addressee_id"))])]),
          ]),
        ]),
      ),
    )
    .select((eb) => eb.case().when("a.requester_id", "=", actor.id).then(eb.ref("a.addressee_id")).else(eb.ref("a.requester_id")).end().as("id"))
    .where("a.status", "=", "ACCEPTED")
    .where((eb) => eb.or([eb("a.requester_id", "=", actor.id), eb("a.addressee_id", "=", actor.id)]))
    .limit(limit)
    .execute();
  const ids = [...new Set(rows.map((r) => r.id).filter((x): x is string => !!x && x !== userId && x !== actor.id))];
  return entries(actor, ids.map((id) => ({ id, at: new Date().toISOString() })));
}
