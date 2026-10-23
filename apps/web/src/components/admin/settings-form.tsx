"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Controller, useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { isApiError } from "@open-talent/api-client";
import { Badge, Button, Card, Field, Input, Select, Skeleton, Slider, Switch, toast } from "@open-talent/ui";
import type { PlatformSettings } from "@open-talent/types";
import { api } from "@/lib/api";
import { countChanges, parseDomains, settingsDiff, thresholdErrors } from "@/lib/admin";
import { useNetworkMeta } from "@/lib/meta";
import { humanize } from "@/lib/moderation";
import { qk } from "@/lib/query-keys";
import { ErrorState } from "@/components/common/states";
import { AreaHeader } from "./admin-bits";

const int = (min: number, max: number) =>
  z.number({ invalid_type_error: "Enter a whole number" }).int("Whole numbers only").min(min, `At least ${min}`).max(max, `At most ${max}`);
const threshold = z.object({ review: z.number().min(0).max(1), hide: z.number().min(0).max(1) });
const domain = z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Not a domain");

function knownTimezone(tz: string): boolean {
  try {
    return tz === "UTC" || Intl.supportedValuesOf("timeZone").includes(tz);
  } catch {
    return true;
  }
}

/** Mirrors the API's settingsPatch validator (apps/api/src/controllers/admin.controller.ts). */
export const settingsSchema = z
  .object({
    networkName: z.string().trim().min(1, "Give the network a name").max(80, "At most 80 characters"),
    registration: z.enum(["OPEN", "CLOSED"]),
    profile: z.object({ publishThreshold: int(0, 100), usernameCooldownDays: int(0, 365) }),
    recruiter: z.object({
      approachesPerDay: int(0, 1000),
      approachExpiryDays: int(1, 90),
      declineCooldownDays: int(0, 365),
      maxOpenJobsPerCompany: int(1, 10000),
      freeMailDomains: z.array(domain).max(2000),
      allowDomainAutoApprove: z.boolean(),
    }),
    messaging: z.object({ requestsPerDay: int(0, 1000), requestMessageCap: int(1, 20) }),
    trust: z.object({ autoConfirmDays: int(1, 90), ratingWindowDays: int(1, 365), complaintsPer30Days: int(1, 100) }),
    import: z.object({ enabled: z.boolean(), perDay: int(0, 100), retentionHours: int(1, 24 * 30) }),
    analytics: z.object({ timezone: z.string().trim().refine(knownTimezone, "Unknown timezone, for example Europe/Berlin") }),
    moderation: z.object({
      enabled: z.boolean(),
      provider: z.enum(["rules", "openai", "stub"]),
      thresholds: z.record(threshold).refine((t) => Object.keys(t).length <= 50, "At most 50 categories"),
      premoderateNewAccounts: z.object({ enabled: z.boolean(), firstPosts: int(0, 100), accountAgeDays: int(0, 365) }),
      blockedTerms: z.array(z.string().trim().min(1).max(100)).max(500, "At most 500 terms"),
    }),
  })
  .superRefine((v, ctx) => {
    for (const [cat, msg] of Object.entries(thresholdErrors(v.moderation.thresholds))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["moderation", "thresholds", cat], message: msg });
    }
  });
type Values = z.infer<typeof settingsSchema>;

const SECTIONS = [
  { id: "network", label: "Network" },
  { id: "profiles", label: "Profiles" },
  { id: "recruiters", label: "Recruiters" },
  { id: "messaging", label: "Messaging" },
  { id: "trust", label: "Trust" },
  { id: "import", label: "AI import" },
  { id: "analytics", label: "Analytics" },
  { id: "moderation", label: "Moderation" },
];

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <Card id={`settings-${id}`} className="scroll-mt-24">
      <div className="border-b border-border px-5 py-4">
        <h3 className="text-base font-semibold">{title}</h3>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-5 px-5 py-5">{children}</div>
    </Card>
  );
}

function SwitchRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-subtle-foreground">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function AdminSettings() {
  const q = useQuery({ queryKey: qk.adminSettings, queryFn: () => api().admin.settings() });
  return (
    <div>
      <AreaHeader title="Settings" description="Policies and limits for the whole network. Only what you change is saved, and every save is in the audit log with before and after." />
      {q.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-72" />
        </div>
      ) : q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : (
        <SettingsForm key={JSON.stringify(q.data)} initial={q.data} />
      )}
    </div>
  );
}

