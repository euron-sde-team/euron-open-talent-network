"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, LogOut } from "lucide-react";
import { isApiError } from "@open-talent/api-client";
import { Badge, Button, Card, Field, Input, Skeleton, toast } from "@open-talent/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState, PageTitle } from "@/components/common/states";
import { CompanyLogo, VerifiedMark, companyHref } from "@/components/common/user-bits";
import { shortDate } from "./format";
import { useRecruiterAccount } from "./use-recruiter";

export function RecruiterSettingsPage() {
  const { reloadMe } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const account = useRecruiterAccount();
  const [title, setTitle] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [mustTransfer, setMustTransfer] = useState(false);

  useEffect(() => {
    if (account.data) setTitle(account.data.title ?? "");
  }, [account.data]);

  const save = useMutation({
    mutationFn: () => api().recruiter.updateMe({ title: title.trim() || null }),
    onSuccess: (r) => {
      qc.setQueryData(qk.recruiterMe, r);
      toast.success({ title: "Title saved" });
    },
  });
  const leave = useMutation({
    mutationFn: () => api().recruiter.leave(),
    meta: { silent: true },
    onSuccess: async () => {
      qc.removeQueries({ queryKey: qk.recruiterMe });
      await reloadMe();
      toast.success({ title: "You left the company", description: "Your pending approaches were withdrawn and contact access ended." });
      router.replace("/");
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "OWNER_MUST_TRANSFER") setMustTransfer(true);
      else toast.error({ title: "Could not leave", description: isApiError(e) ? e.message : undefined });
    },
  });

  if (account.isPending) {
    return (
      <Card className="space-y-3 p-5">
        <Skeleton className="h-5 w-1/4" />
        <Skeleton className="h-10 w-full" />
      </Card>
    );
  }
  if (account.isError) return <Card><ErrorState error={account.error} onRetry={() => account.refetch()} /></Card>;
  const a = account.data;
  const dirty = (a.title ?? "") !== title.trim();

  return (
    <div className="space-y-4" data-testid="recruiter-settings">
      <PageTitle title="Recruiter settings" />
      <Card className="p-5">
        <h2 className="text-xl font-semibold">Your recruiter profile</h2>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) save.mutate();
          }}
        >
          <Field label="Title" htmlFor="rs-title" hint="Shown to candidates next to your approaches, for example Talent partner.">
            <Input id="rs-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} data-testid="rs-title" />
          </Field>
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-subtle-foreground">Work email</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
                <span className="truncate">{a.workEmail}</span>
                {a.workEmailVerified ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Confirmed" /> : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-subtle-foreground">Role on the team</dt>
              <dd className="mt-0.5">
                <Badge tone="primary">{a.role === "OWNER" ? "Owner" : a.role === "ADMIN" ? "Admin" : "Recruiter"}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-subtle-foreground">Recruiting since</dt>
              <dd className="mt-0.5 font-medium">{shortDate(a.createdAt)}</dd>
            </div>
          </dl>
          <div className="flex justify-end">
            <Button type="submit" disabled={!dirty} loading={save.isPending} data-testid="rs-save">
              Save
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="text-xl font-semibold">Company</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <CompanyLogo company={a.company} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 font-semibold">
              {a.company.name}
              <VerifiedMark status={a.company.status} />
            </p>
            <p className="text-sm text-muted-foreground">Daily approach quota: {a.quota.approachesPerDay}</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={companyHref(a.company.slug)}>{a.role === "RECRUITER" ? "View company page" : "Manage company page and team"}</Link>
          </Button>
        </div>
      </Card>

      <Card className="border-danger/30 p-5">
        <h2 className="text-xl font-semibold">Leave {a.company.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You stop recruiting for this company. Your pending approaches are withdrawn and any contact details candidates shared with you stop being available. Jobs you posted stay with the company.
        </p>
        {mustTransfer ? (
          <div role="alert" className="mt-3 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground" data-testid="rs-must-transfer">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              You are the only owner of this company page. Make another teammate an owner on the{" "}
              <Link href={companyHref(a.company.slug)} className="font-semibold underline">
                company page team settings
              </Link>{" "}
              first, then leave.
            </p>
          </div>
        ) : null}
        <div className="mt-4">
          <Button variant="danger-ghost" onClick={() => setLeaving(true)} data-testid="rs-leave">
            <LogOut /> Leave company
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title={`Leave ${a.company.name}?`}
        description="This can not be undone. To recruit again you would apply and be verified again."
        confirmLabel="Leave company"
        destructive
        testId="rs-leave-dialog"
        onConfirm={() => leave.mutateAsync()}
      />
    </div>
  );
}
