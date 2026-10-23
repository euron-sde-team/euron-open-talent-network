"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { isApiError } from "@open-talent/api-client";
import { BriefcaseBusiness, ChevronRight, Eye, EyeOff, Globe, Lock, ShieldCheck, Sparkles } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Segmented,
  Select,
  toast,
} from "@open-talent/ui";
import { EMPLOYMENT_TYPES, PROFILE_SECTIONS, WORKPLACE_TYPES, type EmploymentType, type MyProfile, type OpenToWorkMode, type ProfileSection, type SectionAudience, type WorkplaceType } from "@open-talent/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useNetworkMeta } from "@/lib/meta";
import { CompletenessMeter } from "@/components/shell/left-rail";
import { EMPLOYMENT_LABEL, WORKPLACE_LABEL } from "@/components/jobs/job-format";
import { AUDIENCE_LABEL, OPEN_TO_WORK_LABEL, SECTION_LABEL, STATUS_HINT, STATUS_LABEL } from "./profile-utils";
import { TagInput } from "./tag-input";
import { useApplyMine } from "./use-profile";

export type OwnerDialog = "openToWork" | "visibility" | "contact";

/** Where each completeness hint takes the owner. Matched on the API's hint text (domain/profile.ts). */
function hintTarget(hint: string): { kind: "section"; section: ProfileSection } | { kind: "basics"; focus?: "about" } | { kind: "dialog"; dialog: OwnerDialog } | { kind: "avatar" } {
  const h = hint.toLowerCase();
  if (h.includes("contact")) return { kind: "dialog", dialog: "contact" };
  if (h.includes("headline")) return { kind: "basics" };
  if (h.includes("about")) return { kind: "basics", focus: "about" };
  if (h.includes("photo")) return { kind: "avatar" };
  if (h.includes("skill")) return { kind: "section", section: "skills" };
  if (h.includes("role")) return { kind: "section", section: "experience" };
  if (h.includes("project")) return { kind: "section", section: "projects" };
  if (h.includes("education")) return { kind: "section", section: "education" };
  return { kind: "section", section: "links" };
}

const STATUS_TONE = { DRAFT: "warning", PUBLISHED: "success", UNLISTED: "neutral", SUSPENDED: "danger" } as const;