function SettingsForm({ initial }: { initial: PlatformSettings }) {
  const qc = useQueryClient();
  const meta = useNetworkMeta();
  const form = useForm<Values>({ resolver: zodResolver(settingsSchema), defaultValues: initial, mode: "onChange" });
  const { register, control, watch, setValue, formState, handleSubmit } = form;
  const errs = formState.errors;
  const values = watch();
  const diff = settingsDiff(initial as unknown as Record<string, unknown>, values as unknown as Record<string, unknown>);
  const changes = countChanges(diff);
  const save = useMutation({
    mutationFn: (patch: Partial<PlatformSettings>) => api().admin.updateSettings(patch),
    meta: { silent: true },
    onSuccess: (s) => {
      qc.setQueryData(qk.adminSettings, s);
      void qc.invalidateQueries({ queryKey: qk.meta });
      toast.success({ title: "Settings saved", description: "They apply within a few seconds." });
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "VALIDATION_FAILED") {
        for (const [path, message] of Object.entries(e.fieldErrors)) form.setError(path as FieldPath<Values>, { message });
      }
      toast.error({ title: "Settings were not saved", description: isApiError(e) ? e.message : undefined });
    },
  });
  return (
    <form onSubmit={handleSubmit(() => changes && save.mutate(diff as Partial<PlatformSettings>))} noValidate className="space-y-4" data-testid="admin-settings-form">
      <nav aria-label="Settings sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#settings-${s.id}`} className="shrink-0 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            {s.label}
          </a>
        ))}
      </nav>

      <Section id="network" title="Network">
        <Field label="Network name" htmlFor="networkName" error={errs.networkName?.message} hint="Shown in page titles, emails and the app header.">
          <Input id="networkName" {...register("networkName")} data-testid="setting-networkName" />
        </Field>
        <Field label="Registration" htmlFor="registration" hint="When closed, nobody new can sign up. Existing members keep working.">
          <Controller
            control={control}
            name="registration"
            render={({ field }) => (
              <Select id="registration" value={field.value} onValueChange={field.onChange} options={[{ value: "OPEN", label: "Open to anyone" }, { value: "CLOSED", label: "Closed" }]} className="sm:w-64" data-testid="setting-registration" />
            )}
          />
        </Field>
      </Section>

      <Section id="profiles" title="Talent profiles">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumField form={form} name="profile.publishThreshold" label="Completeness needed to publish" hint="A profile must reach this score (0 to 100) before it can be public." min={0} max={100} suffix="of 100" />
          <NumField form={form} name="profile.usernameCooldownDays" label="Username change cooldown" min={0} max={365} suffix="days" />
        </div>
      </Section>

      <Section id="recruiters" title="Recruiters" description="Limits that keep outreach respectful, and how recruiter applications are checked.">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumField form={form} name="recruiter.approachesPerDay" label="Approaches per recruiter per day" hint="A per-recruiter override is available in the approval queue." min={0} max={1000} />
          <NumField form={form} name="recruiter.approachExpiryDays" label="An unanswered approach expires after" min={1} max={90} suffix="days" />
          <NumField form={form} name="recruiter.declineCooldownDays" label="After a decline, wait before approaching again" min={0} max={365} suffix="days" />
          <NumField form={form} name="recruiter.maxOpenJobsPerCompany" label="Open jobs per company" min={1} max={10000} />
        </div>
        <Controller
          control={control}
          name="recruiter.allowDomainAutoApprove"
          render={({ field }) => (
            <SwitchRow label="Allow domain auto-approval" hint="Recruiters of a verified company whose confirmed work email matches its domains skip review, when the company opts in.">
              <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="setting-auto-approve" />
            </SwitchRow>
          )}
        />
        <TagEditor
          label="Free email providers"
          hint="Work emails on these domains can not prove company membership: the queue flags them and they never auto-approve."
          values={values.recruiter.freeMailDomains}
          onChange={(v) => setValue("recruiter.freeMailDomains", v, { shouldDirty: true, shouldValidate: true })}
          parse={(input, existing) => parseDomains(input, existing)}
          placeholder="Add domains, for example mail.example"
          testId="free-mail"
          mono
        />
      </Section>

      <Section id="messaging" title="Messaging" description="Message requests let people write to someone they are not connected to.">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumField form={form} name="messaging.requestsPerDay" label="Message requests per person per day" min={0} max={1000} />
          <NumField form={form} name="messaging.requestMessageCap" label="Messages allowed before the request is accepted" min={1} max={20} />
        </div>
      </Section>

      <Section id="trust" title="Trust" description="Engagements, ratings and complaints.">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumField form={form} name="trust.autoConfirmDays" label="Engagements auto-confirm after" min={1} max={90} suffix="days" />
          <NumField form={form} name="trust.ratingWindowDays" label="Ratings can be given for" hint="Counted from when an engagement completes." min={1} max={365} suffix="days" />
          <NumField form={form} name="trust.complaintsPer30Days" label="Complaints one person can file per 30 days" min={1} max={100} />
        </div>
      </Section>

      <Section id="import" title="AI profile import" description="Members can turn a resume, text or a voice note into a draft profile.">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">AI provider on this deployment:</span>
          {meta.data ? meta.data.ai.import ? <Badge tone="success">Available</Badge> : <Badge tone="warning">Not configured</Badge> : <Skeleton className="h-5 w-20" />}
          {meta.data && !meta.data.ai.import ? <span className="text-xs text-subtle-foreground">The import wizard stays hidden until a provider key is set on the server, even when enabled here.</span> : null}
        </div>
        <Controller
          control={control}
          name="import.enabled"
          render={({ field }) => (
            <SwitchRow label="Enable AI import">
              <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="setting-import-enabled" />
            </SwitchRow>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <NumField form={form} name="import.perDay" label="Imports per person per day" min={0} max={100} />
          <NumField form={form} name="import.retentionHours" label="Uploaded files are deleted after" min={1} max={720} suffix="hours" />
        </div>
      </Section>

      <Section id="analytics" title="Analytics">
        <Field label="Timezone for daily numbers" htmlFor="analytics.timezone" error={errs.analytics?.timezone?.message} hint="The overview counts days in this timezone. Use an IANA name, for example Europe/Berlin or UTC.">
          <Input id="analytics.timezone" list="tz-list" className="sm:w-72" {...register("analytics.timezone")} data-testid="setting-timezone" />
        </Field>
        <TimezoneList />
      </Section>

      <ModerationSection form={form} values={values} />

      <div className="sticky bottom-16 z-10 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-border bg-card/95 p-3 shadow-popover backdrop-blur md:bottom-4" data-testid="settings-save-bar">
        <span className="mr-auto text-sm text-muted-foreground">{changes ? `${changes} unsaved change${changes === 1 ? "" : "s"}` : "No changes"}</span>
        <Button variant="ghost" onClick={() => form.reset(initial)} disabled={!changes || save.isPending}>
          Discard
        </Button>
        <Button type="submit" loading={save.isPending} disabled={!changes} data-testid="admin-settings-save">
          Save changes
        </Button>
      </div>
    </form>
  );
}

