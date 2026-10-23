"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BriefcaseBusiness, Building2, KeyRound, MapPin, MessageSquareText, Search, ShieldCheck, Sparkles, UserRoundCheck } from "lucide-react";
import { Button, Card, Skeleton } from "@open-talent/ui";
import { api } from "@/lib/api";
import { useProductName } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { compactNumber } from "@/lib/time";
import { CompanyLogo, VerifiedMark, companyHref } from "@/components/common/user-bits";
import { EMPLOYMENT_LABEL, formatPlace, formatSalary } from "@/components/jobs/job-format";

/** The signed-out home page. Every number on it comes from the live API; nothing is invented. */
export function Landing() {
  const name = useProductName();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [where, setWhere] = useState("");
  const jobs = useQuery({ queryKey: qk.jobs({ landing: true }), queryFn: () => api().jobs.search({ limit: 6, sort: "recent" }), staleTime: 120_000 });
  const companies = useQuery({ queryKey: qk.companies({ landing: true }), queryFn: () => api().companies.list({ limit: 8 }), staleTime: 300_000 });
  const facets = useQuery({ queryKey: qk.facets, queryFn: () => api().search.facets(), staleTime: 300_000, meta: { silent: true } });

  const searchJobs = (e: React.FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (where.trim()) p.set("location", where.trim());
    router.push(`/jobs${p.size ? `?${p}` : ""}`);
  };

  return (
    <main id="main" className="bg-card">
      <section className="mx-auto grid max-w-[1180px] items-center gap-10 px-4 pb-14 pt-10 md:grid-cols-[1.1fr_1fr] md:pt-16">
        <div>
          <h1 className="text-balance text-4xl font-light leading-tight tracking-tight text-primary-soft-foreground md:text-[52px]" data-testid="landing-title">
            Welcome to {name}, your professional network
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">
            Build a page that shows your real work. Get found by verified recruiters, and decide who gets your contact details, one channel at a time.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg" className="rounded-full px-7">
              <Link href="/signup" data-testid="landing-join">
                Join now
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full px-7">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
        <HeroArt />
      </section>

      <section className="border-y border-border bg-muted/40">
        <div className="mx-auto max-w-[1180px] px-4 py-12">
          <h2 className="text-3xl font-light text-foreground">Find the right job or internship for you</h2>
          <form onSubmit={searchJobs} className="mt-6 flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm sm:flex-row" role="search" aria-label="Search jobs">
            <label className="flex flex-1 items-center gap-2 rounded-md px-3">
              <Search className="size-5 text-subtle-foreground" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, skill or company" aria-label="Keywords" className="h-11 w-full bg-transparent text-[15px] outline-none placeholder:text-subtle-foreground" />
            </label>
            <span className="hidden w-px bg-border sm:block" aria-hidden />
            <label className="flex flex-1 items-center gap-2 rounded-md px-3">
              <MapPin className="size-5 text-subtle-foreground" aria-hidden />
              <input value={where} onChange={(e) => setWhere(e.target.value)} placeholder="City, country or Remote" aria-label="Location" className="h-11 w-full bg-transparent text-[15px] outline-none placeholder:text-subtle-foreground" />
            </label>
            <Button type="submit" size="lg" data-testid="landing-search">
              Search jobs
            </Button>
          </form>
          {facets.data?.skills.length ? (
            <div className="mt-5">
              <p className="text-sm font-semibold text-muted-foreground">Skills people here work with</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {facets.data.skills.slice(0, 14).map((s) => (
                  <Link key={s.name} href={`/jobs?q=${encodeURIComponent(s.name)}`} className="rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-foreground/40 hover:bg-muted">
                    {s.name}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-4 py-12">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold">Recently posted jobs</h2>
          <Link href="/jobs" className="inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
            See all jobs <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="landing-jobs">
          {jobs.isPending
            ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)
            : (jobs.data?.items ?? []).map((j) => (
                <Link key={j.id} href={`/jobs?job=${encodeURIComponent(j.id)}`} className="group flex gap-3 rounded-lg border border-border p-4 transition-shadow hover:shadow-md">
                  <CompanyLogo company={j.company} size="lg" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-link group-hover:underline">{j.title}</span>
                    <span className="block truncate text-sm">{j.company.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">{formatPlace(j.location, j.workplaceType)}</span>
                    <span className="mt-1 block truncate text-xs text-subtle-foreground">
                      {EMPLOYMENT_LABEL[j.employmentType]}
                      {formatSalary(j.salary) ? `, ${formatSalary(j.salary)}` : ""}
                    </span>
                  </span>
                </Link>
              ))}
        </div>
        {!jobs.isPending && !jobs.data?.items.length ? <p className="mt-4 text-muted-foreground">No open jobs yet. Recruiters can post the first one.</p> : null}
      </section>

      {companies.data?.items.length ? (
        <section className="mx-auto max-w-[1180px] px-4 pb-12">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-2xl font-semibold">Companies on {name}</h2>
            <Link href="/companies" className="inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
              Browse companies <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="landing-companies">
            {companies.data.items.map((c) => (
              <Link key={c.id} href={companyHref(c.slug)} className="flex flex-col items-center rounded-lg border border-border p-4 text-center transition-shadow hover:shadow-md">
                <CompanyLogo company={c} size="xl" />
                <span className="mt-3 inline-flex max-w-full items-center gap-1 font-semibold">
                  <span className="truncate">{c.name}</span>
                  <VerifiedMark status={c.status} />
                </span>
                <span className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{c.industry ?? c.tagline ?? ""}</span>
                <span className="mt-1 text-xs text-subtle-foreground">{c.openJobCount ? `${compactNumber(c.openJobCount)} open ${c.openJobCount === 1 ? "job" : "jobs"}` : "Not hiring right now"}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="border-t border-border bg-muted/40">
        <div className="mx-auto max-w-[1180px] px-4 py-14">
          <h2 className="max-w-2xl text-3xl font-light">Your contact details stay yours until you say yes</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {[
              { icon: UserRoundCheck, title: "Recruiters are verified", text: "Every recruiter confirms a work email on their company's domain, and an admin reviews each account before it can reach anyone." },
              { icon: MessageSquareText, title: "They ask first", text: "A recruiter sends an approach with the role and pay. You accept, decline or block, and nobody sees your email or phone in the meantime." },
              { icon: KeyRound, title: "You choose the channels", text: "Share email, phone or WhatsApp individually. Every time a recruiter views them it is logged for you, and you can revoke access whenever you like." },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title}>
                <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
                  <Icon className="size-5" />
                </span>
                <p className="mt-3 text-lg font-semibold">{title}</p>
                <p className="mt-1 text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1180px] gap-6 px-4 py-14 md:grid-cols-2">
        <Card className="p-6">
          <Sparkles className="size-6 text-primary" />
          <p className="mt-3 text-xl font-semibold">Build your page in one step</p>
          <p className="mt-1 text-muted-foreground">Paste your resume, upload a PDF or record a short voice note. The assistant drafts your experience, projects and skills, and you approve each section before anything is saved.</p>
          <Button asChild className="mt-5">
            <Link href="/signup">Create your page</Link>
          </Button>
        </Card>
        <Card className="p-6">
          <BriefcaseBusiness className="size-6 text-primary" />
          <p className="mt-3 text-xl font-semibold">Hiring? Bring your team</p>
          <p className="mt-1 text-muted-foreground">Set up a company page, post jobs with screening questions, and move candidates through a shared pipeline that updates live for everyone on the team.</p>
          <Button asChild variant="outline" className="mt-5">
            <Link href="/signup?next=/recruiter/join">Start hiring</Link>
          </Button>
        </Card>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-subtle-foreground">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="size-4" /> {name}
          </span>
          <nav className="flex flex-wrap gap-4" aria-label="Footer">
            <Link href="/jobs" className="hover:underline">
              Jobs
            </Link>
            <Link href="/talent" className="hover:underline">
              People
            </Link>
            <Link href="/companies" className="hover:underline">
              Companies
            </Link>
            <Link href="/login" className="hover:underline">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}

/** A drawn illustration (no stock photos): a profile card, a job card and an approach. */
function HeroArt() {
  return (
    <div className="relative mx-auto hidden aspect-[5/4] w-full max-w-[520px] md:block" aria-hidden>
      <div className="absolute inset-[6%] rounded-[36px] bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.22),transparent_60%),radial-gradient(circle_at_80%_80%,hsl(var(--open-to-work)/0.2),transparent_55%)]" />
      <div className="absolute left-[4%] top-[10%] w-[58%] rounded-xl border border-border bg-card p-4 shadow-lg">
        <div className="h-12 rounded-md bg-[linear-gradient(120deg,hsl(var(--primary)/0.85),hsl(var(--primary)/0.35))]" />
        <div className="-mt-6 ml-3 size-14 rounded-full bg-[hsl(var(--open-to-work))] ring-4 ring-card" />
        <div className="mt-2 h-3 w-2/3 rounded bg-foreground/80" />
        <div className="mt-2 h-2.5 w-5/6 rounded bg-muted-foreground/40" />
        <div className="mt-3 flex gap-1.5">
          {["w-12", "w-16", "w-10"].map((w) => (
            <span key={w} className={`h-5 ${w} rounded-full bg-primary-soft`} />
          ))}
        </div>
      </div>
      <div className="absolute right-[4%] top-[32%] w-[52%] rounded-xl border border-border bg-card p-4 shadow-lg">
        <div className="flex items-center gap-2">
          <Building2 className="size-8 rounded-md bg-muted p-1.5 text-primary" />
          <div className="flex-1">
            <div className="h-2.5 w-3/4 rounded bg-foreground/70" />
            <div className="mt-1.5 h-2 w-1/2 rounded bg-muted-foreground/40" />
          </div>
        </div>
        <div className="mt-3 h-2 w-full rounded bg-muted" />
        <div className="mt-1.5 h-2 w-4/5 rounded bg-muted" />
        <div className="mt-3 h-7 w-24 rounded-full bg-primary" />
      </div>
      <div className="absolute bottom-[8%] left-[16%] flex w-[56%] items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-lg">
        <KeyRound className="size-9 rounded-full bg-success-soft p-2 text-success-soft-foreground" />
        <div className="flex-1">
          <div className="h-2.5 w-4/5 rounded bg-foreground/70" />
          <div className="mt-1.5 h-2 w-3/5 rounded bg-muted-foreground/40" />
        </div>
      </div>
    </div>
  );
}
