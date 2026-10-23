"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Users } from "lucide-react";
import { Button, Card, EmptyState, Skeleton } from "@open-talent/ui";
import type { FollowEntry, NetworkEntry } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { ErrorState, LoadMore } from "@/components/common/states";
import { PersonRow, profileHref } from "@/components/common/user-bits";
import { ConnectButton } from "@/components/network/connect-button";
import { FollowButton } from "./follow-button";
import { normalizeProfile } from "./profile-utils";

type Kind = "followers" | "following" | "connections";

const TITLE: Record<Kind, string> = { followers: "Followers", following: "Following", connections: "Connections" };

function useOwnerName(username: string) {
  const profile = useQuery({
    queryKey: qk.profile(username),
    queryFn: async () => normalizeProfile(await api().profiles.get(username)),
    meta: { silent: true },
    retry: false,
  });
  return profile.data?.user.displayName ?? `@${username}`;
}

function ListShell({ username, kind, children }: { username: string; kind: Kind; children: React.ReactNode }) {
  const name = useOwnerName(username);
  return (
    <Card data-testid={`${kind}-list`} className="mx-auto max-w-[760px]">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link href={profileHref(username)} aria-label="Back to profile" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted focus-visible:ring-2">
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-lg font-bold">{TITLE[kind]}</h1>
          <p className="truncate text-sm text-subtle-foreground">{name}</p>
        </div>
      </div>
      <div className="px-4 py-2">{children}</div>
    </Card>
  );
}

function RowsSkeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Followers or following of a person, infinite. */
export function PeopleList({ username, kind }: { username: string; kind: "followers" | "following" }) {
  const { user } = useAuth();
  const list = usePagedList<FollowEntry>({
    queryKey: kind === "followers" ? qk.followers(username) : qk.following(username),
    fetchPage: (cursor) => (kind === "followers" ? api().users.followers(username, { cursor }) : api().users.following(username, { cursor })),
  });
  return (
    <ListShell username={username} kind={kind}>
      {list.isPending ? (
        <RowsSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} compact />
      ) : !list.items.length ? (
        <EmptyState
          compact
          icon={<Users />}
          title={kind === "followers" ? "No followers yet" : "Not following anyone yet"}
          description={kind === "followers" ? "Followers see this person's posts in their feed." : undefined}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={profileHref(username)}>Back to profile</Link>
            </Button>
          }
        />
      ) : (
        <div className="divide-y divide-border">
          {list.items.map((u) => (
            <PersonRow
              key={u.id}
              user={u}
              action={
                user && u.id !== user.id ? <FollowButton key={`${u.id}:${u.viewerFollows}`} userId={u.id} following={u.viewerFollows} size="sm" variantWhenOff="outline" testId="list-follow-button" /> : null
              }
            />
          ))}
        </div>
      )}
      <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
    </ListShell>
  );
}

/** Someone's connections, with the viewer's own connect state on each row. */
export function ConnectionsList({ username }: { username: string }) {
  const { user } = useAuth();
  const list = usePagedList<NetworkEntry & { id: string }>({
    queryKey: qk.connectionsOf(username),
    fetchPage: async (cursor) => {
      const page = await api().network.of(username, { cursor });
      return { ...page, items: page.items.map((e) => ({ ...e, id: e.user.id })) };
    },
  });
  return (
    <ListShell username={username} kind="connections">
      {list.isPending ? (
        <RowsSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} compact />
      ) : !list.items.length ? (
        <EmptyState
          compact
          icon={<Users />}
          title="No connections to show"
          description="Connections appear here once both people accept. Some people keep their list private."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={profileHref(username)}>Back to profile</Link>
            </Button>
          }
        />
      ) : (
        <div className="divide-y divide-border">
          {list.items.map((e) => (
            <PersonRow
              key={e.user.id}
              user={e.user}
              meta={e.mutualCount > 0 && user?.id !== e.user.id ? `${e.user.headline ?? `@${e.user.username}`} · ${e.mutualCount} mutual` : undefined}
              action={user && e.user.id !== user.id ? <ConnectButton key={`${e.user.id}:${e.connection}`} user={e.user} state={e.connection} connectionId={e.connectionId} /> : null}
            />
          ))}
        </div>
      )}
      <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
    </ListShell>
  );
}
