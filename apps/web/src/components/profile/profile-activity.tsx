"use client";

import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { flattenPages, nextCursor } from "@open-talent/api-client";
import { MessageSquare, Repeat2, Star, ThumbsUp } from "lucide-react";
import { Button, Skeleton, Spinner } from "@open-talent/ui";
import type { Post, Profile, SubScores } from "@open-talent/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { ErrorState } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { UserAvatar, UserName, userTagline } from "@/components/common/user-bits";
import { Stars } from "./profile-badges";
import { SectionCard } from "./section-card";

function PostRow({ post }: { post: Post }) {
  const text = post.body || post.sharedPost?.body || "";
  const thumb = post.media.find((m) => m.kind === "IMAGE");
  return (
    <li>
      <Link href={`/posts/${post.id}`} className="-mx-2 flex gap-3 rounded-md px-2 py-3 hover:bg-muted focus-visible:ring-2" data-testid="activity-post">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-subtle-foreground">
            {post.sharedPost ? "Reposted · " : ""}
            <TimeAgo value={post.createdAt} />
          </p>
          <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-sm text-foreground">{text || (post.job ? `Shared a job: ${post.job.title}` : "Shared an update")}</p>
          <p className="mt-1.5 flex items-center gap-3 text-xs text-subtle-foreground">
            {post.reactionCount ? (
              <span className="inline-flex items-center gap-1">
                <ThumbsUp className="size-3.5" /> {post.reactionCount}
              </span>
            ) : null}
            {post.commentCount ? (
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="size-3.5" /> {post.commentCount}
              </span>
            ) : null}
            {post.repostCount ? (
              <span className="inline-flex items-center gap-1">
                <Repeat2 className="size-3.5" /> {post.repostCount}
              </span>
            ) : null}
          </p>
        </div>
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb.thumbUrl ?? thumb.url} alt="" className="size-16 shrink-0 rounded-md border border-border object-cover" loading="lazy" />
        ) : null}
      </Link>
    </li>
  );
}

/** The person's latest posts: three up front, the rest inline on demand. */
export function ActivitySection({ profile, isSelf }: { profile: Profile; isSelf: boolean }) {
  const username = profile.user.username;
  const [expanded, setExpanded] = useState(false);
  const q = useInfiniteQuery({
    queryKey: [...qk.userPosts(username), "activity"],
    queryFn: ({ pageParam }) => api().users.posts(username, { cursor: pageParam, limit: pageParam ? 10 : 3 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
  });
  const items = flattenPages(q.data?.pages);
  const shown = expanded ? items : items.slice(0, 3);
  if (q.isSuccess && !items.length && !isSelf) return null;
  return (
    <SectionCard
      id="section-activity"
      title="Activity"
      testId="profile-activity"
      footer={
        items.length >= 3 && (q.hasNextPage || items.length > 3) ? (
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-b-lg px-4 py-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              if (!expanded) {
                setExpanded(true);
                if (items.length <= 3 && q.hasNextPage) void q.fetchNextPage();
              } else if (q.hasNextPage) void q.fetchNextPage();
              else setExpanded(false);
            }}
            disabled={q.isFetchingNextPage}
            data-testid="activity-toggle"
          >
            {q.isFetchingNextPage ? <Spinner size="sm" /> : null}
            {!expanded ? "Show all posts" : q.hasNextPage ? "Show more posts" : "Show fewer"}
          </button>
        ) : undefined
      }
    >
      <p className="-mt-0.5 mb-1 text-sm text-link">
        {profile.followerCount} follower{profile.followerCount === 1 ? "" : "s"}
      </p>
      {q.isPending ? (
        <div className="space-y-3 py-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : !items.length ? (
        <div className="flex flex-col items-start gap-2 py-2">
          <p className="text-sm text-muted-foreground">You have not posted yet. Posts you share appear here for people who visit your profile.</p>
          <Button asChild size="sm" variant="outline">
            <Link href="/">Start a post</Link>
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((p) => (
            <PostRow key={p.id} post={p} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

const SUB_LABEL: Record<keyof SubScores, string> = { communication: "Communication", quality: "Quality of work", reliability: "Reliability", professionalism: "Professionalism" };

/** Revealed ratings from completed engagements. */
export function RecommendationsSection({ profile }: { profile: Profile }) {
  const username = profile.user.username;
  const q = useQuery({ queryKey: qk.profileRatings(username), queryFn: () => api().profiles.ratings(username) });
  const items = (q.data ?? []).filter((r) => r.revealedAt);
  if (q.isSuccess && !items.length) return null;
  if (q.isError) return null;
  return (
    <SectionCard id="section-recommendations" title="Recommendations" testId="profile-recommendations">
      {q.isPending ? (
        <div className="space-y-3 py-2" aria-hidden>
          <Skeleton className="h-20" />
        </div>
      ) : (
        <>
          {profile.rating.count && profile.rating.average != null ? (
            <p className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Star className="size-4 fill-warning text-warning" />
              <span className="font-semibold text-foreground">{profile.rating.average.toFixed(1)}</span> weighted average from {profile.rating.count} completed engagement{profile.rating.count > 1 ? "s" : ""}
            </p>
          ) : null}
          <ul className="divide-y divide-border">
            {items.map((r) => {
              const subs = (Object.keys(SUB_LABEL) as (keyof SubScores)[]).filter((k) => typeof r.subScores[k] === "number");
              return (
                <li key={r.id} className="flex gap-3 py-4 first:pt-2 last:pb-1" data-testid="rating-item">
                  <UserAvatar user={r.rater} />
                  <div className="min-w-0 flex-1">
                    <UserName user={r.rater} className="text-sm" />
                    <p className="truncate text-xs text-subtle-foreground">{userTagline(r.rater)}</p>
                    <p className="mt-1 flex items-center gap-2 text-sm">
                      <Stars value={r.score} />
                      <span className="font-semibold">{r.score.toFixed(1)}</span>
                      <span className="text-xs text-subtle-foreground">
                        <TimeAgo value={r.revealedAt ?? r.createdAt} />
                      </span>
                    </p>
                    {r.comment ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{r.comment}</p> : null}
                    {subs.length ? (
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                        {subs.map((k) => (
                          <div key={k}>
                            <dt className="text-subtle-foreground">{SUB_LABEL[k]}</dt>
                            <dd className="font-semibold text-foreground">{r.subScores[k]} / 5</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </SectionCard>
  );
}
