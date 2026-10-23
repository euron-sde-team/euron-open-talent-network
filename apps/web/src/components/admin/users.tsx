"use client";

import { useState } from "react";
import { ChevronRight, Users } from "lucide-react";
import { Badge, Card, EmptyState, Select } from "@open-talent/ui";
import type { AdminUserRow, UserRole, UserStatus } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { usePagedList } from "@/lib/hooks/queries";
import { humanize } from "@/lib/moderation";
import { qk } from "@/lib/query-keys";
import { relativeTime } from "@/lib/time";
import { UserAvatar } from "@/components/common/user-bits";
import { ErrorState, LoadMore } from "@/components/common/states";
import { AreaHeader, ListSkeleton, PROFILE_TONE, ROLE_LABEL, STATUS_TONE, SearchField } from "./admin-bits";
import type { AdminViewer } from "./admin-page";
import { PersonDrawer } from "./person-drawer";

const ALL = "__all__";

export function AdminUsers({ viewer }: { viewer: AdminViewer }) {
  const { user: me } = useAuth();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const debounced = useDebounced(q.trim(), 250);
  const filters = { q: debounced || undefined, status: status === ALL ? undefined : (status as UserStatus), role: role === ALL ? undefined : (role as UserRole) };
  const list = usePagedList<AdminUserRow>({ queryKey: qk.adminUsers(filters), fetchPage: (cursor) => api().admin.users({ cursor, ...filters }) });
  const [openId, setOpenId] = useState<string | null>(null);
  const open = list.items.find((u) => u.id === openId) ?? null;

  return (
    <div>
      <AreaHeader title="People" description="Every account. Open a person to warn, suspend, restore their profile or grant a verification badge." />
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_180px_180px]">
        <SearchField value={q} onChange={setQ} placeholder="Search by name, username or exact email" testId="admin-users-search" />
        <Select
          aria-label="Status"
          value={status}
          onValueChange={setStatus}
          options={[{ value: ALL, label: "Any status" }, ...(["ACTIVE", "PENDING_VERIFICATION", "SUSPENDED", "BANNED", "DEACTIVATED"] as const).map((s) => ({ value: s, label: humanize(s) }))]}
          data-testid="admin-users-status"
        />
        <Select aria-label="Role" value={role} onValueChange={setRole} options={[{ value: ALL, label: "Any role" }, ...(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))]} data-testid="admin-users-role" />
      </div>
      <Card className="overflow-hidden">
        {list.isPending ? (
          <ListSkeleton rows={6} height="h-12" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.items.length ? (
          <EmptyState icon={<Users />} title="No one matches" description="Try a different search or filter. Email search needs the exact address." />
        ) : (
          <>
            <table className="hidden w-full text-left text-sm md:table" data-testid="admin-users-table">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-subtle-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Person</th>
                  <th className="px-3 py-2.5 font-semibold">Role</th>
                  <th className="px-3 py-2.5 font-semibold">Account</th>
                  <th className="px-3 py-2.5 font-semibold">Profile</th>
                  <th className="px-3 py-2.5 font-semibold">Joined</th>
                  <th className="px-3 py-2.5 font-semibold">Last seen</th>
                  <th className="w-8" aria-hidden />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.items.map((u) => (
                  <tr key={u.id} onClick={() => setOpenId(u.id)} className="cursor-pointer transition-colors hover:bg-muted" data-testid="admin-user-row">
                    <td className="max-w-0 px-4 py-2.5">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenId(u.id);
                        }}
                        aria-label={`Open ${u.displayName}`}
                      >
                        <UserAvatar user={u} size="sm" link={false} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {u.displayName}
                            {u.id === me?.id ? <span className="ml-1.5 text-xs font-normal text-subtle-foreground">(you)</span> : null}
                          </span>
                          <span className="block truncate text-xs text-subtle-foreground">
                            @{u.username}, {u.email}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5">{u.role === "USER" ? <span className="text-muted-foreground">Member</span> : <Badge tone="primary">{ROLE_LABEL[u.role]}</Badge>}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={STATUS_TONE[u.status]}>{humanize(u.status)}</Badge>
                      {u.status === "SUSPENDED" && u.suspendedUntil ? <span className="block text-2xs text-subtle-foreground">until {new Date(u.suspendedUntil).toLocaleDateString()}</span> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={PROFILE_TONE[u.profileStatus]}>{humanize(u.profileStatus)}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{relativeTime(u.createdAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{u.lastSeenAt ? relativeTime(u.lastSeenAt) : "Never"}</td>
                    <td className="pr-3 text-subtle-foreground">
                      <ChevronRight className="size-4" aria-hidden />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-border md:hidden">
              {list.items.map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => setOpenId(u.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted" data-testid="admin-user-row">
                    <UserAvatar user={u} size="md" link={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{u.displayName}</span>
                      <span className="block truncate text-xs text-subtle-foreground">{u.email}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {u.role !== "USER" ? <Badge tone="primary">{ROLE_LABEL[u.role]}</Badge> : null}
                        <Badge tone={STATUS_TONE[u.status]}>{humanize(u.status)}</Badge>
                        <Badge tone={PROFILE_TONE[u.profileStatus]}>Profile {humanize(u.profileStatus).toLowerCase()}</Badge>
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => void list.fetchNextPage()} />
          </>
        )}
      </Card>
      <PersonDrawer user={open} viewer={viewer} onOpenChange={(o) => !o && setOpenId(null)} />
    </div>
  );
}
