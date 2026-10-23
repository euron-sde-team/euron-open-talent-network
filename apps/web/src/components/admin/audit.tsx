"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronRight, FilterX, ScrollText } from "lucide-react";
import { Button, Card, EmptyState, Field, Input, cn } from "@open-talent/ui";
import type { AuditEntry } from "@open-talent/types";
import { api } from "@/lib/api";
import { formatJsonValue, jsonChanges } from "@/lib/admin";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { fullTimestamp, relativeTime } from "@/lib/time";
import { UserAvatar, profileHref } from "@/components/common/user-bits";
import { ErrorState, LoadMore } from "@/components/common/states";
import { AreaHeader, ListSkeleton } from "./admin-bits";

type Filters = { action: string; actorId: string; entityType: string; entityId: string };
const EMPTY: Filters = { action: "", actorId: "", entityType: "", entityId: "" };

export function AdminAudit() {
  const params = useSearchParams();
  const [f, setF] = useState<Filters>(() => ({
    action: params.get("action") ?? "",
    actorId: params.get("actorId") ?? "",
    entityType: params.get("entityType") ?? "",
    entityId: params.get("entityId") ?? "",
  }));
  const d = useDebounced(f, 300);
  const filters = {
    action: d.action.trim() || undefined,
    actorId: d.actorId.trim() || undefined,
    entityType: d.entityType.trim() || undefined,
    entityId: d.entityId.trim() || undefined,
  };
  const list = usePagedList<AuditEntry>({ queryKey: qk.audit(filters), fetchPage: (cursor) => api().admin.audit({ cursor, ...filters }) });
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const any = Object.values(f).some((v) => v.trim());

  return (
    <div>
      <AreaHeader
        title="Audit log"
        description="Every administrative and security change, newest first. Click an actor or target to filter by it."
        actions={
          any ? (
            <Button variant="ghost" size="sm" onClick={() => setF(EMPTY)}>
              <FilterX /> Clear filters
            </Button>
          ) : null
        }
      />
      <Card className="mb-3 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Action starts with" htmlFor="audit-action">
          <Input id="audit-action" value={f.action} onChange={set("action")} placeholder="recruiter." className="font-mono" data-testid="audit-action" />
        </Field>
        <Field label="Actor id" htmlFor="audit-actor">
          <Input id="audit-actor" value={f.actorId} onChange={set("actorId")} className="font-mono" />
        </Field>
        <Field label="Target type" htmlFor="audit-type">
          <Input id="audit-type" value={f.entityType} onChange={set("entityType")} placeholder="user, company, settings" className="font-mono" />
        </Field>
        <Field label="Target id" htmlFor="audit-entity">
          <Input id="audit-entity" value={f.entityId} onChange={set("entityId")} className="font-mono" data-testid="audit-entity" />
        </Field>
      </Card>
      <Card className="overflow-hidden">
        {list.isPending ? (
          <ListSkeleton rows={8} height="h-10" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState icon={<ScrollText />} title="No audit entries" description={any ? "Nothing matches these filters." : "Administrative and security actions are recorded here."} />
        ) : (
          <ul className="divide-y divide-border" data-testid="audit-log">
            {list.items.map((e) => (
              <AuditRow key={e.id} e={e} onFilter={(patch) => setF((x) => ({ ...x, ...patch }))} />
            ))}
            <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => void list.fetchNextPage()} endLabel="The beginning of the log" />
          </ul>
        )}
      </Card>
    </div>
  );
}

function AuditRow({ e, onFilter }: { e: AuditEntry; onFilter: (f: Partial<Filters>) => void }) {
  const [open, setOpen] = useState(false);
  const data = e.data ?? {};
  const hasData = Object.keys(data).length > 0;
  const changes = "before" in data || "after" in data ? jsonChanges(data.before, data.after) : "from" in data && "to" in data ? jsonChanges(data.from, data.to) : [];
  return (
    <li className="px-4 py-2.5" data-testid="audit-row">
      <div className="flex items-start gap-3">
        {e.actor ? <UserAvatar user={e.actor} size="sm" /> : <span className="size-8 shrink-0 rounded-full bg-muted" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {e.actor ? (
              <button type="button" className="font-semibold hover:underline" onClick={() => onFilter({ actorId: e.actor!.id })} title="Show only this actor">
                {e.actor.displayName}
              </button>
            ) : (
              <span className="font-semibold">System</span>
            )}
            <button type="button" onClick={() => onFilter({ action: e.action })} title="Show only this action" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-primary/10">
              {e.action}
            </button>
            <span className="min-w-0 text-muted-foreground">
              on{" "}
              <button type="button" className="font-mono text-xs hover:underline" onClick={() => onFilter({ entityType: e.entityType, entityId: e.entityId ?? "" })} title="Show only this target">
                {e.entityType}
                {e.entityId ? ` ${e.entityId}` : ""}
              </button>
            </span>
          </p>
          <p className="text-xs text-subtle-foreground" title={fullTimestamp(e.createdAt)}>
            {relativeTime(e.createdAt)}
            {e.actor ? (
              <>
                {", "}
                <a href={profileHref(e.actor.username)} className="hover:underline">
                  @{e.actor.username}
                </a>
              </>
            ) : null}
          </p>
          {hasData ? (
            <>
              <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-link hover:underline">
                <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden />
                {changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"}` : "Details"}
              </button>
              {open ? (
                changes.length ? (
                  <div className="mt-1.5 overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-left font-mono text-xs">
                      <thead className="bg-muted/50 text-subtle-foreground">
                        <tr>
                          <th className="px-2 py-1.5 font-semibold">Field</th>
                          <th className="px-2 py-1.5 font-semibold">Before</th>
                          <th className="px-2 py-1.5 font-semibold">After</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {changes.map((c) => (
                          <tr key={c.path}>
                            <td className="whitespace-nowrap px-2 py-1.5 font-semibold">{c.path}</td>
                            <td className="px-2 py-1.5 text-danger-soft-foreground">
                              <span className="rounded bg-danger-soft px-1">{formatJsonValue(c.before)}</span>
                            </td>
                            <td className="px-2 py-1.5 text-success-soft-foreground">
                              <span className="rounded bg-success-soft px-1">{formatJsonValue(c.after)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <pre className="mt-1.5 max-h-60 overflow-auto rounded-md bg-muted p-2 font-mono text-xs leading-relaxed">{JSON.stringify(data, null, 2)}</pre>
                )
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}
