"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Eye, Handshake, Mail, ShieldAlert, Star } from "lucide-react";
import { cn } from "@open-talent/ui";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { profileHref } from "@/components/common/user-bits";
import { ApproachesTab } from "./approaches-tab";
import { ComplaintsTab } from "./complaints-tab";
import { ContactLogTab } from "./contact-log-tab";
import { EngagementsTab } from "./engagements-tab";
import { InvitesTab } from "./invites-tab";
import { OverviewTab } from "./overview-tab";

const TABS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "approaches", label: "Approaches", icon: Handshake },
  { id: "invites", label: "Job invitations", icon: Mail },
  { id: "contact-log", label: "Contact access", icon: Eye },
  { id: "engagements", label: "Engagements and ratings", icon: Star },
  { id: "complaints", label: "Complaints", icon: ShieldAlert },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function DashboardPage() {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params?.get("tab");
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : "overview";
  // Shares the overview's cache entry, so the pending badge costs nothing extra.
  const analytics = useQuery({ queryKey: qk.profileAnalytics, queryFn: () => api().profiles.analytics(), staleTime: 60_000, meta: { silent: true } });
  const invites = useQuery({ queryKey: qk.jobInvites, queryFn: () => api().jobs.invites(), staleTime: 60_000, meta: { silent: true } });
  const badge: Partial<Record<TabId, number>> = {
    approaches: analytics.data?.approaches.pending ?? 0,
    invites: invites.data?.filter((i) => i.status === "SENT").length ?? 0,
  };

  const hrefFor = (id: TabId) => {
    const p = new URLSearchParams(params?.toString());
    if (id === "overview") p.delete("tab");
    else p.set("tab", id);
    const s = p.toString();
    return s ? `${pathname}?${s}` : (pathname ?? "/dashboard");
  };
  const go = (id: TabId) => router.replace(hrefFor(id), { scroll: false });

  return (
    <div data-testid="dashboard-page">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Your dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Private to you. How your{" "}
          <Link href={profileHref(me.username)} className="font-medium text-link hover:underline">
            profile
          </Link>{" "}
          is doing, and every recruiter interaction in one place.
        </p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[210px_minmax(0,1fr)] md:gap-6">
        <nav aria-label="Dashboard sections" className="-mx-4 md:mx-0">
          <ul className="flex gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] md:sticky md:top-[calc(var(--header-height)+1rem)] md:flex-col md:overflow-visible md:border-b-0 md:px-0">
            {TABS.map((t) => {
              const active = t.id === tab;
              const n = badge[t.id] ?? 0;
              return (
                <li key={t.id} className="shrink-0">
                  <Link
                    href={hrefFor(t.id)}
                    replace
                    scroll={false}
                    aria-current={active ? "page" : undefined}
                    data-testid={`dashboard-tab-${t.id}`}
                    className={cn(
                      "flex items-center gap-2.5 whitespace-nowrap text-sm font-semibold transition-colors",
                      "max-md:-mb-px max-md:h-11 max-md:border-b-2 max-md:px-3",
                      "md:rounded-md md:px-3 md:py-2",
                      active
                        ? "text-foreground max-md:border-primary md:bg-primary/10"
                        : "text-muted-foreground hover:text-foreground max-md:border-transparent md:hover:bg-muted",
                    )}
                  >
                    <t.icon className="size-4 shrink-0 max-md:hidden" aria-hidden />
                    <span className="md:flex-1">{t.label}</span>
                    {n ? (
                      <span className="rounded-full bg-primary px-1.5 text-2xs font-bold tabular-nums text-primary-foreground" aria-label={`${n} new`}>
                        {n > 99 ? "99+" : n}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <section className="min-w-0" aria-live="off">
          {tab === "overview" ? (
            <OverviewTab onTab={go} />
          ) : tab === "approaches" ? (
            <ApproachesTab />
          ) : tab === "invites" ? (
            <InvitesTab />
          ) : tab === "contact-log" ? (
            <ContactLogTab />
          ) : tab === "engagements" ? (
            <EngagementsTab />
          ) : (
            <ComplaintsTab />
          )}
        </section>
      </div>
    </div>
  );
}
