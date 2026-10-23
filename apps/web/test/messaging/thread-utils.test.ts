import { describe, expect, it } from "vitest";
import { clearUnread, contextChip, counterpart, isMuted, lastMessagePreview, receiptFor, threadTitle } from "@/components/messages/thread-utils";
import { msg, thread } from "./fixtures";

describe("thread helpers", () => {
  it("names the thread after the other person and labels its context", () => {
    const t = thread("t1");
    expect(counterpart(t, "me").id).toBe("ada");
    expect(threadTitle(t)).toBe("Ada Lovelace");
    expect(contextChip(t)).toBeNull();
    expect(contextChip(thread("t2", { context: "APPROACH", contextLabel: "Senior Data Engineer" }))).toBe("Approach: Senior Data Engineer");
    expect(contextChip(thread("t3", { context: "REQUEST" }))).toBe("Message request");
  });

  it("previews the last message with a sender prefix", () => {
    expect(lastMessagePreview(thread("t", { lastMessage: msg("m", "me", "2026-01-01T00:00:00Z", { body: "see you" }) }), "me")).toBe("You: see you");
    expect(lastMessagePreview(thread("t", { lastMessage: msg("m", "ada", "2026-01-01T00:00:00Z", { body: "", media: [{} as never, {} as never] }) }), "me")).toBe("Sent 2 attachments");
    expect(lastMessagePreview(thread("t"), "me")).toBe("No messages yet");
  });

  it("knows when a thread is muted", () => {
    expect(isMuted(thread("t", { mutedUntil: "2999-01-01T00:00:00Z" }))).toBe(true);
    expect(isMuted(thread("t", { mutedUntil: "2000-01-01T00:00:00Z" }))).toBe(false);
  });

  it("shows Seen only under the viewer's latest message once read", () => {
    const m1 = msg("1", "me", "2026-01-01T10:00:00Z");
    const t = thread("t");
    expect(receiptFor(t, [m1], "me")).toEqual({ "1": "Sent" });
    const read = thread("t", { participants: t.participants.map((p) => (p.user.id === "ada" ? { ...p, lastReadAt: "2026-01-01T10:00:05Z" } : p)) });
    expect(receiptFor(read, [m1], "me")).toEqual({ "1": "Seen" });
    expect(receiptFor(read, [m1, msg("2", "ada", "2026-01-01T10:01:00Z")], "me")).toEqual({});
  });

  it("clears unread counts in list caches", () => {
    const data = { pages: [{ items: [thread("a", { unreadCount: 3 }), thread("b", { unreadCount: 1 })], nextCursor: null }], pageParams: [undefined] };
    const next = clearUnread(data, "a")!;
    expect(next.pages[0]!.items.map((t) => t.unreadCount)).toEqual([0, 1]);
  });
});
