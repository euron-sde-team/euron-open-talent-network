"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, MapPin, Send, Star } from "lucide-react";
import type { Page, SearchResults, TalentCard } from "@open-talent/types";
import { Avatar, Badge, Button, Card, Tooltip, cn, toast } from "@open-talent/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { profileHref } from "@/components/common/user-bits";
import { InviteDialog } from "./invite-dialog";

type Snapshot = [readonly unknown[], unknown][];

const markSaved = (cards: TalentCard[], username: string, on: boolean) => cards.map((c) => (c.user.username === username ? { ...c, saved: on } : c));

/** Flip `saved` on this person's card in every people list and the "All" search results. */
export function setSavedEverywhere(qc: QueryClient, username: string, on: boolean): Snapshot {
  const snapshot: Snapshot = [];
  for (const [key, data] of qc.getQueriesData({ predicate: (q) => q.queryKey[0] === "people" || q.queryKey[0] === "search-all" })) {
    if (!data || typeof data !== "object") continue;
    snapshot.push([key, data]);
    const d = data as Partial<InfiniteData<Page<TalentCard>>> & Partial<SearchResults>;
    if (Array.isArray(d.pages)) qc.setQueryData(key, { ...d, pages: d.pages.map((p) => ({ ...p, items: markSaved(p.items, username, on) })) });
    else if (Array.isArray(d.people)) qc.setQueryData(key, { ...d, people: markSaved(d.people, username, on) });
  }
  return snapshot;
}

/** Save or unsave, flipping the card's `saved` in every cached list at once and rolling back on failure. */
export function useSaveToggle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, on }: { username: string; on: boolean }) => (on ? api().recruiter.save(username) : api().recruiter.unsave(username)),
    onMutate: async ({ username, on }) => {
      await qc.cancelQueries({ queryKey: ["people"] });
      return { snapshot: setSavedEverywhere(qc, username, on) };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
    },
    onSuccess: (_d, { on }) => {
      toast.success({ title: on ? "Saved to your candidates" : "Removed from saved" });
      // Stale, not refetched: an open saved list keeps an unsaved card so a slip can be undone in place.
      void qc.invalidateQueries({ queryKey: qk.savedCandidates, refetchType: "none" });
    },
  });
}

export function TalentResultCard({
  card,
  saved = card.saved,
  footer,
  onSavedChange,
  testId = "talent-card",
}: {
  card: TalentCard;
  /** Overrides `card.saved` (the saved list tracks unsaves made in place). */
  saved?: boolean;
  footer?: React.ReactNode;
  onSavedChange?: (on: boolean) => void;
  testId?: string;
}) {
  const toggle = useSaveToggle();
  const [invite, setInvite] = useState(false);
  const matched = new Set(card.matchedSkills.map((s) => s.toLowerCase()));
  const skills = [...card.topSkills].sort((a, b) => Number(matched.has(b.toLowerCase())) - Number(matched.has(a.toLowerCase())));
  const extraMatched = card.matchedSkills.filter((m) => !card.topSkills.some((t) => t.toLowerCase() === m.toLowerCase()));

  return (
    <Card className="p-4" data-testid={testId}>
      <div className="flex items-start gap-3">
        <Link href={profileHref(card.user.username)} className="shrink-0 rounded-full" tabIndex={-1} aria-hidden>
          <Avatar name={card.user.displayName} seed={card.user.id} src={card.user.avatarUrl} size="lg" openToWork={card.openToWork} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={profileHref(card.user.username)} className="truncate font-semibold hover:underline">
              {card.user.displayName}
            </Link>
            {card.openToWork ? <Badge tone="success">Open to work</Badge> : null}
            {card.rating.count > 0 && card.rating.average !== null ? (
              <Tooltip content={`${card.rating.count} rating${card.rating.count === 1 ? "" : "s"} from engagements`}>
                <span className="inline-flex items-center gap-0.5 text-xs font-semibold">
                  <Star className="size-3.5 fill-warning text-warning" aria-hidden />
                  {card.rating.average.toFixed(1)}
                  <span className="font-normal text-subtle-foreground">({card.rating.count})</span>
                </span>
              </Tooltip>
            ) : null}
          </div>
          {card.headline ? <p className="line-clamp-2 text-sm text-muted-foreground">{card.headline}</p> : null}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle-foreground">
            {card.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {card.location}
              </span>
            ) : null}
            {card.yearsExperience !== null ? <span>{card.yearsExperience} yrs experience</span> : null}
          </p>
          {skills.length || extraMatched.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {[...extraMatched, ...skills].slice(0, 8).map((s) => {
                const hit = matched.has(s.toLowerCase());
                return (
                  <span key={s} className={cn("rounded-full px-2 py-0.5 text-2xs font-semibold", hit ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                    {s}
                  </span>
                );
              })}
            </div>
          ) : null}
          {card.badges.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {card.badges.slice(0, 3).map((b) => (
                <Badge key={b.slug} tone="outline">
                  {b.label}
                </Badge>
              ))}
            </div>
          ) : null}
          {footer}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
        <Button
          size="sm"
          variant={saved ? "soft" : "outline"}
          aria-pressed={saved}
          onClick={() => {
            onSavedChange?.(!saved);
            toggle.mutate({ username: card.user.username, on: !saved }, { onError: () => onSavedChange?.(saved) });
          }}
          data-testid="talent-save"
        >
          <Star className={cn(saved && "fill-current")} /> {saved ? "Saved" : "Save"}
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link href={profileHref(card.user.username)} data-testid="talent-approach">
            <Send /> Approach
          </Link>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setInvite(true)} data-testid="talent-invite">
          <BriefcaseBusiness /> Invite to a job
        </Button>
      </div>
      {invite ? <InviteDialog open={invite} onOpenChange={setInvite} username={card.user.username} name={card.user.displayName} /> : null}
    </Card>
  );
}
