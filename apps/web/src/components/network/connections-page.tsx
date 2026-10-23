"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText, MoreHorizontal, Search, UserMinus, Users } from "lucide-react";
import {
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  Select,
  Skeleton,
  toast,
} from "@open-talent/ui";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { usePagedList } from "@/lib/hooks/queries";
import { useOpenConversation } from "@/lib/hooks/use-open-conversation";
import { qk } from "@/lib/query-keys";
import { compactNumber } from "@/lib/time";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState, LoadMore } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { UserAvatar, UserName, userTagline } from "@/components/common/user-bits";
import { useInvalidateNetwork } from "./connect-button";
import { NetworkShell } from "./network-page";
import { removeRows, withIds, type NetworkRow } from "./network-cache";

type Sort = "recent" | "first" | "last";

const lastName = (n: string) => n.trim().split(/\s+/).pop() ?? n;

function ConnectionRow({ row, onRemove }: { row: NetworkRow; onRemove: (row: NetworkRow) => void }) {
  const openConversation = useOpenConversation();
  return (
    <li className="flex items-center gap-3 py-3" data-testid="connection-row">
      <UserAvatar user={row.user} size="lg" />
      <div className="min-w-0 flex-1">
        <UserName user={row.user} />
        <p className="truncate text-sm text-muted-foreground">{userTagline(row.user)}</p>
        <p className="text-xs text-subtle-foreground">
          Connected <TimeAgo value={row.since} />
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="max-sm:hidden"
        onClick={() => openConversation.mutate(row.user)}
        disabled={openConversation.isPending}
        data-testid="connection-message"
      >
        <MessageSquareText /> Message
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`More actions for ${row.user.displayName}`} data-testid="connection-menu">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem className="sm:hidden" onSelect={() => openConversation.mutate(row.user)}>
            <MessageSquareText /> Message
          </DropdownMenuItem>
          <DropdownMenuItem destructive onSelect={() => onRemove(row)} data-testid="connection-remove">
            <UserMinus /> Remove connection
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function ConnectionsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const invalidate = useInvalidateNetwork();
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [removing, setRemoving] = useState<NetworkRow | null>(null);
  const list = usePagedList<NetworkRow>({
    queryKey: qk.connections,
    fetchPage: async (cursor) => withIds(await api().network.connections({ cursor })),
  });

  const remove = useMutation({
    mutationFn: (row: NetworkRow) => api().network.remove(row.user.id),
    onMutate: async (row) => {
      await qc.cancelQueries({ queryKey: qk.connections });
      return { prev: removeRows<NetworkRow>(qc, qk.connections, (r) => r.id === row.id) };
    },
    onSuccess: (_d, row) => toast.success({ title: `Removed ${row.user.displayName} from your connections` }),
    onError: (e, _row, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.connections, ctx.prev);
      toast.error({ title: "Could not remove the connection", description: errorMessage(e) });
    },
    onSettled: (_d, _e, row) => invalidate(row.user.username),
  });

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const rows = needle
      ? list.items.filter((r) => [r.user.displayName, r.user.username, r.user.headline ?? ""].some((s) => s.toLowerCase().includes(needle)))
      : list.items;
    if (sort === "recent") return rows;
    const key = (r: NetworkRow) => (sort === "first" ? r.user.displayName : lastName(r.user.displayName));
    return [...rows].sort((a, b) => key(a).localeCompare(key(b)));
  }, [list.items, filter, sort]);

  return (
    <NetworkShell active="connections">
      <Card data-testid="connections-page">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-xl font-semibold">
            {compactNumber(me.connectionCount)} connection{me.connectionCount === 1 ? "" : "s"}
          </h1>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search by name or headline"
                aria-label="Search connections"
                className="pl-9"
                data-testid="connections-filter"
              />
            </div>
            <div className="sm:w-48">
              <Select
                aria-label="Sort connections"
                value={sort}
                onValueChange={(v) => setSort(v as Sort)}
                options={[
                  { value: "recent", label: "Recently added" },
                  { value: "first", label: "First name" },
                  { value: "last", label: "Last name" },
                ]}
                data-testid="connections-sort"
              />
            </div>
          </div>
          {filter.trim() && list.hasNextPage ? <p className="mt-2 text-xs text-subtle-foreground">Searching the connections loaded so far. Scroll to load more.</p> : null}
        </div>
        <div className="px-4">
          {list.isPending ? (
            <div className="space-y-4 py-4">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} compact />
          ) : !list.items.length ? (
            <EmptyState
              icon={<Users />}
              title="No connections yet"
              description="Connect with people you have worked with. Your network helps you hear about roles and get introductions."
              action={
                <Button asChild variant="soft" size="sm">
                  <Link href="/network">Find people you may know</Link>
                </Button>
              }
            />
          ) : !shown.length ? (
            <EmptyState compact icon={<Search />} title={`No connections match "${filter.trim()}"`} description="Try a different name, or clear the search." />
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((row) => (
                <ConnectionRow key={row.id} row={row} onRemove={setRemoving} />
              ))}
            </ul>
          )}
          <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
        </div>
      </Card>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? `Remove ${removing.user.displayName}?` : "Remove connection?"}
        description="They will not be notified. You can send a new invitation later."
        confirmLabel="Remove"
        destructive
        testId="remove-connection-dialog"
        onConfirm={() => (removing ? remove.mutateAsync(removing) : undefined)}
      />
    </NetworkShell>
  );
}
