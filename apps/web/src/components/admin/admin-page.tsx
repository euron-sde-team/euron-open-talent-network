"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Briefcase, Building2, Flag, Gauge, ScrollText, Settings2, ShieldAlert, Users, type LucideIcon } from "lucide-react";
import { isApiError } from "@open-talent/api-client";
import { Badge, Skeleton, cn } from "@open-talent/ui";
import type { AdminArea, AdminPermissions, UserRole } from "@open-talent/types";
import { api } from "@/lib/api";
import { useProductName } from "@/lib/meta";
import { humanize } from "@/lib/moderation";
import { qk } from "@/lib/query-keys";
import { useSignals } from "@/lib/stores/signals";
import { ErrorState } from "@/components/common/states";
import { ModerationDesk } from "@/components/moderation/moderation-desk";
import { ForbiddenArea } from "./admin-bits";
import { AdminAudit } from "./audit";
import { AdminCompanies } from "./companies";
import { AdminComplaints } from "./complaints";
import { AdminJobs } from "./jobs";
import { AdminOverview } from "./overview";
import { AdminRecruiters } from "./recruiters";
import { AdminSettings } from "./settings-form";
import { AdminUsers } from "./users";

export interface AdminViewer {
  role: UserRole;
  areas: AdminPermissions;
}

const AREAS: { id: AdminArea; label: string; icon: LucideIcon; hint: string }[] = [
  { id: "overview", label: "Overview", icon: Gauge, hint: "Network health over a date range" },
  { id: "recruiters", label: "Recruiter approvals", icon: BadgeCheck, hint: "Review recruiter applications" },
  { id: "companies", label: "Companies", icon: Building2, hint: "Verify and manage company pages" },
  { id: "moderation", label: "Moderation", icon: ShieldAlert, hint: "Flagged and reported content" },
  { id: "people", label: "People", icon: Users, hint: "Accounts, profiles and badges" },
  { id: "jobs", label: "Jobs", icon: Briefcase, hint: "Every job posting" },
  { id: "complaints", label: "Complaints", icon: Flag, hint: "Disputes between members" },
  { id: "settings", label: "Settings", icon: Settings2, hint: "Platform policies and limits" },
  { id: "audit", label: "Audit log", icon: ScrollText, hint: "Every change, by whom" },
];

export function areaHref(area: AdminArea, extra?: Record<string, string>): string {
  const p = new URLSearchParams({ area, ...(extra ?? {}) });
  return `/admin?${p.toString()}`;
}

export function AdminPage() {
  const product = useProductName();
  const params = useSearchParams();
  const pathname = usePathname();
  const me = useQuery({ queryKey: qk.adminMe, queryFn: () => api().admin.me(), staleTime: 60_000, retry: (n, e) => !(isApiError(e) && e.status === 403) && n < 2 });
  const liveOpen = useSignals((s) => s.modOpenCases);

  if (me.isPending) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Skeleton className="hidden h-96 lg:block" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (me.isError) {
    if (isApiError(me.error) && me.error.status === 403) return <ForbiddenArea title="The control plane is for network staff" />;
    return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  }
  const viewer: AdminViewer = me.data;
  const visible = AREAS.filter((a) => viewer.areas[a.id]);
  if (!visible.length) return <ForbiddenArea title="The control plane is for network staff" />;
  const requested = params.get("area") as AdminArea | null;
  // An unknown ?area= (a stale link) opens the first area rather than claiming a 403.
  const active = (requested && AREAS.find((a) => a.id === requested)) || visible[0];
  const allowed = !!active && viewer.areas[active.id];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="min-w-0 lg:sticky lg:top-[calc(var(--header-height)+16px)] lg:self-start">
        <div className="mb-3 hidden lg:block">
          <p className="text-2xs font-semibold uppercase tracking-wide text-subtle-foreground">{product}</p>
          <h1 className="text-lg font-bold tracking-tight">Control plane</h1>
          <Badge tone="primary" className="mt-1">
            {humanize(viewer.role)}
          </Badge>
        </div>
        <nav aria-label="Admin areas" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:overflow-visible lg:px-0" data-testid="admin-nav">
          <ul className="flex gap-1 lg:flex-col">
            {visible.map((a) => {
              const current = active?.id === a.id;
              const count = a.id === "moderation" ? liveOpen : null;
              return (
                <li key={a.id} className="shrink-0">
                  <Link
                    href={`${pathname}?area=${a.id}`}
                    scroll={false}
                    aria-current={current ? "page" : undefined}
                    title={a.hint}
                    data-testid={`admin-area-${a.id}`}
                    className={cn(
                      "flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      current ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <a.icon className={cn("size-4 shrink-0", current ? "text-primary" : "text-subtle-foreground")} aria-hidden />
                    <span className="flex-1">{a.label}</span>
                    {count ? <span className="rounded-full bg-warning-soft px-1.5 text-2xs font-bold tabular-nums text-warning-soft-foreground">{count > 99 ? "99+" : count}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <section className="min-w-0" aria-label={active?.label ?? "Admin"}>
        {!allowed ? <ForbiddenArea /> : <AreaView area={active!.id} viewer={viewer} />}
      </section>
    </div>
  );
}

function AreaView({ area, viewer }: { area: AdminArea; viewer: AdminViewer }) {
  switch (area) {
    case "overview":
      return <AdminOverview viewer={viewer} />;
    case "recruiters":
      return <AdminRecruiters />;
    case "companies":
      return <AdminCompanies />;
    case "moderation":
      return <ModerationDesk embedded />;
    case "people":
      return <AdminUsers viewer={viewer} />;
    case "jobs":
      return <AdminJobs />;
    case "complaints":
      return <AdminComplaints />;
    case "settings":
      return <AdminSettings />;
    case "audit":
      return <AdminAudit />;
  }
}
