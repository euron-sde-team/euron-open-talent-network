"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CircleCheck, Info, Quote, Sparkles } from "lucide-react";
import { Badge, Button, Card, Checkbox, Spinner, cn, toast } from "@open-talent/ui";
import type { ImportStatus, ProfileImport, ProfileSection, ProposedProfile } from "@open-talent/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { EMPLOYMENT_LABEL, formatMonth, formatSpan } from "@/components/jobs/job-format";
import { BADGE_KIND_LABEL, LINK_KIND_LABEL, SECTION_LABEL, hostOf, yearRange } from "../profile-utils";
import { useApplyMine } from "../use-profile";

const STAGES: { status: ImportStatus; label: string; detail: (audio: boolean) => string }[] = [
  { status: "QUEUED", label: "Queued", detail: () => "Waiting for a free worker" },
  { status: "EXTRACTING", label: "Reading", detail: (audio) => (audio ? "Transcribing your voice note" : "Pulling the text out of your input") },
  { status: "GENERATING", label: "Drafting", detail: () => "Turning it into roles, projects and skills" },
  { status: "SCORING", label: "Checking badges", detail: () => "Keeping only badges backed by a quote from your input" },
  { status: "READY", label: "Ready to review", detail: () => "Nothing is saved until you choose" },
];

const TERMINAL: ImportStatus[] = ["READY", "APPLIED", "FAILED"];

export function useImport(id: string | null) {
  return useQuery({
    queryKey: qk.import(id ?? ""),
    queryFn: () => api().profiles.import(id!),
    enabled: !!id,
    // Realtime "import:status" invalidates this key; polling covers a missing socket.
    refetchInterval: (q) => (q.state.data && TERMINAL.includes(q.state.data.status) ? false : 1500),
  });
}

