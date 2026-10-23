"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Shield, Sparkles } from "lucide-react";
import { Avatar, Card, CountBadge, cn } from "@open-talent/ui";
import { useAuth } from "@/lib/auth";
import { profileHref, userTagline } from "@/components/common/user-bits";
import { SECONDARY_NAV } from "./nav-items";
import { useNavBadges } from "./header";

function RailLink({ href, icon, label, active, count }: { href: string; icon: React.ReactNode; label: string; active?: boolean; count?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors", active ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-muted")}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <CountBadge count={count} className="ring-0" /> : null}
    </Link>
  );
}

/** A slim progress bar; the colour turns to success once the profile can be published. */
export function CompletenessMeter({ value, threshold = 55, className }: { value: number; threshold?: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={className}>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Profile strength">
        <div className={cn("h-full rounded-full transition-[width]", pct >= threshold ? "bg-success" : "bg-warning")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Feed left rail: the viewer's profile card, then shortcuts. */
export function LeftRail() {
  const pathname = usePathname() ?? "/";
  const { user, isStaff, status } = useAuth();
  const badges = useNavBadges();
  if (status !== "signed-in" || !user) return null;
  const draft = user.profileStatus === "DRAFT";
  return (
    <div className="space-y-3 pb-8">
      <Card className="overflow-hidden" data-testid="rail-profile-card">
        <div className="h-14 bg-[linear-gradient(120deg,hsl(var(--primary)/0.85),hsl(var(--primary)/0.35))]" aria-hidden />
        <div className="-mt-8 px-4 pb-4">
          <Link href={profileHref(user.username)} className="block">
            <Avatar name={user.displayName} seed={user.id} src={user.avatarUrl} size="xl" openToWork={user.openToWork} className="rounded-full ring-2 ring-card" />
            <p className="mt-2 text-base font-semibold leading-tight hover:underline">{user.displayName}</p>
          </Link>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{userTagline(user)}</p>
        </div>
        <div className="border-t border-border px-4 py-3 text-sm">
          <Link href="/network/connections" className="flex items-center justify-between hover:underline">
            <span className="text-muted-foreground">Connections</span>
            <span className="font-semibold text-primary-soft-foreground">{user.connectionCount}</span>
          </Link>
          <Link href="/network" className="mt-1 flex items-center justify-between hover:underline">
            <span className="text-muted-foreground">Invitations</span>
            <span className="font-semibold text-primary-soft-foreground">{badges["/network"] ?? 0}</span>
          </Link>
        </div>
        {draft || user.profileCompleteness < 100 ? (
          <Link href={draft ? "/profile/setup" : profileHref(user.username)} className="block border-t border-border px-4 py-3 hover:bg-muted" data-testid="rail-completeness">
            <span className="flex items-center justify-between text-sm">
              <span className="font-medium">{draft ? "Finish and publish your profile" : "Profile strength"}</span>
              <span className="text-muted-foreground">{user.profileCompleteness}%</span>
            </span>
            <CompletenessMeter value={user.profileCompleteness} className="mt-2" />
            {draft ? (
              <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-soft-foreground">
                <Sparkles className="size-3.5" /> Import from a resume in one step <ChevronRight className="size-3" />
              </span>
            ) : null}
          </Link>
        ) : null}
      </Card>

      <Card className="p-1.5">
        <nav aria-label="Shortcuts">
          {SECONDARY_NAV.map((n) => (
            <RailLink key={n.href} href={n.href} label={n.label} active={pathname === n.href || pathname.startsWith(`${n.href}/`)} icon={<n.icon className="size-[18px]" />} />
          ))}
          {isStaff ? <RailLink href="/moderation" label="Moderation desk" active={pathname.startsWith("/moderation")} icon={<Shield className="size-[18px]" />} /> : null}
        </nav>
      </Card>
    </div>
  );
}
