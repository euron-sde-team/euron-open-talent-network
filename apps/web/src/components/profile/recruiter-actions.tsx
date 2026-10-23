"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, Eye, Mail, MessageCircle, Phone, Send, ShieldCheck, Ticket } from "lucide-react";
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
  Input,
  Select,
  Skeleton,
  Textarea,
  toast,
} from "@open-talent/ui";
import { EMPLOYMENT_TYPES, PAY_PERIODS, type ContactReveal, type EmploymentType, type PayPeriod, type Profile } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { EMPLOYMENT_LABEL } from "@/components/jobs/job-format";
import { setSavedEverywhere } from "@/components/recruiter/talent/talent-card";
import { usePatchProfile } from "./use-profile";

const PERIOD_LABEL: Record<PayPeriod, string> = { HOUR: "per hour", DAY: "per day", MONTH: "per month", YEAR: "per year", PROJECT: "per project" };

export function approachBlockedCopy(r: NonNullable<Profile["viewer"]["recruiter"]>): string | null {
  switch (r.approachBlockedReason) {
    case "ALREADY_PENDING":
      return "You already have a pending approach with this person. Wait for their answer.";
    case "COOLDOWN":
      return r.cooldownUntil
        ? `They declined recently. You can approach again on ${new Date(r.cooldownUntil).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}.`
        : "They declined recently. You can approach again after the cooldown.";
    case "QUOTA":
      return "You have used today's approaches. The quota resets at midnight UTC.";
    case "NOT_PUBLISHED":
      return "This profile is not published, so it can not be approached.";
    default:
      return null;
  }
}

/** Open jobs of the recruiter's own company, for "Approach" and "Invite to apply". */
function useOpenJobs(enabled: boolean) {
  const { user } = useAuth();
  const slug = user?.recruiter?.status === "ACTIVE" ? user.recruiter.company.slug : null;
  return useQuery({
    queryKey: qk.companyJobs(slug ?? "", "OPEN"),
    queryFn: () => api().companies.jobs(slug!, { status: "OPEN", limit: 50 }),
    enabled: enabled && !!slug,
    staleTime: 60_000,
  });
}

