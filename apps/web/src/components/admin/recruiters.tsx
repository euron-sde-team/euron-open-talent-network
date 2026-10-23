"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, CheckCircle2, Gauge, MailCheck, MailWarning, RotateCcw, ShieldOff, XCircle } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Input, toast } from "@open-talent/ui";
import type { AdminRecruiterRow, RecruiterStatus } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { emailDomain } from "@/lib/admin";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { fullTimestamp } from "@/lib/time";
import { CompanyLogo, UserAvatar, companyHref, profileHref } from "@/components/common/user-bits";
import { ErrorState, LoadMore } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { AreaHeader, Fact, FilterTabs, ListSkeleton, ReasonDialog, SearchField, filtersOf, useRowCache } from "./admin-bits";

const TABS: { value: RecruiterStatus; label: string }[] = [
  { value: "PENDING_REVIEW", label: "Waiting for review" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "REJECTED", label: "Rejected" },
  { value: "EMAIL_PENDING", label: "Email not confirmed" },
  { value: "LEFT", label: "Left the company" },
];

const COMPANY_TONE = { VERIFIED: "success", UNVERIFIED: "neutral", SUSPENDED: "danger" } as const;

type Dialog =
  | { kind: "approve" | "reject" | "suspend" | "reinstate"; row: AdminRecruiterRow }
  | { kind: "quota"; row: AdminRecruiterRow };

export function AdminRecruiters() {
  const [status, setStatus] = useState<RecruiterStatus>("PENDING_REVIEW");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 250);
  const filters = { status, q: q || undefined };
  const list = usePagedList<AdminRecruiterRow>({ queryKey: qk.adminRecruiters(filters), fetchPage: (cursor) => api().admin.recruiters({ cursor, ...filters }) });
  const [dialog, setDialog] = useState<Dialog | null>(null);

  return (
    <div>
      <AreaHeader title="Recruiter approvals" description="People who want to recruit for a company. Check that the work email belongs to the company before approving. The queue is oldest first." />
      <FilterTabs label="Recruiter status" value={status} onChange={setStatus} options={TABS} testId="recruiter-tabs" />
      <SearchField value={search} onChange={setSearch} placeholder="Search by person, company or exact work email" className="mb-3 max-w-md" testId="recruiter-search" />
      {list.isPending ? (
        <Card>
          <ListSkeleton rows={4} height="h-28" />
        </Card>
      ) : list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        </Card>
      ) : !list.items.length ? (
        <Card>
          <EmptyState
            icon={<BadgeCheck />}
            title={status === "PENDING_REVIEW" ? "No applications waiting" : "Nobody here"}
            description={status === "PENDING_REVIEW" ? "New recruiter applications appear here once the applicant confirms their work email." : q ? "Try a different search." : "No recruiters have this status."}
          />
        </Card>
      ) : (
        <ul className="space-y-3" data-testid="recruiter-queue">
          {list.items.map((r) => (
            <RecruiterCard key={r.id} row={r} onAction={(kind) => setDialog({ kind, row: r })} />
          ))}
          <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => void list.fetchNextPage()} />
        </ul>
      )}
      <RecruiterDialogs dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

