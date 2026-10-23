"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, Search } from "lucide-react";
import { Button, CountBadge, Dialog, DialogContent, DialogTitle, IconButton, Tooltip, cn } from "@open-talent/ui";
import { useAuth } from "@/lib/auth";
import { useCounts } from "@/lib/hooks/queries";
import { Wordmark } from "@/components/common/wordmark";
import { AvatarMenu } from "./avatar-menu";
import { NotificationsBell } from "./notifications-bell";
import { PRIMARY_NAV } from "./nav-items";
import { SearchBox } from "./search-box";

/** Unread badges per nav href, from the single live counts query. */
export function useNavBadges(): Record<string, number> {
  const c = useCounts().data;
  return {
    "/network": c?.connectionRequests ?? 0,
    "/messaging": (c?.messages ?? 0) + (c?.messageRequests ?? 0),
    "/notifications": c?.notifications ?? 0,
  };
}

/** Where the recruiter switch goes: the workspace once ACTIVE, onboarding before that. */
export function useRecruiterHref(): { href: string; label: string } {
  const { user } = useAuth();
  const r = user?.recruiter;
  if (r?.status === "ACTIVE") return { href: "/recruiter", label: "Recruiter" };
  if (r) return { href: "/recruiter/join", label: "Recruiter setup" };
  return { href: "/recruiter/join", label: "Hire talent" };
}

export function Header() {
  const pathname = usePathname() ?? "/";
  const { status } = useAuth();
  const badges = useNavBadges();
  const recruiter = useRecruiterHref();
  const [searchOpen, setSearchOpen] = useState(false);
  const signedIn = status === "signed-in";
  return (
    <header className="sticky top-0 z-50 h-header border-b border-border bg-card/95 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <div className="mx-auto flex h-full max-w-[1280px] items-center gap-2 px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 lg:flex-none lg:basis-[340px]">
          {/* Signed out, the sign-in buttons need the room on a phone: the mark alone links home. */}
          <Wordmark className="shrink-0" compact={false} textClassName={status === "signed-out" ? "hidden sm:inline" : undefined} />
          <SearchBox className="hidden w-full max-w-[280px] md:block" />
        </div>

        <nav aria-label="Primary" className="hidden flex-1 items-center justify-center gap-0.5 md:flex">
          {(signedIn ? PRIMARY_NAV : PRIMARY_NAV.filter((n) => n.href === "/jobs")).map((item) => {
            const active = item.match(pathname);
            const count = badges[item.href] ?? 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={count ? `${item.label}, ${count} new` : item.label}
                aria-current={active ? "page" : undefined}
                data-testid={`nav-${item.href === "/" ? "home" : item.href.slice(1)}`}
                className={cn(
                  "relative flex h-[calc(var(--header-height)-2px)] min-w-[72px] flex-col items-center justify-center gap-0.5 px-2 text-xs transition-colors lg:min-w-[88px]",
                  active ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="relative">
                  <item.icon className="size-6" strokeWidth={active ? 2.3 : 1.9} />
                  <CountBadge count={count} className="absolute -right-2.5 -top-1.5" />
                </span>
                <span className="hidden lg:block">{item.label}</span>
                {active ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-foreground" /> : null}
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-none items-center justify-end gap-2 lg:basis-[340px]">
          <IconButton label="Search" variant="muted" size="lg" className="md:hidden" onClick={() => setSearchOpen(true)}>
            <Search />
          </IconButton>
          {signedIn ? (
            <>
              <NotificationsBell />
              <AvatarMenu />
              <span className="mx-1 hidden h-8 w-px bg-border lg:block" aria-hidden />
              <Tooltip content={recruiter.label === "Recruiter" ? "Open your recruiter workspace" : "Hire on this network"}>
                <Link
                  href={recruiter.href}
                  data-testid="nav-recruiter"
                  className={cn(
                    "hidden h-[calc(var(--header-height)-2px)] flex-col items-center justify-center gap-0.5 px-2 text-xs lg:flex",
                    pathname.startsWith("/recruiter") ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <BriefcaseBusiness className="size-6 text-primary" strokeWidth={1.9} />
                  {recruiter.label}
                </Link>
              </Tooltip>
            </>
          ) : status === "signed-out" ? (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/talent">People</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Join now</Link>
              </Button>
            </>
          ) : (
            <span className="size-10 animate-shimmer rounded-full bg-muted" aria-hidden />
          )}
        </div>
      </div>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="top-4 translate-y-0 p-4" hideClose>
          <DialogTitle className="sr-only">Search</DialogTitle>
          <SearchBox autoFocus onNavigate={() => setSearchOpen(false)} />
        </DialogContent>
      </Dialog>
    </header>
  );
}
