/**
 * The account and the light parts of the graph: your own settings (name, photo, cover,
 * who may send you message requests, digests), follows, blocks and sessions. The talent
 * page lives in profile.service.ts, connections in network.service.ts.
 *
 * A block in either direction makes a profile (and everything under it) a 404, never a
 * 403, so a blocked person cannot even confirm the account exists. Blocking also ends
 * follows, the connection, contact unlocks and pending approaches (block.repository).
 */
import type { FollowEntry, Me, MessageRequestPolicy, UserSummary } from "@open-talent/types";
import type { Actor, RequestMeta } from "../core/context";
import { requireActive } from "../core/context";
import { withEffects, withTransaction, type Effects } from "../core/effects";
import { badRequest, notFound } from "../core/errors";
import { db } from "../db/kysely";
import { pairKey } from "../domain/can-message";
import { cleanDisplayName } from "../domain/display-name";
import { loadSummaries, toMe } from "../presenters/user.presenter";
import { rooms } from "../realtime/port";
import { blockRepo } from "../repositories/block.repository";
import { dmRepo } from "../repositories/dm.repository";
import { followRepo } from "../repositories/follow.repository";
import { decodeTime, encodeTime, pageBy, type Paged } from "../repositories/keyset";
import { profileRepo } from "../repositories/profile.repository";
import { sessionRepo } from "../repositories/session.repository";
import { userRepo, type UserRow } from "../repositories/user.repository";
import { isBlockedEitherWay } from "../repositories/visibility";
import { audit } from "./audit.service";
import { claimSingle } from "./media-attach.service";
import { notify } from "./notification.service";

const VISIBLE_STATUSES = new Set(["ACTIVE", "SUSPENDED"]);

/** A person the viewer may see, by username or id. 404 on unknown, gone or blocked. */
export async function visibleUser(viewer: Actor | null, by: { username?: string; id?: string }): Promise<UserRow> {
  const user = by.username ? await userRepo.findByUsername(by.username) : await userRepo.findById(by.id as string);
  if (!user || !VISIBLE_STATUSES.has(user.status)) throw notFound("User not found");
  if (viewer && viewer.id !== user.id && (await isBlockedEitherWay(viewer.id, user.id))) throw notFound("User not found");
  return user;
}

export async function me(actor: Actor): Promise<Me> {
  const row = await userRepo.findById(actor.id);
  if (!row) throw notFound("User not found");
  return toMe(row);
}

/** Followers or followees, each with `viewerFollows` (false when signed out, and for the viewer's own row). */
export async function follows(viewer: Actor | null, username: string, direction: "followers" | "following", q: { cursor?: string; limit: number }): Promise<Paged<FollowEntry>> {
  const user = await visibleUser(viewer, { username });
  const rows = await followRepo.list(user.id, direction, viewer?.id ?? null, decodeTime(q.cursor), q.limit);
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  const ids = page.items.map((r) => r.id);
  const [users, followed] = await Promise.all([loadSummaries(ids), viewer ? followRepo.followedAmong(viewer.id, ids) : Promise.resolve(new Set<string>())]);
  const items: FollowEntry[] = [];
  for (const id of ids) {
    const u = users.get(id);
    if (u) items.push({ ...u, viewerFollows: id !== viewer?.id && followed.has(id) });
  }
  return { items, nextCursor: page.nextCursor };
}

export async function follow(actor: Actor, userId: string): Promise<void> {
  requireActive(actor);
  if (userId === actor.id) throw badRequest("You cannot follow yourself", "SELF_ACTION");
  const target = await visibleUser(actor, { id: userId });
  if (target.status !== "ACTIVE") throw notFound("User not found");
  await withTransaction(async (trx, fx: Effects) => {
    if (await followRepo.follow(actor.id, target.id, trx)) {
      await notify({ recipientId: target.id, actorId: actor.id, type: "FOLLOW", entityType: "user", entityId: actor.id, data: { username: actor.username } }, fx, trx);
    }
  });
}

export async function unfollow(actor: Actor, userId: string): Promise<void> {
  await withTransaction((trx) => followRepo.unfollow(actor.id, userId, trx));
}

