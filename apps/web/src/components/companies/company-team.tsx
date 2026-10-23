"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserMinus, Users } from "lucide-react";
import { Badge, EmptyState, IconButton, Select, Skeleton, toast } from "@open-talent/ui";
import type { Company, CompanyRole, RecruiterStatus, TeamMember } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { PersonRow } from "@/components/common/user-bits";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { SectionCard } from "@/components/jobs/job-bits";

const ROLE_LABEL: Record<CompanyRole, string> = { OWNER: "Owner", ADMIN: "Admin", RECRUITER: "Recruiter" };
const ROLE_HINT: Record<CompanyRole, string> = {
  OWNER: "Edits the page, manages everyone",
  ADMIN: "Edits the page, removes recruiters",
  RECRUITER: "Posts jobs and approaches people",
};

const STATUS_COPY: Record<RecruiterStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  ACTIVE: { label: "Active", tone: "success" },
  EMAIL_PENDING: { label: "Confirming work email", tone: "neutral" },
  PENDING_REVIEW: { label: "Waiting for review", tone: "warning" },
  REJECTED: { label: "Not approved", tone: "danger" },
  SUSPENDED: { label: "Suspended", tone: "danger" },
  LEFT: { label: "Left the company", tone: "neutral" },
};

/**
 * The company team for page admins. Only an OWNER changes roles (the API refuses an
 * ADMIN), admins remove recruiters, owners remove anyone but themselves.
 */
export function TeamTab({ company }: { company: Company }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const myRole = company.viewer.role;
  const team = useQuery({ queryKey: qk.team(company.slug), queryFn: () => api().companies.team(company.slug) });
  const [removing, setRemoving] = useState<TeamMember | null>(null);

  const setRole = useMutation({
    mutationFn: ({ member, role }: { member: TeamMember; role: CompanyRole }) => api().companies.setRole(member.recruiterId, role),
    onMutate: ({ member, role }) => {
      const prev = qc.getQueryData<TeamMember[]>(qk.team(company.slug));
      qc.setQueryData<TeamMember[]>(qk.team(company.slug), (list) => list?.map((m) => (m.recruiterId === member.recruiterId ? { ...m, role } : m)));
      return prev;
    },
    onError: (_e, _v, prev) => qc.setQueryData(qk.team(company.slug), prev),
    onSuccess: (list, { member, role }) => {
      qc.setQueryData(qk.team(company.slug), list);
      if (member.user.id === user?.id) void qc.invalidateQueries({ queryKey: qk.company(company.slug) });
      toast.success({ title: `${member.user.displayName} is now ${role === "ADMIN" ? "an" : "a"} ${ROLE_LABEL[role].toLowerCase()}` });
    },
  });

  const remove = useMutation({
    mutationFn: (member: TeamMember) => api().companies.removeMember(member.recruiterId),
    onSuccess: (_d, member) => {
      qc.setQueryData<TeamMember[]>(qk.team(company.slug), (list) => list?.filter((m) => m.recruiterId !== member.recruiterId));
      void qc.invalidateQueries({ queryKey: qk.team(company.slug) });
      void qc.invalidateQueries({ queryKey: qk.company(company.slug) });
      toast.success({ title: `${member.user.displayName} was removed from the team`, description: "Their pending approaches were withdrawn and their jobs moved to you." });
    },
  });

  const members = team.data ?? [];
  const active = members.filter((m) => m.status === "ACTIVE");
  const others = members.filter((m) => m.status !== "ACTIVE");

  const row = (m: TeamMember) => {
    const self = m.user.id === user?.id;
    const canEditRole = myRole === "OWNER" && m.status === "ACTIVE";
    const canRemove = !self && (myRole === "OWNER" || (myRole === "ADMIN" && m.role !== "OWNER"));
    const status = STATUS_COPY[m.status];
    return (
      <li key={m.recruiterId} className="py-1" data-testid="team-member" data-recruiter-id={m.recruiterId}>
        <PersonRow
          user={m.user}
          meta={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {m.title ? <span>{m.title}</span> : null}
              {m.status !== "ACTIVE" ? <Badge tone={status.tone}>{status.label}</Badge> : null}
              <span>
                Joined <TimeAgo value={m.joinedAt} />
              </span>
              {self ? <span className="font-semibold">You</span> : null}
            </span>
          }
          action={
            <div className="flex shrink-0 items-center gap-1">
              {canEditRole ? (
                <Select
                  aria-label={`Role for ${m.user.displayName}`}
                  value={m.role}
                  onValueChange={(v) => v !== m.role && setRole.mutate({ member: m, role: v as CompanyRole })}
                  options={(["OWNER", "ADMIN", "RECRUITER"] as const).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                  className="h-8 w-[120px]"
                  disabled={setRole.isPending}
                  data-testid="team-role"
                />
              ) : (
                <Badge tone={m.role === "RECRUITER" ? "neutral" : "primary"} size="md">
                  {ROLE_LABEL[m.role]}
                </Badge>
              )}
              {canRemove ? (
                <IconButton label={`Remove ${m.user.displayName}`} size="sm" onClick={() => setRemoving(m)} data-testid="team-remove">
                  <UserMinus />
                </IconButton>
              ) : null}
            </div>
          }
        />
      </li>
    );
  };

  return (
    <SectionCard title="Team" testId="company-team">
      <div className="-mt-1 mb-3 grid gap-1 text-xs text-subtle-foreground sm:grid-cols-3">
        {(["OWNER", "ADMIN", "RECRUITER"] as const).map((r) => (
          <p key={r}>
            <span className="font-semibold text-foreground">{ROLE_LABEL[r]}:</span> {ROLE_HINT[r]}
          </p>
        ))}
      </div>
      {team.isPending ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))}
        </div>
      ) : team.isError ? (
        <ErrorState error={team.error} onRetry={() => void team.refetch()} compact />
      ) : !members.length ? (
        <EmptyState compact icon={<Users />} title="No teammates yet" description="Recruiters join by registering with a work email on one of the company domains." />
      ) : (
        <>
          <ul className="divide-y divide-border">{active.map(row)}</ul>
          {others.length ? (
            <div className="mt-4 border-t border-border pt-3">
              <h3 className="mb-1 text-sm font-semibold">Not active</h3>
              <p className="mb-1 text-xs text-subtle-foreground">People waiting for a work email check or an operator review, and former members. Removing a pending person cancels their request.</p>
              <ul className="divide-y divide-border">{others.map(row)}</ul>
            </div>
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? `Remove ${removing.user.displayName}?` : "Remove teammate?"}
        description="They lose access to this company's jobs and candidates. Their pending approaches are withdrawn, contact unlocks end, and jobs they posted move to you."
        confirmLabel="Remove"
        destructive
        onConfirm={() => (removing ? remove.mutateAsync(removing) : undefined)}
        testId="team-remove-dialog"
      />
    </SectionCard>
  );
}
