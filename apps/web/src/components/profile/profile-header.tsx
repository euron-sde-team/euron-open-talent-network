"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Building2,
  Check,
  ChevronDown,
  Download,
  Eye,
  Flag,
  GraduationCap,
  Link2,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Share2,
  Ticket,
  UserMinus,
} from "lucide-react";
import {
  Avatar,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
  toast,
} from "@open-talent/ui";
import { PROFILE_SECTIONS, type Profile, type ProfileSection } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { saveBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { useOpenConversation } from "@/lib/hooks/use-open-conversation";
import { qk } from "@/lib/query-keys";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ReportDialog } from "@/components/common/report-dialog";
import { CompanyLogo, RoleMark, companyHref, profileHref } from "@/components/common/user-bits";
import { ConnectButton, useInvalidateNetwork } from "@/components/network/connect-button";
import { FollowButton } from "./follow-button";
import { BadgeRow, RatingLine } from "./profile-badges";
import { LocationLine } from "./profile-sections";
import { SECTION_LABEL } from "./profile-utils";
import { AvatarUpload, CoverUpload } from "./owner-media";
import { ApproachDialog, ContactRevealDialog, InviteDialog, SaveCandidateButton, approachBlockedCopy } from "./recruiter-actions";

export interface HeaderOwnerActions {
  editBasics: () => void;
  addSection: (s: ProfileSection) => void;
}

function CurrentPlace({ profile }: { profile: Profile }) {
  const current = profile.experience.find((e) => !e.endMonth);
  const school = profile.education[0];
  const company = current?.company;
  const companyName = current?.companyName ?? profile.currentCompany;
  if (!companyName && !school) return null;
  return (
    <ul className="space-y-2 text-sm font-semibold text-foreground md:w-60">
      {companyName ? (
        <li>
          {company ? (
            <Link href={companyHref(company.slug)} className="flex items-center gap-2 hover:underline">
              <CompanyLogo company={company} size="sm" />
              <span className="truncate">{company.name}</span>
            </Link>
          ) : (
            <span className="flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[22%] bg-muted text-subtle-foreground">
                <Building2 className="size-4" />
              </span>
              <span className="truncate">{companyName}</span>
            </span>
          )}
        </li>
      ) : null}
      {school ? (
        <li>
          <a href="#section-education" className="flex items-center gap-2 hover:underline">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[22%] bg-muted text-subtle-foreground">
              <GraduationCap className="size-4" />
            </span>
            <span className="truncate">{school.institution}</span>
          </a>
        </li>
      ) : null}
    </ul>
  );
}

