"use client";

import { Avatar } from "@open-talent/ui";
import type { Thread } from "@open-talent/types";

/** The other person's avatar (threads are 1:1). */
export function ThreadAvatar({ thread, online, size = "md" }: { thread: Thread; viewerId?: string; online?: boolean; size?: "sm" | "md" | "lg" }) {
  const other = thread.counterpart;
  return <Avatar name={other.displayName} seed={other.id} src={other.avatarUrl} size={size} online={online} openToWork={other.openToWork} />;
}
