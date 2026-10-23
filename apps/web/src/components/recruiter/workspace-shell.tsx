"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BriefcaseBusiness, Building2, Handshake, Home, Search, Send, Settings, Star } from "lucide-react";
import { cn } from "@open-talent/ui";
import { useAuth } from "@/lib/auth";
import { companyHref, CompanyLogo, VerifiedMark } from "@/components/common/user-bits";
import { FullPageSpinner } from "@/components/common/require-auth";
import { useRecruiterAccount } from "./use-recruiter";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  match: (p: string) => boolean;
  testId: string;
}

function navItems(slug: string): NavItem[] {
  return [
    { href: "/recruiter", label: "Home", icon: Home, match: (p) => p === "/recruiter", testId: "recruiter-nav-home" },
    { href: "/recruiter/jobs", label: "Jobs", icon: BriefcaseBusiness, match: (p) => p.startsWith("/recruiter/jobs"), testId: "recruiter-nav-jobs" },
    { href: "/recruiter/talent", label: "Talent search", icon: Search, match: (p) => p.startsWith("/recruiter/talent"), testId: "recruiter-nav-talent" },
    { href: "/recruiter/saved", label: "Saved candidates", icon: Star, match: (p) => p.startsWith("/recruiter/saved"), testId: "recruiter-nav-saved" },
    { href: "/recruiter/approaches", label: "Approaches", icon: Send, match: (p) => p.startsWith("/recruiter/approaches"), testId: "recruiter-nav-approaches" },
    { href: "/recruiter/engagements", label: "Engagements", icon: Handshake, match: (p) => p.startsWith("/recruiter/engagements"), testId: "recruiter-nav-engagements" },
    { href: companyHref(slug), label: "Company page", icon: Building2, match: () => false, testId: "recruiter-nav-company" },
    { href: "/recruiter/settings", label: "Settings", icon: Settings, match: (p) => p.startsWith("/recruiter/settings"), testId: "recruiter-nav-settings" },
  ];
}

/**
 * The recruiter workspace frame: a left sub-navigation (a scrolling strip on small
 * screens) and the page. Only ACTIVE recruiters get in; everyone else goes to onboarding.
 */
export function RecruiterWorkspace({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const active = user?.recruiter?.status === "ACTIVE";
  useEffect(() => {
    if (user && !active) router.replace("/recruiter/join");
  }, [user, active, router]);
  if (!user || !active) return <FullPageSpinner />;
  const company = user.recruiter!.company;
  const items = navItems(company.slug);

  return (
    <div className={cn("mx-auto flex gap-6 px-4 lg:gap-8", wide ? "max-w-[1920px]" : "max-w-[1320px]")}>
      <aside className="sticky top-header hidden h-[calc(100dvh-var(--header-height))] w-[232px] shrink-0 overflow-y-auto py-4 lg:block" aria-label="Recruiter workspace">
        <SideCard />
        <nav className="mt-3 space-y-0.5">
          {items.map((it) => {
            const on = it.match(pathname);
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={on ? "page" : undefined}
                data-testid={it.testId}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "bg-primary/10 font-semibold text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <it.icon className={cn("size-[18px] shrink-0", on ? "text-primary" : "")} aria-hidden />
                {it.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main id="main" className="min-w-0 flex-1 py-4">
        <nav aria-label="Recruiter workspace" className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] lg:hidden">
          {items.map((it) => {
            const on = it.match(pathname);
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold",
                  on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <it.icon className="size-4" aria-hidden />
                {it.label}
              </Link>
            );
          })}
        </nav>
        {children}
      </main>
    </div>
  );
}

function SideCard() {
  const { user } = useAuth();
  const { data } = useRecruiterAccount();
  const r = user!.recruiter!;
  const quota = data?.quota;
  const pct = quota ? Math.min(100, Math.round((quota.usedToday / Math.max(1, quota.approachesPerDay)) * 100)) : 0;
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-card">
      <div className="flex items-center gap-3">
        <CompanyLogo company={r.company} size="md" />
        <div className="min-w-0">
          <p className="flex items-center gap-1 truncate text-sm font-semibold">
            <span className="truncate">{r.company.name}</span>
            <VerifiedMark status={r.company.status} className="[&_svg]:size-3.5" />
          </p>
          <p className="truncate text-xs text-subtle-foreground">{data?.title ?? (r.role === "OWNER" ? "Owner" : r.role === "ADMIN" ? "Admin" : "Recruiter")}</p>
        </div>
      </div>
      {quota ? (
        <div className="mt-3">
          <div className="flex justify-between text-2xs font-medium text-muted-foreground">
            <span>Approaches today</span>
            <span>
              {quota.usedToday} of {quota.approachesPerDay}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
            <div className={cn("h-full rounded-full", pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
