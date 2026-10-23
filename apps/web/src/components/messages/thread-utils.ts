import type { Contact } from "@open-talent/api-client";
import type { InfiniteData } from "@tanstack/react-query";
import type { Message, Page, Thread, ThreadContext, UserSummary } from "@open-talent/types";
import { seenBy } from "@/lib/realtime/reducers";

/** The other person in a 1:1 thread (the API resolves it as `counterpart`). */
export function counterpart(thread: Thread, _viewerId?: string): UserSummary {
  return thread.counterpart;
}

export function threadTitle(thread: Thread): string {
  return thread.counterpart.displayName;
}

/** What a thread is about, shown as a chip and a banner: "Approach: Senior Data Engineer". */
export const CONTEXT_LABEL: Record<ThreadContext, string | null> = {
  CONNECTION: null,
  REQUEST: "Message request",
  APPROACH: "Approach",
  APPLICATION: "Application",
  SUPPORT: "Support",
};

export function contextChip(thread: Thread): string | null {
  const label = CONTEXT_LABEL[thread.context];
  if (!label) return null;
  return thread.contextLabel ? `${label}: ${thread.contextLabel}` : label;
}

/** One-line preview of the last message: "You: see you there". */
export function lastMessagePreview(thread: Thread, viewerId: string | undefined): string {
  const m = thread.lastMessage;
  if (!m) return "No messages yet";
  const who = m.sender.id === viewerId ? "You: " : "";
  if (m.status === "DELETED" || m.status === "REMOVED") return `${who}Message removed`;
  const body = m.body || (m.media.length ? (m.media.length === 1 ? "Sent an attachment" : `Sent ${m.media.length} attachments`) : "");
  return `${who}${body}`;
}

export const isMuted = (thread: Thread, now = Date.now()) => !!thread.mutedUntil && new Date(thread.mutedUntil).getTime() > now;

export function onlineOf(contacts: Contact[] | undefined, userId: string | undefined): Contact | undefined {
  return userId ? contacts?.find((c) => c.user.id === userId) : undefined;
}

/** Receipt under the viewer's latest message: "Seen" once the other person read it, otherwise "Sent". */
export function receiptFor(thread: Thread, messages: Message[], viewerId: string | undefined): Record<string, string> {
  if (!viewerId) return {};
  const last = [...messages].reverse().find((m) => !m.id.startsWith("tmp_"));
  if (!last || last.sender.id !== viewerId) return {};
  return { [last.id]: seenBy(thread, last, viewerId).length ? "Seen" : "Sent" };
}

type ThreadPages = InfiniteData<Page<Thread>, string | undefined>;

/** Zero a thread's unread count in every list cache. */
export function clearUnread(data: ThreadPages | undefined, threadId: string): ThreadPages | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((t) => (t.id === threadId ? { ...t, unreadCount: 0 } : t)) })) };
}
