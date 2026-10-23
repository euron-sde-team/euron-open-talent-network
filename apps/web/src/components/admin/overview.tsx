"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Activity, BadgeCheck, Briefcase, Building2, Download, FileText, Flag, Send, ShieldAlert, Timer, UserCheck, Users, type LucideIcon } from "lucide-react";
import { Button, Card, Input, Segmented, Skeleton, cn, toast } from "@open-talent/ui";
import type { AdminArea, AdminStats } from "@open-talent/types";
import { api } from "@/lib/api";
import { isoDay, percent, presetRange, rangeDays, sparklinePath } from "@/lib/admin";
import { saveBlob } from "@/lib/download";
import { qk } from "@/lib/query-keys";
import { compactNumber } from "@/lib/time";
import { ErrorState } from "@/components/common/states";
import { AreaHeader } from "./admin-bits";
import type { AdminViewer } from "./admin-page";

type Preset = "7" | "30" | "90" | "custom";
type SeriesKey = Exclude<keyof AdminStats["daily"][number], "date">;

const SERIES: { key: SeriesKey; label: string; tone: string }[] = [
  { key: "signups", label: "Sign-ups", tone: "text-primary" },
  { key: "published", label: "Profiles published", tone: "text-success" },
  { key: "applications", label: "Applications", tone: "text-verified" },
  { key: "approaches", label: "Recruiter approaches", tone: "text-warning" },
  { key: "posts", label: "Posts", tone: "text-muted-foreground" },
];

