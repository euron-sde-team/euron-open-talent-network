"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Contact, UserCheck, Users, UsersRound } from "lucide-react";
import { Card, cn } from "@open-talent/ui";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { compactNumber } from "@/lib/time";
import { profileHref } from "@/components/common/user-bits";

function ManageLink({ href, icon, label, count, active, testId }: { href: string; icon: React.ReactNode; label: string; count?: number | null; active?: boolean; testId: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted [&_svg]:size-[18px] [&_svg]:text-muted-foreground",
        active && "bg-primary/10",
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {count != null ? <span className="tabular-nums text-muted-foreground">{compactNumber(count)}</span> : <ChevronRight className="!size-4" />}
    </Link>
  );
}

/** "Manage my network": connection count plus the viewer's own followers and following lists. */
export function ManageCard({ active }: { active?: "connections" }) {
  const me = useMe();
  // The owner's profile carries the follower count; the connection count lives on Me.
  const mine = useQuery({ queryKey: qk.myProfile, queryFn: () => api().profiles.mine(), staleTime: 60_000, meta: { silent: true } });
  return (
    <Card className="p-2" data-testid="network-manage">
      <h2 className="px-3 pb-1 pt-2 text-base font-semibold">Manage my network</h2>
      <nav aria-label="Manage my network">
        <ManageLink href="/network/connections" icon={<Users />} label="Connections" count={me.connectionCount} active={active === "connections"} testId="network-manage-connections" />
        <ManageLink href={`${profileHref(me.username)}/followers`} icon={<UsersRound />} label="Followers" count={mine.data?.followerCount ?? null} testId="network-manage-followers" />
        <ManageLink href={`${profileHref(me.username)}/following`} icon={<UserCheck />} label="Following" testId="network-manage-following" />
        <ManageLink href="/network" icon={<Contact />} label="Invitations and suggestions" testId="network-manage-home" />
      </nav>
    </Card>
  );
}
