"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { BadgeCheck, Building2, ExternalLink, Globe, MoreHorizontal, Pencil, RotateCcw, ShieldOff, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Switch,
  toast,
} from "@open-talent/ui";
import type { AdminCompanyRow, CompanyStatus } from "@open-talent/types";
import { api } from "@/lib/api";
import { parseDomains } from "@/lib/admin";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { compactNumber, fullTimestamp } from "@/lib/time";
import { CompanyLogo, companyHref } from "@/components/common/user-bits";
import { ErrorState, LoadMore } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { AreaHeader, Fact, FilterTabs, ListSkeleton, ReasonDialog, SearchField, filtersOf, useRowCache } from "./admin-bits";

type Tab = "ALL" | CompanyStatus;
const TABS: { value: Tab; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "UNVERIFIED", label: "Unverified" },
  { value: "VERIFIED", label: "Verified" },
  { value: "SUSPENDED", label: "Suspended" },
];
const TONE = { VERIFIED: "success", UNVERIFIED: "neutral", SUSPENDED: "danger" } as const;

type Patch = { status?: CompanyStatus; reason?: string | null; domains?: string[]; autoApproveDomain?: boolean };
type Pending = { kind: "VERIFIED" | "UNVERIFIED" | "SUSPENDED"; row: AdminCompanyRow } | { kind: "domains"; row: AdminCompanyRow };

