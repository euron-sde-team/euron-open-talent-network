"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { isApiError, type CompanyInput } from "@open-talent/api-client";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  IconButton,
  Input,
  Select,
  Spinner,
  Switch,
  Textarea,
  toast,
} from "@open-talent/ui";
import type { Company } from "@open-talent/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useUploads } from "@/lib/hooks/use-uploads";
import { qk } from "@/lib/query-keys";
import { CompanyLogo } from "@/components/common/user-bits";

export const SIZE_BANDS = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001+"] as const;

interface Draft {
  name: string;
  tagline: string;
  about: string;
  website: string;
  industry: string;
  sizeBand: string;
  headquarters: string;
  foundedYear: string;
  domains: string[];
  autoApproveDomain: boolean;
  /** undefined = unchanged, null = removed. */
  logo: undefined | null;
  cover: undefined | null;
}

function draftOf(c: Company): Draft {
  return {
    name: c.name,
    tagline: c.tagline ?? "",
    about: c.about ?? "",
    website: c.website ?? "",
    industry: c.industry ?? "",
    sizeBand: c.sizeBand ?? "",
    headquarters: c.headquarters ?? "",
    foundedYear: c.foundedYear ? String(c.foundedYear) : "",
    domains: c.manage?.domains ?? [],
    autoApproveDomain: c.manage?.autoApproveDomain ?? false,
    logo: undefined,
    cover: undefined,
  };
}

const LIMITS = { name: 120, tagline: 160, about: 4000, website: 300, industry: 80, headquarters: 120 } as const;
const isImage = (mime: string) => mime.startsWith("image/");