type Form = ReturnType<typeof useForm<Values>>;

function errorAt(form: Form, path: FieldPath<Values>): string | undefined {
  const m = form.getFieldState(path, form.formState).error?.message;
  return typeof m === "string" ? m : undefined;
}

function NumField({ form, name, label, hint, min, max, suffix }: { form: Form; name: FieldPath<Values>; label: string; hint?: string; min: number; max: number; suffix?: string }) {
  return (
    <Field label={label} htmlFor={name} hint={hint} error={errorAt(form, name)}>
      <div className="flex items-center gap-2">
        <Input id={name} type="number" inputMode="numeric" min={min} max={max} className="w-32" {...form.register(name, { valueAsNumber: true })} data-testid={`setting-${name.replace(/\./g, "-")}`} />
        {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
      </div>
    </Field>
  );
}

function TimezoneList() {
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  }, []);
  return (
    <datalist id="tz-list">
      <option value="UTC" />
      {zones.map((z) => (
        <option key={z} value={z} />
      ))}
    </datalist>
  );
}

function ModerationSection({ form, values }: { form: Form; values: Values }) {
  const { control, setValue, register, formState } = form;
  const errs = formState.errors;
  const [category, setCategory] = useState("");
  const thresholds = values.moderation.thresholds;
  const premod = values.moderation.premoderateNewAccounts.enabled;
  const addCategory = () => {
    const c = category.trim().toLowerCase();
    if (!c || thresholds[c] || Object.keys(thresholds).length >= 50) return;
    setValue("moderation.thresholds", { ...thresholds, [c]: { review: 0.5, hide: 0.9 } }, { shouldDirty: true, shouldValidate: true });
    setCategory("");
  };
  return (
    <Section id="moderation" title="Moderation" description="New content is scored per category from 0 to 1. At or above review it joins the queue and stays visible; at or above hide it is hidden until a moderator decides.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={control}
          name="moderation.enabled"
          render={({ field }) => (
            <SwitchRow label="Score new content">
              <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="admin-moderation-enabled" />
            </SwitchRow>
          )}
        />
        <Field label="Provider" htmlFor="provider" hint="OpenAI moderation needs an API key on the server.">
          <Controller
            control={control}
            name="moderation.provider"
            render={({ field }) => (
              <Select id="provider" value={field.value} onValueChange={field.onChange} options={[{ value: "rules", label: "Built-in rules" }, { value: "openai", label: "OpenAI moderation" }, { value: "stub", label: "Stub (testing only)" }]} data-testid="setting-provider" />
            )}
          />
        </Field>
      </div>
      <div className="space-y-4" data-testid="admin-thresholds">
        {Object.entries(thresholds).map(([cat, t]) => {
          const e = (errs.moderation?.thresholds as Record<string, { message?: string }> | undefined)?.[cat]?.message;
          return (
            <div key={cat}>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">{humanize(cat)}</span>
                <span className="tabular-nums text-muted-foreground">
                  review at {t.review.toFixed(2)}, hide at {t.hide.toFixed(2)}
                </span>
              </div>
              <Slider
                min={0}
                max={1}
                step={0.01}
                minStepsBetweenThumbs={0}
                value={[t.review, t.hide]}
                thumbLabels={[`${humanize(cat)} review threshold`, `${humanize(cat)} hide threshold`]}
                onValueChange={([review, hide]) => setValue("moderation.thresholds", { ...thresholds, [cat]: { review: review ?? 0, hide: hide ?? 1 } }, { shouldDirty: true, shouldValidate: true })}
              />
              {e ? <p className="mt-1 text-xs font-medium text-danger">{e}</p> : null}
            </div>
          );
        })}
        <div className="flex gap-2">
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCategory();
              }
            }}
            placeholder="Add a category the provider reports"
            aria-label="New moderation category"
            className="sm:w-72"
          />
          <Button variant="outline" onClick={addCategory} disabled={!category.trim()}>
            <Plus /> Add
          </Button>
        </div>
      </div>
      <div className="space-y-3 border-t border-border pt-4">
        <Controller
          control={control}
          name="moderation.premoderateNewAccounts.enabled"
          render={({ field }) => (
            <SwitchRow label="Pre-moderate new accounts" hint="Hold the first posts of new accounts for review before anyone else sees them.">
              <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="setting-premod" />
            </SwitchRow>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First posts to hold" htmlFor="firstPosts" error={errs.moderation?.premoderateNewAccounts?.firstPosts?.message}>
            <Input id="firstPosts" type="number" min={0} max={100} className="w-32" disabled={!premod} {...register("moderation.premoderateNewAccounts.firstPosts", { valueAsNumber: true })} />
          </Field>
          <Field label="For accounts younger than (days)" htmlFor="accountAgeDays" error={errs.moderation?.premoderateNewAccounts?.accountAgeDays?.message}>
            <Input id="accountAgeDays" type="number" min={0} max={365} className="w-32" disabled={!premod} {...register("moderation.premoderateNewAccounts.accountAgeDays", { valueAsNumber: true })} />
          </Field>
        </div>
      </div>
      <div className="border-t border-border pt-4">
        <TagEditor
          label="Blocked terms"
          hint="Content containing any of these words or phrases is held for review. Matching ignores case."
          values={values.moderation.blockedTerms}
          onChange={(v) => setValue("moderation.blockedTerms", v, { shouldDirty: true, shouldValidate: true })}
          parse={(input, existing) => {
            const seen = new Set(existing);
            const added = input
              .split(",")
              .map((t) => t.trim().toLowerCase())
              .filter((t) => t && t.length <= 100 && !seen.has(t) && (seen.add(t), true));
            return { added, invalid: [] };
          }}
          placeholder="Add a word or phrase, or several separated by commas"
          testId="blocked-terms"
        />
      </div>
    </Section>
  );
}

