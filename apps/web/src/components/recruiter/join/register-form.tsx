"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Building2, Check, Plus, Search } from "lucide-react";
import type { CompanySummary, RecruiterAccount } from "@open-talent/types";
import { Button, Card, Field, Input, Segmented, Select, Skeleton, Textarea, cn } from "@open-talent/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { CompanyLogo, VerifiedMark } from "@/components/common/user-bits";
import { SIZE_BANDS } from "../format";

/** Common personal providers. The server has the authoritative list; this only warns early. */
const PERSONAL_DOMAINS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "yandex.com", "mail.com", "zoho.com"]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RegisterForm({ previous, onDone, onCancel }: { previous?: RecruiterAccount | null; onDone: (r: RecruiterAccount) => void; onCancel?: () => void }) {
  const { reloadMe } = useAuth();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"join" | "create">("join");
  const [picked, setPicked] = useState<CompanySummary | null>(null);
  const [company, setCompany] = useState({ name: "", website: "", industry: "", sizeBand: "", headquarters: "" });
  const [workEmail, setWorkEmail] = useState(previous?.workEmail ?? "");
  const [title, setTitle] = useState(previous?.title ?? "");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  const domain = workEmail.split("@")[1]?.trim().toLowerCase() ?? "";
  const personal = !!domain && PERSONAL_DOMAINS.has(domain);
  const errors = {
    company: mode === "join" ? (!picked ? "Pick a company page, or create a new one." : null) : company.name.trim().length < 2 ? "Enter the company name." : null,
    website: mode === "create" && company.website && !/^(https?:\/\/)?[^\s.]+\.[^\s]+$/i.test(company.website.trim()) ? "Enter a web address like https://example.com" : null,
    workEmail: !EMAIL_RE.test(workEmail.trim()) ? "Enter the email address you use at work." : null,
  };
  const valid = !errors.company && !errors.website && !errors.workEmail;

  const submit = useMutation({
    mutationFn: () =>
      api().recruiter.register({
        ...(mode === "join"
          ? { companySlug: picked!.slug }
          : {
              newCompany: {
                name: company.name.trim(),
                website: company.website.trim() ? (/^https?:\/\//i.test(company.website.trim()) ? company.website.trim() : `https://${company.website.trim()}`) : null,
                industry: company.industry.trim() || null,
                sizeBand: company.sizeBand || null,
                headquarters: company.headquarters.trim() || null,
              },
            }),
        workEmail: workEmail.trim(),
        title: title.trim() || null,
        note: note.trim() || null,
      }),
    meta: { silent: true },
    onSuccess: async (r) => {
      qc.setQueryData(qk.recruiterMe, r);
      await reloadMe();
      onDone(r);
    },
  });

  return (
    <form
      noValidate
      className="space-y-5"
      data-testid="recruiter-register-form"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (valid) submit.mutate();
      }}
    >
      <Card className="p-5">
        <h2 className="text-xl font-semibold">Your company</h2>
        <p className="mt-1 text-sm text-muted-foreground">Recruit for a company that already has a page here, or create its page. Whoever creates a page becomes its owner.</p>
        <Segmented
          className="mt-4"
          aria-label="Company choice"
          value={mode}
          onChange={setMode}
          options={[
            { value: "join", label: "Join an existing page" },
            { value: "create", label: "Create a company page" },
          ]}
        />
        <div className="mt-4">
          {mode === "join" ? (
            <CompanyPicker picked={picked} onPick={setPicked} error={touched ? errors.company : null} onCreate={(name) => { setMode("create"); setCompany((c) => ({ ...c, name })); }} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company name" htmlFor="rc-name" error={touched ? errors.company : null} className="sm:col-span-2">
                <Input id="rc-name" value={company.name} maxLength={120} onChange={(e) => setCompany({ ...company, name: e.target.value })} aria-invalid={touched && !!errors.company} data-testid="rc-company-name" />
              </Field>
              <Field label="Website" htmlFor="rc-web" optional error={touched ? errors.website : null} hint="Its domain helps us confirm your work email.">
                <Input id="rc-web" value={company.website} maxLength={300} placeholder="https://example.com" onChange={(e) => setCompany({ ...company, website: e.target.value })} aria-invalid={touched && !!errors.website} />
              </Field>
              <Field label="Industry" htmlFor="rc-industry" optional>
                <Input id="rc-industry" value={company.industry} maxLength={80} placeholder="Software" onChange={(e) => setCompany({ ...company, industry: e.target.value })} />
              </Field>
              <Field label="Company size" htmlFor="rc-size" optional>
                <Select id="rc-size" value={company.sizeBand || undefined} onValueChange={(v) => setCompany({ ...company, sizeBand: v })} placeholder="Choose a size" options={SIZE_BANDS.map((s) => ({ value: s, label: `${s} employees` }))} />
              </Field>
              <Field label="Headquarters" htmlFor="rc-hq" optional>
                <Input id="rc-hq" value={company.headquarters} maxLength={120} placeholder="City, country" onChange={(e) => setCompany({ ...company, headquarters: e.target.value })} />
              </Field>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-xl font-semibold">You</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Work email"
            htmlFor="rc-email"
            className="sm:col-span-2"
            error={touched ? errors.workEmail : null}
            hint={personal ? undefined : "We send a six-digit code here. It is never shown on your profile."}
          >
            <Input id="rc-email" type="email" autoComplete="email" value={workEmail} maxLength={200} placeholder="you@yourcompany" onChange={(e) => setWorkEmail(e.target.value)} aria-invalid={touched && !!errors.workEmail} data-testid="rc-work-email" />
          </Field>
          {personal ? (
            <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground sm:col-span-2" role="status">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              This looks like a personal address. Personal mail providers can not prove you work at a company, so this request will need a closer manual review and may be declined. Use your company address if you have one.
            </p>
          ) : null}
          <Field label="Your title" htmlFor="rc-title" optional>
            <Input id="rc-title" value={title} maxLength={120} placeholder="Talent partner" onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Note for the reviewer" htmlFor="rc-note" optional className="sm:col-span-2" hint="Anything that helps confirm you recruit for this company.">
            <Textarea id="rc-note" value={note} maxLength={1000} rows={3} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Card>

      {submit.error ? (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-foreground" data-testid="rc-register-error">
          {errorMessage(submit.error)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="lg" loading={submit.isPending} data-testid="rc-register-submit">
          Send verification code
        </Button>
      </div>
    </form>
  );
}

function CompanyPicker({ picked, onPick, error, onCreate }: { picked: CompanySummary | null; onPick: (c: CompanySummary | null) => void; error: string | null; onCreate: (name: string) => void }) {
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim(), 250);
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: qk.companies({ q: term, picker: true }),
    queryFn: () => api().companies.list({ q: term || undefined, limit: 6 }),
    enabled: !picked,
    staleTime: 30_000,
  });

  if (picked) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3" data-testid="rc-picked-company">
        <CompanyLogo company={picked} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 font-semibold">
            <span className="truncate">{picked.name}</span>
            <VerifiedMark status={picked.status} />
          </p>
          <p className="truncate text-sm text-muted-foreground">{[picked.industry, picked.headquarters, picked.sizeBand ? `${picked.sizeBand} employees` : null].filter(Boolean).join(" · ") || picked.tagline}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => onPick(null)}>
          Change
        </Button>
      </div>
    );
  }

  const items = data?.items ?? [];
  return (
    <div>
      <label htmlFor="rc-company-search" className="sr-only">
        Search company pages
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
        <Input
          id="rc-company-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search company pages"
          className="pl-9"
          autoComplete="off"
          aria-invalid={!!error}
          data-testid="rc-company-search"
        />
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
      <ul className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border" role="listbox" aria-label="Company pages">
        {isFetching && !items.length ? (
          Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 p-3">
              <Skeleton className="size-10 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </li>
          ))
        ) : isError ? (
          <li className="flex items-center justify-between gap-2 p-3 text-sm text-muted-foreground">
            Company search did not load.
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </li>
        ) : (
          items.map((c) => (
            <li key={c.id} role="option" aria-selected={false}>
              <button
                type="button"
                disabled={c.status === "SUSPENDED"}
                onClick={() => onPick(c)}
                className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50"
                data-testid="rc-company-option"
              >
                <CompanyLogo company={c} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-sm font-semibold">
                    <span className="truncate">{c.name}</span>
                    <VerifiedMark status={c.status} className="[&_svg]:size-3.5" />
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.status === "SUSPENDED" ? "Not accepting recruiters" : [c.industry, c.headquarters].filter(Boolean).join(" · ") || c.tagline || "Company page"}
                  </span>
                </span>
                <Check className="size-4 text-transparent" aria-hidden />
              </button>
            </li>
          ))
        )}
        <li>
          <button
            type="button"
            onClick={() => onCreate(q.trim())}
            className={cn("flex w-full items-center gap-3 p-3 text-left text-sm font-semibold text-link transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none")}
            data-testid="rc-create-instead"
          >
            <span className="flex size-10 items-center justify-center rounded-md bg-muted">{items.length ? <Plus className="size-4" /> : <Building2 className="size-4" />}</span>
            {q.trim() && !items.length && !isFetching ? `No page called "${q.trim()}". Create it` : "Create a new company page"}
          </button>
        </li>
      </ul>
    </div>
  );
}
