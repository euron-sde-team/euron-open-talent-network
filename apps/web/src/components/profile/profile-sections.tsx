"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { Award, BriefcaseBusiness, Building2, CalendarDays, ExternalLink, FolderGit2, GitBranch, GraduationCap, Link2, MapPin, Play, Plus, Star, ThumbsUp } from "lucide-react";
import { Badge, Button, cn, toast } from "@open-talent/ui";
import type { Profile, ProfileLink, ProfileSection, SectionAudience } from "@open-talent/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { CompanyLogo, companyHref } from "@/components/common/user-bits";
import { EMPLOYMENT_LABEL, WORKPLACE_LABEL, formatMonth, formatSpan } from "@/components/jobs/job-format";
import { HiddenSectionRow, ItemList, OwnerEmpty, SectionCard } from "./section-card";
import { LINK_KIND_LABEL, SECTION_ITEM, SECTION_LABEL, hostOf, yearRange } from "./profile-utils";
import { usePatchProfile } from "./use-profile";

export interface OwnerControls {
  audience: (s: ProfileSection) => SectionAudience;
  edit: (s: ProfileSection) => void;
  add: (s: ProfileSection) => void;
}

/** Long text clamped to a few lines with a toggle. Plain text only. */
export function ClampText({ text, lines = 4, className }: { text: string; lines?: 3 | 4 | 6; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 320 || text.split("\n").length > lines;
  const clamp = { 3: "line-clamp-3", 4: "line-clamp-4", 6: "line-clamp-6" }[lines];
  return (
    <div className={className}>
      <p className={cn("whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]", long && !open && clamp)}>{text}</p>
      {long ? (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-sm font-semibold text-muted-foreground hover:text-foreground hover:underline">
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

function SkillChips({ skills }: { skills: string[] }) {
  if (!skills.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {skills.map((s) => (
        <Badge key={s} tone="outline">
          {s}
        </Badge>
      ))}
    </div>
  );
}

/** Wraps a section: hidden placeholder, owner empty state, or nothing when empty for visitors. */
function Gate({ profile, section, owner, empty, children }: { profile: Profile; section: ProfileSection; owner?: OwnerControls; empty: boolean; children: React.ReactNode }) {
  if (profile.hiddenSections.includes(section)) return <HiddenSectionRow section={section} />;
  if (empty && !owner) return null;
  return <>{children}</>;
}

function sectionProps(section: ProfileSection, owner: OwnerControls | undefined, hasItems: boolean) {
  return {
    id: `section-${section}`,
    title: SECTION_LABEL[section],
    testId: `profile-${section}`,
    audience: owner?.audience(section),
    onEdit: owner && hasItems ? () => owner.edit(section) : undefined,
    onAdd: owner ? () => owner.add(section) : undefined,
  };
}

function AddFirst({ section, owner, text }: { section: ProfileSection; owner: OwnerControls; text: string }) {
  return (
    <OwnerEmpty
      text={text}
      action={
        <Button size="sm" variant="outline" onClick={() => owner.add(section)} data-testid={`add-first-${section}`}>
          <Plus /> Add {SECTION_ITEM[section]}
        </Button>
      }
    />
  );
}

// ─── About and open to work ─────────────────────────────────────────────────

export function AboutCard({ profile, onEdit }: { profile: Profile; onEdit?: () => void }) {
  if (!profile.about && !onEdit) return null;
  return (
    <SectionCard title="About" onEdit={onEdit} editLabel="Edit about" testId="profile-about">
      {profile.about ? (
        <ClampText text={profile.about} />
      ) : (
        <OwnerEmpty
          text="Two or three sentences on what you do best and what you want next. Recruiters read this first."
          action={
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Plus /> Write about
            </Button>
          }
        />
      )}
      {profile.languages.length ? (
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Languages:</span> {profile.languages.join(", ")}
        </p>
      ) : null}
    </SectionCard>
  );
}

export function OpenToWorkCard({ profile, onEdit, modeLabel }: { profile: Profile; onEdit?: () => void; modeLabel?: string }) {
  const o = profile.openToWork;
  if (!o) return null;
  const parts = [
    o.employmentTypes.map((t) => EMPLOYMENT_LABEL[t]).join(", "),
    o.workplaceTypes.map((t) => WORKPLACE_LABEL[t]).join(", "),
  ].filter(Boolean);
  return (
    <section className="flex items-start gap-3 rounded-lg border border-border bg-success-soft px-4 py-3 sm:px-5" data-testid="open-to-work-card" aria-label="Open to work">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-success-soft-foreground">
        <BriefcaseBusiness className="size-4" />
      </span>
      <div className="min-w-0 flex-1 text-success-soft-foreground">
        <p className="text-sm font-semibold">Open to work{o.roles.length ? `: ${o.roles.join(", ")}` : ""}</p>
        {parts.length ? <p className="text-sm">{parts.join(" · ")}</p> : null}
        {o.availableFrom ? (
          <p className="mt-0.5 inline-flex items-center gap-1 text-sm">
            <CalendarDays className="size-3.5" /> Available from {new Date(`${o.availableFrom}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
          </p>
        ) : null}
        {modeLabel ? <p className="mt-1 text-xs opacity-80">Shown to: {modeLabel}</p> : null}
      </div>
      {onEdit ? (
        <Button size="sm" variant="ghost" onClick={onEdit} className="shrink-0 text-success-soft-foreground" data-testid="open-to-work-edit">
          Edit
        </Button>
      ) : null}
    </section>
  );
}

// ─── Experience ─────────────────────────────────────────────────────────────

export function ExperienceSection({ profile, owner }: { profile: Profile; owner?: OwnerControls }) {
  const items = profile.experience;
  return (
    <Gate profile={profile} section="experience" owner={owner} empty={!items.length}>
      <SectionCard {...sectionProps("experience", owner, !!items.length)}>
        {!items.length && owner ? (
          <AddFirst section="experience" owner={owner} text="Roles carry the most weight with recruiters. Add the ones you are proudest of." />
        ) : (
          <ItemList>
            {items.map((e) => (
              <li key={e.id} className="flex gap-3 py-4 first:pt-2 last:pb-1">
                {e.company ? (
                  <Link href={companyHref(e.company.slug)} className="shrink-0" aria-label={e.company.name}>
                    <CompanyLogo company={e.company} size="lg" />
                  </Link>
                ) : (
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-[22%] bg-muted text-subtle-foreground" aria-hidden>
                    <Building2 className="size-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">{e.title}</p>
                  <p className="text-sm text-foreground">
                    {e.company ? (
                      <Link href={companyHref(e.company.slug)} className="hover:underline">
                        {e.companyName}
                      </Link>
                    ) : (
                      e.companyName
                    )}
                    {e.employmentType ? ` · ${EMPLOYMENT_LABEL[e.employmentType]}` : ""}
                  </p>
                  <p className="text-sm text-subtle-foreground">{formatSpan(e.startMonth, e.endMonth)}</p>
                  {e.location || e.workplaceType ? (
                    <p className="text-sm text-subtle-foreground">{[e.location, e.workplaceType ? WORKPLACE_LABEL[e.workplaceType] : null].filter(Boolean).join(" · ")}</p>
                  ) : null}
                  {e.description ? <ClampText text={e.description} lines={3} className="mt-2" /> : null}
                  <SkillChips skills={e.skills} />
                </div>
              </li>
            ))}
          </ItemList>
        )}
      </SectionCard>
    </Gate>
  );
}

// ─── Education ──────────────────────────────────────────────────────────────

export function EducationSection({ profile, owner }: { profile: Profile; owner?: OwnerControls }) {
  const items = profile.education;
  return (
    <Gate profile={profile} section="education" owner={owner} empty={!items.length}>
      <SectionCard {...sectionProps("education", owner, !!items.length)}>
        {!items.length && owner ? (
          <AddFirst section="education" owner={owner} text="Add a degree, a bootcamp or a course that shaped your work." />
        ) : (
          <ItemList>
            {items.map((e) => (
              <li key={e.id} className="flex gap-3 py-4 first:pt-2 last:pb-1">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-[22%] bg-muted text-subtle-foreground" aria-hidden>
                  <GraduationCap className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">{e.institution}</p>
                  {e.degree || e.field ? <p className="text-sm text-foreground">{[e.degree, e.field].filter(Boolean).join(", ")}</p> : null}
                  {e.startYear || e.endYear ? <p className="text-sm text-subtle-foreground">{yearRange(e.startYear, e.endYear)}</p> : null}
                  {e.grade ? <p className="text-sm text-subtle-foreground">Grade: {e.grade}</p> : null}
                  {e.description ? <ClampText text={e.description} lines={3} className="mt-2" /> : null}
                </div>
              </li>
            ))}
          </ItemList>
        )}
      </SectionCard>
    </Gate>
  );
}

// ─── Projects ───────────────────────────────────────────────────────────────

export function ProjectsSection({ profile, owner }: { profile: Profile; owner?: OwnerControls }) {
  const items = profile.projects;
  return (
    <Gate profile={profile} section="projects" owner={owner} empty={!items.length}>
      <SectionCard {...sectionProps("projects", owner, !!items.length)}>
        {!items.length && owner ? (
          <AddFirst section="projects" owner={owner} text="Show something you built. A link to a repo or a demo says more than a list of skills." />
        ) : (
          <ItemList>
            {items.map((p) => (
              <li key={p.id} className="flex flex-col gap-3 py-4 first:pt-2 last:pb-1 sm:flex-row">
                {p.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.cover.thumbUrl ?? p.cover.url} alt="" className="aspect-video w-full shrink-0 rounded-md border border-border object-cover sm:w-40" loading="lazy" />
                ) : (
                  <span className="hidden size-12 shrink-0 items-center justify-center rounded-[22%] bg-muted text-subtle-foreground sm:flex" aria-hidden>
                    <FolderGit2 className="size-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">{p.name}</p>
                  {p.startMonth ? <p className="text-sm text-subtle-foreground">{p.endMonth ? `${formatMonth(p.startMonth)} to ${formatMonth(p.endMonth)}` : `Since ${formatMonth(p.startMonth)}`}</p> : null}
                  {p.description ? <ClampText text={p.description} lines={3} className="mt-1" /> : null}
                  <SkillChips skills={p.skills} />
                  {p.url || p.repoUrl ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {p.url ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={p.url} target="_blank" rel="noopener noreferrer nofollow">
                            <ExternalLink /> {hostOf(p.url)}
                          </a>
                        </Button>
                      ) : null}
                      {p.repoUrl ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={p.repoUrl} target="_blank" rel="noopener noreferrer nofollow">
                            <GitBranch /> Source
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ItemList>
        )}
      </SectionCard>
    </Gate>
  );
}

// ─── Skills ─────────────────────────────────────────────────────────────────

export function SkillsSection({ profile, owner }: { profile: Profile; owner?: OwnerControls }) {
  const items = profile.skills;
  const [all, setAll] = useState(false);
  const canEndorse = !profile.viewer.isSelf && profile.viewer.signedIn && profile.viewer.connection === "CONNECTED";
  const patch = usePatchProfile(profile.user.username);
  const endorse = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => (on ? api().profiles.endorse(id) : api().profiles.unendorse(id)),
    meta: { silent: true },
    onMutate: ({ id, on }) =>
      patch((p) => ({
        ...p,
        skills: p.skills.map((s) => (s.id === id ? { ...s, endorsedByViewer: on, endorsementCount: Math.max(0, s.endorsementCount + (on ? 1 : -1)) } : s)),
      })),
    onSuccess: (r, { id }) => patch((p) => ({ ...p, skills: p.skills.map((s) => (s.id === id ? { ...s, ...r } : s)) })),
    onError: (e, _v, rollback) => {
      rollback?.();
      toast.error({ title: "Could not update the endorsement", description: errorMessage(e) });
    },
  });
  const shown = all ? items : items.slice(0, 6);
  return (
    <Gate profile={profile} section="skills" owner={owner} empty={!items.length}>
      <SectionCard
        {...sectionProps("skills", owner, !!items.length)}
        footer={
          items.length > 6 ? (
            <button type="button" onClick={() => setAll((v) => !v)} className="w-full rounded-b-lg px-4 py-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="skills-toggle">
              {all ? "Show fewer skills" : `Show all ${items.length} skills`}
            </button>
          ) : undefined
        }
      >
        {!items.length && owner ? (
          <AddFirst section="skills" owner={owner} text="Skills power search and job matching. Add the ones you use every week." />
        ) : (
          <ItemList>
            {shown.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3 first:pt-2 last:pb-1" data-testid="skill-row">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{s.name}</p>
                  <p className="text-sm text-subtle-foreground">
                    {[s.years ? `${s.years} yr${s.years > 1 ? "s" : ""}` : null, s.category, s.endorsementCount ? `${s.endorsementCount} endorsement${s.endorsementCount > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ") || "No endorsements yet"}
                  </p>
                </div>
                {canEndorse ? (
                  <Button
                    size="sm"
                    variant={s.endorsedByViewer ? "secondary" : "outline"}
                    aria-pressed={s.endorsedByViewer}
                    onClick={() => endorse.mutate({ id: s.id, on: !s.endorsedByViewer })}
                    data-testid="endorse-button"
                  >
                    <ThumbsUp /> {s.endorsedByViewer ? "Endorsed" : "Endorse"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ItemList>
        )}
      </SectionCard>
    </Gate>
  );
}

// ─── Certifications ─────────────────────────────────────────────────────────

export function CertificationsSection({ profile, owner }: { profile: Profile; owner?: OwnerControls }) {
  const items = profile.certifications;
  return (
    <Gate profile={profile} section="certifications" owner={owner} empty={!items.length}>
      <SectionCard {...sectionProps("certifications", owner, !!items.length)}>
        {!items.length && owner ? (
          <AddFirst section="certifications" owner={owner} text="Add licenses and certifications with a credential link so they can be checked." />
        ) : (
          <ItemList>
            {items.map((c) => (
              <li key={c.id} className="flex gap-3 py-4 first:pt-2 last:pb-1">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-[22%] bg-muted text-subtle-foreground" aria-hidden>
                  <Award className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">{c.name}</p>
                  {c.issuer ? <p className="text-sm text-foreground">{c.issuer}</p> : null}
                  {c.issuedMonth ? (
                    <p className="text-sm text-subtle-foreground">
                      Issued {formatMonth(c.issuedMonth)}
                      {c.expiresMonth ? ` · Expires ${formatMonth(c.expiresMonth)}` : ""}
                    </p>
                  ) : null}
                  {c.credentialId ? <p className="text-sm text-subtle-foreground">Credential ID {c.credentialId}</p> : null}
                  {c.credentialUrl ? (
                    <Button asChild size="sm" variant="outline" className="mt-2">
                      <a href={c.credentialUrl} target="_blank" rel="noopener noreferrer nofollow">
                        <ExternalLink /> Show credential
                      </a>
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ItemList>
        )}
      </SectionCard>
    </Gate>
  );
}

// ─── Links and featured ─────────────────────────────────────────────────────

function LinkIcon({ link }: { link: ProfileLink }) {
  if (link.kind === "GITHUB") return <GitBranch className="size-4" />;
  if (link.kind === "YOUTUBE") return <Play className="size-4" />;
  return <Link2 className="size-4" />;
}

/** A YouTube video that loads only when clicked (no third-party request before that). */
function YouTubeEmbed({ link }: { link: ProfileLink }) {
  const [on, setOn] = useState(false);
  if (on && link.embedId)
    return (
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(link.embedId)}?autoplay=1`}
          title={link.label ?? "Video"}
          className="size-full"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  return (
    <button
      type="button"
      onClick={() => setOn(true)}
      className="group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border border-border bg-[linear-gradient(135deg,hsl(var(--primary)/0.25),hsl(var(--primary)/0.06))] focus-visible:ring-2"
      data-testid="video-click-to-load"
      aria-label={`Play ${link.label ?? "video"}`}
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-card text-foreground shadow-card transition-transform group-hover:scale-105">
        <Play className="size-6 translate-x-0.5" />
      </span>
      <span className="absolute bottom-2 left-3 right-3 truncate text-left text-xs font-medium text-muted-foreground">Click to load the video from YouTube</span>
    </button>
  );
}

export function FeaturedSection({ profile }: { profile: Profile }) {
  if (profile.hiddenSections.includes("links")) return null;
  const featured = profile.links.filter((l) => l.featured);
  if (!featured.length) return null;
  return (
    <SectionCard title="Featured" testId="profile-featured">
      <div className="grid gap-3 sm:grid-cols-2">
        {featured.map((l) => (
          <div key={l.id} className="min-w-0 rounded-md border border-border p-3">
            {l.embedId ? <YouTubeEmbed link={l} /> : null}
            <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className={cn("flex items-center gap-2 text-sm font-semibold text-foreground hover:underline", l.embedId && "mt-2")}>
              <LinkIcon link={l} />
              <span className="truncate">{l.label ?? hostOf(l.url)}</span>
            </a>
            <p className="truncate text-xs text-subtle-foreground">{hostOf(l.url)}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export function LinksSection({ profile, owner }: { profile: Profile; owner?: OwnerControls }) {
  const items = profile.links;
  return (
    <Gate profile={profile} section="links" owner={owner} empty={!items.length}>
      <SectionCard {...sectionProps("links", owner, !!items.length)}>
        {!items.length && owner ? (
          <AddFirst section="links" owner={owner} text="Link your GitHub, a portfolio or a talk. Mark one as featured to pin it near the top." />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {items.map((l) => (
              <li key={l.id}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5 hover:bg-muted focus-visible:ring-2"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <LinkIcon link={l} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {l.label ?? LINK_KIND_LABEL[l.kind]}
                      {l.featured ? <Star className="ml-1 inline size-3 fill-current text-warning" aria-label="Featured" /> : null}
                    </span>
                    <span className="block truncate text-xs text-subtle-foreground">{hostOf(l.url)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </Gate>
  );
}

export function LocationLine({ profile }: { profile: Profile }) {
  if (!profile.location) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <MapPin className="size-3.5" /> {profile.location}
    </span>
  );
}