function TagEditor({
  label,
  hint,
  values,
  onChange,
  parse,
  placeholder,
  testId,
  mono,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (v: string[]) => void;
  parse: (input: string, existing: string[]) => { added: string[]; invalid: string[] };
  placeholder: string;
  testId: string;
  mono?: boolean;
}) {
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const { added, invalid } = parse(input, values);
    if (added.length) onChange([...values, ...added]);
    setInput(invalid.join(", "));
    setError(invalid.length ? `Not valid: ${invalid.join(", ")}` : null);
  };
  const shown = filter.trim() ? values.filter((v) => v.includes(filter.trim().toLowerCase())) : values;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <span className="text-xs text-subtle-foreground">{values.length} listed</span>
      </div>
      <p className="mb-2 text-xs text-subtle-foreground">{hint}</p>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          aria-label={`Add to ${label}`}
          data-testid={`${testId}-input`}
        />
        <Button variant="outline" onClick={add} disabled={!input.trim()}>
          Add
        </Button>
      </div>
      {error ? <p className="mt-1 text-xs font-medium text-danger">{error}</p> : null}
      {values.length > 12 ? <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter the list" aria-label={`Filter ${label}`} className="mt-2 h-8 sm:w-60" /> : null}
      {values.length ? (
        <ul className="mt-2 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto" data-testid={testId}>
          {shown.map((t) => (
            <li key={t} className={`inline-flex items-center gap-1 rounded-md bg-muted py-1 pl-2.5 pr-1 text-xs ${mono ? "font-mono" : ""}`}>
              {t}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(values.filter((x) => x !== t))} className="rounded p-0.5 text-muted-foreground hover:bg-card hover:text-foreground">
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-subtle-foreground">None.</p>
      )}
    </div>
  );
}