export function SaveCandidateButton({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const patch = usePatchProfile(profile.user.username);
  const saved = !!profile.viewer.recruiter?.saved;
  const m = useMutation({
    mutationFn: (next: boolean) => (next ? api().recruiter.save(profile.user.username) : api().recruiter.unsave(profile.user.username)),
    meta: { silent: true },
    onMutate: (next) => patch((p) => (p.viewer.recruiter ? { ...p, viewer: { ...p.viewer, recruiter: { ...p.viewer.recruiter, saved: next } } } : p)),
    onSuccess: (_r, next) => {
      toast.success({ title: next ? "Saved to your candidates" : "Removed from saved candidates" });
      void qc.invalidateQueries({ queryKey: qk.savedCandidates });
      setSavedEverywhere(qc, profile.user.username, next);
    },
    onError: (e, _n, rollback) => {
      rollback?.();
      toast.error({ title: "Could not update saved candidates", description: errorMessage(e) });
    },
  });
  return (
    <Button variant="outline" aria-pressed={saved} onClick={() => m.mutate(!saved)} data-testid="save-candidate">
      {saved ? <BookmarkCheck /> : <Bookmark />} {saved ? "Saved" : "Save"}
    </Button>
  );
}

// ─── Approach ───────────────────────────────────────────────────────────────

export function ApproachDialog({ profile, open, onOpenChange }: { profile: Profile; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const jobs = useOpenJobs(open);
  const [f, setF] = useState({ roleTitle: profile.openToWork?.roles[0] ?? "", message: "", jobId: "none", employmentType: "none", min: "", max: "", currency: "USD", period: "YEAR" as PayPeriod });
  const [touched, setTouched] = useState(false);
  const set = (p: Partial<typeof f>) => setF((cur) => ({ ...cur, ...p }));
  const min = f.min ? Number(f.min) : null;
  const max = f.max ? Number(f.max) : null;
  const errors = {
    roleTitle: f.roleTitle.trim().length < 2 ? "Name the role (at least 2 characters)" : undefined,
    message: f.message.trim().length < 30 ? `Write a little more (${f.message.trim().length}/30 characters at least)` : undefined,
    salary: min != null && max != null && max < min ? "The maximum must not be below the minimum" : !/^[A-Za-z]{3}$/.test(f.currency) && (min != null || max != null) ? "Use a 3-letter currency code" : undefined,
  };
  const valid = !errors.roleTitle && !errors.message && !errors.salary;
  const send = useMutation({
    mutationFn: () =>
      api().approaches.send({
        username: profile.user.username,
        roleTitle: f.roleTitle.trim(),
        message: f.message.trim(),
        jobId: f.jobId === "none" ? null : f.jobId,
        employmentType: f.employmentType === "none" ? null : (f.employmentType as EmploymentType),
        salary: min != null || max != null ? { min, max, currency: f.currency.toUpperCase(), period: f.period } : null,
      }),
    meta: { silent: true },
    onSuccess: () => {
      toast.success({ title: `Approach sent to ${profile.user.displayName}`, description: "They will see it in their approaches. Contact details unlock only if they accept." });
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: qk.profile(profile.user.username) });
      void qc.invalidateQueries({ queryKey: qk.approachesSentAll });
      void qc.invalidateQueries({ queryKey: qk.recruiterMe });
    },
    onError: (e) => toast.error({ title: "Could not send the approach", description: errorMessage(e) }),
  });
  const jobOptions = [{ value: "none", label: "No specific job" }, ...(jobs.data?.items ?? []).map((j) => ({ value: j.id, label: j.title }))];
  return (
    <Dialog open={open} onOpenChange={(o) => !send.isPending && onOpenChange(o)}>
      <DialogContent size="lg" data-testid="approach-dialog">
        <DialogHeader>
          <DialogTitle>Approach {profile.user.displayName}</DialogTitle>
          <DialogDescription>
            A specific, honest note about the role gets answers. {profile.user.displayName.split(" ")[0]} chooses whether to share contact details; nothing is revealed unless they accept.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Role" htmlFor="approach-role" error={touched ? errors.roleTitle : undefined}>
            <Input id="approach-role" value={f.roleTitle} maxLength={120} onChange={(e) => set({ roleTitle: e.target.value })} placeholder="Senior Platform Engineer" aria-invalid={touched && !!errors.roleTitle} data-testid="approach-role" />
          </Field>
          <Field
            label="Message"
            htmlFor="approach-message"
            error={touched ? errors.message : undefined}
            hint={`${f.message.length}/3000. Say why this person, what the team does, and what happens next.`}
          >
            <Textarea id="approach-message" rows={6} value={f.message} maxLength={3000} onChange={(e) => set({ message: e.target.value })} aria-invalid={touched && !!errors.message} data-testid="approach-message" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Linked job" htmlFor="approach-job" optional hint={jobs.isPending && open && user?.recruiter ? "Loading your open jobs" : !jobs.data?.items.length ? "Your company has no open jobs" : undefined}>
              <Select id="approach-job" value={f.jobId} onValueChange={(v) => set({ jobId: v })} options={jobOptions} aria-label="Linked job" data-testid="approach-job" />
            </Field>
            <Field label="Employment type" htmlFor="approach-type" optional>
              <Select
                id="approach-type"
                value={f.employmentType}
                onValueChange={(v) => set({ employmentType: v })}
                options={[{ value: "none", label: "Not specified" }, ...EMPLOYMENT_TYPES.map((t) => ({ value: t, label: EMPLOYMENT_LABEL[t] }))]}
                aria-label="Employment type"
              />
            </Field>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">
              Pay range <span className="text-xs font-normal text-subtle-foreground">Optional</span>
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_90px_140px]">
              <Input inputMode="numeric" aria-label="Minimum" placeholder="Min" value={f.min} onChange={(e) => set({ min: e.target.value.replace(/\D/g, "") })} />
              <Input inputMode="numeric" aria-label="Maximum" placeholder="Max" value={f.max} onChange={(e) => set({ max: e.target.value.replace(/\D/g, "") })} />
              <Input aria-label="Currency" maxLength={3} value={f.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
              <Select value={f.period} onValueChange={(v) => set({ period: v as PayPeriod })} options={PAY_PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} aria-label="Pay period" />
            </div>
            {touched && errors.salary ? (
              <p role="alert" className="text-xs font-medium text-danger">
                {errors.salary}
              </p>
            ) : null}
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={send.isPending}>
            Cancel
          </Button>
          <Button
            loading={send.isPending}
            onClick={() => {
              setTouched(true);
              if (valid) send.mutate();
            }}
            data-testid="approach-send"
          >
            <Send /> Send approach
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Contact reveal ─────────────────────────────────────────────────────────

export function ContactRevealDialog({ approachId, name, open, onOpenChange }: { approachId: string; name: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [data, setData] = useState<ContactReveal | null>(null);
  const reveal = useMutation({
    mutationFn: () => api().approaches.contact(approachId),
    meta: { silent: true },
    onSuccess: setData,
    onError: (e) => toast.error({ title: "Could not show the contact details", description: errorMessage(e) }),
  });
  const rows = data
    ? [
        data.email ? { icon: <Mail />, label: "Email", value: data.email, href: `mailto:${data.email}` } : null,
        data.phone ? { icon: <Phone />, label: "Phone", value: data.phone, href: `tel:${data.phone}` } : null,
        data.whatsapp ? { icon: <MessageCircle />, label: "WhatsApp", value: data.whatsapp, href: data.whatsappLink ?? undefined } : null,
      ].filter((r): r is NonNullable<typeof r> => !!r)
    : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="contact-dialog">
        <DialogHeader>
          <DialogTitle>Contact {name}</DialogTitle>
          <DialogDescription>{name} accepted your approach and chose what to share.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            Every view is logged and visible to {name}. They can revoke access at any time.
          </p>
          {!data ? (
            reveal.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : null
          ) : rows.length ? (
            <ul className="divide-y divide-border rounded-md border border-border">
              {rows.map((r) => (
                <li key={r.label}>
                  <a href={r.href} target={r.label === "WhatsApp" ? "_blank" : undefined} rel="noopener noreferrer" className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground">
                    {r.icon}
                    <span className="min-w-0">
                      <span className="block text-xs text-subtle-foreground">{r.label}</span>
                      <span className="block truncate text-sm font-semibold text-foreground" data-testid={`contact-${r.label.toLowerCase()}`}>
                        {r.value}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing is shared right now. The candidate may have revoked access.</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!data ? (
            <Button loading={reveal.isPending} onClick={() => reveal.mutate()} data-testid="contact-reveal">
              <Eye /> Show contact details
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Invite to apply ────────────────────────────────────────────────────────

export function InviteDialog({ profile, open, onOpenChange }: { profile: Profile; open: boolean; onOpenChange: (o: boolean) => void }) {
  const jobs = useOpenJobs(open);
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState("");
  const invite = useMutation({
    mutationFn: () => api().jobs.invite(jobId!, profile.user.username, message.trim() || null),
    meta: { silent: true },
    onSuccess: () => {
      toast.success({ title: `Invitation sent to ${profile.user.displayName}` });
      onOpenChange(false);
      setMessage("");
    },
    onError: (e) => toast.error({ title: "Could not send the invitation", description: errorMessage(e) }),
  });
  const list = jobs.data?.items ?? [];
  return (
    <Dialog open={open} onOpenChange={(o) => !invite.isPending && onOpenChange(o)}>
      <DialogContent size="md" data-testid="invite-dialog">
        <DialogHeader>
          <DialogTitle>Invite {profile.user.displayName} to apply</DialogTitle>
          <DialogDescription>They get a notification with the job and your note, and can apply in one step.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {jobs.isPending ? (
            <Skeleton className="h-10" />
          ) : !list.length ? (
            <p className="rounded-md bg-muted px-3 py-3 text-sm text-muted-foreground">Your company has no open jobs. Open a job first, then invite people to it.</p>
          ) : (
            <Field label="Job" htmlFor="invite-job">
              <Select id="invite-job" value={jobId} onValueChange={setJobId} placeholder="Choose an open job" options={list.map((j) => ({ value: j.id, label: j.title }))} aria-label="Job" data-testid="invite-job" />
            </Field>
          )}
          <Field label="Note" htmlFor="invite-note" optional hint={`${message.length}/1000`}>
            <Textarea id="invite-note" rows={4} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Your work on build tooling stood out. This team owns..." />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={invite.isPending}>
            Cancel
          </Button>
          <Button disabled={!jobId} loading={invite.isPending} onClick={() => invite.mutate()} data-testid="invite-send">
            <Ticket /> Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
