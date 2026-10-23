"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  Award,
  Bell,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  FileText,
  Handshake,
  KeyRound,
  MessageCircle,
  MessageSquare,
  Repeat2,
  Shield,
  Sparkles,
  Star,
  ThumbsUp,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { Avatar, cn } from "@open-talent/ui";
import type { Notification, NotificationCounts, NotificationType } from "@open-talent/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { markNotificationsRead, type NotificationPages } from "@/lib/realtime/reducers";
import { TimeAgo } from "@/components/common/time-ago";

export const NOTIFICATION_COPY: Record<NotificationType, string> = {
  CONNECTION_REQUEST: "wants to connect with you",
  CONNECTION_ACCEPTED: "accepted your invitation to connect",
  FOLLOW: "started following you",
  COMPANY_FOLLOW: "followed your company page",
  POST_COMMENT: "commented on your post",
  COMMENT_REPLY: "replied to your comment",
  POST_REACTION: "reacted to your post",
  COMMENT_REACTION: "reacted to your comment",
  MENTION: "mentioned you",
  REPOST: "reposted your post",
  ENDORSEMENT: "endorsed one of your skills",
  DM_REQUEST: "sent you a message request",
  APPROACH_RECEIVED: "would like to talk to you about a role",
  APPROACH_ACCEPTED: "Your approach was accepted, and contact details are unlocked",
  APPROACH_DECLINED: "Your approach was declined",
  CONTACT_REVOKED: "A candidate revoked access to their contact details",
  JOB_INVITE: "invited you to apply for a job",
  APPLICATION_RECEIVED: "applied to your job",
  APPLICATION_STAGE: "Your application moved forward",
  ENGAGEMENT_PROPOSED: "proposed recording an engagement with you",
  ENGAGEMENT_UPDATED: "updated an engagement with you",
  RATING_RECEIVED: "Ratings for a finished engagement are now visible",
  RECRUITER_APPROVED: "Your recruiter account is approved. You can start hiring",
  RECRUITER_REJECTED: "Your recruiter application was not approved",
  IMPORT_READY: "Your profile import is ready to review",
  COMPLAINT_UPDATED: "A complaint you are part of was updated",
  MODERATION_ACTION: "A moderator reviewed your content",
  APPEAL_DECIDED: "Your appeal has been decided",
};

/** Types whose copy is a full sentence without an actor. */
const ACTORLESS = new Set<NotificationType>([
  "APPROACH_ACCEPTED",
  "APPROACH_DECLINED",
  "CONTACT_REVOKED",
  "APPLICATION_STAGE",
  "RATING_RECEIVED",
  "RECRUITER_APPROVED",
  "RECRUITER_REJECTED",
  "IMPORT_READY",
  "COMPLAINT_UPDATED",
  "MODERATION_ACTION",
  "APPEAL_DECIDED",
]);

const primary = "bg-primary text-primary-foreground";
const success = "bg-success text-success-foreground";
const warning = "bg-warning text-warning-foreground";
const danger = "bg-danger text-danger-foreground";

