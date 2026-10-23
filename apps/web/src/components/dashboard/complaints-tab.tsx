"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus, ShieldAlert } from "lucide-react";
import { Badge, Button, Card, EmptyState, Skeleton } from "@open-talent/ui";
import type { Complaint } from "@open-talent/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { ErrorState } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { PersonRow } from "@/components/common/user-bits";
import { ComplaintDialog } from "./complaint-dialog";
import { COMPLAINT_CATEGORY, COMPLAINT_STATUS } from "./labels";

function ComplaintRow({ c }: { c: Complaint }) {
  const s = COMPLAINT_STATUS[c.status];
  const about = c.engagementId ? "an engagement" : c.approachId ? "an approach" : c.applicationId ? "an application" : null;
  return (
    <li className="space-y-2 p-4" data-testid="complaint-row">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={s.tone}>{s.label}</Badge>
        <span className="text-sm font-semibold">{COMPLAINT_CATEGORY[c.category]}</span>
        <span className="text-xs text-subtle-foreground">
          Filed <TimeAgo value={c.createdAt} />
          {about ? `, about ${about}` : ""}
        </span>
      </div>
      <PersonRow user={c.against} />
      <p className="whitespace-pre-line text-sm text-foreground">{c.description}</p>
      {c.evidence.length ? (
        <ul className="flex flex-wrap gap-2">
          {c.evidence.map((m) => (
            <li key={m.id}>
              <a href={m.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                <FileText className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{m.fileName}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {c.adminNote ? (
        <div className="rounded-md bg-muted/60 px-3 py-2 text-sm">
          <p className="text-xs font-semibold text-muted-foreground">
            Note from the trust team{c.resolvedAt ? (
              <>
                , <TimeAgo value={c.resolvedAt} />
              </>
            ) : null}
          </p>
          <p className="mt-0.5 whitespace-pre-line">{c.adminNote}</p>
        </div>
      ) : null}
    </li>
  );
}

export function ComplaintsTab() {
  const q = useQuery({ queryKey: qk.complaints, queryFn: () => api().trust.complaints(), staleTime: 30_000 });
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Complaints</h2>
          <p className="text-sm text-muted-foreground">Complaints you filed and their outcome. Only you and the trust team can see them.</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)} data-testid="complaint-new">
          <Plus /> File a complaint
        </Button>
      </div>
      <Card>
        {q.isPending ? (
          <div className="space-y-4 p-4">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data.length ? (
          <EmptyState icon={<ShieldAlert />} title="No complaints filed" description="If someone you dealt with here behaved badly, for example did not pay or did not show up, you can tell the trust team." />
        ) : (
          <ul className="divide-y divide-border">
            {q.data.map((c) => (
              <ComplaintRow key={c.id} c={c} />
            ))}
          </ul>
        )}
      </Card>
      <ComplaintDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
