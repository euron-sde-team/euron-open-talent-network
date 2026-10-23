"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from "lucide-react";
import { isApiError, type JobInput } from "@open-talent/api-client";
import { EMPLOYMENT_TYPES, PAY_PERIODS, SENIORITIES, WORKPLACE_TYPES, type EmploymentType, type Job, type PayPeriod, type Seniority, type WorkplaceType } from "@open-talent/types";
import { Badge, Button, Card, Field, IconButton, Input, Segmented, Select, Skeleton, Switch, Textarea, cn, toast } from "@open-talent/ui";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { ErrorState, NotFoundState } from "@/components/common/states";
import { EMPLOYMENT_LABEL, SENIORITY_LABEL, WORKPLACE_LABEL, formatPlace, formatSalary } from "@/components/jobs/job-format";
import { JOB_STATUS_LABEL, JOB_STATUS_TONE } from "../format";
import { TagInput } from "../tag-input";
import { JobDescription } from "./job-description";
import { useInvalidateJobs } from "./job-actions";

interface Question {
  key: string;
  id?: string;
  prompt: string;
  kind: "TEXT" | "YES_NO";
  required: boolean;
}

interface FormState {
  title: string;
  description: string;
  employmentType: EmploymentType;
  workplaceType: WorkplaceType;
  seniority: Seniority | "";
  location: string;
  countryCode: string;
  salaryMin: string;
  salaryMax: string;
  currency: string;
  period: PayPeriod | "";
  skills: string[];
  openings: string;
  closesAt: string;
  questions: Question[];
}

const PERIOD_LABEL: Record<PayPeriod, string> = { HOUR: "Per hour", DAY: "Per day", MONTH: "Per month", YEAR: "Per year", PROJECT: "Per project" };

let keySeq = 0;
const newKey = () => `q${++keySeq}`;

function empty(): FormState {
  return { title: "", description: "", employmentType: "FULL_TIME", workplaceType: "HYBRID", seniority: "", location: "", countryCode: "", salaryMin: "", salaryMax: "", currency: "", period: "YEAR", skills: [], openings: "1", closesAt: "", questions: [] };
}

function fromJob(j: Job): FormState {
  return {
    title: j.title,
    description: j.description,
    employmentType: j.employmentType,
    workplaceType: j.workplaceType,
    seniority: j.seniority ?? "",
    location: j.location ?? "",
    countryCode: j.countryCode ?? "",
    salaryMin: j.salary?.min != null ? String(j.salary.min) : "",
    salaryMax: j.salary?.max != null ? String(j.salary.max) : "",
    currency: j.salary?.currency ?? "",
    period: j.salary?.period ?? "",
    skills: j.skills,
    openings: String(j.openings),
    closesAt: j.closesAt ? j.closesAt.slice(0, 10) : "",
    questions: j.screeningQuestions.map((q) => ({ key: newKey(), id: q.id, prompt: q.prompt, kind: q.kind, required: q.required })),
  };
}

function validate(f: FormState) {
  const e: Partial<Record<string, string>> = {};
  const t = f.title.trim();
  if (t.length < 3) e.title = "Give the job a title of at least 3 characters.";
  const d = f.description.trim();
  if (d.length < 30) e.description = `Describe the role in at least 30 characters (${d.length} so far).`;
  const min = f.salaryMin ? Number(f.salaryMin) : null;
  const max = f.salaryMax ? Number(f.salaryMax) : null;
  if ((min !== null && (!Number.isInteger(min) || min < 0)) || (max !== null && (!Number.isInteger(max) || max < 0))) e.salary = "Use whole numbers for pay.";
  else if (min !== null && max !== null && max < min) e.salary = "The maximum must not be below the minimum.";
  if ((min !== null || max !== null) && !/^[A-Za-z]{3}$/.test(f.currency.trim())) e.currency = "Add a three-letter currency code, like USD or EUR.";
  else if (f.currency.trim() && !/^[A-Za-z]{3}$/.test(f.currency.trim())) e.currency = "Use a three-letter currency code.";
  if (f.countryCode.trim() && !/^[A-Za-z]{2}$/.test(f.countryCode.trim())) e.countryCode = "Use a two-letter country code, like US or DE.";
  const openings = Number(f.openings);
  if (!Number.isInteger(openings) || openings < 1 || openings > 500) e.openings = "Between 1 and 500.";
  if (f.closesAt && new Date(`${f.closesAt}T23:59:59`) <= new Date()) e.closesAt = "Pick a date in the future.";
  f.questions.forEach((q, i) => {
    if (q.prompt.trim().length < 3) e[`q${i}`] = "Write the question (at least 3 characters).";
  });
  return e;
}

