"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { isApiError } from "@open-talent/api-client";
import { BarChart3, Users } from "lucide-react";
import { AvatarStack, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@open-talent/ui";
import type { MyProfile, Profile, ProfileSection } from "@open-talent/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { useProductName } from "@/lib/meta";
import { ErrorState, NotFoundState } from "@/components/common/states";
import { profileHref } from "@/components/common/user-bits";
import { BasicsEditor } from "./basics-editor";
import { ContactEditor, OpenToWorkEditor, OwnerStrip, VisibilityEditor, type OwnerDialog } from "./owner-panel";
import { ActivitySection, RecommendationsSection } from "./profile-activity";
import { ProfileHeader } from "./profile-header";
import {
  AboutCard,
  CertificationsSection,
  EducationSection,
  ExperienceSection,
  FeaturedSection,
  LinksSection,
  OpenToWorkCard,
  ProjectsSection,
  SkillsSection,
  type OwnerControls,
} from "./profile-sections";
import { OPEN_TO_WORK_LABEL } from "./profile-utils";
import { SectionEditor } from "./section-editor";
import { useProfileView } from "./use-profile";

function ProfileSkeleton() {
  return (
    <div className="mx-auto grid max-w-[1128px] gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6" aria-busy="true" aria-label="Loading profile">
      <div className="space-y-3">
        <Card className="overflow-hidden">
          <Skeleton className="h-28 rounded-none sm:h-44" />
          <div className="px-4 pb-5 sm:px-6">
            <Skeleton className="-mt-14 size-28 rounded-full border-4 border-card sm:-mt-20 sm:size-36" />
            <Skeleton className="mt-4 h-6 w-56" />
            <Skeleton className="mt-2 h-4 w-80 max-w-full" />
            <Skeleton className="mt-2 h-4 w-40" />
            <div className="mt-4 flex gap-2">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
        </Card>
        {[0, 1].map((i) => (
          <Card key={i} className="space-y-3 p-6">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </Card>
        ))}
      </div>
      <div className="hidden space-y-3 lg:block">
        <Skeleton className="h-40 rounded-lg" />
      </div>
    </div>
  );
}

/** Count one view per mount for other people's profiles (the API dedupes per day). */
function useViewBeacon(username: string, active: boolean) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!active || sent.current === username) return;
    sent.current = username;
    void api().profiles.view(username).catch(() => undefined);
  }, [active, username]);
}