export function OwnerStrip({
  my,
  onDialog,
  onSection,
  onBasics,
}: {
  my: MyProfile;
  onDialog: (d: OwnerDialog) => void;
  onSection: (s: ProfileSection) => void;
  onBasics: (focus?: "about") => void;
}) {
  const applyMine = useApplyMine();
  const aiImport = !!useNetworkMeta().data?.ai.import;
  const status = useMutation({
    mutationFn: (s: "PUBLISHED" | "UNLISTED" | "DRAFT") => api().profiles.setStatus(s),
    meta: { silent: true },
    onSuccess: (fresh, s) => {
      applyMine(fresh);
      toast.success({ title: s === "PUBLISHED" ? "Your profile is live" : s === "UNLISTED" ? "Your profile is unlisted" : "Your profile is back to draft", description: STATUS_HINT[s] });
    },
    onError: (e) => {
      const publish = isApiError(e) && e.code.startsWith("PUBLISH_");
      toast.error({ title: publish ? "Not ready to publish yet" : "Could not change the status", description: publish && isApiError(e) ? e.message : errorMessage(e) });
      if (isApiError(e) && e.code === "PUBLISH_NO_CONTACT") onDialog("contact");
    },
  });
  const s = my.status;
  const pct = Math.round(my.completeness);
  const ready = pct >= my.publishThreshold;
  const go = (hint: string) => {
    const t = hintTarget(hint);
    if (t.kind === "section") onSection(t.section);
    else if (t.kind === "basics") onBasics(t.focus);
    else if (t.kind === "dialog") onDialog(t.dialog);
    else toast.info({ title: "Use the camera button on your photo to upload one" });
  };

  return (
    <Card className="overflow-hidden" data-testid="owner-strip">
      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[s]} size="md" data-testid="profile-status">
              {s === "PUBLISHED" ? <Globe /> : s === "UNLISTED" ? <EyeOff /> : <Lock />} {STATUS_LABEL[s]}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Profile strength <span className="font-semibold text-foreground">{pct}%</span>
              {!ready ? ` · ${my.publishThreshold}% needed to publish` : ""}
            </span>
          </div>
          <CompletenessMeter value={pct} threshold={my.publishThreshold} className="mt-2 max-w-md" />
          <p className="mt-2 text-sm text-muted-foreground">{STATUS_HINT[s]}</p>
          {my.missing.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Suggestions">
              {my.missing.map((m) => (
                <li key={m}>
                  <button type="button" onClick={() => go(m)} className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-muted focus-visible:ring-2" data-testid="missing-hint">
                    {m} <ChevronRight className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
          {s === "DRAFT" || s === "UNLISTED" ? (
            <Button onClick={() => status.mutate("PUBLISHED")} loading={status.isPending && status.variables === "PUBLISHED"} disabled={status.isPending} data-testid="publish-profile">
              <Globe /> Publish
            </Button>
          ) : null}
          {s === "DRAFT" || s === "PUBLISHED" ? (
            <Button variant="outline" onClick={() => status.mutate("UNLISTED")} loading={status.isPending && status.variables === "UNLISTED"} disabled={status.isPending} data-testid="unlist-profile">
              <EyeOff /> {s === "DRAFT" ? "Publish unlisted" : "Unlist"}
            </Button>
          ) : null}
          {s === "PUBLISHED" || s === "UNLISTED" ? (
            <Button variant="ghost" onClick={() => status.mutate("DRAFT")} loading={status.isPending && status.variables === "DRAFT"} disabled={status.isPending} data-testid="draft-profile">
              Back to draft
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-1 gap-y-1 border-t border-border bg-muted/40 px-2 py-1.5 sm:px-4">
        <Button size="sm" variant="ghost" onClick={() => onDialog("openToWork")} data-testid="owner-open-to-work">
          <BriefcaseBusiness /> Open to work: {OPEN_TO_WORK_LABEL[my.openToWorkMode]}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDialog("visibility")} data-testid="owner-visibility">
          <Eye /> Section visibility
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDialog("contact")} data-testid="owner-contact">
          <ShieldCheck /> Private contact
        </Button>
        {aiImport ? (
          <Button size="sm" variant="ghost" asChild>
            <Link href="/profile/setup">
              <Sparkles /> Import from a resume
            </Link>
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

// ─── Open to work ───────────────────────────────────────────────────────────

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function OpenToWorkEditor({ my, onClose, onSaved }: { my: MyProfile; onClose: () => void; onSaved?: () => void }) {
  const applyMine = useApplyMine();
  const s = my.openToWorkSettings;
  const [mode, setMode] = useState<OpenToWorkMode>(my.openToWorkMode);
  const [roles, setRoles] = useState<string[]>(s.roles);
  const [types, setTypes] = useState<EmploymentType[]>(s.employmentTypes);
  const [places, setPlaces] = useState<WorkplaceType[]>(s.workplaceTypes);
  const [from, setFrom] = useState(s.availableFrom ?? "");
  const save = useMutation({
    mutationFn: () => api().profiles.openToWork({ mode, roles, employmentTypes: types, workplaceTypes: places, availableFrom: from || null }),
    meta: { silent: true },
    onSuccess: (fresh) => {
      applyMine(fresh);
      toast.success({ title: mode === "OFF" ? "Open to work is off" : "Open to work saved" });
      onSaved?.();
      onClose();
    },
    onError: (e) => toast.error({ title: "Could not save", description: errorMessage(e) }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent size="md" data-testid="open-to-work-editor">
        <DialogHeader>
          <DialogTitle>Open to work</DialogTitle>
          <DialogDescription>Tell recruiters what you are looking for. A green ring around your photo shows the signal to the people you choose.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Who sees it</p>
            <Segmented<OpenToWorkMode>
              value={mode}
              onChange={setMode}
              aria-label="Who sees it"
              options={[
                { value: "OFF", label: "Off" },
                { value: "RECRUITERS", label: "Recruiters" },
                { value: "PUBLIC", label: "Everyone" },
              ]}
            />
            <p className="text-xs text-subtle-foreground">
              {mode === "OFF" ? "Nobody sees an open-to-work signal." : mode === "RECRUITERS" ? "Only verified recruiters see it, including any at your current company." : "Everyone who opens your profile sees it."}
            </p>
          </div>
          <Field label="Roles you want" htmlFor="otw-roles" hint="Up to 5">
            <TagInput id="otw-roles" value={roles} onChange={setRoles} max={5} maxLength={80} placeholder="Staff Engineer" aria-label="Roles" />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Employment types</legend>
            <div className="grid grid-cols-2 gap-2">
              {EMPLOYMENT_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={types.includes(t)} onCheckedChange={() => setTypes((l) => toggle(l, t))} /> {EMPLOYMENT_LABEL[t]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Workplace</legend>
            <div className="flex flex-wrap gap-4">
              {WORKPLACE_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={places.includes(t)} onCheckedChange={() => setPlaces((l) => toggle(l, t))} /> {WORKPLACE_LABEL[t]}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Available from" htmlFor="otw-from" optional>
            <Input id="otw-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[200px]" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} data-testid="open-to-work-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Section visibility ─────────────────────────────────────────────────────

export function VisibilityEditor({ my, onClose }: { my: MyProfile; onClose: () => void }) {
  const applyMine = useApplyMine();
  const [v, setV] = useState<Record<ProfileSection, SectionAudience>>(() => Object.fromEntries(PROFILE_SECTIONS.map((s) => [s, my.sectionVisibility[s] ?? "PUBLIC"])) as Record<ProfileSection, SectionAudience>);
  const save = useMutation({
    mutationFn: () => api().profiles.visibility(v),
    meta: { silent: true },
    onSuccess: (fresh) => {
      applyMine(fresh);
      toast.success({ title: "Visibility saved" });
      onClose();
    },
    onError: (e) => toast.error({ title: "Could not save", description: errorMessage(e) }),
  });
  const options = (Object.keys(AUDIENCE_LABEL) as SectionAudience[]).map((a) => ({ value: a, label: AUDIENCE_LABEL[a] }));
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent size="md" data-testid="visibility-editor">
        <DialogHeader>
          <DialogTitle>Who sees each section</DialogTitle>
          <DialogDescription>Your name, headline, photo and About are always visible on a published profile. Sections you limit show visitors a short note instead.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="divide-y divide-border">
            {PROFILE_SECTIONS.map((s) => (
              <li key={s} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-semibold">{SECTION_LABEL[s]}</span>
                <Select value={v[s]} onValueChange={(a) => setV((c) => ({ ...c, [s]: a as SectionAudience }))} options={options} aria-label={`${SECTION_LABEL[s]} visibility`} className="sm:w-64" data-testid={`visibility-${s}`} />
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} data-testid="visibility-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Private contact ────────────────────────────────────────────────────────

const PHONE = /^\+[1-9][0-9]{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ContactFields({ value, onChange, errors }: { value: { email: string; phone: string; whatsapp: string }; onChange: (p: Partial<{ email: string; phone: string; whatsapp: string }>) => void; errors: Record<string, string | undefined> }) {
  const strip = (s: string) => s.replace(/[\s().-]/g, "");
  return (
    <div className="space-y-4">
      <Field label="Email" htmlFor="contact-email" optional error={errors.email}>
        <Input id="contact-email" type="email" autoComplete="email" value={value.email} maxLength={200} onChange={(e) => onChange({ email: e.target.value })} aria-invalid={!!errors.email} data-testid="contact-email-input" />
      </Field>
      <Field label="Phone" htmlFor="contact-phone" optional error={errors.phone} hint="International format, for example +15551234567">
        <Input id="contact-phone" type="tel" autoComplete="tel" value={value.phone} onChange={(e) => onChange({ phone: strip(e.target.value) })} aria-invalid={!!errors.phone} placeholder="+15551234567" data-testid="contact-phone-input" />
      </Field>
      <Field label="WhatsApp" htmlFor="contact-whatsapp" optional error={errors.whatsapp} hint="The number you use on WhatsApp, in international format">
        <Input id="contact-whatsapp" type="tel" value={value.whatsapp} onChange={(e) => onChange({ whatsapp: strip(e.target.value) })} aria-invalid={!!errors.whatsapp} placeholder="+15551234567" data-testid="contact-whatsapp-input" />
      </Field>
    </div>
  );
}

export function contactErrors(v: { email: string; phone: string; whatsapp: string }) {
  return {
    email: v.email.trim() && !EMAIL.test(v.email.trim()) ? "Enter a valid email address" : undefined,
    phone: v.phone && !PHONE.test(v.phone) ? "Use international format, starting with + and the country code" : undefined,
    whatsapp: v.whatsapp && !PHONE.test(v.whatsapp) ? "Use international format, starting with + and the country code" : undefined,
  };
}

export const PRIVACY_NOTE = "Never shown on your profile. When you accept a recruiter's approach, you choose which of these to share, every view is logged for you to see, and you can revoke access at any time.";

export function ContactEditor({ my, onClose }: { my: MyProfile; onClose: () => void }) {
  const applyMine = useApplyMine();
  const [v, setV] = useState({ email: my.contact.email ?? "", phone: my.contact.phone ?? "", whatsapp: my.contact.whatsapp ?? "" });
  const [touched, setTouched] = useState(false);
  const errors = contactErrors(v);
  const valid = !errors.email && !errors.phone && !errors.whatsapp;
  const save = useMutation({
    mutationFn: () => api().profiles.contact({ email: v.email.trim() || null, phone: v.phone || null, whatsapp: v.whatsapp || null }),
    meta: { silent: true },
    onSuccess: (fresh) => {
      applyMine(fresh);
      toast.success({ title: "Private contact saved" });
      onClose();
    },
    onError: (e) => toast.error({ title: "Could not save", description: errorMessage(e) }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent size="md" data-testid="contact-editor">
        <DialogHeader>
          <DialogTitle>Private contact</DialogTitle>
          <DialogDescription>{PRIVACY_NOTE}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ContactFields value={v} onChange={(p) => setV((c) => ({ ...c, ...p }))} errors={touched ? errors : {}} />
          <p className="mt-4 text-xs text-subtle-foreground">Add at least one channel to publish your profile.</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setTouched(true);
              if (valid) save.mutate();
            }}
            loading={save.isPending}
            data-testid="contact-save"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
