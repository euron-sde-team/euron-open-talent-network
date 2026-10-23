"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, UserPlus } from "lucide-react";
import { Button, Card, EmptyState, Segmented } from "@open-talent/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { HOME_FEED, useSignals } from "@/lib/stores/signals";
import { ComposerCard } from "@/components/posts/composer";
import { PostFeed } from "@/components/posts/post-feed";
import { ThreeColumn } from "@/components/shell/layouts";
import { Landing } from "@/components/landing/landing";

export function NewPostsPill({ feedKey, queryKey }: { feedKey: string; queryKey: readonly unknown[] }) {
  const count = useSignals((s) => s.newPosts[feedKey] ?? 0);
  const clear = useSignals((s) => s.clearNewPosts);
  const qc = useQueryClient();
  if (!count) return null;
  return (
    <div className="pointer-events-none sticky top-[calc(var(--header-height)+12px)] z-30 flex justify-center">
      <Button
        size="sm"
        className="pointer-events-auto rounded-full shadow-popover animate-slide-up"
        data-testid="new-posts-pill"
        onClick={() => {
          clear(feedKey);
          window.scrollTo({ top: 0, behavior: "smooth" });
          void qc.resetQueries({ queryKey });
        }}
      >
        <ArrowUp /> {count === 1 ? "1 new post" : `${count > 99 ? "99+" : count} new posts`}
      </Button>
    </div>
  );
}

/** `/`: the feed when signed in, the public landing page when signed out. */
export function HomePage() {
  const { status } = useAuth();
  if (status === "loading") return <ThreeColumn>{null}</ThreeColumn>;
  if (status === "signed-out") return <Landing />;
  return (
    <ThreeColumn>
      <HomeFeed />
    </ThreeColumn>
  );
}

function HomeFeed() {
  const [sort, setSort] = useState<"latest" | "top">("latest");
  const clear = useSignals((s) => s.clearNewPosts);
  useEffect(() => () => clear(HOME_FEED), [clear]);
  return (
    <div className="space-y-3">
      <ComposerCard />
      <NewPostsPill feedKey={HOME_FEED} queryKey={qk.feed(sort)} />
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <Segmented
          aria-label="Sort feed"
          value={sort}
          onChange={setSort}
          options={[
            { value: "latest", label: "Recent" },
            { value: "top", label: "Top" },
          ]}
        />
      </div>
      <PostFeed
        key={sort}
        queryKey={qk.feed(sort)}
        fetchPage={(cursor) => api().posts.feed({ sort, cursor })}
        empty={
          <Card>
            <EmptyState
              icon={<UserPlus />}
              title="Your feed is quiet"
              description="Connect with people you have worked with and follow companies you care about. Their posts, jobs and milestones show up here."
              action={
                <Button asChild>
                  <Link href="/network">Grow your network</Link>
                </Button>
              }
            />
          </Card>
        }
      />
    </div>
  );
}