function toInput(f: FormState): JobInput {
  const min = f.salaryMin ? Number(f.salaryMin) : null;
  const max = f.salaryMax ? Number(f.salaryMax) : null;
  const hasPay = min !== null || max !== null;
  return {
    title: f.title.trim(),
    description: f.description.trim(),
    employmentType: f.employmentType,
    workplaceType: f.workplaceType,
    seniority: f.seniority || null,
    location: f.location.trim() || null,
    countryCode: f.countryCode.trim() ? f.countryCode.trim().toUpperCase() : null,
    salary: hasPay ? { min, max, currency: f.currency.trim().toUpperCase(), period: f.period || null } : null,
    skills: f.skills,
    openings: Number(f.openings),
    screeningQuestions: f.questions.map((q) => ({ ...(q.id ? { id: q.id } : {}), prompt: q.prompt.trim(), kind: q.kind, required: q.required })),
    closesAt: f.closesAt ? new Date(`${f.closesAt}T23:59:59`).toISOString() : null,
  };
}

export function JobFormPage({ jobId }: { jobId?: string }) {
  const existing = useQuery({ queryKey: qk.job(jobId ?? ""), queryFn: () => api().jobs.get(jobId!), enabled: !!jobId });
  if (jobId && existing.isPending) {
    return (
      <Card className="space-y-4 p-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </Card>
    );
  }
  if (jobId && existing.isError) return <Card><ErrorState error={existing.error} onRetry={() => existing.refetch()} /></Card>;
  if (jobId && existing.data && !existing.data.viewer.canManage) return <Card><NotFoundState title="You can not edit this job" description="Only the hiring team of the company that posted it can." /></Card>;
  return <JobForm key={existing.data?.id ?? "new"} job={existing.data ?? null} />;
}

