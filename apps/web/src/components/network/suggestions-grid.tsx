"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { Avatar, Card, EmptyState, IconButton, Skeleton } from "@open-talent/ui";
import type { NetworkEntry } from "@open-talent/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { ErrorState } from "@/components/common/states";
import { profileHref, RoleMark, userTagline } from "@/components/common/user-bits";
import { ConnectButton } from "./connect-button";

function SuggestionCard({ entry, onDismiss }: { entry: NetworkEntry; onDismiss: () => void }) {
  const u = entry.user;
  return (
    <li className="relative flex flex-col overflow-hidden rounded-lg border border-border bg-card" data-testid="suggestion-card">
      <div className="h-14 bg-[linear-gradient(120deg,hsl(var(--primary)/0.7),hsl(var(--primary)/0.25))]" aria-hidden />
      <IconButton label={`Dismiss ${u.displayName}`} size="sm" variant="muted" className="absolute right-2 top-2 bg-card/80" onClick={onDismiss} data-testid="suggestion-dismiss">
        <X />
      </IconButton>
      <div className="-mt-9 flex flex-1 flex-col items-center px-3 pb-3 text-center">
        <Link href={profileHref(u.username)} className="rounded-full focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar name={u.displayName} seed={u.id} src={u.avatarUrl} size="xl" openToWork={u.openToWork} className="rounded-full ring-2 ring-card" />
        </Link>
        <Link href={profileHref(u.username)} className="mt-2 inline-flex max-w-full items-center gap-1 font-semibold leading-tight text-foreground hover:underline">
          <span className="truncate">{u.displayName}</span>
          <RoleMark role={u.role} />
        </Link>
        <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">{userTagline(u)}</p>
        <p className="mt-2 min-h-4 text-xs text-subtle-foreground">{entry.mutualCount > 0 ? `${entry.mutualCount} mutual connection${entry.mutualCount === 1 ? "" : "s"}` : ""}</p>
        <div className="mt-auto w-full pt-3">
          <ConnectButton user={u} state={entry.connection} connectionId={entry.connectionId} block />
        </div>
      </div>
    </li>
  );
}

/** "People you may know": second-degree connections first, then colleagues and shared skills. */
export function SuggestionsGrid() {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const q = useQuery({ queryKey: qk.suggestions, queryFn: () => api().network.suggestions(), staleTime: 300_000 });
  const visible = (q.data ?? []).filter((e) => !dismissed.has(e.user.id));

  return (
    <Card data-testid="network-suggestions">
      <div className="px-4 pb-2 pt-4">
        <h2 className="text-xl font-semibold">People you may know</h2>
        <p className="text-sm text-muted-foreground">Based on mutual connections, shared workplaces and skills.</p>
      </div>
      <div className="p-4 pt-2">
        {q.isPending ? (
          <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="overflow-hidden rounded-lg border border-border">
                <Skeleton className="h-14 rounded-none" />
                <div className="flex flex-col items-center gap-2 p-3">
                  <Skeleton className="-mt-10 size-20 rounded-full" />
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="mt-2 h-8 w-full" />
                </div>
              </li>
            ))}
          </ul>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
        ) : !visible.length ? (
          <EmptyState
            compact
            icon={<Sparkles />}
            title="No suggestions right now"
            description="Add your experience and skills to your profile, and we will suggest people you have worked with or share skills with."
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {visible.map((e) => (
              <SuggestionCard key={e.user.id} entry={e} onDismiss={() => setDismissed((s) => new Set(s).add(e.user.id))} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