export function ImportProgress({ imp, onRetry }: { imp: ProfileImport | undefined; onRetry: () => void }) {
  const status = imp?.status ?? "QUEUED";
  const failed = status === "FAILED";
  const at = Math.max(0, STAGES.findIndex((s) => s.status === status));
  const audio = imp?.source === "AUDIO";
  return (
    <Card className="p-5 sm:p-6" data-testid="import-progress">
      <h2 className="text-xl font-semibold">{failed ? "The import did not finish" : "Building your draft"}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{failed ? "Your input is still here. Try again, or paste the text instead of a file." : "This usually takes under a minute. You can leave this page; we will notify you when it is ready."}</p>
      {failed ? (
        <div className="mt-4 flex items-start gap-3 rounded-md bg-danger-soft px-4 py-3 text-sm text-danger-soft-foreground" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">{imp?.error ?? "Something went wrong while reading your input."}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={onRetry} data-testid="import-retry">
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <ol className="mt-5 space-y-0" aria-label="Progress">
          {STAGES.map((s, i) => {
            const done = i < at || status === "READY";
            const current = i === at && status !== "READY";
            return (
              <li key={s.status} className="relative flex gap-3 pb-5 last:pb-0" aria-current={current ? "step" : undefined}>
                {i < STAGES.length - 1 ? <span className={cn("absolute left-[13px] top-7 h-[calc(100%-24px)] w-px", done ? "bg-primary" : "bg-border")} aria-hidden /> : null}
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                    done ? "border-primary bg-primary text-primary-foreground" : current ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-border bg-card text-subtle-foreground",
                  )}
                >
                  {done ? <Check className="size-4" /> : current ? <Spinner size="sm" className="text-current" label={s.label} /> : i + 1}
                </span>
                <div className="pt-0.5">
                  <p className={cn("text-sm font-semibold", done || current ? "text-foreground" : "text-subtle-foreground")}>{s.label}</p>
                  <p className="text-xs text-subtle-foreground">{s.detail(audio)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

// ─── Review ─────────────────────────────────────────────────────────────────

type Part = "basics" | ProfileSection | "badges";

function count(p: ProposedProfile, s: ProfileSection): number {
  return p[s].length;
}

function Group({ id, title, checked, onChecked, note, children, testId }: { id: string; title: string; checked: boolean; onChecked: (v: boolean) => void; note?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className={cn("rounded-lg border transition-colors", checked ? "border-primary/40" : "border-border")} data-testid={testId}>
      <label htmlFor={id} className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-3">
        <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChecked(v === true)} />
        <span className="flex-1 font-semibold">{title}</span>
        {note ? <span className="text-xs text-subtle-foreground">{note}</span> : null}
      </label>
      <div className={cn("px-4 py-3 text-sm", !checked && "opacity-60")}>{children}</div>
    </section>
  );
}

export function ImportReview({ imp, existing, onApplied }: { imp: ProfileImport; existing: Partial<Record<ProfileSection, number>>; onApplied: () => void }) {
  const qc = useQueryClient();
  const applyMine = useApplyMine();
  const p = imp.proposal!;
  const sections = (["experience", "education", "projects", "skills", "certifications", "links"] as ProfileSection[]).filter((s) => count(p, s) > 0);
  const hasBasics = !!(p.headline || p.about || p.currentTitle || p.location || p.yearsExperience != null);
  const [pick, setPick] = useState<Record<Part, boolean>>(() => {
    const out = { basics: hasBasics, badges: imp.proposedBadges.length > 0 } as Record<Part, boolean>;
    for (const s of sections) out[s] = true;
    return out;
  });
  const set = (k: Part) => (v: boolean) => setPick((c) => ({ ...c, [k]: v }));
  const chosen = sections.filter((s) => pick[s]);
  const nothing = !chosen.length && !pick.basics && !pick.badges;
  const apply = useMutation({
    mutationFn: () => api().profiles.applyImport(imp.id, { sections: chosen, basics: !!pick.basics, badges: !!pick.badges }),
    meta: { silent: true },
    onSuccess: async () => {
      void qc.invalidateQueries({ queryKey: qk.importLatest });
      try {
        applyMine(await api().profiles.mine());
      } catch {
        /* the next page load refetches */
      }
      toast.success({ title: "Added to your profile" });
      onApplied();
    },
    onError: (e) => toast.error({ title: "Could not apply the draft", description: errorMessage(e) }),
  });
  const replaces = (s: ProfileSection) => (existing[s] ? `Replaces the ${existing[s]} on your profile` : undefined);

  return (
    <div className="space-y-4" data-testid="import-review">
      <Card className="p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Sparkles className="size-5 text-primary" /> Review your draft
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Untick anything that is wrong. You can edit every item on your page afterwards. Nothing is published by this step.</p>
        {imp.missingInfo.length ? (
          <div className="mt-4 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground" data-testid="import-missing">
            <p className="flex items-center gap-2 font-semibold">
              <Info className="size-4" /> Worth adding afterwards
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-6">
              {imp.missingInfo.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {hasBasics ? (
        <Group id="pick-basics" title="Headline and summary" checked={!!pick.basics} onChecked={set("basics")} testId="review-basics">
          <dl className="space-y-2">
            {p.headline ? (
              <div>
                <dt className="text-xs text-subtle-foreground">Headline</dt>
                <dd className="font-semibold">{p.headline}</dd>
              </div>
            ) : null}
            {p.currentTitle || p.location || p.yearsExperience != null ? (
              <div>
                <dt className="text-xs text-subtle-foreground">Details</dt>
                <dd>{[p.currentTitle, p.location, p.yearsExperience != null ? `${p.yearsExperience} yrs experience` : null].filter(Boolean).join(" · ")}</dd>
              </div>
            ) : null}
            {p.about ? (
              <div>
                <dt className="text-xs text-subtle-foreground">About</dt>
                <dd className="line-clamp-6 whitespace-pre-wrap">{p.about}</dd>
              </div>
            ) : null}
          </dl>
        </Group>
      ) : null}

      {p.experience.length ? (
        <Group id="pick-experience" title={`${SECTION_LABEL.experience} (${p.experience.length})`} checked={!!pick.experience} onChecked={set("experience")} note={replaces("experience")} testId="review-experience">
          <ul className="divide-y divide-border">
            {p.experience.map((e, i) => (
              <li key={i} className="py-2 first:pt-0 last:pb-0">
                <p className="font-semibold">{e.title}</p>
                <p>
                  {e.companyName}
                  {e.employmentType ? ` · ${EMPLOYMENT_LABEL[e.employmentType]}` : ""}
                </p>
                <p className="text-xs text-subtle-foreground">{formatSpan(e.startMonth, e.endMonth)}</p>
                {e.skills.length ? <p className="mt-0.5 text-xs text-subtle-foreground">{e.skills.join(", ")}</p> : null}
              </li>
            ))}
          </ul>
        </Group>
      ) : null}

      {p.education.length ? (
        <Group id="pick-education" title={`${SECTION_LABEL.education} (${p.education.length})`} checked={!!pick.education} onChecked={set("education")} note={replaces("education")} testId="review-education">
          <ul className="divide-y divide-border">
            {p.education.map((e, i) => (
              <li key={i} className="py-2 first:pt-0 last:pb-0">
                <p className="font-semibold">{e.institution}</p>
                <p>{[e.degree, e.field].filter(Boolean).join(", ")}</p>
                {e.startYear || e.endYear ? <p className="text-xs text-subtle-foreground">{yearRange(e.startYear, e.endYear)}</p> : null}
              </li>
            ))}
          </ul>
        </Group>
      ) : null}

      {p.projects.length ? (
        <Group id="pick-projects" title={`${SECTION_LABEL.projects} (${p.projects.length})`} checked={!!pick.projects} onChecked={set("projects")} note={replaces("projects")} testId="review-projects">
          <ul className="divide-y divide-border">
            {p.projects.map((x, i) => (
              <li key={i} className="py-2 first:pt-0 last:pb-0">
                <p className="font-semibold">{x.name}</p>
                {x.description ? <p className="line-clamp-2 text-muted-foreground">{x.description}</p> : null}
                {x.url ? <p className="text-xs text-link">{hostOf(x.url)}</p> : null}
              </li>
            ))}
          </ul>
        </Group>
      ) : null}

      {p.skills.length ? (
        <Group id="pick-skills" title={`${SECTION_LABEL.skills} (${p.skills.length})`} checked={!!pick.skills} onChecked={set("skills")} note={existing.skills ? "Endorsements stay on skills you keep" : undefined} testId="review-skills">
          <div className="flex flex-wrap gap-1.5">
            {p.skills.map((s) => (
              <Badge key={s.name} tone="outline" size="md">
                {s.name}
                {s.years ? <span className="font-normal text-subtle-foreground">{s.years}y</span> : null}
              </Badge>
            ))}
          </div>
        </Group>
      ) : null}

      {p.certifications.length ? (
        <Group id="pick-certifications" title={`${SECTION_LABEL.certifications} (${p.certifications.length})`} checked={!!pick.certifications} onChecked={set("certifications")} note={replaces("certifications")} testId="review-certifications">
          <ul className="space-y-1">
            {p.certifications.map((c, i) => (
              <li key={i}>
                <span className="font-semibold">{c.name}</span>
                {c.issuer ? ` · ${c.issuer}` : ""}
                {c.issuedMonth ? <span className="text-xs text-subtle-foreground"> · {formatMonth(c.issuedMonth)}</span> : null}
              </li>
            ))}
          </ul>
        </Group>
      ) : null}

      {p.links.length ? (
        <Group id="pick-links" title={`${SECTION_LABEL.links} (${p.links.length})`} checked={!!pick.links} onChecked={set("links")} note={replaces("links")} testId="review-links">
          <ul className="space-y-1">
            {p.links.map((l, i) => (
              <li key={i}>
                <span className="font-semibold">{l.label ?? LINK_KIND_LABEL[l.kind]}</span> <span className="text-subtle-foreground">{hostOf(l.url)}</span>
              </li>
            ))}
          </ul>
        </Group>
      ) : null}

      {imp.proposedBadges.length ? (
        <Group id="pick-badges" title={`Badges (${imp.proposedBadges.length})`} checked={!!pick.badges} onChecked={set("badges")} note="Each one quotes your own words" testId="review-badges">
          <ul className="space-y-3">
            {imp.proposedBadges.map((b) => (
              <li key={b.slug}>
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone="primary" size="md">
                    <CircleCheck /> {b.label}
                  </Badge>
                  <span className="text-xs text-subtle-foreground">
                    {BADGE_KIND_LABEL[b.kind]}
                    {b.confidence != null ? ` · ${Math.round(b.confidence * 100)}% confidence` : ""}
                  </span>
                </p>
                {b.rationale ? <p className="mt-1 text-muted-foreground">{b.rationale}</p> : null}
                {b.evidenceQuote ? (
                  <blockquote className="mt-1 flex gap-2 rounded-md bg-muted px-3 py-2">
                    <Quote className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" />
                    <span className="italic">{b.evidenceQuote}</span>
                  </blockquote>
                ) : null}
              </li>
            ))}
          </ul>
        </Group>
      ) : null}

      <div className="sticky bottom-16 z-10 flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-card sm:flex-row sm:items-center sm:justify-between md:bottom-4">
        <p className="text-sm text-muted-foreground">{nothing ? "Pick at least one part to add." : `Adding ${[pick.basics ? "summary" : null, ...chosen.map((s) => SECTION_LABEL[s].toLowerCase()), pick.badges ? "badges" : null].filter(Boolean).join(", ")}.`}</p>
        <Button onClick={() => apply.mutate()} loading={apply.isPending} disabled={nothing} data-testid="import-apply">
          Add to my profile
        </Button>
      </div>
    </div>
  );
}