const ICONS: Record<NotificationType, { icon: typeof Bell; tone: string }> = {
  CONNECTION_REQUEST: { icon: UserPlus, tone: primary },
  CONNECTION_ACCEPTED: { icon: UserCheck, tone: success },
  FOLLOW: { icon: UserPlus, tone: primary },
  COMPANY_FOLLOW: { icon: Building2, tone: primary },
  POST_COMMENT: { icon: MessageCircle, tone: success },
  COMMENT_REPLY: { icon: MessageCircle, tone: success },
  POST_REACTION: { icon: ThumbsUp, tone: primary },
  COMMENT_REACTION: { icon: ThumbsUp, tone: primary },
  MENTION: { icon: AtSign, tone: primary },
  REPOST: { icon: Repeat2, tone: success },
  ENDORSEMENT: { icon: Award, tone: success },
  DM_REQUEST: { icon: MessageSquare, tone: primary },
  APPROACH_RECEIVED: { icon: Handshake, tone: primary },
  APPROACH_ACCEPTED: { icon: KeyRound, tone: success },
  APPROACH_DECLINED: { icon: Handshake, tone: warning },
  CONTACT_REVOKED: { icon: KeyRound, tone: warning },
  JOB_INVITE: { icon: BriefcaseBusiness, tone: primary },
  APPLICATION_RECEIVED: { icon: FileText, tone: primary },
  APPLICATION_STAGE: { icon: BriefcaseBusiness, tone: success },
  ENGAGEMENT_PROPOSED: { icon: Handshake, tone: primary },
  ENGAGEMENT_UPDATED: { icon: Handshake, tone: primary },
  RATING_RECEIVED: { icon: Star, tone: success },
  RECRUITER_APPROVED: { icon: CheckCircle2, tone: success },
  RECRUITER_REJECTED: { icon: Shield, tone: danger },
  IMPORT_READY: { icon: Sparkles, tone: primary },
  COMPLAINT_UPDATED: { icon: Shield, tone: warning },
  MODERATION_ACTION: { icon: Shield, tone: warning },
  APPEAL_DECIDED: { icon: Shield, tone: primary },
};

export function notificationText(n: Notification): { actor: string | null; text: string } {
  const copy = NOTIFICATION_COPY[n.type] ?? "sent you a notification";
  if (ACTORLESS.has(n.type) || !n.actor)
    return { actor: null, text: copy.charAt(0).toUpperCase() + copy.slice(1) };
  return { actor: n.actor.displayName, text: copy };
}

/** Only internal paths: the API sends a path, never a full URL, and we enforce that. */
export function safeInternalHref(href: string): string {
  return href.startsWith("/") && !href.startsWith("//") ? href : "/notifications";
}

export function NotificationItem({
  n,
  compact,
  onNavigate,
}: {
  n: Notification;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const qc = useQueryClient();
  const { actor, text } = notificationText(n);
  const { icon: Icon, tone } = ICONS[n.type] ?? {
    icon: Bell,
    tone: "bg-primary text-primary-foreground",
  };
  const markRead = useMutation({
    mutationFn: () => api().notifications.read(n.id),
    meta: { silent: true },
    onMutate: () => {
      const at = new Date().toISOString();
      for (const unread of [false, true])
        qc.setQueryData<NotificationPages>(qk.notifications(unread), (d) =>
          markNotificationsRead(d, n.id, at)
        );
      qc.setQueryData<NotificationCounts>(qk.counts, (c) =>
        c ? { ...c, notifications: Math.max(0, c.notifications - 1) } : c
      );
    },
  });
  const unread = !n.readAt;
  return (
    <Link
      href={safeInternalHref(n.href)}
      data-testid="notification-item"
      onClick={() => {
        if (unread) markRead.mutate();
        onNavigate?.();
      }}
      className={cn(
        "flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted",
        compact ? "" : "py-3"
      )}
    >
      <span className="relative shrink-0">
        {n.actor ? (
          <Avatar
            name={n.actor.displayName}
            seed={n.actor.id}
            src={n.actor.avatarUrl}
            size={compact ? "md" : "lg"}
          />
        ) : (
          <span
            className={cn(
              "flex items-center justify-center rounded-full bg-muted text-muted-foreground",
              compact ? "size-10" : "size-12"
            )}
          >
            <Bell className="size-5" />
          </span>
        )}
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full ring-2 ring-popover",
            tone
          )}
        >
          <Icon className="size-3" />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm leading-snug",
            unread ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {actor ? <span className="font-semibold text-foreground">{actor} </span> : null}
          {text}
          {n.snippet ? <span className="text-muted-foreground">: {n.snippet}</span> : null}
        </span>
        <TimeAgo
          value={n.createdAt}
          className={cn(
            "mt-0.5 block text-xs",
            unread ? "font-semibold text-primary-soft-foreground" : "text-subtle-foreground"
          )}
        />
      </span>
      {unread ? (
        <span className="mt-3 size-2.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />
      ) : null}
    </Link>
  );
}