export function AdminCompanies() {
  const [tab, setTab] = useState<Tab>("ALL");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 250);
  const filters = { status: tab === "ALL" ? undefined : tab, q: q || undefined };
  const list = usePagedList<AdminCompanyRow>({ queryKey: qk.adminCompanies(filters), fetchPage: (cursor) => api().admin.companies({ cursor, ...filters }) });
  const [pending, setPending] = useState<Pending | null>(null);
  const cache = useRowCache<AdminCompanyRow>(qk.adminCompaniesAll);
  const update = useMutation({
    mutationFn: (v: { row: AdminCompanyRow; patch: Patch }) => api().admin.updateCompany(v.row.id, v.patch),
    onMutate: (v) => {
      const snap = cache.snapshot();
      cache.patch(v.row.id, (row) => ({ ...row, ...v.patch, ...(v.patch.status === "SUSPENDED" ? { suspendedReason: v.patch.reason ?? null } : {}) }) as AdminCompanyRow);
      return { snap };
    },
    onError: (_e, _v, ctx) => ctx && cache.restore(ctx.snap),
    onSuccess: (row, v) => {
      // The server's row wins; drop it from tabs it no longer belongs to.
      cache.patch(row.id, (_old, key) => {
        const s = filtersOf(key).status;
        return s && s !== row.status ? null : row;
      });
      const p = v.patch;
      toast.success({
        title:
          p.status === "VERIFIED"
            ? `${row.name} is verified`
            : p.status === "UNVERIFIED"
              ? `${row.name} is no longer verified`
              : p.status === "SUSPENDED"
                ? `${row.name} is suspended`
                : p.domains
                  ? "Domains saved"
                  : p.autoApproveDomain !== undefined
                    ? p.autoApproveDomain
                      ? "Domain auto-approval on"
                      : "Domain auto-approval off"
                    : "Saved",
        description: p.status === "SUSPENDED" ? "Its open jobs were closed and pending approaches withdrawn." : undefined,
      });
    },
  });

  return (
    <div>
      <AreaHeader title="Companies" description="Verify company pages, keep their domains right (recruiter approvals check against them) and suspend abusive pages." />
      <FilterTabs label="Company status" value={tab} onChange={setTab} options={TABS} testId="company-tabs" />
      <SearchField value={search} onChange={setSearch} placeholder="Search by name, slug or a domain" className="mb-3 max-w-md" testId="company-search" />
      <Card className="overflow-hidden">
        {list.isPending ? (
          <ListSkeleton rows={5} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState icon={<Building2 />} title="No companies here" description={q ? "Try a different search." : "Company pages created by recruiters appear here."} />
        ) : (
          <ul className="divide-y divide-border" data-testid="company-list">
            {list.items.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center" data-testid="company-row">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <CompanyLogo company={c} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={companyHref(c.slug)} className="font-semibold hover:underline">
                        {c.name}
                      </Link>
                      <Badge tone={TONE[c.status]}>{c.status === "VERIFIED" ? "Verified" : c.status === "SUSPENDED" ? "Suspended" : "Unverified"}</Badge>
                    </div>
                    <p className="truncate text-xs text-subtle-foreground">
                      /{c.slug}
                      {c.industry ? `, ${c.industry}` : ""}
                      {c.headquarters ? `, ${c.headquarters}` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {c.domains.length ? (
                        c.domains.map((d) => (
                          <code key={d} className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs">
                            {d}
                          </code>
                        ))
                      ) : (
                        <span className="text-xs text-warning">No domains: recruiters can not be matched</span>
                      )}
                    </div>
                    {c.status === "SUSPENDED" && c.suspendedReason ? <p className="mt-1 text-xs text-danger">Suspended: {c.suspendedReason}</p> : null}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 md:w-60">
                  <Fact label="Team">{compactNumber(c.memberCount)}</Fact>
                  <Fact label="Open jobs">{compactNumber(c.openJobCount)}</Fact>
                  <Fact label="Followers">{compactNumber(c.followerCount)}</Fact>
                </div>
                <div className="flex items-center justify-between gap-3 md:w-56 md:justify-end">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground" title="Recruiters whose confirmed work email matches a domain skip review, when the company is verified and the platform allows it.">
                    <Switch
                      checked={c.autoApproveDomain}
                      onCheckedChange={(v) => update.mutate({ row: c, patch: { autoApproveDomain: v } })}
                      aria-label={`Auto-approve recruiters from ${c.name}'s domains`}
                      data-testid="company-auto-approve"
                    />
                    Auto-approve
                  </label>
                  <span className="hidden text-xs text-subtle-foreground lg:inline" title={fullTimestamp(c.createdAt)}>
                    <TimeAgo value={c.createdAt} />
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton label={`Actions for ${c.name}`} size="sm" data-testid="company-actions">
                        <MoreHorizontal />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {c.status !== "VERIFIED" ? (
                        <DropdownMenuItem onSelect={() => setPending({ kind: "VERIFIED", row: c })} data-testid="company-verify">
                          {c.status === "SUSPENDED" ? <RotateCcw /> : <BadgeCheck />} {c.status === "SUSPENDED" ? "Restore as verified" : "Verify"}
                        </DropdownMenuItem>
                      ) : null}
                      {c.status !== "UNVERIFIED" ? (
                        <DropdownMenuItem onSelect={() => setPending({ kind: "UNVERIFIED", row: c })} data-testid="company-unverify">
                          <RotateCcw /> {c.status === "SUSPENDED" ? "Restore as unverified" : "Remove verification"}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => setPending({ kind: "domains", row: c })} data-testid="company-domains">
                        <Pencil /> Edit domains
                      </DropdownMenuItem>
                      {c.website ? (
                        <DropdownMenuItem asChild>
                          <a href={c.website} target="_blank" rel="noopener noreferrer nofollow">
                            <Globe /> Website <ExternalLink className="ml-auto" />
                          </a>
                        </DropdownMenuItem>
                      ) : null}
                      {c.status !== "SUSPENDED" ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onSelect={() => setPending({ kind: "SUSPENDED", row: c })} data-testid="company-suspend">
                            <ShieldOff /> Suspend
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
            <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => void list.fetchNextPage()} />
          </ul>
        )}
      </Card>
      {pending?.kind === "domains" ? (
        <DomainsDialog row={pending.row} onClose={() => setPending(null)} onSave={(domains) => update.mutateAsync({ row: pending.row, patch: { domains } })} />
      ) : pending ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={pending.kind === "VERIFIED" ? `Verify ${pending.row.name}?` : pending.kind === "UNVERIFIED" ? `Mark ${pending.row.name} unverified?` : `Suspend ${pending.row.name}?`}
          description={
            pending.kind === "VERIFIED"
              ? "The page shows a verified mark and its domains can auto-approve recruiters (if enabled)."
              : pending.kind === "UNVERIFIED"
                ? "The verified mark goes away and domain auto-approval stops."
                : "The page is hidden, every open job closes and pending approaches from its recruiters are withdrawn."
          }
          confirmLabel={pending.kind === "VERIFIED" ? "Verify" : pending.kind === "UNVERIFIED" ? "Confirm" : "Suspend"}
          destructive={pending.kind === "SUSPENDED"}
          reason={pending.kind === "SUSPENDED" ? "required" : "optional"}
          onConfirm={({ reason }) => update.mutateAsync({ row: pending.row, patch: { status: pending.kind as CompanyStatus, reason: reason || null } })}
          testId="company-status-dialog"
        />
      ) : null}
    </div>
  );
}

function DomainsDialog({ row, onClose, onSave }: { row: AdminCompanyRow; onClose: () => void; onSave: (domains: string[]) => Promise<unknown> }) {
  const [domains, setDomains] = useState(row.domains);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const add = () => {
    const { added, invalid } = parseDomains(input, domains);
    const next = [...domains, ...added].slice(0, 10);
    setDomains(next);
    setInput(invalid.length ? invalid.join(", ") : "");
    setError(invalid.length ? `Not a domain: ${invalid.join(", ")}` : domains.length + added.length > 10 ? "A company can have at most 10 domains." : null);
  };
  const dirty = JSON.stringify(domains) !== JSON.stringify(row.domains);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="md" data-testid="company-domains-dialog">
        <DialogHeader>
          <DialogTitle>Domains for {row.name}</DialogTitle>
          <DialogDescription>Recruiter work emails are checked against these. Use the bare domain, for example example.com. Up to 10.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Field label="Add domains" htmlFor="domain-input" error={error ?? undefined} hint="Paste several separated by commas or spaces.">
            <div className="flex gap-2">
              <Input
                id="domain-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                }}
                placeholder="example.com"
                data-testid="domain-input"
              />
              <Button variant="outline" onClick={add} disabled={!input.trim() || domains.length >= 10}>
                Add
              </Button>
            </div>
          </Field>
          {domains.length ? (
            <ul className="flex flex-wrap gap-1.5" data-testid="domain-list">
              {domains.map((d) => (
                <li key={d} className="inline-flex items-center gap-1 rounded-md bg-muted py-1 pl-2.5 pr-1 font-mono text-xs">
                  {d}
                  <button type="button" aria-label={`Remove ${d}`} onClick={() => setDomains(domains.filter((x) => x !== d))} className="rounded p-0.5 text-muted-foreground hover:bg-card hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-subtle-foreground">No domains yet.</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!dirty}
            data-testid="domain-save"
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(domains);
                onClose();
              } catch {
                /* toasted by the mutation cache */
              } finally {
                setBusy(false);
              }
            }}
          >
            Save domains
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
