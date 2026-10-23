"use client";

import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { Badge, Card, EmptyState, Skeleton } from "@open-talent/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { ErrorState } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { CompanyLink, UserAvatar, UserName } from "@/components/common/user-bits";
import { CHANNEL_LABEL } from "./labels";

/** Every time a recruiter opened a contact channel you shared, newest first. */
export function ContactLogTab() {
  const q = useQuery({ queryKey: qk.contactLog, queryFn: () => api().profiles.contactLog(), staleTime: 30_000 });
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">Contact access log</h2>
        <p className="text-sm text-muted-foreground">Who opened the contact details you shared, which channel, and when. Revoke access from the approach at any time.</p>
      </div>
      <Card>
        {q.isPending ? (
          <div className="space-y-4 p-4">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data.length ? (
          <EmptyState icon={<Eye />} title="No one has opened your contact details" description="When a recruiter you accepted views a channel you shared, it is recorded here." />
        ) : (
          <ul className="divide-y divide-border" data-testid="contact-log">
            {q.data.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                <UserAvatar user={e.recruiter} size="sm" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="flex flex-wrap items-center gap-x-1">
                    <UserName user={e.recruiter} />
                    <span className="text-muted-foreground">at</span>
                    <CompanyLink company={e.company} />
                  </p>
                  <p className="text-xs text-subtle-foreground">
                    Viewed your {CHANNEL_LABEL[e.channel].toLowerCase()} <TimeAgo value={e.viewedAt} />
                  </p>
                </div>
                <Badge tone="neutral">{CHANNEL_LABEL[e.channel]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
