"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Inbox, Send } from "lucide-react";
import { Button, Card, EmptyState, Segmented, Skeleton, toast } from "@open-talent/ui";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useCounts, usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { TimeAgo } from "@/components/common/time-ago";
import { ErrorState, LoadMore } from "@/components/common/states";
import { UserAvatar, UserName, userTagline } from "@/components/common/user-bits";
import { useInvalidateNetwork } from "./connect-button";
import { removeRows, withIds, type NetworkRow } from "./network-cache";

type Direction = "received" | "sent";

function useInvitationAction(direction: Direction, fn: (connectionId: string) => Promise<unknown>, done: (row: NetworkRow) => string | null) {
  const qc = useQueryClient();
  const invalidate = useInvalidateNetwork();
  const key = qk.invitations(direction);
  return useMutation({
    mutationFn: (row: NetworkRow) => fn(row.connectionId!),
    onMutate: async (row) => {
      await qc.cancelQueries({ queryKey: key });
      return { prev: removeRows<NetworkRow>(qc, key, (r) => r.id === row.id) };
    },
    onSuccess: (_d, row) => {
      const msg = done(row);
      if (msg) toast.success({ title: msg });
    },
    onError: (e, _row, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error({ title: "That did not go through", description: errorMessage(e) });
    },
    onSettled: (_d, _e, row) => invalidate(row.user.username),
  });
}

function InvitationRow({ row, direction }: { row: NetworkRow; direction: Direction }) {
  const accept = useInvitationAction(direction, (id) => api().network.accept(id), (r) => `You and ${r.user.displayName} are now connected`);
  const ignore = useInvitationAction(direction, (id) => api().network.ignore(id), () => null);
  const withdraw = useInvitationAction(direction, (id) => api().network.withdraw(id), () => "Invitation withdrawn");
  const busy = accept.isPending || ignore.isPending || withdraw.isPending;
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start" data-testid="invitation-row">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <UserAvatar user={row.user} size="lg" />
        <div className="min-w-0 flex-1">
          <UserName user={row.user} />
          <p className="truncate text-sm text-muted-foreground">{userTagline(row.user)}</p>
          <p className="mt-0.5 text-xs text-subtle-foreground">
            {row.mutualCount > 0 ? `${row.mutualCount} mutual connection${row.mutualCount === 1 ? "" : "s"}, ` : ""}
            {direction === "received" ? "sent " : "you sent "}
            <TimeAgo value={row.since} />
          </p>
          {row.note ? <p className="mt-2 whitespace-pre-line rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">{row.note}</p> : null}
        </div>
      </div>
      <div className="flex shrink-0 gap-2 sm:pt-1">
        {direction === "received" ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => ignore.mutate(row)} disabled={busy} data-testid="invitation-ignore">
              Ignore
            </Button>
            <Button size="sm" variant="outline" onClick={() => accept.mutate(row)} disabled={busy} data-testid="invitation-accept">
              Accept
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => withdraw.mutate(row)} disabled={busy} data-testid="invitation-withdraw">
            Withdraw
          </Button>
        )}
      </div>
    </li>
  );
}

export function InvitationsCard() {
  const [direction, setDirection] = useState<Direction>("received");
  const counts = useCounts();
  const list = usePagedList<NetworkRow>({
    queryKey: qk.invitations(direction),
    fetchPage: async (cursor) => withIds(await api().network.invitations(direction, { cursor })),
  });
  const received = counts.data?.connectionRequests ?? 0;

  return (
    <Card data-testid="network-invitations">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-xl font-semibold">Invitations</h2>
        <Segmented<Direction>
          aria-label="Invitation direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "received", label: "Received", count: received },
            { value: "sent", label: "Sent" },
          ]}
        />
      </div>
      <div className="px-4">
        {list.isPending ? (
          <div className="space-y-4 py-4">
            {Array.from({ length: 2 }, (_, i) => (
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
            compact
            icon={direction === "received" ? <Inbox /> : <Send />}
            title={direction === "received" ? "No pending invitations" : "No invitations waiting"}
            description={direction === "received" ? "When someone invites you to connect, it shows up here." : "Invitations you send stay here until they are accepted or you withdraw them."}
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.items.map((row) => (
              <InvitationRow key={row.id} row={row} direction={direction} />
            ))}
          </ul>
        )}
        <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
      </div>
    </Card>
  );
}