function validate(d: Draft): Record<string, string> {
  const e: Record<string, string> = {};
  if (d.name.trim().length < 2) e.name = "Give the company a name of at least 2 characters.";
  if (d.website.trim() && !/^(https?:\/\/)?[^\s/$.?#]+\.[^\s]+$/i.test(d.website.trim())) e.website = "Enter a web address, for example https://example.com.";
  if (d.foundedYear.trim()) {
    const y = Number(d.foundedYear);
    if (!Number.isInteger(y) || y < 1800 || y > new Date().getFullYear() + 1) e.foundedYear = "Enter a year, for example 2014.";
  }
  return e;
}

/** Only what changed goes to PATCH /companies/:slug. */
function patchOf(c: Company, d: Draft, logoId: string | undefined, coverId: string | undefined): CompanyInput {
  const p: CompanyInput = {};
  const s = (v: string) => v.trim() || null;
  if (d.name.trim() !== c.name) p.name = d.name.trim();
  if (s(d.tagline) !== c.tagline) p.tagline = s(d.tagline);
  if (s(d.about) !== c.about) p.about = s(d.about);
  if (s(d.website) !== c.website) {
    const w = s(d.website);
    p.website = w && !/^https?:\/\//i.test(w) ? `https://${w}` : w;
  }
  if (s(d.industry) !== c.industry) p.industry = s(d.industry);
  if ((d.sizeBand || null) !== c.sizeBand) p.sizeBand = d.sizeBand || null;
  if (s(d.headquarters) !== c.headquarters) p.headquarters = s(d.headquarters);
  const year = d.foundedYear.trim() ? Number(d.foundedYear) : null;
  if (year !== c.foundedYear) p.foundedYear = year;
  if (logoId) p.logoUploadId = logoId;
  else if (d.logo === null) p.logoUploadId = null;
  if (coverId) p.coverUploadId = coverId;
  else if (d.cover === null) p.coverUploadId = null;
  if (c.manage) {
    if (JSON.stringify([...d.domains].sort()) !== JSON.stringify([...c.manage.domains].sort())) p.domains = d.domains;
    if (d.autoApproveDomain !== c.manage.autoApproveDomain) p.autoApproveDomain = d.autoApproveDomain;
  }
  return p;
}

function ImagePicker({
  label,
  current,
  uploads,
  removed,
  onRemove,
  wide,
  company,
  testId,
}: {
  label: string;
  current: string | null;
  uploads: ReturnType<typeof useUploads>;
  removed: boolean;
  onRemove: () => void;
  wide?: boolean;
  company: Company;
  testId: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const item = uploads.items[0];
  const src = item?.previewUrl ?? (removed ? null : current);
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-3">
        {wide ? (
          <div className="relative h-16 w-40 shrink-0 overflow-hidden rounded-md border border-border bg-primary-soft">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {src ? <img src={src} alt="" className="size-full object-cover" /> : null}
            {item?.status === "uploading" ? (
              <span className="absolute inset-0 flex items-center justify-center bg-card/60">
                <Spinner size="sm" />
              </span>
            ) : null}
          </div>
        ) : (
          <div className="relative shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {src ? <img src={src} alt="" className="size-16 rounded-md border border-border object-cover" /> : <CompanyLogo company={{ ...company, logoUrl: null }} size="lg" className="size-16" />}
            {item?.status === "uploading" ? (
              <span className="absolute inset-0 flex items-center justify-center rounded-md bg-card/60">
                <Spinner size="sm" />
              </span>
            ) : null}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            ref={ref}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              if (e.target.files?.length) {
                if (item) uploads.remove(item.localId);
                uploads.add(e.target.files);
              }
              e.target.value = "";
            }}
            data-testid={`${testId}-input`}
          />
          <Button variant="outline" size="sm" onClick={() => ref.current?.click()}>
            <ImagePlus aria-hidden />
            {src ? "Replace" : "Upload"}
          </Button>
          {src ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (item) uploads.remove(item.localId);
                onRemove();
              }}
            >
              <Trash2 aria-hidden />
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {item?.status === "error" ? <p className="text-xs text-danger">{item.error}</p> : null}
    </div>
  );
}

/**
 * The page admins' editor. The draft lives here (outside the dialog content), so
 * closing by accident and reopening keeps what was typed until it is saved or reset.
 */
export function CompanyEditDialog({ company, open, onOpenChange }: { company: Company; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [domainInput, setDomainInput] = useState("");
  const logo = useUploads("COMPANY_LOGO", { max: 1, accept: isImage });
  const cover = useUploads("COMPANY_COVER", { max: 1, accept: isImage });
  const d = draft ?? draftOf(company);
  const set = (p: Partial<Draft>) => setDraft({ ...d, ...p });

  const save = useMutation({
    mutationFn: (body: CompanyInput) => api().companies.update(company.slug, body),
    meta: { silent: true },
    onSuccess: (updated, body) => {
      qc.setQueryData(qk.company(company.slug), updated);
      void qc.invalidateQueries({ queryKey: ["companies"] });
      logo.reset();
      cover.reset();
      setDraft(null);
      setErrors({});
      onOpenChange(false);
      const backToReview = body.domains !== undefined && company.status === "VERIFIED" && updated.status === "UNVERIFIED";
      toast.success({ title: "Company page updated", description: backToReview ? "The domains changed, so the page goes back for verification." : undefined });
    },
    onError: (e) => {
      if (isApiError(e)) {
        if (e.code === "URL_INVALID") return setErrors({ website: "That web address is not valid. Use https://..." });
        if (e.code === "VALIDATION_FAILED") {
          const fe = e.fieldErrors;
          const mapped: Record<string, string> = {};
          for (const [k, v] of Object.entries(fe)) mapped[k.split(".")[0]!] = v;
          setErrors(mapped);
        }
      }
      toast.error({ title: "Could not save the page", description: errorMessage(e) });
    },
  });

  const addDomain = () => {
    const v = domainInput.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (!v) return;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)) return setErrors((x) => ({ ...x, domains: "Enter a domain such as example.com." }));
    if (d.domains.includes(v)) return setDomainInput("");
    if (d.domains.length >= 10) return setErrors((x) => ({ ...x, domains: "Up to 10 domains." }));
    set({ domains: [...d.domains, v] });
    setDomainInput("");
    setErrors((x) => ({ ...x, domains: "" }));
  };

  const submit = () => {
    const errs = validate(d);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const body = patchOf(company, d, logo.mediaIds[0], cover.mediaIds[0]);
    if (!Object.keys(body).length) {
      onOpenChange(false);
      return;
    }
    save.mutate(body);
  };

  const dirty = draft !== null || logo.items.length > 0 || cover.items.length > 0;
  const domainsChanged = company.manage && JSON.stringify([...d.domains].sort()) !== JSON.stringify([...company.manage.domains].sort());

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent size="lg" data-testid="company-edit-dialog">
        <DialogHeader>
          <DialogTitle>Edit company page</DialogTitle>
          <DialogDescription>Changes show on the public page right away.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <ImagePicker label="Logo" current={company.logoUrl} uploads={logo} removed={d.logo === null} onRemove={() => set({ logo: null })} company={company} testId="company-logo" />
            <ImagePicker label="Cover image" current={company.coverUrl} uploads={cover} removed={d.cover === null} onRemove={() => set({ cover: null })} company={company} wide testId="company-cover" />
          </div>
          <Field label="Name" htmlFor="co-name" error={errors.name}>
            <Input id="co-name" value={d.name} maxLength={LIMITS.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={!!errors.name || undefined} />
          </Field>
          <Field label="Tagline" htmlFor="co-tagline" optional hint={`${d.tagline.length} / ${LIMITS.tagline}`} error={errors.tagline}>
            <Input id="co-tagline" value={d.tagline} maxLength={LIMITS.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="What the company does, in a line" />
          </Field>
          <Field label="About" htmlFor="co-about" optional hint={`${d.about.length} / ${LIMITS.about}`} error={errors.about}>
            <Textarea id="co-about" rows={6} value={d.about} maxLength={LIMITS.about} onChange={(e) => set({ about: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Website" htmlFor="co-website" optional error={errors.website}>
              <Input id="co-website" type="url" inputMode="url" value={d.website} maxLength={LIMITS.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://example.com" aria-invalid={!!errors.website || undefined} />
            </Field>
            <Field label="Industry" htmlFor="co-industry" optional error={errors.industry}>
              <Input id="co-industry" value={d.industry} maxLength={LIMITS.industry} onChange={(e) => set({ industry: e.target.value })} placeholder="For example Software" />
            </Field>
            <Field label="Company size" htmlFor="co-size" optional>
              <Select
                id="co-size"
                value={d.sizeBand || "none"}
                onValueChange={(v) => set({ sizeBand: v === "none" ? "" : v })}
                options={[{ value: "none", label: "Not set" }, ...SIZE_BANDS.map((b) => ({ value: b, label: `${b} employees` }))]}
              />
            </Field>
            <Field label="Headquarters" htmlFor="co-hq" optional error={errors.headquarters}>
              <Input id="co-hq" value={d.headquarters} maxLength={LIMITS.headquarters} onChange={(e) => set({ headquarters: e.target.value })} placeholder="City, country" />
            </Field>
            <Field label="Founded" htmlFor="co-founded" optional error={errors.foundedYear}>
              <Input id="co-founded" inputMode="numeric" value={d.foundedYear} maxLength={4} onChange={(e) => set({ foundedYear: e.target.value.replace(/\D/g, "") })} placeholder="2014" aria-invalid={!!errors.foundedYear || undefined} />
            </Field>
          </div>

          {company.manage ? (
            <div className="space-y-3 rounded-lg border border-border p-4" data-testid="company-domains">
              <div>
                <p className="text-sm font-semibold">Work email domains</p>
                <p className="text-xs text-subtle-foreground">Recruiters prove they work here with an email on one of these domains.</p>
              </div>
              {d.domains.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {d.domains.map((dom) => (
                    <li key={dom} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-3 pr-1 text-sm">
                      {dom}
                      <IconButton label={`Remove ${dom}`} size="sm" className="size-6" onClick={() => set({ domains: d.domains.filter((x) => x !== dom) })}>
                        <X />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No domains yet.</p>
              )}
              <div className="flex gap-2">
                <Input
                  aria-label="Add a domain"
                  placeholder="example.com"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addDomain();
                    }
                  }}
                  className="h-9"
                />
                <Button variant="outline" onClick={addDomain} disabled={!domainInput.trim()}>
                  <Plus aria-hidden />
                  Add
                </Button>
              </div>
              {errors.domains ? <p className="text-xs font-medium text-danger">{errors.domains}</p> : null}
              {domainsChanged && company.status === "VERIFIED" ? (
                <p className="flex gap-2 rounded-md bg-warning-soft p-2.5 text-xs text-warning-soft-foreground">
                  <AlertTriangle className="size-4 shrink-0" aria-hidden />
                  Changing the domains of a verified company sends it back for verification.
                </p>
              ) : null}
              <label htmlFor="co-auto" className="flex items-start justify-between gap-4 border-t border-border pt-3">
                <span>
                  <span className="block text-sm font-medium">Approve recruiters on these domains automatically</span>
                  <span className="block text-xs text-subtle-foreground">When off, each new recruiter waits for a review after confirming their work email.</span>
                </span>
                <Switch id="co-auto" checked={d.autoApproveDomain} onCheckedChange={(v) => set({ autoApproveDomain: v })} data-testid="company-auto-approve" />
              </label>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter className="justify-between">
          {dirty ? (
            <Button
              variant="ghost"
              onClick={() => {
                logo.items.forEach((i) => logo.remove(i.localId));
                cover.items.forEach((i) => cover.remove(i.localId));
                setDraft(null);
                setErrors({});
              }}
              disabled={save.isPending}
            >
              Reset changes
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button onClick={submit} loading={save.isPending} disabled={logo.busy || cover.busy || logo.failed || cover.failed} data-testid="company-edit-save">
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
