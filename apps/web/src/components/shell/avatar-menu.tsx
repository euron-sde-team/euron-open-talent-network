"use client";

import Link from "next/link";
import { BriefcaseBusiness, FileText, LayoutDashboard, LogOut, Monitor, Moon, Settings, Shield, Sun, UserRound, Wrench } from "lucide-react";
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@open-talent/ui";
import { useAuth, useMe } from "@/lib/auth";
import { useTheme, type ThemePref } from "@/lib/stores/theme";
import { profileHref, userTagline } from "@/components/common/user-bits";
import { useRecruiterHref } from "./header";

export function AvatarMenu() {
  const me = useMe();
  const { logout, isStaff, isAdmin } = useAuth();
  const { pref, setPref } = useTheme();
  const recruiter = useRecruiterHref();
  const canAdmin = isStaff || me.role === "RECRUITER_OPS";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Account menu" data-testid="avatar-menu" className="flex flex-col items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <Avatar name={me.displayName} seed={me.id} src={me.avatarUrl} size="sm" />
          <span className="hidden text-xs text-muted-foreground lg:block">Me</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <div className="flex items-start gap-3 px-3 pb-2 pt-3">
          <Avatar name={me.displayName} seed={me.id} src={me.avatarUrl} size="lg" />
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold text-foreground">{me.displayName}</span>
            <span className="line-clamp-2 text-sm text-muted-foreground">{userTagline(me)}</span>
          </span>
        </div>
        <div className="px-3 pb-2">
          <Button asChild variant="outline" size="sm" block>
            <Link href={profileHref(me.username)} data-testid="view-profile">
              View profile
            </Link>
          </Button>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Account</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <LayoutDashboard /> Your dashboard
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/jobs/applications">
            <FileText /> My applications
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={recruiter.href}>
            <BriefcaseBusiness /> {recruiter.label === "Recruiter" ? "Recruiter workspace" : recruiter.label}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> Settings and privacy
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/moderation">
            <UserRound /> Your content reviews
          </Link>
        </DropdownMenuItem>
        {isStaff ? (
          <DropdownMenuItem asChild>
            <Link href="/moderation" data-testid="nav-moderation">
              <Shield /> Moderation desk
            </Link>
          </DropdownMenuItem>
        ) : null}
        {canAdmin ? (
          <DropdownMenuItem asChild>
            <Link href="/admin" data-testid="nav-admin">
              <Wrench /> {isAdmin ? "Administration" : "Control plane"}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={pref} onValueChange={(v) => setPref(v as ThemePref)}>
          <DropdownMenuRadioItem value="system" data-testid="theme-system">
            <Monitor /> Match device
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light" data-testid="theme-light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" data-testid="theme-dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()} data-testid="sign-out">
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