function DomainEvidence({ r }: { r: AdminRecruiterRow }) {
  const domain = emailDomain(r.workEmail);
  const tone = r.freeMail ? "warning" : r.domainMatches ? "success" : "danger";
  const label = r.freeMail ? "Free email provider" : r.domainMatches ? "Matches a company domain" : "Not a company domain";
  const Icon = r.freeMail ? MailWarning : r.domainMatches ? CheckCircle2 : AlertTriangle;
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3" data-testid="domain-evidence">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">
          {r.workEmail.slice(0, r.workEmail.length - domain.length)}
          <span className={tone === "success" ? "font-semibold text-success" : tone === "warning" ? "font-semibold text-warning" : "font-semibold text-danger"}>{domain}</span>
        </span>
        <Badge tone={tone}>
          <Icon /> {label}
        </Badge>
        {r.workEmailVerified ? (
          <Badge tone="neutral">
            <MailCheck /> Confirmed
          </Badge>
        ) : (
          <Badge tone="warning">Not confirmed</Badge>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Company domains:{" "}
        {r.company.domains.length ? (
          r.company.domains.map((d) => (
            <code key={d} className={d === domain ? "mr-1 rounded bg-success-soft px-1 font-mono text-success-soft-foreground" : "mr-1 rounded bg-muted px-1 font-mono"}>
              {d}
            </code>
          ))
        ) : (
          <span className="text-subtle-foreground">none listed, add them under Companies</span>
        )}
      </p>
    </div>
  );
}

function RecruiterCard({ row: r, onAction }: { row: AdminRecruiterRow; onAction: (k: Dialog["kind"]) => void }) {
  const { user: me } = useAuth();
  const self = me?.id === r.user.id;
  return (
    <li>
      <Card className="p-4" data-testid="recruiter-row">
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-start gap-3">
              <UserAvatar user={r.user} size="md" />
              <div className="min-w-0 flex-1">
                <Link href={profileHref(r.user.username)} className="font-semibold hover:underline">
                  {r.user.displayName}
                </Link>
                <p className="truncate text-xs text-subtle-foreground">
                  {r.title ?? "No title given"}, account {r.user.email}
                </p>
              </div>
              <span className="shrink-0 text-xs text-subtle-foreground" title={fullTimestamp(r.createdAt)}>
                Applied <TimeAgo value={r.createdAt} />
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <CompanyLogo company={r.company} size="sm" />
              <Link href={companyHref(r.company.slug)} className="text-sm font-medium hover:underline">
                {r.company.name}
              </Link>
              <Badge tone={COMPANY_TONE[r.company.status]}>{r.company.status === "VERIFIED" ? "Verified company" : r.company.status === "SUSPENDED" ? "Suspended company" : "Unverified company"}</Badge>
            </div>
            <DomainEvidence r={r} />
            {r.applicationNote ? (
              <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground">
                <span className="sr-only">Application note: </span>
                {r.applicationNote}
              </blockquote>
            ) : null}
            {r.reviewedAt ? (
              <p className="text-xs text-subtle-foreground">
                Reviewed by {r.reviewedBy?.displayName ?? "staff"} <TimeAgo value={r.reviewedAt} />
                {r.reviewNote ? `: ${r.reviewNote}` : ""}
              </p>
            ) : null}
            {r.status === "ACTIVE" || r.status === "SUSPENDED" ? (
              <div className="flex gap-6">
                <Fact label="Approaches sent">{r.approachesSent}</Fact>
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 md:w-44 md:flex-col">
            {r.status === "PENDING_REVIEW" ? (
              self ? (
                <p className="text-xs text-subtle-foreground">Another operator must review your own application.</p>
              ) : (
                <>
                  <Button size="sm" onClick={() => onAction("approve")} data-testid="recruiter-approve">
                    <CheckCircle2 /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onAction("reject")} data-testid="recruiter-reject">
                    <XCircle /> Reject
                  </Button>
                </>
              )
            ) : null}
            {r.status === "ACTIVE" ? (
              <>
                <Button size="sm" variant="outline" onClick={() => onAction("quota")} data-testid="recruiter-quota">
                  <Gauge /> Daily quota
                </Button>
                <Button size="sm" variant="danger-ghost" onClick={() => onAction("suspend")} data-testid="recruiter-suspend">
                  <ShieldOff /> Suspend
                </Button>
              </>
            ) : null}
            {r.status === "SUSPENDED" ? (
              <Button size="sm" variant="outline" onClick={() => onAction("reinstate")} disabled={!r.workEmailVerified} title={r.workEmailVerified ? undefined : "The work email is not confirmed"} data-testid="recruiter-reinstate">
                <RotateCcw /> Reinstate
              </Button>
            ) : null}
            {r.status === "EMAIL_PENDING" ? <p className="text-xs text-subtle-foreground">Waiting for the applicant to confirm their work email.</p> : null}
          </div>
        </div>
      </Card>
    </li>
  );
}

function RecruiterDialogs({ dialog, onClose }: { dialog: Dialog | null; onClose: () => void }) {
  const cache = useRowCache<AdminRecruiterRow>(qk.adminRecruitersAll);
  const run = useMutation({
    mutationFn: async (v: { kind: Dialog["kind"]; row: AdminRecruiterRow; reason: string; quota?: number | null }) => {
      switch (v.kind) {
        case "approve":
          return api().admin.reviewRecruiter(v.row.id, "APPROVE", v.reason || null);
        case "reject":
          return api().admin.reviewRecruiter(v.row.id, "REJECT", v.reason);
        case "suspend":
          return api().admin.suspendRecruiter(v.row.id, v.reason);
        case "reinstate":
          return api().admin.reinstateRecruiter(v.row.id);
        case "quota":
          return api().admin.recruiterQuota(v.row.id, v.quota ?? null);
      }
    },
    onMutate: (v) => {
      const snap = cache.snapshot();
      const next: Partial<Record<Dialog["kind"], RecruiterStatus>> = { approve: "ACTIVE", reject: "REJECTED", suspend: "SUSPENDED", reinstate: "ACTIVE" };
      const to = next[v.kind];
      if (to) cache.patch(v.row.id, (row, key) => (filtersOf(key).status === to ? { ...row, status: to } : null));
      return { snap };
    },
    onError: (_e, _v, ctx) => ctx && cache.restore(ctx.snap),
    onSuccess: (_d, v) => {
      const copy: Record<Dialog["kind"], string> = {
        approve: `${v.row.user.displayName} can now recruit for ${v.row.company.name}`,
        reject: "Application rejected. The applicant can read your note.",
        suspend: `${v.row.user.displayName} is suspended. Pending approaches were withdrawn.`,
        reinstate: `${v.row.user.displayName} is active again`,
        quota: v.quota === null ? "Quota reset to the platform default" : `Daily quota set to ${v.quota}`,
      };
      toast.success({ title: copy[v.kind] });
    },
    onSettled: () => void cache.invalidate(),
  });
  if (!dialog) return null;
  const { kind, row } = dialog;
  if (kind === "quota") return <QuotaDialog row={row} onClose={onClose} onSave={(quota) => run.mutateAsync({ kind, row, reason: "", quota })} />;
  const name = row.user.displayName;
  const cfg = {
    approve: {
      title: `Approve ${name}?`,
      description: `They become a recruiter for ${row.company.name}: they can search talent, send approaches and post jobs.${row.domainMatches ? "" : " Their work email does not match the company's domains."}`,
      confirm: "Approve",
      reason: "optional" as const,
      label: "Note to the applicant",
      destructive: false,
    },
    reject: { title: `Reject ${name}?`, description: "Tell them why, so they can fix it and apply again. They read this note.", confirm: "Reject", reason: "required" as const, label: "Note to the applicant", destructive: true },
    suspend: { title: `Suspend ${name} as a recruiter?`, description: "Their pending approaches are withdrawn and every contact unlock they hold ends. Their member account stays active.", confirm: "Suspend", reason: "required" as const, label: "Reason", destructive: true },
    reinstate: { title: `Reinstate ${name}?`, description: "They can recruit again. Withdrawn approaches and ended unlocks are not restored.", confirm: "Reinstate", reason: "none" as const, label: "Reason", destructive: false },
  }[kind];
  return (
    <ReasonDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={cfg.title}
      description={cfg.description}
      confirmLabel={cfg.confirm}
      reason={cfg.reason}
      reasonLabel={cfg.label}
      reasonHint={kind === "suspend" ? "Recorded in the audit log." : "Sent to the applicant and recorded in the audit log."}
      destructive={cfg.destructive}
      onConfirm={({ reason }) => run.mutateAsync({ kind, row, reason })}
      testId={`recruiter-${kind}-dialog`}
    />
  );
}

function QuotaDialog({ row, onClose, onSave }: { row: AdminRecruiterRow; onClose: () => void; onSave: (quota: number | null) => Promise<unknown> }) {
  const [value, setValue] = useState("");
  const n = Number(value);
  const ok = value.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 1000;
  return (
    <ReasonDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Daily approach quota for ${row.user.displayName}`}
      description="Overrides the platform default for this recruiter only. Zero stops new approaches."
      confirmLabel={ok ? `Set to ${n}` : "Reset to default"}
      reason="none"
      canConfirm={ok || value.trim() === ""}
      onConfirm={() => onSave(ok ? n : null)}
      testId="recruiter-quota-dialog"
    >
      <Field label="Approaches per day" htmlFor="quota-value" hint="Leave empty and confirm to go back to the platform default." error={value.trim() && !ok ? "A whole number from 0 to 1000." : undefined}>
        <Input id="quota-value" type="number" inputMode="numeric" min={0} max={1000} value={value} onChange={(e) => setValue(e.target.value)} className="w-32" placeholder="Default" data-testid="quota-input" />
      </Field>
    </ReasonDialog>
  );
}
