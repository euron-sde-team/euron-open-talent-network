"use client";

import { useRef } from "react";
import { ImagePlus, Link2Off, Trash2 } from "lucide-react";
import { Button, Checkbox, Field, Input, Label, Select, Spinner, Textarea } from "@open-talent/ui";
import { EMPLOYMENT_TYPES, LINK_KINDS, WORKPLACE_TYPES, type EmploymentType, type LinkKind, type WorkplaceType } from "@open-talent/types";
import type { CertificationInput, EducationInput, ExperienceInput, LinkInput, ProjectInput, SkillInput } from "@open-talent/api-client";
import { EMPLOYMENT_LABEL, WORKPLACE_LABEL } from "@/components/jobs/job-format";
import { LINK_KIND_LABEL } from "./profile-utils";
import { TagInput } from "./tag-input";
import { useSingleImage } from "./owner-media";

type Errors = Record<string, string>;
interface FormProps<T> {
  uid: string;
  value: T;
  onChange: (patch: Partial<T>) => void;
  errors: Errors;
}

const NONE = "none";
const employmentOptions = [{ value: NONE, label: "Not specified" }, ...EMPLOYMENT_TYPES.map((t) => ({ value: t, label: EMPLOYMENT_LABEL[t] }))];
const workplaceOptions = [{ value: NONE, label: "Not specified" }, ...WORKPLACE_TYPES.map((t) => ({ value: t, label: WORKPLACE_LABEL[t] }))];

/** A `<input type="month">` that stores "YYYY-MM" (browsers without month inputs fall back to text with the same format). */
function MonthInput({ id, value, onChange, invalid, disabled }: { id: string; value: string | null | undefined; onChange: (v: string | null) => void; invalid?: boolean; disabled?: boolean }) {
  return (
    <Input
      id={id}
      type="month"
      placeholder="YYYY-MM"
      pattern="\d{4}-\d{2}"
      value={value ?? ""}
      disabled={disabled}
      aria-invalid={invalid}
      onChange={(e) => onChange(e.target.value || null)}
      max="2100-12"
      min="1950-01"
    />
  );
}

const str = (v: string | null | undefined) => v ?? "";
const intOrNull = (v: string) => (v.trim() === "" ? null : Number.parseInt(v, 10));