function MutualCard({ profile }: { profile: Profile }) {
  const q = useQuery({
    queryKey: qk.mutual(profile.user.id),
    queryFn: () => api().network.mutual(profile.user.id),
    enabled: profile.viewer.signedIn && !profile.viewer.isSelf && profile.viewer.mutualCount > 0,
    staleTime: 60_000,
    meta: { silent: true },
  });
  if (!profile.viewer.mutualCount || !q.data?.length) return null;
  const first = q.data.slice(0, 2).map((e) => e.user.displayName.split(" ")[0]);
  const rest = profile.viewer.mutualCount - first.length;
  return (
    <Card data-testid="mutual-card">
      <CardHeader>
        <CardTitle>Mutual connections</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <AvatarStack people={q.data.map((e) => ({ id: e.user.id, name: e.user.displayName, src: e.user.avatarUrl }))} max={5} />
        <p className="text-sm text-muted-foreground">
          {first.join(", ")}
          {rest > 0 ? ` and ${rest} other${rest > 1 ? "s" : ""}` : ""} you both know
        </p>
        <ul className="space-y-1">
          {q.data.slice(0, 4).map((e) => (
            <li key={e.user.id}>
              <Link href={profileHref(e.user.username)} className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                <span className="truncate font-semibold">{e.user.displayName}</span>
                <span className="truncate text-xs text-subtle-foreground">{e.user.headline}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function InsightsCard() {
  const q = useQuery({ queryKey: qk.profileAnalytics, queryFn: () => api().profiles.analytics(), staleTime: 60_000, meta: { silent: true } });
  const d = q.data;
  return (
    <Card data-testid="profile-insights">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="size-4 text-muted-foreground" /> Profile insights
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-subtle-foreground">Private to you</p>
        {q.isPending ? (
          <Skeleton className="h-24" />
        ) : !d ? (
          <p className="text-sm text-muted-foreground">Insights are not available right now.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-3">
            {[
              { label: "Views, 7 days", value: d.views7d },
              { label: "Views, 30 days", value: d.views30d },
              { label: "Recruiter views, 30 days", value: d.searchAppearances30d },
              { label: "Pending approaches", value: d.approaches.pending },
            ].map((m) => (
              <div key={m.label} className="rounded-md bg-muted px-3 py-2">
                <dd className="text-lg font-bold text-foreground">{m.value}</dd>
                <dt className="text-xs text-muted-foreground">{m.label}</dt>
              </div>
            ))}
          </dl>
        )}
        {d?.recruiterCompanies.length ? (
          <div className="mt-3">
            <p className="text-xs font-semibold text-muted-foreground">Recruiters from</p>
            <ul className="mt-1 space-y-1 text-sm">
              {d.recruiterCompanies.slice(0, 4).map((c) => (
                <li key={c.slug} className="flex justify-between gap-2">
                  <Link href={`/company/${encodeURIComponent(c.slug)}`} className="truncate hover:underline">
                    {c.name}
                  </Link>
                  <span className="text-subtle-foreground">{c.views}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function JoinCard() {
  const name = useProductName();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" /> Join {name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Build your own talent page, connect with people you know, and hear from verified recruiters only when you say yes.</p>
        <div className="flex gap-2">
          <Button asChild size="sm">
            <Link href="/signup">Create account</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type Editing = { kind: "section"; section: ProfileSection; add: boolean } | { kind: "basics"; focus?: "about" } | { kind: "dialog"; dialog: OwnerDialog } | null;

function ProfileView({ profile, my }: { profile: Profile; my?: MyProfile }) {
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);
  const owner: OwnerControls | undefined = my
    ? {
        audience: (s) => my.sectionVisibility[s] ?? "PUBLIC",
        edit: (s) => setEditing({ kind: "section", section: s, add: false }),
        add: (s) => setEditing({ kind: "section", section: s, add: true }),
      }
    : undefined;
  const signedOut = !profile.viewer.signedIn;

  return (
    <div className="mx-auto grid max-w-[1128px] gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6">
      <div className="min-w-0 space-y-3">
        <ProfileHeader profile={profile} owner={my ? { editBasics: () => setEditing({ kind: "basics" }), addSection: (s) => owner!.add(s) } : undefined} />
        {my ? (
          <OwnerStrip
            my={my}
            onDialog={(d) => setEditing({ kind: "dialog", dialog: d })}
            onSection={(s) => setEditing({ kind: "section", section: s, add: true })}
            onBasics={(focus) => setEditing({ kind: "basics", focus })}
          />
        ) : null}
        <OpenToWorkCard
          profile={profile}
          onEdit={my ? () => setEditing({ kind: "dialog", dialog: "openToWork" }) : undefined}
          modeLabel={my && my.openToWorkMode !== "OFF" ? OPEN_TO_WORK_LABEL[my.openToWorkMode] : undefined}
        />
        <AboutCard profile={profile} onEdit={my ? () => setEditing({ kind: "basics", focus: "about" }) : undefined} />
        <FeaturedSection profile={profile} />
        <ActivitySection profile={profile} isSelf={!!my} />
        <ExperienceSection profile={profile} owner={owner} />
        <EducationSection profile={profile} owner={owner} />
        <ProjectsSection profile={profile} owner={owner} />
        <SkillsSection profile={profile} owner={owner} />
        <CertificationsSection profile={profile} owner={owner} />
        <LinksSection profile={profile} owner={owner} />
        <RecommendationsSection profile={profile} />
      </div>
      <aside className="min-w-0 space-y-3 lg:sticky lg:top-[calc(var(--header-height)+16px)] lg:self-start" aria-label="More about this profile">
        {my ? <InsightsCard /> : null}
        {signedOut ? <JoinCard /> : null}
        <MutualCard profile={profile} />
      </aside>

      {my && editing?.kind === "section" ? <SectionEditor key={editing.section} profile={my} section={editing.section} startWithNew={editing.add} onClose={close} /> : null}
      {my && editing?.kind === "basics" ? <BasicsEditor my={my} focus={editing.focus} onClose={close} /> : null}
      {my && editing?.kind === "dialog" && editing.dialog === "openToWork" ? <OpenToWorkEditor my={my} onClose={close} /> : null}
      {my && editing?.kind === "dialog" && editing.dialog === "visibility" ? <VisibilityEditor my={my} onClose={close} /> : null}
      {my && editing?.kind === "dialog" && editing.dialog === "contact" ? <ContactEditor my={my} onClose={close} /> : null}
    </div>
  );
}

export function ProfilePage({ username }: { username: string }) {
  const router = useRouter();
  const v = useProfileView(username);
  const movedTo = isApiError(v.error) && (v.error.code === "PROFILE_MOVED" || v.error.status === 301) ? ((v.error.details as { username?: string } | undefined)?.username ?? null) : null;
  useEffect(() => {
    if (movedTo) router.replace(profileHref(movedTo));
  }, [movedTo, router]);
  useViewBeacon(username, !!v.profile && !v.isSelf);

  if (movedTo || v.loading) return <ProfileSkeleton />;
  if (v.error || !v.profile) {
    const notFound = isApiError(v.error) && v.error.status === 404;
    return (
      <div className="mx-auto max-w-[760px] px-4 py-8">
        <Card>
          {notFound ? (
            <NotFoundState title="This profile is not available" description="The person may have changed their username, made their page private, or it may not exist." />
          ) : (
            <ErrorState error={v.error} onRetry={v.refetch} />
          )}
        </Card>
      </div>
    );
  }
  return <ProfileView profile={v.profile} my={v.my} />;
}
