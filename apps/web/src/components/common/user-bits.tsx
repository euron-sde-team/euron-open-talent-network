"use client";

import Link from "next/link";
import { BadgeCheck, Building2, ShieldCheck } from "lucide-react";
import { Avatar, Tooltip, cn, type AvatarSize } from "@open-talent/ui";
import type { CompanyStatus, UserSummary } from "@open-talent/types";

/** The canonical profile path. Usernames are lowercase ASCII with hyphens, but encode anyway. */
export const profileHref = (username: string) => `/in/${encodeURIComponent(username)}`;
export const companyHref = (slug: string) => `/company/${encodeURIComponent(slug)}`;

type AvatarUser = Pick<UserSummary, "id" | "displayName" | "avatarUrl" | "username"> & { openToWork?: boolean };

export function UserAvatar({ user, size = "md", online, className, link = true }: { user: AvatarUser; size?: AvatarSize; online?: boolean; className?: string; link?: boolean }) {
  const av = <Avatar name={user.displayName} seed={user.id} src={user.avatarUrl} size={size} online={online} openToWork={user.openToWork} className={className} />;
  if (!link) return av;
  return (
    <Link href={profileHref(user.username)} className="shrink-0 rounded-full focus-visible:ring-2" tabIndex={-1} aria-hidden>
      {av}
    </Link>
  );
}

export function RoleMark({ role }: { role: UserSummary["role"] }) {
  if (role === "USER") return null;
  const label = role === "ADMIN" ? "Network admin" : role === "RECRUITER_OPS" ? "Recruiter operations" : "Network moderator";
  return (
    <Tooltip content={label}>
      <span className="inline-flex text-primary" aria-label={label}>
        {role === "ADMIN" ? <BadgeCheck className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
      </span>
    </Tooltip>
  );
}

export function UserName({ user, className }: { user: Pick<UserSummary, "username" | "displayName" | "role">; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <Link href={profileHref(user.username)} className="truncate font-semibold text-foreground hover:underline">
        {user.displayName}
      </Link>
      <RoleMark role={user.role} />
    </span>
  );
}

/** The second line under a name: headline, else "Recruiter at X", else the handle. */
export function userTagline(user: Pick<UserSummary, "headline" | "recruiterAt" | "username">): string {
  return user.headline ?? (user.recruiterAt ? `Recruiter at ${user.recruiterAt.name}` : `@${user.username}`);
}

export function CompanyLogo({ company, size = "md", className }: { company: { id: string; name: string; logoUrl: string | null }; size?: AvatarSize; className?: string }) {
  return <Avatar name={company.name} seed={company.id} src={company.logoUrl} size={size} shape="square" className={className} />;
}

export function VerifiedMark({ status, className }: { status: CompanyStatus; className?: string }) {
  if (status !== "VERIFIED") return null;
  return (
    <Tooltip content="Verified company: the team signed in with work email on this domain">
      <span className={cn("inline-flex text-verified", className)} aria-label="Verified company">
        <BadgeCheck className="size-4" />
      </span>
    </Tooltip>
  );
}

export function CompanyLink({ company, className }: { company: { slug: string; name: string; status?: CompanyStatus }; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <Link href={companyHref(company.slug)} className="truncate font-semibold text-foreground hover:underline">
        {company.name}
      </Link>
      {company.status ? <VerifiedMark status={company.status} className="[&_svg]:size-3.5" /> : null}
    </span>
  );
}

export function CompanyPlaceholderIcon({ className }: { className?: string }) {
  return <Building2 className={cn("size-5 text-subtle-foreground", className)} aria-hidden />;
}

/** A row with avatar, name and a secondary line (people lists). */
export function PersonRow({ user, meta, action, online }: { user: UserSummary; meta?: React.ReactNode; action?: React.ReactNode; online?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <UserAvatar user={user} online={online} />
      <div className="min-w-0 flex-1">
        <UserName user={user} className="text-sm" />
        <p className="truncate text-xs text-subtle-foreground">{meta ?? userTagline(user)}</p>
      </div>
      {action}
    </div>
  );
}
