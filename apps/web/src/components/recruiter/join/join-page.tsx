"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Ban, CheckCircle2, Clock, MailCheck, ShieldCheck, UserRoundSearch, XCircle } from "lucide-react";
import type { RecruiterAccount, RecruiterStatus } from "@open-talent/types";
import { Button, Card, Skeleton, cn } from "@open-talent/ui";
import { useAuth } from "@/lib/auth";
import { useProductName } from "@/lib/meta";
import { ErrorState } from "@/components/common/states";
import { CompanyLogo, VerifiedMark, companyHref } from "@/components/common/user-bits";
import { shortDate } from "../format";
import { useRecruiterAccount } from "../use-recruiter";
import { RegisterForm } from "./register-form";
import { VerifyCode } from "./verify-code";

const STEPS = [
  { key: "apply", label: "Tell us who you hire for", icon: UserRoundSearch },
  { key: "email", label: "Confirm your work email", icon: MailCheck },
  { key: "review", label: "Quick review", icon: ShieldCheck },
  { key: "hire", label: "Start hiring", icon: CheckCircle2 },
] as const;

function stepIndex(status: RecruiterStatus | null, registering: boolean): number {
  if (registering || !status || status === "REJECTED" || status === "LEFT") return 0;
  if (status === "EMAIL_PENDING") return 1;
  if (status === "PENDING_REVIEW" || status === "SUSPENDED") return 2;
  return 3;
}

export function RecruiterJoinPage() {
  const { user } = useAuth();
  const product = useProductName();
  const has = !!user?.recruiter;
  const account = useRecruiterAccount();
  const [registering, setRegistering] = useState(false);

  const status = has ? (account.data?.status ?? user!.recruiter!.status) : null;
  const step = stepIndex(status, registering);

  let body: React.ReactNode;
  if (has && account.isPending) body = <Card className="space-y-3 p-6"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-24 w-full" /></Card>;
  else if (has && account.isError) body = <Card><ErrorState error={account.error} onRetry={() => account.refetch()} /></Card>;
  else if (!has || registering || account.data?.status === "LEFT") body = <RegisterForm previous={account.data} onDone={() => setRegistering(false)} onCancel={has ? () => setRegistering(false) : undefined} />;
  else {
    const a = account.data!;
    switch (a.status) {
      case "EMAIL_PENDING":
        body = <VerifyCode account={a} onVerified={() => undefined} onRestart={() => setRegistering(true)} />;
        break;
      case "PENDING_REVIEW":
        body = <PendingReview account={a} />;
        break;
      case "REJECTED":
        body = <Rejected account={a} onRetry={() => setRegistering(true)} />;
        break;
      case "SUSPENDED":
        body = <Suspended account={a} />;
        break;
      case "ACTIVE":
        body = <Approved account={a} />;
        break;
    }
  }

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
      <header className="mb-6">
        <p className="text-sm font-semibold text-primary">Hire on {product}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Set up your recruiter account</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Recruiters on {product} are real people at real companies. We confirm your work email with a code, then a reviewer approves the account (teams on a verified company domain are approved automatically). Personal mail providers can not verify a company, so use your work address.
        </p>
      </header>
      <ol className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Progress">
        {STEPS.map((s, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li
              key={s.key}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold",
                current ? "border-primary/40 bg-primary/10 text-foreground" : done ? "border-border bg-card text-muted-foreground" : "border-dashed border-border text-subtle-foreground",
              )}
            >
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", done ? "bg-success text-success-foreground" : current ? "bg-primary text-primary-foreground" : "bg-muted")}>
                {done ? <CheckCircle2 className="size-3.5" aria-hidden /> : <s.icon className="size-3.5" aria-hidden />}
              </span>
              <span className="leading-tight">{s.label}</span>
            </li>
          );
        })}
      </ol>
      {body}
    </main>
  );
}

