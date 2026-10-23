import type { Message, Thread, UserSummary } from "@open-talent/types";

export const user = (id: string, name = `User ${id}`): UserSummary => ({ id, username: `u${id}`, displayName: name, avatarUrl: null, headline: null, role: "USER", openToWork: false, recruiterAt: null });

export const msg = (id: string, senderId: string, createdAt: string, extra: Partial<Message> = {}): Message => ({
  id,
  threadId: "room",
  sender: user(senderId),
  body: `message ${id}`,
  media: [],
  replyTo: null,
  reactions: [],
  status: "PUBLISHED",
  createdAt,
  editedAt: null,
  ...extra,
});

export const thread = (id: string, extra: Partial<Thread> = {}): Thread => ({
  id,
  context: "CONNECTION",
  contextLabel: null,
  contextId: null,
  participants: [
    { user: user("me", "Me Myself"), state: "ACTIVE", lastReadAt: null },
    { user: user("ada", "Ada Lovelace"), state: "ACTIVE", lastReadAt: null },
  ],
  counterpart: user("ada", "Ada Lovelace"),
  lastMessage: null,
  lastMessageAt: null,
  unreadCount: 0,
  viewerState: "ACTIVE",
  canSend: true,
  mutedUntil: null,
  archived: false,
  ...extra,
});