/** Block someone. Their 1:1 conversation's live room is closed for both sides at once. */
export async function block(actor: Actor, userId: string, meta: RequestMeta): Promise<void> {
  if (userId === actor.id) throw badRequest("You cannot block yourself", "SELF_ACTION");
  const target = await userRepo.findById(userId);
  if (!target) throw notFound("User not found");
  await withTransaction(async (trx, fx) => {
    await blockRepo.block(actor.id, target.id, trx);
    await audit({ actorId: actor.id, action: "user.block", entityType: "user", entityId: target.id, ip: meta.ip }, trx);
    const direct = await dmRepo.findDirect(pairKey(actor.id, target.id), trx);
    if (direct) fx.leave([actor.id, target.id], [rooms.thread(direct.id)]);
  });
}

export async function unblock(actor: Actor, userId: string): Promise<void> {
  await blockRepo.unblock(actor.id, userId);
}

export async function blocks(actor: Actor): Promise<UserSummary[]> {
  const ids = await blockRepo.blockedBy(actor.id);
  const users = await loadSummaries(ids);
  return ids.map((id) => users.get(id)).filter((u): u is UserSummary => !!u);
}

export interface AccountPatch {
  displayName?: string;
  avatarUploadId?: string | null;
  coverUploadId?: string | null;
  messageRequestPolicy?: MessageRequestPolicy;
  emailDigest?: boolean;
}

export async function updateMe(actor: Actor, patch: AccountPatch): Promise<Me> {
  requireActive(actor);
  let displayName: string | undefined;
  if (patch.displayName !== undefined) {
    const cleaned = cleanDisplayName(patch.displayName);
    if (!cleaned) throw badRequest("Use your name, not an email address or phone number", "DISPLAY_NAME_INVALID");
    displayName = cleaned;
  }
  const avatar = patch.avatarUploadId === undefined ? undefined : await claimSingle(actor.id, patch.avatarUploadId, "AVATAR");
  const cover = patch.coverUploadId === undefined ? undefined : await claimSingle(actor.id, patch.coverUploadId, "COVER");
  const row = await withEffects(async (fx) => {
    const updated = await userRepo.update(actor.id, {
      ...(displayName !== undefined ? { display_name: displayName } : {}),
      ...(patch.messageRequestPolicy !== undefined ? { message_request_policy: patch.messageRequestPolicy } : {}),
      ...(avatar !== undefined ? { avatar_upload_id: avatar } : {}),
      ...(cover !== undefined ? { cover_upload_id: cover } : {}),
      ...(patch.emailDigest !== undefined ? { email_digest: patch.emailDigest } : {}),
    });
    // The name and photo are public: a REVIEW case for a moderator, never an automatic hide.
    if (updated && (displayName !== undefined || avatar !== undefined)) fx.job("moderation.scan", { targetType: "USER", targetId: actor.id });
    return updated;
  });
  if (!row) throw notFound("User not found");
  // The photo counts toward profile completeness.
  if (avatar !== undefined) {
    const profile = await profileRepo.byUserId(actor.id);
    if (profile) await withTransaction((trx) => profileRepo.refreshDerived(profile.id, trx));
  }
  return toMe(row);
}

/**
 * Active sessions. The access token does not name its session, so `current` marks the
 * most recently used session from this browser (same user agent).
 */
export async function sessions(actor: Actor, meta: RequestMeta) {
  const rows = await sessionRepo.listActive(actor.id);
  const currentId = rows.find((r) => r.user_agent === (meta.userAgent?.slice(0, 300) ?? null))?.id ?? null;
  return rows.map((r) => ({
    id: r.id,
    userAgent: r.user_agent,
    ip: r.ip,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at.toISOString(),
    current: r.id === currentId,
  }));
}

export async function revokeSession(actor: Actor, sessionId: string, meta: RequestMeta): Promise<void> {
  const row = await db.selectFrom("sessions").select(["id", "family_id"]).where("id", "=", sessionId).where("user_id", "=", actor.id).where("revoked_at", "is", null).executeTakeFirst();
  if (!row) throw notFound("Session not found");
  await sessionRepo.revokeFamily(row.family_id);
  await audit({ actorId: actor.id, action: "session.revoke", entityType: "session", entityId: row.id, ip: meta.ip });
}