function Submitted({ account }: { account: RecruiterAccount }) {
  return (
    <dl className="mt-5 grid gap-4 rounded-lg border border-border p-4 text-sm sm:grid-cols-2">
      <div className="flex items-center gap-3 sm:col-span-2">
        <CompanyLogo company={account.company} size="md" />
        <div className="min-w-0">
          <dt className="sr-only">Company</dt>
          <dd className="flex items-center gap-1 font-semibold">
            <Link href={companyHref(account.company.slug)} className="truncate hover:underline">
              {account.company.name}
            </Link>
            <VerifiedMark status={account.company.status} className="[&_svg]:size-3.5" />
          </dd>
          <dd className="text-xs text-muted-foreground">{account.role === "OWNER" ? "You will own this company page" : "Joining the team"}</dd>
        </div>
      </div>
      <div>
        <dt className="text-xs font-medium text-subtle-foreground">Work email</dt>
        <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
          {account.workEmail}
          {account.workEmailVerified ? <CheckCircle2 className="size-4 text-success" aria-label="Confirmed" /> : null}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-subtle-foreground">Title</dt>
        <dd className="mt-0.5 font-medium">{account.title ?? "Not given"}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-subtle-foreground">Requested</dt>
        <dd className="mt-0.5 font-medium">{shortDate(account.createdAt)}</dd>
      </div>
    </dl>
  );
}

function StatusCard({ icon, tone, title, children, testId }: { icon: React.ReactNode; tone: "primary" | "success" | "warning" | "danger"; title: string; children: React.ReactNode; testId: string }) {
  const toneClass = { primary: "bg-primary-soft text-primary-soft-foreground", success: "bg-success-soft text-success-soft-foreground", warning: "bg-warning-soft text-warning-soft-foreground", danger: "bg-danger-soft text-danger-soft-foreground" }[tone];
  return (
    <Card className="p-6" data-testid={testId}>
      <div className="flex items-start gap-4">
        <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-full [&_svg]:size-6", toneClass)}>{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">{title}</h2>
          {children}
        </div>
      </div>
    </Card>
  );
}

function PendingReview({ account }: { account: RecruiterAccount }) {
  return (
    <StatusCard icon={<Clock />} tone="warning" title="Your email is confirmed. A reviewer is on it." testId="recruiter-pending-review">
      <p className="mt-1 text-sm text-muted-foreground">
        We check that the company and your role look right. You will get a notification when the account is approved. Until then you can keep using the network as a member.
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />Work email confirmed</li>
        <li className="flex gap-2"><Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />Manual review</li>
        <li className="flex gap-2 text-muted-foreground"><ArrowRight className="mt-0.5 size-4 shrink-0" aria-hidden />Then: post jobs, search talent and send approaches</li>
      </ul>
      <Submitted account={account} />
    </StatusCard>
  );
}

function Rejected({ account, onRetry }: { account: RecruiterAccount; onRetry: () => void }) {
  return (
    <StatusCard icon={<XCircle />} tone="danger" title="This request was not approved" testId="recruiter-rejected">
      {account.reviewNote ? (
        <blockquote className="mt-2 rounded-md border-l-4 border-danger/40 bg-muted px-3 py-2 text-sm">{account.reviewNote}</blockquote>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">The reviewer did not leave a note.</p>
      )}
      <p className="mt-3 text-sm text-muted-foreground">You can apply again, for example with your company email address or with more detail for the reviewer.</p>
      <Submitted account={account} />
      <div className="mt-5">
        <Button onClick={onRetry} data-testid="recruiter-reapply">
          Apply again
        </Button>
      </div>
    </StatusCard>
  );
}

function Suspended({ account }: { account: RecruiterAccount }) {
  return (
    <StatusCard icon={<Ban />} tone="danger" title="Your recruiter account is suspended" testId="recruiter-suspended">
      <p className="mt-1 text-sm text-muted-foreground">You can not post jobs, search talent or send approaches while it is suspended. Your member account is not affected.</p>
      {account.reviewNote ? <blockquote className="mt-3 rounded-md border-l-4 border-danger/40 bg-muted px-3 py-2 text-sm">{account.reviewNote}</blockquote> : null}
      <p className="mt-3 text-sm text-muted-foreground">If you think this is a mistake, contact the network team from your settings.</p>
    </StatusCard>
  );
}

function Approved({ account }: { account: RecruiterAccount }) {
  return (
    <StatusCard icon={<CheckCircle2 />} tone="success" title={`You are recruiting for ${account.company.name}`} testId="recruiter-active">
      <p className="mt-1 text-sm text-muted-foreground">Your account is approved. Post a job, search talent or open your pipeline.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/recruiter" data-testid="recruiter-open-workspace">
            Open the recruiter workspace
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/recruiter/jobs/new">Post a job</Link>
        </Button>
      </div>
    </StatusCard>
  );
}
