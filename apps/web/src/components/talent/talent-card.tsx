"use client";

import Link from "next/link";
import { Award, BriefcaseBusiness, MapPin } from "lucide-react";
import { Avatar, Badge, cn } from "@open-talent/ui";
import type { TalentCard } from "@open-talent/types";
import { useAuth } from "@/lib/auth";
import { profileHref, RoleMark, userTagline } from "@/components/common/user-bits";
import { ConnectButton } from "@/components/network/connect-button";
import { RatingLine } from "./stars";

function SkillChips({ card, max = 5 }: { card: TalentCard; max?: number }) {
  const matched = new Set(card.matchedSkills.map((s) => s.toLowerCase()));
  // Matched skills first, so the reason this person showed up is visible at a glance.
  const skills = [...card.matchedSkills, ...card.topSkills.filter((s) => !matched.has(s.toLowerCase()))].slice(0, max);
  if (!skills.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Skills">
      {skills.map((s) => {
        const hit = matched.has(s.toLowerCase());
        return (
          <li
            key={s}
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs",
              hit ? "border-primary/30 bg-primary-soft font-semibold text-primary-soft-foreground" : "border-border text-muted-foreground",
            )}
          >
            {hit ? <span className="sr-only">Matched skill: </span> : null}
            {s}
          </li>
        );
      })}
    </ul>
  );
}

function Facts({ card }: { card: TalentCard }) {
  const bits = [
    card.location ? (
      <span key="l" className="inline-flex items-center gap-1">
        <MapPin className="size-3.5" aria-hidden /> {card.location}
      </span>
    ) : null,
    card.yearsExperience != null ? (
      <span key="y" className="inline-flex items-center gap-1">
        <BriefcaseBusiness className="size-3.5" aria-hidden /> {card.yearsExperience} yr{card.yearsExperience === 1 ? "" : "s"} experience
      </span>
    ) : null,
  ].filter(Boolean);
  if (!bits.length) return null;
  return <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle-foreground">{bits}</p>;
}

function Badges({ card }: { card: TalentCard }) {
  if (!card.badges.length && !card.openToWork) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {card.openToWork ? <Badge tone="success">Open to work</Badge> : null}
      {card.badges.slice(0, 3).map((b) => (
        <Badge key={b.slug} tone="primary">
          <Award aria-hidden /> {b.label}
        </Badge>
      ))}
    </div>
  );
}

/** A directory result. `layout="grid"` is a centred card, `"list"` a dense row. */
export function TalentCardView({ card, layout = "grid" }: { card: TalentCard; layout?: "grid" | "list" }) {
  const { status } = useAuth();
  const u = card.user;
  const href = profileHref(u.username);
  const headline = card.headline ?? userTagline(u);
  const connect = status === "signed-in" ? <ConnectButton user={u} state={card.connection} connectionId={null} block={layout === "grid"} /> : null;

  if (layout === "list")
    return (
      <article className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start" data-testid="talent-card">
        <Link href={href} className="shrink-0 self-start rounded-full focus-visible:ring-2 focus-visible:ring-ring" tabIndex={-1} aria-hidden>
          <Avatar name={u.displayName} seed={u.id} src={u.avatarUrl} size="lg" openToWork={card.openToWork} />
        </Link>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={href} className="font-semibold text-foreground hover:underline">
              {u.displayName}
            </Link>
            <RoleMark role={u.role} />
            <RatingLine rating={card.rating} />
          </div>
          <p className="line-clamp-2 text-sm text-muted-foreground">{headline}</p>
          <Facts card={card} />
          <Badges card={card} />
          <SkillChips card={card} max={8} />
        </div>
        {connect ? <div className="shrink-0">{connect}</div> : null}
      </article>
    );

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card" data-testid="talent-card">
      <div className="h-12 bg-[linear-gradient(120deg,hsl(var(--primary)/0.55),hsl(var(--primary)/0.15))]" aria-hidden />
      <div className="-mt-8 flex flex-1 flex-col gap-2 px-4 pb-4">
        <Link href={href} className="self-start rounded-full focus-visible:ring-2 focus-visible:ring-ring" tabIndex={-1} aria-hidden>
          <Avatar name={u.displayName} seed={u.id} src={u.avatarUrl} size="lg" openToWork={card.openToWork} className="rounded-full ring-2 ring-card" />
        </Link>
        <div>
          <Link href={href} className="inline-flex max-w-full items-center gap-1 font-semibold text-foreground hover:underline">
            <span className="truncate">{u.displayName}</span>
            <RoleMark role={u.role} />
          </Link>
          <p className="line-clamp-2 text-sm text-muted-foreground">{headline}</p>
        </div>
        <Facts card={card} />
        <RatingLine rating={card.rating} />
        <Badges card={card} />
        <SkillChips card={card} />
        {connect ? <div className="mt-auto pt-2">{connect}</div> : null}
      </div>
    </article>
  );
}
