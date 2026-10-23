"use client";

import { useMutation } from "@tanstack/react-query";
import { BadgeCheck, EyeOff, Quote, Sparkles, Star } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger, Switch, Tooltip, cn } from "@open-talent/ui";
import type { Badge as BadgeT, RatingSummary } from "@open-talent/types";
import { api } from "@/lib/api";
import { BADGE_KIND_LABEL } from "./profile-utils";
import { useApplyMine } from "./use-profile";

const SOURCE_LABEL: Record<BadgeT["source"], string> = { AI: "Suggested by AI from evidence in the profile", SYSTEM: "Calculated from the profile", ADMIN: "Granted by the network team" };

/** Badges under the name. Hover shows the rationale; click opens the evidence (and the owner's visibility switch). */
export function BadgeRow({ badges, owner }: { badges: BadgeT[]; owner?: boolean }) {
  const applyMine = useApplyMine();
  const toggle = useMutation({
    mutationFn: ({ id, visible }: { id: string; visible: boolean }) => api().profiles.badgeVisibility(id, visible),
    onSuccess: applyMine,
  });
  const shown = owner ? badges : badges.filter((b) => b.isVisible);
  if (!shown.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Badges" data-testid="profile-badges">
      {shown.map((b) => (
        <li key={b.id}>
          <Popover>
            <Tooltip content={b.rationale ?? BADGE_KIND_LABEL[b.kind]}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors hover:bg-muted focus-visible:ring-2",
                    b.isVisible ? "border-primary/30 bg-primary-soft text-primary-soft-foreground" : "border-dashed border-border text-subtle-foreground",
                  )}
                  data-testid="profile-badge"
                >
                  {b.source === "ADMIN" ? <BadgeCheck className="size-3.5" /> : b.source === "AI" ? <Sparkles className="size-3.5" /> : <Star className="size-3.5" />}
                  {b.label}
                  {b.percentile != null ? <span className="font-normal opacity-80">top {Math.max(1, 100 - Math.round(b.percentile))}%</span> : null}
                  {!b.isVisible ? <EyeOff className="size-3" aria-label="Hidden" /> : null}
                </button>
              </PopoverTrigger>
            </Tooltip>
            <PopoverContent className="w-80 max-w-[calc(100vw-32px)] space-y-2 text-sm" align="start">
              <p className="font-semibold text-foreground">{b.label}</p>
              <p className="text-xs text-subtle-foreground">
                {BADGE_KIND_LABEL[b.kind]} · {SOURCE_LABEL[b.source]}
                {b.confidence != null && b.source === "AI" ? ` · ${Math.round(b.confidence * 100)}% confidence` : ""}
              </p>
              {b.rationale ? <p className="text-muted-foreground">{b.rationale}</p> : null}
              {b.evidenceQuote ? (
                <blockquote className="flex gap-2 rounded-md bg-muted px-3 py-2 text-foreground">
                  <Quote className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" />
                  <span className="italic">{b.evidenceQuote}</span>
                </blockquote>
              ) : null}
              {owner ? (
                <label className="flex items-center justify-between gap-3 border-t border-border pt-2 text-sm">
                  <span>Show on my profile</span>
                  <Switch checked={b.isVisible} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate({ id: b.id, visible: v })} aria-label={`Show ${b.label} on my profile`} />
                </label>
              ) : null}
            </PopoverContent>
          </Popover>
        </li>
      ))}
    </ul>
  );
}

export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-hidden>
      {Array.from({ length: 5 }, (_, i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span key={i} className="relative inline-block size-3.5">
            <Star className="absolute inset-0 size-3.5 text-border" />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className="size-3.5 fill-warning text-warning" />
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** "4.3 ★★★★☆ (12 ratings)". The average is Bayesian (computed on the server). */
export function RatingLine({ rating, href }: { rating: RatingSummary; href?: string }) {
  if (!rating.count || rating.average == null) return null;
  const label = `Rated ${rating.average.toFixed(1)} out of 5 from ${rating.count} rating${rating.count > 1 ? "s" : ""}`;
  const body = (
    <>
      <span className="font-semibold text-foreground">{rating.average.toFixed(1)}</span>
      <Stars value={rating.average} />
      <span>
        ({rating.count} rating{rating.count > 1 ? "s" : ""})
      </span>
    </>
  );
  return (
    <Tooltip content="A weighted average from completed engagements, so a few ratings do not outweigh many.">
      {href ? (
        <a href={href} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:underline" aria-label={label} data-testid="rating-summary">
          {body}
        </a>
      ) : (
        <span tabIndex={0} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground" aria-label={label} data-testid="rating-summary">
          {body}
        </span>
      )}
    </Tooltip>
  );
}