async function shareProfile(name: string) {
  const url = window.location.href.split("#")[0]!;
  if (navigator.share) {
    try {
      await navigator.share({ title: name, url });
      return;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success({ title: "Link copied", description: url });
  } catch {
    toast.info({ title: "Copy this link", description: url });
  }
}

function SelfActions({ profile, owner }: { profile: Profile; owner: HeaderOwnerActions }) {
  const [busy, setBusy] = useState<"pdf" | "docx" | null>(null);
  const download = async (format: "pdf" | "docx") => {
    setBusy(format);
    try {
      saveBlob(await api().profiles.resume(format), `${profile.user.username}-resume.${format}`);
    } catch (e) {
      toast.error({ title: "Could not build the resume", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button data-testid="add-section">
            <Plus /> Add section <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Add to your profile</DropdownMenuLabel>
          {PROFILE_SECTIONS.map((s) => (
            <DropdownMenuItem key={s} onSelect={() => owner.addSection(s)} data-testid={`add-section-${s}`}>
              {SECTION_LABEL[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" onClick={owner.editBasics} data-testid="edit-profile">
        <Pencil /> Edit profile basics
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" loading={!!busy} data-testid="resume-download">
            <Download /> Resume
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => void download("pdf")} data-testid="resume-pdf">
            Download as PDF
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void download("docx")} data-testid="resume-docx">
            Download as Word (DOCX)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IconButton label="Share profile" variant="outline" onClick={() => void shareProfile(profile.user.displayName)} data-testid="share-profile">
        <Share2 />
      </IconButton>
    </>
  );
}

function OtherActions({ profile }: { profile: Profile }) {
  const { user } = profile;
  const v = profile.viewer;
  const router = useRouter();
  const qc = useQueryClient();
  const invalidateNetwork = useInvalidateNetwork();
  const openConversation = useOpenConversation();
  const [dialog, setDialog] = useState<"report" | "block" | "remove" | "approach" | "contact" | "invite" | null>(null);
  const close = (o: boolean) => !o && setDialog(null);
  const rec = v.recruiter;
  const blockedCopy = rec ? approachBlockedCopy(rec) : null;

  const block = useMutation({
    mutationFn: () => (v.blocked ? api().users.unblock(user.id) : api().users.block(user.id)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.blocks });
      if (v.blocked) {
        toast.success({ title: `Unblocked ${user.displayName}` });
        void qc.invalidateQueries({ queryKey: qk.profile(user.username) });
      } else {
        toast.success({ title: `Blocked ${user.displayName}`, description: "They can not see your profile or message you. Unblock any time in settings." });
        qc.removeQueries({ queryKey: qk.profile(user.username) });
        router.push("/");
      }
    },
  });
  const remove = useMutation({
    mutationFn: () => api().network.remove(user.id),
    onSuccess: () => {
      toast.success({ title: `Removed ${user.displayName} from your connections` });
      invalidateNetwork(user.username);
    },
  });

  if (!v.signedIn)
    return (
      <>
        <Button asChild>
          <Link href={`/login?next=${encodeURIComponent(profileHref(user.username))}`}>Sign in to connect</Link>
        </Button>
        <IconButton label="Share profile" variant="outline" onClick={() => void shareProfile(user.displayName)}>
          <Share2 />
        </IconButton>
      </>
    );

  return (
    <>
      {rec ? (
        rec.unlockedApproachId ? (
          <Button onClick={() => setDialog("contact")} data-testid="view-contact">
            <Eye /> View contact
          </Button>
        ) : (
          <Tooltip content={blockedCopy}>
            <span tabIndex={blockedCopy ? 0 : -1} className="inline-flex rounded-md">
              <Button onClick={() => setDialog("approach")} disabled={!!blockedCopy} data-testid="approach-button">
                <Send /> Approach
              </Button>
            </span>
          </Tooltip>
        )
      ) : null}
      {!v.blocked ? (
        <ConnectButton key={`${v.connection}:${v.connectionId}`} user={user} state={v.connection} connectionId={v.connectionId} size="md" />
      ) : null}
      {v.connection !== "CONNECTED" && v.messaging.canMessage ? (
        <Button variant={rec ? "outline" : "primary"} onClick={() => openConversation.mutate(user)} loading={openConversation.isPending} data-testid="message-button">
          <MessageSquareText /> Message
        </Button>
      ) : v.connection !== "CONNECTED" && v.messaging.canRequest ? (
        <Tooltip content="You are not connected, so your first message arrives as a request they can accept or decline.">
          <Button variant="outline" onClick={() => openConversation.mutate(user)} loading={openConversation.isPending} data-testid="message-request-button">
            <MessageSquareText /> Message request
          </Button>
        </Tooltip>
      ) : null}
      {!v.blocked ? <FollowButton userId={user.id} username={user.username} following={v.following} variantWhenOff="outline" /> : null}
      {rec ? <SaveCandidateButton profile={profile} /> : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="More actions" variant="outline" data-testid="profile-menu">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {rec ? (
            <>
              <DropdownMenuItem onSelect={() => setDialog("invite")} data-testid="invite-to-apply">
                <Ticket /> Invite to apply
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem onSelect={() => void shareProfile(user.displayName)}>
            <Link2 /> Share profile
          </DropdownMenuItem>
          {v.connection === "CONNECTED" ? (
            <DropdownMenuItem onSelect={() => setDialog("remove")} data-testid="remove-connection">
              <UserMinus /> Remove connection
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialog("report")} data-testid="report-user">
            <Flag /> Report profile
          </DropdownMenuItem>
          <DropdownMenuItem destructive={!v.blocked} onSelect={() => setDialog("block")} data-testid={v.blocked ? "unblock-button" : "block-user"}>
            {v.blocked ? <Check /> : <Ban />} {v.blocked ? `Unblock ${user.displayName}` : `Block ${user.displayName}`}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ReportDialog open={dialog === "report"} onOpenChange={close} targetType="PROFILE" targetId={user.id} />
      <ConfirmDialog
        open={dialog === "block"}
        onOpenChange={close}
        title={v.blocked ? `Unblock ${user.displayName}?` : `Block ${user.displayName}?`}
        description={
          v.blocked
            ? "They will be able to see your profile and send you invitations again."
            : "They will not be able to see your profile, message you or connect with you. Existing connections and follows end. They are not told."
        }
        confirmLabel={v.blocked ? "Unblock" : "Block"}
        destructive={!v.blocked}
        onConfirm={() => block.mutateAsync()}
        testId="block-confirm"
      />
      <ConfirmDialog
        open={dialog === "remove"}
        onOpenChange={close}
        title={`Remove ${user.displayName} from your connections?`}
        description="They will not be told. You can send a new invitation later."
        confirmLabel="Remove"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
      {rec ? (
        <>
          {dialog === "approach" ? <ApproachDialog profile={profile} open onOpenChange={close} /> : null}
          {rec.unlockedApproachId ? <ContactRevealDialog approachId={rec.unlockedApproachId} name={user.displayName} open={dialog === "contact"} onOpenChange={close} /> : null}
          {dialog === "invite" ? <InviteDialog profile={profile} open onOpenChange={close} /> : null}
        </>
      ) : null}
    </>
  );
}

export function ProfileHeader({ profile, owner }: { profile: Profile; owner?: HeaderOwnerActions }) {
  const { user } = profile;
  const { user: me } = useAuth();
  const isSelf = !!owner;
  // The owner's avatar comes from Me so a fresh upload shows without waiting for the profile refetch.
  const avatarUrl = isSelf && me ? me.avatarUrl : user.avatarUrl;
  const v = profile.viewer;
  const rec = v.recruiter;
  const blockedCopy = rec && !rec.unlockedApproachId ? approachBlockedCopy(rec) : null;
  return (
    <Card className="overflow-hidden" data-testid="profile-header">
      <div className="relative h-28 bg-[linear-gradient(120deg,hsl(var(--primary)/0.9),hsl(var(--primary)/0.35)_60%,hsl(var(--primary)/0.15))] sm:h-44">
        {profile.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.coverUrl} alt="" className="absolute inset-0 size-full object-cover" />
        ) : null}
        {isSelf ? <CoverUpload hasCover={!!profile.coverUrl} /> : null}
      </div>
      <div className="px-4 pb-5 sm:px-6">
        <div className="flex items-end justify-between">
          <div className="relative -mt-14 rounded-full bg-card p-1 sm:-mt-20">
            <Avatar name={user.displayName} seed={user.id} src={avatarUrl} size="2xl" openToWork={user.openToWork} className="[&>span:first-child]:size-24 sm:[&>span:first-child]:size-32" />
            {isSelf ? <AvatarUpload hasAvatar={!!avatarUrl} /> : null}
          </div>
          {owner ? (
            <IconButton label="Edit profile basics" onClick={owner.editBasics} className="mt-3" data-testid="edit-basics-pencil">
              <Pencil />
            </IconButton>
          ) : null}
        </div>

        <div className="mt-3 flex flex-col gap-4 md:flex-row md:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1.5 text-2xl font-bold leading-tight text-foreground">
              <span className="break-words">{user.displayName}</span>
              <RoleMark role={user.role} />
            </h1>
            {profile.headline ? <p className="mt-1 text-base text-foreground">{profile.headline}</p> : owner ? (
              <button type="button" onClick={owner.editBasics} className="mt-1 text-base text-subtle-foreground hover:underline">
                Add a headline
              </button>
            ) : null}
            {user.recruiterAt ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                Recruiter at{" "}
                <Link href={companyHref(user.recruiterAt.slug)} className="font-semibold text-foreground hover:underline">
                  {user.recruiterAt.name}
                </Link>
              </p>
            ) : null}
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-subtle-foreground">
              <LocationLine profile={profile} />
              {profile.yearsExperience != null ? <span>{profile.yearsExperience} yrs experience</span> : null}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid="profile-stats">
              <Link href={`${profileHref(user.username)}/connections`} className="font-semibold text-link hover:underline">
                {profile.connectionCount >= 500 ? "500+" : profile.connectionCount} connection{profile.connectionCount === 1 ? "" : "s"}
              </Link>
              <Link href={`${profileHref(user.username)}/followers`} className="font-semibold text-link hover:underline">
                {profile.followerCount} follower{profile.followerCount === 1 ? "" : "s"}
              </Link>
              {!isSelf && v.mutualCount > 0 ? (
                <span className="text-muted-foreground" data-testid="mutual-count">
                  {v.mutualCount} mutual connection{v.mutualCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </p>
            <div className="mt-1">
              <RatingLine rating={profile.rating} href={profile.rating.count ? "#section-recommendations" : undefined} />
            </div>
            <BadgeRow badges={profile.badges} owner={isSelf} />
          </div>
          <CurrentPlace profile={profile} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="profile-actions">
          {owner ? <SelfActions profile={profile} owner={owner} /> : <OtherActions profile={profile} />}
        </div>
        {blockedCopy ? (
          <p className="mt-2 text-xs text-subtle-foreground" data-testid="approach-blocked-reason">
            {blockedCopy}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