export function AdminOverview({ viewer }: { viewer: AdminViewer }) {
  const [preset, setPreset] = useState<Preset>("30");
  const [custom, setCustom] = useState(() => presetRange(30));
  const range = preset === "custom" ? custom : presetRange(Number(preset));
  const days = rangeDays(range.from, range.to);
  const valid = days > 0 && days <= 367;
  const q = useQuery({
    queryKey: qk.adminStats(range.from, range.to),
    queryFn: () => api().admin.stats(range),
    enabled: valid,
    placeholderData: keepPreviousData,
  });
  const csv = useMutation({
    mutationFn: () => api().admin.statsCsv(range),
    onSuccess: (blob) => {
      saveBlob(blob, `overview-${range.from}-to-${range.to}.csv`);
      toast.success({ title: "CSV downloaded", description: "One row per day, no personal data." });
    },
  });
  const s = q.data;
  const link = (area: AdminArea) => (viewer.areas[area] ? `/admin?area=${area}` : undefined);

  return (
    <div className="space-y-4">
      <AreaHeader
        title="Overview"
        description={s ? `Days are counted in ${s.range.timezone}, set under Settings. Totals are as of now; the rest covers ${s.range.from} to ${s.range.to}.` : "Network health over a date range."}
        actions={
          <Button variant="outline" size="sm" onClick={() => csv.mutate()} loading={csv.isPending} disabled={!valid} data-testid="admin-stats-csv">
            <Download /> Export CSV
          </Button>
        }
      />
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <Segmented<Preset>
          aria-label="Date range"
          value={preset}
          onChange={setPreset}
          options={[
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
            { value: "custom", label: "Custom" },
          ]}
        />
        {preset === "custom" ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="sr-only" htmlFor="stats-from">
              From
            </label>
            <Input id="stats-from" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="h-9 w-40" data-testid="stats-from" />
            <span className="text-muted-foreground">to</span>
            <label className="sr-only" htmlFor="stats-to">
              To
            </label>
            <Input id="stats-to" type="date" value={custom.to} min={custom.from} max={isoDay(new Date())} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="h-9 w-40" data-testid="stats-to" />
            {!valid ? <span className="text-xs font-medium text-danger">Pick a start before the end, at most a year apart.</span> : null}
          </div>
        ) : null}
        {q.isFetching && s ? <span className="ml-auto text-xs text-subtle-foreground">Updating...</span> : null}
      </Card>

      {q.isError && !s ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : (
        <>
          <Totals s={s} link={link} />
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="p-4 xl:col-span-2">
              <h3 className="mb-3 text-[15px] font-semibold">Daily activity</h3>
              {s ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {SERIES.map((x) => (
                    <SeriesChart key={x.key} data={s.daily} series={x.key} label={x.label} tone={x.tone} />
                  ))}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {SERIES.map((x) => (
                    <Skeleton key={x.key} className="h-36" />
                  ))}
                </div>
              )}
            </Card>
            <div className="space-y-4">
              <Funnel s={s} />
              <TopSkills s={s} />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <MetricCard
              title="Hiring"
              rows={
                s
                  ? [
                      { icon: Send, label: "Approaches sent", value: compactNumber(s.hiring.approachesSent) },
                      { icon: UserCheck, label: "Approach acceptance", value: percent(s.hiring.approachAcceptanceRate), hint: "Accepted out of answered or expired, for approaches sent in the range." },
                      { icon: FileText, label: "Applications per open job", value: s.hiring.applicationsPerOpenJob === null ? "n/a" : String(s.hiring.applicationsPerOpenJob) },
                      { icon: Timer, label: "Median time to hire", value: s.hiring.medianDaysToHire === null ? "n/a" : `${s.hiring.medianDaysToHire} days`, hint: "From application to hired, for hires in the range." },
                    ]
                  : null
              }
            />
            <MetricCard
              title="Trust and safety"
              rows={
                s
                  ? [
                      { icon: Flag, label: "Complaints opened", value: compactNumber(s.trust.complaintsOpened) },
                      { icon: Timer, label: "Median time to resolve a complaint", value: s.trust.medianComplaintHours === null ? "n/a" : `${s.trust.medianComplaintHours} hours`, hint: "For complaints resolved in the range." },
                      { icon: ShieldAlert, label: "Moderation cases resolved", value: compactNumber(s.trust.casesResolved) },
                    ]
                  : null
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

function Totals({ s, link }: { s: AdminStats | undefined; link: (a: AdminArea) => string | undefined }) {
  const t = s?.totals;
  const tiles: { label: string; value: number | undefined; sub?: string; icon: LucideIcon; href?: string; alert?: boolean }[] = [
    { label: "Accounts", value: t?.users, icon: Users, href: link("people") },
    { label: "Active in 7 days", value: t?.activeUsers7d, icon: Activity },
    { label: "Published profiles", value: t?.profilesPublished, icon: FileText },
    { label: "Companies", value: t?.companies, sub: t ? `${compactNumber(t.companiesVerified)} verified` : undefined, icon: Building2, href: link("companies") },
    { label: "Active recruiters", value: t?.recruitersActive, sub: t ? `${compactNumber(t.recruitersPendingReview)} waiting for review` : undefined, icon: BadgeCheck, href: link("recruiters"), alert: !!t?.recruitersPendingReview },
    { label: "Open jobs", value: t?.jobsOpen, sub: t ? `${compactNumber(t.applications)} applications in total` : undefined, icon: Briefcase, href: link("jobs") },
    { label: "Open moderation cases", value: t?.openCases, icon: ShieldAlert, href: link("moderation"), alert: !!t?.openCases },
    { label: "Open complaints", value: t?.openComplaints, icon: Flag, href: link("complaints"), alert: !!t?.openComplaints },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="admin-totals">
      {tiles.map((x) => {
        const body = (
          <>
            <span className="flex items-center justify-between">
              <x.icon className="size-4 text-subtle-foreground" aria-hidden />
              {x.alert ? <span className="size-2 rounded-full bg-warning" aria-label="Needs attention" /> : null}
            </span>
            <span className="mt-2 block text-2xl font-bold tabular-nums">{x.value === undefined ? <Skeleton className="h-7 w-16" /> : compactNumber(x.value)}</span>
            <span className="block text-xs text-muted-foreground">{x.label}</span>
            {x.sub ? <span className="mt-0.5 block text-2xs text-subtle-foreground">{x.sub}</span> : null}
          </>
        );
        return x.href ? (
          <Link key={x.label} href={x.href} scroll={false} className="block rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {body}
          </Link>
        ) : (
          <Card key={x.label} className="p-4">
            {body}
          </Card>
        );
      })}
    </div>
  );
}

function Funnel({ s }: { s: AdminStats | undefined }) {
  const steps = s
    ? [
        { label: "Sign-ups", value: s.funnel.signups },
        { label: "Profiles published", value: s.funnel.profilesPublished },
        { label: "Applications", value: s.funnel.applied },
        { label: "Hires", value: s.funnel.hired },
      ]
    : [];
  const max = Math.max(1, ...steps.map((x) => x.value));
  return (
    <Card className="p-4">
      <h3 className="text-[15px] font-semibold">In this range</h3>
      <p className="mb-3 text-xs text-subtle-foreground">Each step counts events in the range, not the same people.</p>
      {s ? (
        <ul className="space-y-2.5" data-testid="admin-funnel">
          {steps.map((x) => (
            <li key={x.label}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-muted-foreground">{x.label}</span>
                <span className="font-semibold tabular-nums">{compactNumber(x.value)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(x.value ? 2 : 0, (x.value / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Skeleton className="h-36" />
      )}
    </Card>
  );
}

function TopSkills({ s }: { s: AdminStats | undefined }) {
  const max = Math.max(1, ...(s?.topSkills ?? []).map((x) => x.count));
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-[15px] font-semibold">Top skills on published profiles</h3>
      {!s ? (
        <Skeleton className="h-40" />
      ) : !s.topSkills.length ? (
        <p className="text-sm text-subtle-foreground">No published profiles list skills yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {s.topSkills.map((x) => (
            <li key={x.name} className="relative flex items-center justify-between overflow-hidden rounded px-2 py-1 text-sm">
              <span className="absolute inset-y-0 left-0 bg-primary-soft" style={{ width: `${(x.count / max) * 100}%` }} aria-hidden />
              <span className="relative truncate">{x.name}</span>
              <span className="relative tabular-nums text-muted-foreground">{compactNumber(x.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MetricCard({ title, rows }: { title: string; rows: { icon: LucideIcon; label: string; value: string; hint?: string }[] | null }) {
  return (
    <Card className="p-4">
      <h3 className="mb-2 text-[15px] font-semibold">{title}</h3>
      {rows ? (
        <dl className="divide-y divide-border">
          {rows.map((r) => (
            <div key={r.label} className="flex items-start gap-3 py-2.5">
              <r.icon className="mt-0.5 size-4 shrink-0 text-subtle-foreground" aria-hidden />
              <dt className="min-w-0 flex-1 text-sm text-muted-foreground">
                {r.label}
                {r.hint ? <span className="block text-2xs text-subtle-foreground">{r.hint}</span> : null}
              </dt>
              <dd className="text-sm font-semibold tabular-nums">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <Skeleton className="h-32" />
      )}
    </Card>
  );
}

export function SeriesChart({ data, series, label, tone }: { data: AdminStats["daily"]; series: SeriesKey; label: string; tone: string }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const values = useMemo(() => data.map((d) => d[series]), [data, series]);
  const total = values.reduce((a, b) => a + b, 0);
  const W = 320;
  const H = 88;
  const PAD = 4;
  const { line, area, max } = sparklinePath(values, W, H, PAD);
  const first = data[0]?.date;
  const last = data[data.length - 1]?.date;
  const step = values.length > 1 ? (W - PAD * 2) / (values.length - 1) : 0;
  const point = hover !== null ? data[hover] : null;
  const hx = hover !== null ? PAD + hover * step : 0;
  const hy = hover !== null && max > 0 ? PAD + (H - PAD * 2) - (values[hover]! / max) * (H - PAD * 2) : H - PAD;
  return (
    <figure className="rounded-lg border border-border p-3" data-testid={`series-${series}`}>
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm text-muted-foreground">{point ? `${label}, ${point.date}` : label}</span>
        <span className="text-lg font-bold tabular-nums">{compactNumber(point ? point[series] : total)}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={cn("mt-2 h-20 w-full touch-none", tone)}
        role="img"
        aria-labelledby={`${id}-t ${id}-d`}
        preserveAspectRatio="none"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          setHover(values.length ? Math.max(0, Math.min(values.length - 1, Math.round((x - PAD) / (step || 1)))) : null);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <title id={`${id}-t`}>{label} per day</title>
        <desc id={`${id}-d`}>
          {total} in total from {first ?? "the start"} to {last ?? "today"}, peak {max} in a day.
        </desc>
        <line x1="0" x2={W} y1={H - PAD} y2={H - PAD} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {area ? <path d={area} fill="currentColor" fillOpacity="0.12" /> : null}
        {line ? <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}
        {hover !== null ? (
          <>
            <line x1={hx} x2={hx} y1={0} y2={H} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <circle cx={hx} cy={hy} r="3" fill="currentColor" />
          </>
        ) : null}
      </svg>
      <div className="mt-1 flex justify-between text-2xs text-subtle-foreground" aria-hidden>
        <span>{first?.slice(5)}</span>
        <span>peak {compactNumber(max)}</span>
        <span>{last?.slice(5)}</span>
      </div>
      <table className="sr-only">
        <caption>{label} per day</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">{label}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d[series]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