function JobForm({ job }: { job: Job | null }) {
  const router = useRouter();
  const invalidate = useInvalidateJobs();
  const initial = useMemo(() => (job ? fromJob(job) : empty()), [job]);
  const [f, setF] = useState<FormState>(initial);
  const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [serverError, setServerError] = useState<string | null>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const errors = validate(f);
  const valid = Object.keys(errors).length === 0;
  const facets = useQuery({ queryKey: qk.facets, queryFn: () => api().search.facets(), staleTime: 300_000, meta: { silent: true } });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async (publish: boolean): Promise<Job> => {
      const body = toInput(f);
      if (!job) return api().jobs.create({ ...body, publish });
      const updated = await api().jobs.update(job.id, body);
      if (publish && updated.status !== "OPEN") return api().jobs.setStatus(job.id, "OPEN");
      return updated;
    },
    meta: { silent: true },
    onMutate: () => setServerError(null),
    onSuccess: (saved, publish) => {
      invalidate(saved);
      toast.success({ title: !job ? (publish ? "Job published" : "Draft saved") : publish && job.status !== "OPEN" ? "Job published" : "Changes saved" });
      router.push(saved.status === "DRAFT" ? "/recruiter/jobs" : `/recruiter/jobs/${saved.id}`);
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "JOB_CAP_REACHED") {
        const cap = (e.details as { cap?: number } | undefined)?.cap;
        setServerError(`Your company already has ${cap ?? "the maximum number of"} open jobs. Save this as a draft, then close or fill another job to publish it.`);
      } else setServerError(errorMessage(e));
    },
  });

  const submit = (publish: boolean) => {
    setTouched(true);
    if (!valid) {
      toast.error({ title: "Some fields need attention" });
      return;
    }
    save.mutate(publish);
  };
  const err = (k: string) => (touched ? errors[k] : undefined);

  const salaryPreview = formatSalary({ min: f.salaryMin ? Number(f.salaryMin) : null, max: f.salaryMax ? Number(f.salaryMax) : null, currency: /^[A-Za-z]{3}$/.test(f.currency) ? f.currency.toUpperCase() : null, period: f.period || null });
  const isDraft = !job || job.status === "DRAFT";

  return (
    <form
      noValidate
      data-testid="job-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit(isDraft ? true : false);
      }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <IconButton label="Back to jobs" asChild>
            <Link href={job ? `/recruiter/jobs/${job.id}` : "/recruiter/jobs"}>
              <ArrowLeft />
            </Link>
          </IconButton>
          <h1 className="truncate text-2xl font-bold tracking-tight">{job ? "Edit job" : "Post a job"}</h1>
          {job ? <Badge tone={JOB_STATUS_TONE[job.status]}>{JOB_STATUS_LABEL[job.status]}</Badge> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {isDraft ? (
            <>
              <Button variant="outline" loading={save.isPending && save.variables === false} disabled={save.isPending} onClick={() => submit(false)} data-testid="job-save-draft">
                Save draft
              </Button>
              <Button type="submit" loading={save.isPending && save.variables === true} disabled={save.isPending} data-testid="job-publish">
                Publish
              </Button>
            </>
          ) : (
            <Button type="submit" loading={save.isPending} disabled={!dirty} data-testid="job-save">
              Save changes
            </Button>
          )}
        </div>
      </div>

      {serverError ? (
        <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-foreground" data-testid="job-form-error">
          {serverError}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card className="space-y-4 p-5">
            <h2 className="text-xl font-semibold">The role</h2>
            <Field label="Job title" htmlFor="job-title" error={err("title")}>
              <Input id="job-title" value={f.title} maxLength={120} placeholder="Senior backend engineer" onChange={(e) => set("title", e.target.value)} aria-invalid={!!err("title")} data-testid="job-title" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Employment type" htmlFor="job-employment">
                <Select id="job-employment" value={f.employmentType} onValueChange={(v) => set("employmentType", v as EmploymentType)} options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: EMPLOYMENT_LABEL[t] }))} data-testid="job-employment" />
              </Field>
              <Field label="Workplace" htmlFor="job-workplace">
                <Select id="job-workplace" value={f.workplaceType} onValueChange={(v) => set("workplaceType", v as WorkplaceType)} options={WORKPLACE_TYPES.map((t) => ({ value: t, label: WORKPLACE_LABEL[t] }))} data-testid="job-workplace" />
              </Field>
              <Field label="Seniority" htmlFor="job-seniority" optional>
                <Select id="job-seniority" value={f.seniority || "none"} onValueChange={(v) => set("seniority", v === "none" ? "" : (v as Seniority))} options={[{ value: "none", label: "Not specified" }, ...SENIORITIES.map((s) => ({ value: s, label: SENIORITY_LABEL[s] }))]} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
              <Field label="Location" htmlFor="job-location" optional hint={f.workplaceType === "REMOTE" ? "Remote jobs match every location search." : undefined}>
                <Input id="job-location" value={f.location} maxLength={120} placeholder="City, region" onChange={(e) => set("location", e.target.value)} list="job-location-list" />
                <datalist id="job-location-list">
                  {(facets.data?.locations ?? []).slice(0, 30).map((l) => (
                    <option key={l.name} value={l.name} />
                  ))}
                </datalist>
              </Field>
              <Field label="Country code" htmlFor="job-country" optional error={err("countryCode")}>
                <Input id="job-country" value={f.countryCode} maxLength={2} placeholder="US" className="uppercase" onChange={(e) => set("countryCode", e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase())} aria-invalid={!!err("countryCode")} />
              </Field>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">Description</h2>
              <Segmented className="lg:hidden" aria-label="Description view" value={mode} onChange={setMode} options={[{ value: "write", label: "Write" }, { value: "preview", label: "Preview" }]} />
            </div>
            <p className="mt-1 text-xs text-subtle-foreground">Plain text. Leave a blank line between paragraphs, start lines with &quot;- &quot; for a list, and put a short line on its own for a heading.</p>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div className={cn(mode === "preview" && "hidden lg:block")}>
                <label htmlFor="job-description" className="sr-only">
                  Description
                </label>
                <Textarea
                  id="job-description"
                  rows={16}
                  maxLength={12000}
                  value={f.description}
                  onChange={(e) => set("description", e.target.value)}
                  aria-invalid={!!err("description")}
                  className="min-h-[320px] font-[inherit]"
                  placeholder={"About the role\n\nWhat you will do, who you will work with, and what success looks like.\n\nWhat we look for\n\n- Experience with...\n- Comfortable with..."}
                  data-testid="job-description"
                />
                <div className="mt-1 flex justify-between text-xs">
                  <span className="font-medium text-danger" role={err("description") ? "alert" : undefined}>
                    {err("description") ?? ""}
                  </span>
                  <span className="text-subtle-foreground tabular-nums">{f.description.length} / 12000</span>
                </div>
              </div>
              <div className={cn("min-h-[320px] rounded-md border border-dashed border-border p-4", mode === "write" && "hidden lg:block")} aria-label="Preview" data-testid="job-description-preview">
                <p className="mb-3 text-2xs font-semibold uppercase tracking-wide text-subtle-foreground">Preview</p>
                <JobDescription text={f.description} />
              </div>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="text-xl font-semibold">Pay and skills</h2>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Minimum" htmlFor="job-min" optional>
                <Input id="job-min" inputMode="numeric" value={f.salaryMin} placeholder="90000" onChange={(e) => set("salaryMin", e.target.value.replace(/[^\d]/g, ""))} aria-invalid={!!err("salary")} />
              </Field>
              <Field label="Maximum" htmlFor="job-max" optional>
                <Input id="job-max" inputMode="numeric" value={f.salaryMax} placeholder="120000" onChange={(e) => set("salaryMax", e.target.value.replace(/[^\d]/g, ""))} aria-invalid={!!err("salary")} />
              </Field>
              <Field label="Currency" htmlFor="job-currency" error={err("currency")} hint="ISO code">
                <Input id="job-currency" value={f.currency} maxLength={3} placeholder="USD" className="uppercase" onChange={(e) => set("currency", e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase())} aria-invalid={!!err("currency")} />
              </Field>
              <Field label="Period" htmlFor="job-period">
                <Select id="job-period" value={f.period || "YEAR"} onValueChange={(v) => set("period", v as PayPeriod)} options={PAY_PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} />
              </Field>
            </div>
            {err("salary") ? (
              <p role="alert" className="-mt-2 text-xs font-medium text-danger">
                {err("salary")}
              </p>
            ) : salaryPreview ? (
              <p className="-mt-2 text-xs text-muted-foreground">Shown as: {salaryPreview}</p>
            ) : (
              <p className="-mt-2 text-xs text-subtle-foreground">Jobs with a pay range get more qualified applicants. Leave empty to hide pay.</p>
            )}
            <Field label="Skills" htmlFor="job-skills" optional hint={`Used for the match score on every application. ${f.skills.length} of 30.`}>
              <TagInput id="job-skills" value={f.skills} onChange={(v) => set("skills", v)} placeholder="Type a skill and press Enter" suggestions={(facets.data?.skills ?? []).map((s) => s.name)} testId="job-skills" />
            </Field>
          </Card>

          <QuestionsBuilder questions={f.questions} onChange={(q) => set("questions", q)} errors={touched ? errors : {}} />
        </div>

        <div className="space-y-4">
          <Card className="space-y-4 p-5">
            <h2 className="text-base font-semibold">Hiring details</h2>
            <Field label="Openings" htmlFor="job-openings" error={err("openings")}>
              <Input id="job-openings" type="number" min={1} max={500} value={f.openings} onChange={(e) => set("openings", e.target.value)} aria-invalid={!!err("openings")} />
            </Field>
            <Field label="Applications close" htmlFor="job-closes" optional error={err("closesAt")} hint="At the end of that day. Leave empty to keep it open until you close it.">
              <Input id="job-closes" type="date" value={f.closesAt} onChange={(e) => set("closesAt", e.target.value)} aria-invalid={!!err("closesAt")} />
            </Field>
          </Card>
          <Card className="p-5 xl:sticky xl:top-[calc(var(--header-height)+16px)]">
            <h2 className="text-base font-semibold">How it will look</h2>
            <div className="mt-3 rounded-md border border-border p-3">
              <p className="font-semibold">{f.title.trim() || "Job title"}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{formatPlace(f.location.trim() || null, f.workplaceType)}</p>
              <p className="mt-1 text-xs text-subtle-foreground">{[EMPLOYMENT_LABEL[f.employmentType], f.seniority ? SENIORITY_LABEL[f.seniority] : null, salaryPreview].filter(Boolean).join(" · ")}</p>
              {f.skills.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {f.skills.slice(0, 6).map((s) => (
                    <Badge key={s} tone="outline">
                      {s}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
            <p className="mt-3 text-xs text-subtle-foreground">
              {isDraft ? "Drafts are visible to your team only. Publishing counts toward your company's open-job limit." : "Edits to an open job are live at once."}
            </p>
          </Card>
        </div>
      </div>
    </form>
  );
}

function QuestionsBuilder({ questions, onChange, errors }: { questions: Question[]; onChange: (q: Question[]) => void; errors: Partial<Record<string, string>> }) {
  const update = (i: number, patch: Partial<Question>) => onChange(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...questions];
    const [it] = next.splice(i, 1);
    next.splice(i + d, 0, it!);
    onChange(next);
  };
  return (
    <Card className="p-5" data-testid="job-questions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Screening questions</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Asked in Easy Apply. Up to 10.</p>
        </div>
        <Button variant="outline" size="sm" disabled={questions.length >= 10} onClick={() => onChange([...questions, { key: newKey(), prompt: "", kind: "YES_NO", required: true }])} data-testid="job-add-question">
          <Plus /> Add question
        </Button>
      </div>
      {questions.length ? (
        <ol className="mt-4 space-y-3">
          {questions.map((q, i) => (
            <li key={q.key} className="rounded-md border border-border p-3" data-testid="job-question">
              <div className="flex items-start gap-2">
                <span className="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <label htmlFor={`q-${q.key}`} className="sr-only">
                      Question {i + 1}
                    </label>
                    <Input id={`q-${q.key}`} value={q.prompt} maxLength={300} placeholder={q.kind === "YES_NO" ? "Are you authorised to work in this country?" : "Tell us about a project you are proud of"} onChange={(e) => update(i, { prompt: e.target.value })} aria-invalid={!!errors[`q${i}`]} />
                    {errors[`q${i}`] ? (
                      <p role="alert" className="mt-1 text-xs font-medium text-danger">
                        {errors[`q${i}`]}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <Segmented aria-label="Answer type" value={q.kind} onChange={(v) => update(i, { kind: v })} options={[{ value: "YES_NO", label: "Yes or no" }, { value: "TEXT", label: "Written answer" }]} />
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <Switch checked={q.required} onCheckedChange={(c) => update(i, { required: c })} aria-label="Required" />
                      Required
                    </label>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-0.5 sm:flex-row">
                  <IconButton label="Move up" size="sm" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </IconButton>
                  <IconButton label="Move down" size="sm" disabled={i === questions.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </IconButton>
                  <IconButton label="Remove question" size="sm" onClick={() => onChange(questions.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </IconButton>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No screening questions. Candidates apply with their talent page and an optional note.</p>
      )}
    </Card>
  );
}
