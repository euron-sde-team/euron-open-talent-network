"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, Ban, ExternalLink, EyeOff, RotateCcw, ScrollText, ShieldCheck, Timer, Trash2, UserCheck, X } from "lucide-react";
import { Badge, Button, DialogTitle, Field, Input, Select, Sheet, SheetContent, Skeleton, Textarea, toast } from "@open-talent/ui";
import type { AdminUserRow, Rating, UserRole } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { humanize } from "@/lib/moderation";
import { qk } from "@/lib/query-keys";
import { fullTimestamp, relativeTime } from "@/lib/time";
import { UserAvatar, profileHref } from "@/components/common/user-bits";
import { Fact, PROFILE_TONE, ROLE_LABEL, ReasonDialog, STATUS_TONE, useRowCache } from "./admin-bits";
import type { AdminViewer } from "./admin-page";
import { RatingRow, useHideRating } from "./ratings";

type AccountKind = "warn" | "suspend" | "unsuspend" | "ban" | "unban" | "suspendProfile" | "restoreProfile" | "erase";

export function PersonDrawer({ user, viewer, onOpenChange }: { user: AdminUserRow | null; viewer: AdminViewer; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={!!user} onOpenChange={onOpenChange}>
      <SheetContent width="max-w-lg" data-testid="person-drawer" aria-describedby={undefined}>
        {user ? <PersonDetail key={user.id} user={user} viewer={viewer} onClose={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-border px-5 py-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function PersonDetail({ user: u, viewer, onClose }: { user: AdminUserRow; viewer: AdminViewer; onClose: () => void }) {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const cache = useRowCache<AdminUserRow>(qk.adminUsersAll);
  const isAdmin = viewer.role === "ADMIN";
  const self = me?.id === u.id;
  // Mirrors applyAccountAction: nobody acts on themselves or an admin; only admins act on moderators.
  const protectedReason = self ? "This is your own account." : u.role === "ADMIN" ? "Admins can only be changed after a role change." : u.role === "MODERATOR" && !isAdmin ? "Only an admin can act on a moderator." : null;
  const [dialog, setDialog] = useState<AccountKind | null>(null);

  const replace = (row: AdminUserRow) => cache.patch(row.id, () => row);
  const act = useMutation({
    mutationFn: async (v: { kind: AccountKind; reason: string; days: number }): Promise<AdminUserRow | null> => {
      const a = api().admin;
      switch (v.kind) {
        case "warn":
          return a.warn(u.id, v.reason);
        case "suspend":
          return a.suspend(u.id, v.days, v.reason);
        case "unsuspend":
          return a.unsuspend(u.id);
        case "ban":
          return a.ban(u.id, v.reason);
        case "unban":
          return a.unban(u.id);
        case "suspendProfile":
          return a.suspendProfile(u.id, v.reason);
        case "restoreProfile":
          return a.restoreProfile(u.id);
        case "erase":
          await a.erase(u.id, v.reason);
          return null;
      }
    },
    onSuccess: (row, v) => {
      if (row) replace(row);
      else {
        cache.patch(u.id, () => null);
        onClose();
      }
      const copy: Record<AccountKind, string> = {
        warn: `${u.displayName} was warned`,
        suspend: `${u.displayName} is suspended for ${v.days} day${v.days === 1 ? "" : "s"}`,
        unsuspend: "Suspension lifted",
        ban: `${u.displayName} is banned`,
        unban: "Ban lifted",
        suspendProfile: "Profile suspended",
        restoreProfile: "Profile restored as unlisted",
        erase: "Account erased",
      };
      toast.success({ title: copy[v.kind], description: v.kind === "erase" ? undefined : "They were notified." });
    },
  });
  const run = (kind: AccountKind) => (input: { reason: string; days: number }) => act.mutateAsync({ kind, ...input });

  return (
    <>
      <div className="shrink-0 px-5 pb-4 pt-5 pr-12">
        <div className="flex items-start gap-3">
          <UserAvatar user={u} size="lg" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate">{u.displayName}</DialogTitle>
            <p className="truncate text-sm text-muted-foreground">@{u.username}</p>
            <p className="truncate text-sm text-muted-foreground">{u.email}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge tone={u.role === "USER" ? "neutral" : "primary"}>{ROLE_LABEL[u.role]}</Badge>
              <Badge tone={STATUS_TONE[u.status]}>{humanize(u.status)}</Badge>
              <Badge tone={PROFILE_TONE[u.profileStatus]}>Profile {humanize(u.profileStatus).toLowerCase()}</Badge>
              {u.recruiterAt ? <Badge tone="outline">Recruiter at {u.recruiterAt.name}</Badge> : null}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Fact label="Joined">
            <span title={fullTimestamp(u.createdAt)}>{relativeTime(u.createdAt)}</span>
          </Fact>
          <Fact label="Last seen">{u.lastSeenAt ? relativeTime(u.lastSeenAt) : "Never"}</Fact>
          {u.status === "SUSPENDED" && u.suspendedUntil ? <Fact label="Suspended until">{fullTimestamp(u.suspendedUntil)}</Fact> : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={profileHref(u.username)} target="_blank">
              <ExternalLink /> View profile
            </Link>
          </Button>
          {viewer.areas.audit ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/admin?area=audit&entityId=${encodeURIComponent(u.id)}`} onClick={onClose}>
                <ScrollText /> Audit trail
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {viewer.areas.settings ? <RoleSection u={u} self={self} onDone={replace} /> : null}

        <Section title="Account">
          {protectedReason ? (
            <p className="text-sm text-muted-foreground">{protectedReason}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setDialog("warn")} data-testid="person-warn">
                <AlertTriangle /> Warn
              </Button>
              {u.status === "SUSPENDED" ? (
                <Button size="sm" variant="outline" onClick={() => setDialog("unsuspend")} data-testid="person-unsuspend">
                  <UserCheck /> Lift suspension
                </Button>
              ) : u.status !== "BANNED" ? (
                <Button size="sm" variant="outline" onClick={() => setDialog("suspend")} data-testid="person-suspend">
                  <Timer /> Suspend
                </Button>
              ) : null}
              {isAdmin ? (
                u.status === "BANNED" ? (
                  <Button size="sm" variant="outline" onClick={() => setDialog("unban")} data-testid="person-unban">
                    <ShieldCheck /> Lift ban
                  </Button>
                ) : (
                  <Button size="sm" variant="danger-ghost" onClick={() => setDialog("ban")} data-testid="person-ban">
                    <Ban /> Ban
                  </Button>
                )
              ) : null}
            </div>
          )}
        </Section>

        <Section title="Talent profile">
          {u.profileStatus === "SUSPENDED" ? (
            <Button size="sm" variant="outline" onClick={() => setDialog("restoreProfile")} data-testid="person-restore-profile">
              <RotateCcw /> Restore profile
            </Button>
          ) : self ? (
            <p className="text-sm text-muted-foreground">This is your own profile.</p>
          ) : (
            <Button size="sm" variant="danger-ghost" onClick={() => setDialog("suspendProfile")} data-testid="person-suspend-profile">
              <EyeOff /> Suspend profile
            </Button>
          )}
          <p className="mt-2 text-xs text-subtle-foreground">A suspended profile leaves search and the directory, and every recruiter contact unlock ends. Restoring makes it unlisted until the owner publishes again.</p>
        </Section>

        <BadgesSection u={u} />
        {viewer.areas.complaints ? <RatingsSection u={u} /> : null}

        {viewer.areas.settings && !self && u.role !== "ADMIN" ? (
          <Section title="Erase account">
            <p className="mb-2 text-sm text-muted-foreground">Anonymises the account the same way self-deletion does. It can not be undone.</p>
            <Button size="sm" variant="danger" onClick={() => setDialog("erase")} data-testid="person-erase">
              <Trash2 /> Erase account
            </Button>
          </Section>
        ) : null}
      </div>

      <ReasonDialog
        open={dialog === "warn"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Warn ${u.displayName}?`}
        description="They get a notification with your reason. Nothing else changes."
        confirmLabel="Send warning"
        reasonHint="Shown to the person and recorded in the audit log."
        onConfirm={run("warn")}
        testId="person-warn-dialog"
      />
      <ReasonDialog
        open={dialog === "suspend"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Suspend ${u.displayName}?`}
        description="They can read but not post, comment, message or recruit until it ends. Their open sessions disconnect."
        confirmLabel="Suspend"
        destructive
        days={7}
        reasonHint="Shown to the person and recorded in the audit log."
        onConfirm={run("suspend")}
        testId="person-suspend-dialog"
      />
      <ReasonDialog open={dialog === "unsuspend"} onOpenChange={(o) => !o && setDialog(null)} title={`Lift ${u.displayName}'s suspension?`} confirmLabel="Lift suspension" reason="none" onConfirm={run("unsuspend")} />
      <ReasonDialog
        open={dialog === "ban"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Ban ${u.displayName}?`}
        description="Every session is revoked and they can not sign in. You can lift a ban later."
        confirmLabel="Ban"
        destructive
        reasonHint="Shown to the person and recorded in the audit log."
        onConfirm={run("ban")}
        testId="person-ban-dialog"
      />
      <ReasonDialog open={dialog === "unban"} onOpenChange={(o) => !o && setDialog(null)} title={`Lift ${u.displayName}'s ban?`} confirmLabel="Lift ban" reason="none" onConfirm={run("unban")} />
      <ReasonDialog
        open={dialog === "suspendProfile"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Suspend this talent profile?"
        description="It leaves search and the directory at once, and recruiters lose any contact details they unlocked."
        confirmLabel="Suspend profile"
        destructive
        reasonHint="Shown to the person and recorded in the audit log."
        onConfirm={run("suspendProfile")}
        testId="person-suspend-profile-dialog"
      />
      <ReasonDialog open={dialog === "restoreProfile"} onOpenChange={(o) => !o && setDialog(null)} title="Restore this profile?" description="It comes back unlisted; the owner decides when to publish." confirmLabel="Restore" reason="none" onConfirm={run("restoreProfile")} />
      <ReasonDialog
        open={dialog === "erase"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Erase ${u.displayName}'s account?`}
        description="Their profile, posts and personal data are anonymised. This can not be undone."
        confirmLabel="Erase for good"
        destructive
        typeToConfirm={u.username}
        reasonHint="For example the erasure request reference. Recorded in the audit log."
        onConfirm={async (input) => {
          await run("erase")(input);
          void qc.invalidateQueries({ queryKey: qk.adminUsersAll });
        }}
        testId="person-erase-dialog"
      />
    </>
  );
}

function RoleSection({ u, self, onDone }: { u: AdminUserRow; self: boolean; onDone: (row: AdminUserRow) => void }) {
  const [role, setRole] = useState<UserRole>(u.role);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setRole(u.role), [u.role]);
  const save = useMutation({
    mutationFn: () => api().admin.setRole(u.id, role),
    onSuccess: (row) => {
      onDone(row);
      toast.success({ title: `${row.displayName} is now ${ROLE_LABEL[row.role].toLowerCase()}` });
    },
  });
  return (
    <Section title="Platform role">
      {self ? (
        <p className="text-sm text-muted-foreground">You can not change your own role. Ask another admin.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Platform role"
            value={role}
            onValueChange={(v) => setRole(v as UserRole)}
            options={(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
            className="w-48"
            data-testid="person-role"
          />
          <Button size="sm" disabled={role === u.role} onClick={() => setConfirm(true)} data-testid="person-role-save">
            Change role
          </Button>
        </div>
      )}
      <p className="mt-2 text-xs text-subtle-foreground">Moderators run the case desk, complaints and people. Recruiter ops run recruiter approvals, companies and jobs. Admins can do everything.</p>
      <ReasonDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Make ${u.displayName} ${ROLE_LABEL[role].toLowerCase()}?`}
        description={role === "ADMIN" ? "Admins can change settings, roles and erase accounts." : role === "USER" ? "They lose access to the control plane." : "Their control plane access changes at once."}
        confirmLabel="Change role"
        reason="none"
        onConfirm={() => save.mutateAsync()}
        testId="person-role-dialog"
      />
    </Section>
  );
}

function BadgesSection({ u }: { u: AdminUserRow }) {
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: qk.profile(u.username), queryFn: () => api().profiles.get(u.username), retry: false, meta: { silent: true } });
  const [label, setLabel] = useState("");
  const [rationale, setRationale] = useState("");
  const [revoking, setRevoking] = useState<{ id: string; label: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.profile(u.username) });
  const grant = useMutation({
    mutationFn: () => api().admin.grantBadge(u.id, label.trim(), rationale.trim() || null),
    onSuccess: () => {
      toast.success({ title: `"${label.trim()}" badge granted` });
      setLabel("");
      setRationale("");
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api().admin.revokeBadge(id),
    onSuccess: () => {
      toast.success({ title: "Badge revoked" });
      refresh();
    },
  });
  const badges = (profile.data?.badges ?? []).filter((b) => b.kind === "VERIFICATION");
  const labelOk = label.trim().length >= 2 && label.trim().length <= 40;
  return (
    <Section title="Verification badges">
      {profile.isPending ? (
        <Skeleton className="h-8" />
      ) : profile.isError ? (
        <p className="text-xs text-subtle-foreground">The profile could not be loaded, so existing badges are not shown.</p>
      ) : badges.length ? (
        <ul className="mb-3 space-y-1.5" data-testid="person-badges">
          {badges.map((b) => (
            <li key={b.id} className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
              <BadgeCheck className="mt-0.5 size-4 shrink-0 text-verified" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{b.label}</p>
                {b.rationale ? <p className="text-xs text-subtle-foreground">{b.rationale}</p> : null}
              </div>
              <Button size="sm" variant="danger-ghost" onClick={() => setRevoking({ id: b.id, label: b.label })} aria-label={`Revoke ${b.label}`}>
                <X /> Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-xs text-subtle-foreground">No verification badges.</p>
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (labelOk) grant.mutate();
        }}
      >
        <Field label="Badge label" htmlFor="badge-label" hint="2 to 40 characters, for example Identity verified.">
          <Input id="badge-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} data-testid="badge-label" />
        </Field>
        <Field label="Rationale" htmlFor="badge-rationale" optional hint="Shown with the badge.">
          <Textarea id="badge-rationale" rows={2} maxLength={500} value={rationale} onChange={(e) => setRationale(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!labelOk} loading={grant.isPending} data-testid="badge-grant">
            <BadgeCheck /> Grant badge
          </Button>
        </div>
      </form>
      <ReasonDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={revoking ? `Revoke "${revoking.label}"?` : ""}
        description="The badge disappears from the profile."
        confirmLabel="Revoke"
        destructive
        reason="none"
        onConfirm={() => revoke.mutateAsync(revoking!.id)}
      />
    </Section>
  );
}

function RatingsSection({ u }: { u: AdminUserRow }) {
  const ratings = useQuery({ queryKey: qk.profileRatings(u.username), queryFn: () => api().profiles.ratings(u.username), retry: false, meta: { silent: true } });
  const hide = useHideRating();
  const [target, setTarget] = useState<Rating | null>(null);
  return (
    <Section title="Ratings from recruiters">
      {ratings.isPending ? (
        <Skeleton className="h-10" />
      ) : !ratings.data?.length ? (
        <p className="text-xs text-subtle-foreground">No visible ratings.</p>
      ) : (
        <ul className="divide-y divide-border">
          {ratings.data.map((r) => (
            <RatingRow key={r.id} rating={r} onHide={() => setTarget(r)} />
          ))}
        </ul>
      )}
      <ReasonDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Hide this rating?"
        description="It disappears from the profile and the average is recomputed."
        confirmLabel="Hide rating"
        destructive
        onConfirm={({ reason }) => hide.mutateAsync({ id: target!.id, reason })}
      />
    </Section>
  );
}