export function ExperienceForm({ uid, value: v, onChange, errors }: FormProps<ExperienceInput>) {
  const current = !v.endMonth;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Title" htmlFor={`${uid}-title`} error={errors.title} className="sm:col-span-2">
        <Input id={`${uid}-title`} value={v.title} maxLength={120} onChange={(e) => onChange({ title: e.target.value })} aria-invalid={!!errors.title} placeholder="Staff Engineer" />
      </Field>
      <Field label="Company" htmlFor={`${uid}-company`} error={errors.companyName} className="sm:col-span-2">
        <Input
          id={`${uid}-company`}
          value={v.companyName}
          maxLength={120}
          onChange={(e) => onChange({ companyName: e.target.value })}
          aria-invalid={!!errors.companyName}
          placeholder="Company name"
        />
        {v.companySlug ? (
          <p className="flex items-center gap-2 text-xs text-subtle-foreground">
            Linked to the company page.
            <button type="button" className="inline-flex items-center gap-1 font-semibold text-link hover:underline" onClick={() => onChange({ companySlug: null })}>
              <Link2Off className="size-3" /> Unlink
            </button>
          </p>
        ) : null}
      </Field>
      <Field label="Employment type" htmlFor={`${uid}-etype`} optional>
        <Select id={`${uid}-etype`} value={v.employmentType ?? NONE} onValueChange={(x) => onChange({ employmentType: x === NONE ? null : (x as EmploymentType) })} options={employmentOptions} aria-label="Employment type" />
      </Field>
      <Field label="Workplace" htmlFor={`${uid}-wtype`} optional>
        <Select id={`${uid}-wtype`} value={v.workplaceType ?? NONE} onValueChange={(x) => onChange({ workplaceType: x === NONE ? null : (x as WorkplaceType) })} options={workplaceOptions} aria-label="Workplace" />
      </Field>
      <Field label="Location" htmlFor={`${uid}-loc`} optional className="sm:col-span-2">
        <Input id={`${uid}-loc`} value={str(v.location)} maxLength={120} onChange={(e) => onChange({ location: e.target.value })} placeholder="City, country" />
      </Field>
      <Field label="Start" htmlFor={`${uid}-start`} error={errors.startMonth}>
        <MonthInput id={`${uid}-start`} value={v.startMonth} onChange={(x) => onChange({ startMonth: x ?? "" })} invalid={!!errors.startMonth} />
      </Field>
      <Field label="End" htmlFor={`${uid}-end`} error={errors.endMonth}>
        <MonthInput id={`${uid}-end`} value={v.endMonth} onChange={(x) => onChange({ endMonth: x })} invalid={!!errors.endMonth} disabled={current} />
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <Checkbox
          checked={current}
          onCheckedChange={(c) => {
            if (c) onChange({ endMonth: null });
            else {
              const now = new Date();
              onChange({ endMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}` });
            }
          }}
        />
        I currently work in this role
      </label>
      <Field label="Description" htmlFor={`${uid}-desc`} optional hint={`${str(v.description).length}/3000. What you owned, and a result with a number if you have one.`} className="sm:col-span-2">
        <Textarea id={`${uid}-desc`} rows={4} maxLength={3000} value={str(v.description)} onChange={(e) => onChange({ description: e.target.value })} />
      </Field>
      <Field label="Skills used" htmlFor={`${uid}-skills`} optional hint="Up to 20" className="sm:col-span-2">
        <TagInput id={`${uid}-skills`} value={v.skills ?? []} onChange={(skills) => onChange({ skills })} aria-label="Skills used" />
      </Field>
    </div>
  );
}

export function EducationForm({ uid, value: v, onChange, errors }: FormProps<EducationInput>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="School" htmlFor={`${uid}-inst`} error={errors.institution} className="sm:col-span-2">
        <Input id={`${uid}-inst`} value={v.institution} maxLength={160} onChange={(e) => onChange({ institution: e.target.value })} aria-invalid={!!errors.institution} />
      </Field>
      <Field label="Degree" htmlFor={`${uid}-deg`} optional>
        <Input id={`${uid}-deg`} value={str(v.degree)} maxLength={120} onChange={(e) => onChange({ degree: e.target.value })} placeholder="BSc" />
      </Field>
      <Field label="Field of study" htmlFor={`${uid}-field`} optional>
        <Input id={`${uid}-field`} value={str(v.field)} maxLength={120} onChange={(e) => onChange({ field: e.target.value })} placeholder="Computer Science" />
      </Field>
      <Field label="Start year" htmlFor={`${uid}-sy`} optional error={errors.startYear}>
        <Input id={`${uid}-sy`} inputMode="numeric" value={v.startYear ?? ""} onChange={(e) => onChange({ startYear: intOrNull(e.target.value.replace(/\D/g, "").slice(0, 4)) })} aria-invalid={!!errors.startYear} placeholder="2014" />
      </Field>
      <Field label="End year" htmlFor={`${uid}-ey`} optional error={errors.endYear}>
        <Input id={`${uid}-ey`} inputMode="numeric" value={v.endYear ?? ""} onChange={(e) => onChange({ endYear: intOrNull(e.target.value.replace(/\D/g, "").slice(0, 4)) })} aria-invalid={!!errors.endYear} placeholder="2018" />
      </Field>
      <Field label="Grade" htmlFor={`${uid}-grade`} optional>
        <Input id={`${uid}-grade`} value={str(v.grade)} maxLength={40} onChange={(e) => onChange({ grade: e.target.value })} />
      </Field>
      <Field label="Description" htmlFor={`${uid}-desc`} optional className="sm:col-span-2">
        <Textarea id={`${uid}-desc`} rows={3} maxLength={2000} value={str(v.description)} onChange={(e) => onChange({ description: e.target.value })} />
      </Field>
    </div>
  );
}

function ProjectCover({ uploadId, previewUrl, onChange }: { uploadId: string | null | undefined; previewUrl: string | null; onChange: (id: string | null, url: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const img = useSingleImage("PROJECT_COVER", async (m) => onChange(m.id, m.thumbUrl ?? m.url));
  const src = img.preview ?? previewUrl;
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex aspect-video w-36 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-subtle-foreground">
        {src && uploadId !== null ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="size-full object-cover" />
        ) : (
          <ImagePlus className="size-5" />
        )}
        {img.busy ? (
          <span className="absolute inset-0 flex items-center justify-center bg-overlay/40 text-white">
            <Spinner size="sm" className="text-current" />
          </span>
        ) : null}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.target.files?.length) img.add(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex flex-col gap-1.5">
        <Button size="sm" variant="outline" onClick={() => ref.current?.click()} disabled={img.busy}>
          <ImagePlus /> {uploadId ? "Replace image" : "Add a cover image"}
        </Button>
        {uploadId ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(null, null)}>
            <Trash2 /> Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ProjectForm({ uid, value: v, onChange, errors, coverUrl, onCover }: FormProps<ProjectInput> & { coverUrl: string | null; onCover: (id: string | null, url: string | null) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" htmlFor={`${uid}-name`} error={errors.name} className="sm:col-span-2">
        <Input id={`${uid}-name`} value={v.name} maxLength={120} onChange={(e) => onChange({ name: e.target.value })} aria-invalid={!!errors.name} />
      </Field>
      <Field label="Description" htmlFor={`${uid}-desc`} optional hint={`${str(v.description).length}/3000`} className="sm:col-span-2">
        <Textarea id={`${uid}-desc`} rows={4} maxLength={3000} value={str(v.description)} onChange={(e) => onChange({ description: e.target.value })} placeholder="What it does, who uses it, and your part in it" />
      </Field>
      <Field label="Live link" htmlFor={`${uid}-url`} optional error={errors.url}>
        <Input id={`${uid}-url`} type="url" value={str(v.url)} maxLength={500} onChange={(e) => onChange({ url: e.target.value })} aria-invalid={!!errors.url} placeholder="https://" />
      </Field>
      <Field label="Source code" htmlFor={`${uid}-repo`} optional error={errors.repoUrl}>
        <Input id={`${uid}-repo`} type="url" value={str(v.repoUrl)} maxLength={500} onChange={(e) => onChange({ repoUrl: e.target.value })} aria-invalid={!!errors.repoUrl} placeholder="https://" />
      </Field>
      <Field label="Start" htmlFor={`${uid}-start`} optional>
        <MonthInput id={`${uid}-start`} value={v.startMonth} onChange={(x) => onChange({ startMonth: x })} />
      </Field>
      <Field label="End" htmlFor={`${uid}-end`} optional error={errors.endMonth}>
        <MonthInput id={`${uid}-end`} value={v.endMonth} onChange={(x) => onChange({ endMonth: x })} invalid={!!errors.endMonth} />
      </Field>
      <div className="space-y-1.5 sm:col-span-2">
        <Label>Cover image</Label>
        <ProjectCover uploadId={v.coverUploadId} previewUrl={coverUrl} onChange={onCover} />
      </div>
      <Field label="Skills used" htmlFor={`${uid}-skills`} optional hint="Up to 20" className="sm:col-span-2">
        <TagInput id={`${uid}-skills`} value={v.skills ?? []} onChange={(skills) => onChange({ skills })} aria-label="Skills used" />
      </Field>
    </div>
  );
}

export function SkillRow({ uid, value: v, onChange, errors }: FormProps<SkillInput>) {
  return (
    <div className="grid flex-1 grid-cols-[minmax(0,1fr)_80px] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_90px]">
      <div>
        <Input aria-label="Skill" id={`${uid}-name`} value={v.name} maxLength={60} onChange={(e) => onChange({ name: e.target.value })} aria-invalid={!!errors.name} placeholder="Skill" />
        {errors.name ? (
          <p role="alert" className="mt-1 text-xs font-medium text-danger">
            {errors.name}
          </p>
        ) : null}
      </div>
      <Input aria-label="Category" className="hidden sm:block" value={str(v.category)} maxLength={60} onChange={(e) => onChange({ category: e.target.value })} placeholder="Category" />
      <Input
        aria-label="Years"
        inputMode="numeric"
        value={v.years ?? ""}
        onChange={(e) => {
          const n = intOrNull(e.target.value.replace(/\D/g, "").slice(0, 2));
          onChange({ years: n == null ? null : Math.min(60, n) });
        }}
        placeholder="Years"
      />
    </div>
  );
}

export function CertificationForm({ uid, value: v, onChange, errors }: FormProps<CertificationInput>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" htmlFor={`${uid}-name`} error={errors.name} className="sm:col-span-2">
        <Input id={`${uid}-name`} value={v.name} maxLength={160} onChange={(e) => onChange({ name: e.target.value })} aria-invalid={!!errors.name} />
      </Field>
      <Field label="Issuing organization" htmlFor={`${uid}-issuer`} optional className="sm:col-span-2">
        <Input id={`${uid}-issuer`} value={str(v.issuer)} maxLength={120} onChange={(e) => onChange({ issuer: e.target.value })} />
      </Field>
      <Field label="Issued" htmlFor={`${uid}-issued`} optional>
        <MonthInput id={`${uid}-issued`} value={v.issuedMonth} onChange={(x) => onChange({ issuedMonth: x })} />
      </Field>
      <Field label="Expires" htmlFor={`${uid}-exp`} optional>
        <MonthInput id={`${uid}-exp`} value={v.expiresMonth} onChange={(x) => onChange({ expiresMonth: x })} />
      </Field>
      <Field label="Credential ID" htmlFor={`${uid}-cid`} optional>
        <Input id={`${uid}-cid`} value={str(v.credentialId)} maxLength={120} onChange={(e) => onChange({ credentialId: e.target.value })} />
      </Field>
      <Field label="Credential link" htmlFor={`${uid}-curl`} optional error={errors.credentialUrl}>
        <Input id={`${uid}-curl`} type="url" value={str(v.credentialUrl)} maxLength={500} onChange={(e) => onChange({ credentialUrl: e.target.value })} aria-invalid={!!errors.credentialUrl} placeholder="https://" />
      </Field>
    </div>
  );
}

export function LinkForm({ uid, value: v, onChange, errors }: FormProps<LinkInput>) {
  return (
    <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
      <Field label="Type" htmlFor={`${uid}-kind`}>
        <Select id={`${uid}-kind`} value={v.kind} onValueChange={(x) => onChange({ kind: x as LinkKind })} options={LINK_KINDS.map((k) => ({ value: k, label: LINK_KIND_LABEL[k] }))} aria-label="Link type" />
      </Field>
      <Field label="Link" htmlFor={`${uid}-url`} error={errors.url}>
        <Input id={`${uid}-url`} type="url" value={v.url} maxLength={500} onChange={(e) => onChange({ url: e.target.value })} aria-invalid={!!errors.url} placeholder="https://" />
      </Field>
      <Field label="Label" htmlFor={`${uid}-label`} optional className="sm:col-span-2">
        <Input id={`${uid}-label`} value={str(v.label)} maxLength={80} onChange={(e) => onChange({ label: e.target.value })} placeholder="Conference talk, portfolio, blog" />
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <Checkbox checked={!!v.featured} onCheckedChange={(c) => onChange({ featured: c === true })} />
        Feature this link near the top of my profile
        {v.kind === "YOUTUBE" ? <span className="text-xs text-subtle-foreground">(videos play only when a visitor clicks)</span> : null}
      </label>
    </div>
  );
}
