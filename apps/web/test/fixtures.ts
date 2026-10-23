import type { Me, Message, Post, Thread, UserSummary } from "@open-talent/types";

export const user = (id: string, name = `User ${id}`): UserSummary => ({ id, username: `user-${id}`, displayName: name, avatarUrl: null, headline: null, role: "USER", openToWork: false, recruiterAt: null });

export const me: Me = {
  ...user("me", "Ada Lovelace"),
  email: "ada@example.org",
  status: "ACTIVE",
  suspendedUntil: null,
  emailVerified: true,
  totpEnabled: false,
  messageRequestPolicy: "RECRUITERS",
  emailDigest: false,
  profileStatus: "PUBLISHED",
  profileCompleteness: 80,
  recruiter: null,
  connectionCount: 12,
};

export function message(id: string, over: Partial<Message> = {}): Message {
  return { id, threadId: "t1", sender: user("u1"), body: `m ${id}`, media: [], replyTo: null, reactions: [], status: "PUBLISHED", createdAt: "2026-01-01T10:00:00.000Z", editedAt: null, ...over };
}

export function thread(id: string, over: Partial<Thread> = {}): Thread {
  return {
    id,
    context: "CONNECTION",
    contextLabel: null,
    contextId: null,
    participants: [
      { user: user("me"), state: "ACTIVE", lastReadAt: null },
      { user: user("u1"), state: "ACTIVE", lastReadAt: null },
    ],
    counterpart: user("u1"),
    lastMessage: null,
    lastMessageAt: null,
    unreadCount: 0,
    viewerState: "ACTIVE",
    canSend: true,
    mutedUntil: null,
    archived: false,
    ...over,
  };
}

export function post(id: string, over: Partial<Post> = {}): Post {
  return {
    id,
    kind: "POST",
    visibility: "PUBLIC",
    author: user("u1"),
    company: null,
    body: "hello",
    mentions: [],
    media: [],
    job: null,
    sharedPost: null,
    status: "PUBLISHED",
    reactionCount: 0,
    reactionCounts: {},
    commentCount: 0,
    repostCount: 0,
    createdAt: "2026-01-01T10:00:00.000Z",
    editedAt: null,
    viewer: { reaction: null, bookmarked: false, canEdit: false, canDelete: false, canModerate: false },
    ...over,
  };
}
