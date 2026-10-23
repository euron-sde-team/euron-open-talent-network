/**
 * Notification rows to DTOs. A snippet quotes content, so it is withheld when it came
 * from a CONNECTIONS-only post whose author the recipient is no longer connected to.
 */
import type { Notification } from "@open-talent/types";
import type { Selectable } from "kysely";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { Notifications } from "../db/types";
import { connectedSet } from "../repositories/visibility";
import { hrefFor } from "../services/notification.service";
import { loadSummaries } from "./user.presenter";

export type NotificationRow = Selectable<Notifications>;

function postIdOf(r: NotificationRow): string | null {
  const d = (r.data ?? {}) as Record<string, unknown>;
  if (typeof d.postId === "string") return d.postId;
  return r.entity_type === "post" ? r.entity_id : null;
}

export async function presentNotifications(viewer: Actor, rows: readonly NotificationRow[], exec: Executor = db): Promise<Notification[]> {
  if (!rows.length) return [];
  const postIds = [...new Set(rows.map(postIdOf).filter((x): x is string => !!x))];
  const [actors, posts] = await Promise.all([
    loadSummaries(rows.map((r) => r.actor_id), exec),
    postIds.length ? exec.selectFrom("posts").select(["id", "author_id", "visibility"]).where("id", "in", postIds).execute() : Promise.resolve([]),
  ]);
  const restricted = posts.filter((p) => p.visibility === "CONNECTIONS" && p.author_id !== viewer.id);
  const connected = await connectedSet(viewer.id, restricted.map((p) => p.author_id), exec);
  const hiddenPosts = new Set(restricted.filter((p) => !connected.has(p.author_id)).map((p) => p.id));
  return rows.map((r) => {
    const pid = postIdOf(r);
    return {
      id: r.id,
      type: r.type,
      actor: r.actor_id ? (actors.get(r.actor_id) ?? null) : null,
      entityType: r.entity_type,
      entityId: r.entity_id,
      snippet: pid && hiddenPosts.has(pid) ? null : r.snippet,
      href: hrefFor(r),
      readAt: r.read_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
    };
  });
}
