"use client";

import { memo, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BriefcaseBusiness, Clock, Globe2, Megaphone, MessageCircle, PartyPopper, Repeat2, ShieldAlert, Sparkles, Users } from "lucide-react";
import { Badge, Card, Skeleton, Tooltip, cn } from "@open-talent/ui";
import type { Post } from "@open-talent/types";
import { useAuth } from "@/lib/auth";
import { usePostActions } from "@/lib/hooks/use-post-actions";
import { compactNumber } from "@/lib/time";
import { TimeAgo } from "@/components/common/time-ago";
import { CompanyLogo, RoleMark, UserAvatar, companyHref, profileHref, userTagline } from "@/components/common/user-bits";
import { EMPLOYMENT_LABEL, formatPlace } from "@/components/jobs/job-format";
import { MediaMosaic } from "@/components/media/media-mosaic";
import { CommentSection } from "./comments";
import { PostMenu } from "./post-menu";
import { ReactionsDialog } from "./reactions-dialog";
import { ReactionButton, ReactionSummary } from "./reactions";
import { ExpandableText } from "./rich-text";
import { ShareDialog } from "./share-dialog";

function StatusBanner({ post }: { post: Post }) {
  if (post.status === "PUBLISHED") return null;
  const pending = post.status === "PENDING_REVIEW";
  return (
    <div className={cn("flex items-start gap-2 border-b px-4 py-2.5 text-sm", pending ? "border-warning/20 bg-warning-soft text-warning-soft-foreground" : "border-danger/20 bg-danger-soft text-danger-soft-foreground")} data-testid="post-status-banner">
      {pending ? <Clock className="mt-0.5 size-4 shrink-0" /> : <ShieldAlert className="mt-0.5 size-4 shrink-0" />}
      <p>
        {pending ? (
          "Waiting for review. Only you and the moderators can see this post until it is approved."
        ) : (
          <>
            This post is hidden from others.{" "}
            <Link href="/account/moderation" className="font-semibold underline">
              See why and appeal
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

const KIND_BADGE: Partial<Record<Post["kind"], { label: string; tone: "primary" | "success" | "warning"; icon: typeof Megaphone }>> = {
  HIRING: { label: "Hiring", tone: "primary", icon: BriefcaseBusiness },
  JOB: { label: "Job", tone: "primary", icon: BriefcaseBusiness },
  OPEN_TO_WORK: { label: "#OpenToWork", tone: "success", icon: Sparkles },
  MILESTONE: { label: "Milestone", tone: "warning", icon: PartyPopper },
};

function PostHeader({ post }: { post: Post }) {
  const kind = KIND_BADGE[post.kind];
  const asCompany = post.company;
  return (
    <div className="flex items-start gap-2.5 px-4 pt-3">
      {asCompany ? (
        <Link href={companyHref(asCompany.slug)} className="shrink-0" tabIndex={-1} aria-hidden>
          <CompanyLogo company={asCompany} size="lg" />
        </Link>
      ) : (
        <UserAvatar user={post.author} size="lg" />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1 text-[15px] leading-tight">
          {asCompany ? (
            <Link href={companyHref(asCompany.slug)} className="font-semibold hover:underline">
              {asCompany.name}
            </Link>
          ) : (
            <>
              <Link href={profileHref(post.author.username)} className="font-semibold hover:underline">
                {post.author.displayName}
              </Link>
              <RoleMark role={post.author.role} />
            </>
          )}
        </p>
        <p className="line-clamp-1 text-[13px] text-muted-foreground">{asCompany ? `Posted by ${post.author.displayName}` : userTagline(post.author)}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-subtle-foreground">
          <Link href={`/posts/${post.id}`} className="hover:underline">
            <TimeAgo value={post.createdAt} />
          </Link>
          {post.editedAt ? (
            <Tooltip content="This post was edited">
              <span>Edited</span>
            </Tooltip>
          ) : null}
          <span aria-hidden>.</span>
          {post.visibility === "CONNECTIONS" ? <Users className="size-3" aria-label="Connections only" /> : <Globe2 className="size-3" aria-label="Anyone" />}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {kind ? (
          <Badge tone={kind.tone}>
            <kind.icon /> {kind.label}
          </Badge>
        ) : null}
        <PostMenu post={post} />
      </div>
    </div>
  );
}

/** A job attached to a HIRING or JOB post. */
function JobEmbed({ job }: { job: NonNullable<Post["job"]> }) {
  const open = job.status === "OPEN";
  return (
    <Link href={`/jobs?job=${encodeURIComponent(job.id)}`} className="mx-4 mt-3 flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50" data-testid="post-job">
      <CompanyLogo company={job.company} size="lg" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-link">{job.title}</span>
        <span className="block truncate text-sm">{job.company.name}</span>
        <span className="block truncate text-sm text-muted-foreground">
          {formatPlace(job.location, job.workplaceType)}, {EMPLOYMENT_LABEL[job.employmentType]}
        </span>
      </span>
      <Badge tone={open ? "success" : "neutral"}>{open ? "Open" : "No longer accepting"}</Badge>
    </Link>
  );
}

/** A reposted post rendered inside another post. */
function SharedEmbed({ post }: { post: Post }) {
  return (
    <Link href={`/posts/${post.id}`} className="mx-4 mt-2 block overflow-hidden rounded-lg border border-border transition-colors hover:bg-muted/40" data-testid="shared-post">
      {post.media.length ? <MediaMosaic media={post.media.slice(0, 4)} /> : null}
      <div className="p-3">
        <p className="flex items-center gap-1.5 text-sm">
          <span className="font-semibold">{post.company?.name ?? post.author.displayName}</span>
          <span className="truncate text-subtle-foreground">{post.company ? null : userTagline(post.author)}</span>
        </p>
        {post.body ? <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{post.body}</p> : null}
      </div>
    </Link>
  );
}

/** Lazily mounts comments when the card scrolls near the viewport (no N+1 fetch storm on load). */
function useNearViewport<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setNear(true), { rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref, near] as const;
}

export const PostCard = memo(function PostCard({ post, detail = false }: { post: Post; detail?: boolean }) {
  const { status } = useAuth();
  const actions = usePostActions(post);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [focusComment, setFocusComment] = useState(false);
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const signedIn = status === "signed-in";

  return (
    <Card ref={ref} className="overflow-visible" data-testid="post-card" data-post-id={post.id}>
      <StatusBanner post={post} />
      <PostHeader post={post} />
      {post.body ? <ExpandableText text={post.body} large={!post.media.length && !post.job && !post.sharedPost} className="px-4 pt-2" /> : null}
      {post.media.length ? <MediaMosaic media={post.media} className="mt-3" /> : null}
      {post.job ? <JobEmbed job={post.job} /> : null}
      {post.sharedPost ? <SharedEmbed post={post.sharedPost} /> : null}

      <div className="mx-4 mt-3 flex items-center gap-3 py-2 text-[15px] text-muted-foreground" data-testid="post-counts">
        <ReactionSummary counts={post.reactionCounts} total={post.reactionCount} onClick={() => setReactionsOpen(true)} />
        <span className="flex-1" />
        {post.commentCount ? (
          <Link href={`/posts/${post.id}`} className="hover:underline">
            {compactNumber(post.commentCount)} {post.commentCount === 1 ? "comment" : "comments"}
          </Link>
        ) : null}
        {post.repostCount ? (
          <span>
            {compactNumber(post.repostCount)} {post.repostCount === 1 ? "repost" : "reposts"}
          </span>
        ) : null}
      </div>

      <div className="mx-4 flex items-center gap-1 border-y border-border py-1">
        <ReactionButton value={post.viewer.reaction} onChange={(r) => (signedIn ? actions.react.mutate(r) : undefined)} disabled={!signedIn || post.status !== "PUBLISHED"} />
        <button
          type="button"
          onClick={() => setFocusComment(true)}
          disabled={post.status !== "PUBLISHED"}
          className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md text-[15px] font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          data-testid="comment-button"
        >
          <MessageCircle className="size-[18px]" /> Comment
        </button>
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          disabled={!signedIn || post.status !== "PUBLISHED"}
          className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md text-[15px] font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          data-testid="share-button"
        >
          <Repeat2 className="size-[18px]" /> Repost
        </button>
      </div>

      <div className="pt-2">
        <CommentSection key={focusComment ? "focus" : "idle"} post={post} firstPage={detail ? 20 : 2} enabled={near || detail} autoFocus={focusComment} />
      </div>

      {reactionsOpen ? <ReactionsDialog post={post} open={reactionsOpen} onOpenChange={setReactionsOpen} /> : null}
      {shareOpen ? <ShareDialog post={post} open={shareOpen} onOpenChange={setShareOpen} /> : null}
    </Card>
  );
});

export function PostSkeleton({ media = true }: { media?: boolean }) {
  return (
    <Card className="p-4" aria-hidden data-testid="post-skeleton">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-3 w-1/5" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-3/5" />
      </div>
      {media ? <Skeleton className="-mx-4 mt-4 h-64 rounded-none" /> : null}
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 flex-1" />
      </div>
    </Card>
  );
}
