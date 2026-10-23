/**
 * DM thread rows to `Thread` DTOs for one viewer. Batched: participants, last messages,
 * unread counts, context labels and the canMessage facts behind `canSend` are a handful
 * of queries for the whole page, never per thread.
 *
 * `canSend` is computed with the same rules the send endpoint enforces
 * (domain/dm-send.ts), from fresh facts, so the composer and the API never disagree.
 */
import type { Thread, ThreadParticipant } from "@open-talent/types";
import type { Selectable } from "kysely";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { DmThreads } from "../db/types";
import { directSendDecision, type ParticipantState } from "../domain/dm-send";
import { dmRepo } from "../repositories/dm.repository";
import { messagingDecisions } from "../repositories/messaging-facts";
import { getSettings } from "../services/settings.service";
import { presentMessages } from "./message.presenter";
import { loadSummaries } from "./user.presenter";

type ThreadRow = Selectable<DmThreads>;

/** "Senior Engineer at Northwind Labs" for approach and application threads. */
async function contextLabels(threads: readonly ThreadRow[], exec: Executor): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const approachIds = threads.filter((t) => t.context === "APPROACH" && t.context_id).map((t) => t.context_id as string);
  const applicationIds = threads.filter((t) => t.context === "APPLICATION" && t.context_id).map((t) => t.context_id as string);
  const [approaches, applications] = await Promise.all([
    approachIds.length ? exec.selectFrom("approaches as a").innerJoin("companies as c", "c.id", "a.company_id").select(["a.id", "a.role_title", "c.name"]).where("a.id", "in", approachIds).execute() : Promise.resolve([]),
    applicationIds.length
      ? exec.selectFrom("applications as a").innerJoin("jobs as j", "j.id", "a.job_id").innerJoin("companies as c", "c.id", "a.company_id").select(["a.id", "j.title", "c.name"]).where("a.id", "in", applicationIds).execute()
      : Promise.resolve([]),
  ]);
  const label = new Map<string, string>([...approaches.map((a) => [a.id, `${a.role_title} at ${a.name}`] as const), ...applications.map((a) => [a.id, `${a.title} at ${a.name}`] as const)]);
  for (const t of threads) if (t.context_id && label.has(t.context_id)) out.set(t.id, label.get(t.context_id)!);
  return out;
}

export async function presentThreads(viewer: Actor, threads: readonly ThreadRow[], exec: Executor = db): Promise<Thread[]> {
  if (!threads.length) return [];
  const ids = threads.map((t) => t.id);
  const parts = await dmRepo.participants(ids, exec);
  const byThread = new Map<string, typeof parts>();
  for (const p of parts) {
    const list = byThread.get(p.thread_id) ?? [];
    list.push(p);
    byThread.set(p.thread_id, list);
  }
  const others = [...new Set(parts.filter((p) => p.user_id !== viewer.id).map((p) => p.user_id))];

  const [summaries, lastRows, unread, decisions, sent, labels, settings] = await Promise.all([
    loadSummaries(parts.map((p) => p.user_id), exec),
    dmRepo.lastMessages(ids, viewer.id, exec),
    dmRepo.unreadCounts(viewer.id, ids, exec),
    messagingDecisions(viewer, others, exec),
    dmRepo.sentCounts(ids, viewer.id, exec),
    contextLabels(threads, exec),
    getSettings(exec),
  ]);
  const lastMessages = await presentMessages(lastRows, viewer.id, exec);
  const lastByThread = new Map(lastMessages.map((m) => [m.threadId, m]));
  const unreadByThread = new Map(unread.map((u) => [u.thread_id, Number(u.unread)]));

  const out: Thread[] = [];
  for (const t of threads) {
    const members = byThread.get(t.id) ?? [];
    const me = members.find((p) => p.user_id === viewer.id);
    const other = members.find((p) => p.user_id !== viewer.id);
    const counterpart = other ? summaries.get(other.user_id) : undefined;
    if (!counterpart) continue;
    const viewerState = (me?.state ?? "DECLINED") as ParticipantState;
    let canSend = viewerState !== "DECLINED" && !!other;
    if (canSend && other) {
      const eligibility = decisions.get(other.user_id) ?? { allowed: false as const, reason: "RECIPIENT_UNAVAILABLE" as const };
      canSend = directSendDecision({ eligibility, counterpartState: other.state, sentWhilePending: sent.get(t.id) ?? 0, requestCap: settings.messaging.requestMessageCap }).allowed;
    }
    const participants: ThreadParticipant[] = members
      .filter((p) => summaries.has(p.user_id))
      .map((p) => ({ user: summaries.get(p.user_id)!, state: p.state, lastReadAt: p.last_read_at ? p.last_read_at.toISOString() : null }));

    out.push({
      id: t.id,
      context: t.context,
      contextLabel: labels.get(t.id) ?? null,
      contextId: t.context_id,
      participants,
      counterpart,
      lastMessage: lastByThread.get(t.id) ?? null,
      lastMessageAt: t.last_message_at ? t.last_message_at.toISOString() : null,
      unreadCount: viewerState === "ACTIVE" || viewerState === "REQUESTED" ? (unreadByThread.get(t.id) ?? 0) : 0,
      viewerState,
      canSend,
      mutedUntil: me?.muted_until && me.muted_until > new Date() ? me.muted_until.toISOString() : null,
      archived: !!me?.archived_at,
    });
  }
  return out;
}

export async function presentThread(viewer: Actor, thread: ThreadRow, exec: Executor = db): Promise<Thread> {
  const [t] = await presentThreads(viewer, [thread], exec);
  if (!t) throw new Error(`thread ${thread.id} could not be presented`);
  return t;
}
