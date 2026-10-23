"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileText, Lock, Paperclip, RotateCw, Upload, X } from "lucide-react";
import { isApiError } from "@open-talent/api-client";
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Label,
  Segmented,
  Skeleton,
  Textarea,
  cn,
  toast,
} from "@open-talent/ui";
import type { Job, MyApplication, MyProfile } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useUploads } from "@/lib/hooks/use-uploads";
import { qk } from "@/lib/query-keys";
import { CompanyLogo, UserAvatar } from "@/components/common/user-bits";
import { invalidateApplications, updateJobEverywhere } from "./job-cache";
import { formatMonth } from "./job-format";

type Step = "profile" | "resume" | "questions" | "note" | "review";
const STEP_LABEL: Record<Step, string> = { profile: "Profile", resume: "Resume", questions: "Questions", note: "Note", review: "Review" };

const NOTE_MAX = 3000;
const ANSWER_MAX = 2000;
const RESUME_TYPES = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);

function ProfilePreview({ profile }: { profile: MyProfile }) {
  // The same slice the API snapshots: headline, location, years, 10 roles, 5 schools, skills.
  const experience = profile.experience.slice(0, 10);
  const education = profile.education.slice(0, 5);
  return (
    <div className="space-y-4 text-sm" data-testid="apply-snapshot">
      <div className="flex items-center gap-3">
        <UserAvatar user={profile.user} size="lg" link={false} />
        <div className="min-w-0">
          <p className="font-semibold">{profile.user.displayName}</p>
          <p className="text-muted-foreground">{profile.headline ?? "No headline yet"}</p>
          <p className="text-xs text-subtle-foreground">
            {[profile.location, profile.yearsExperience != null ? `${profile.yearsExperience} years of experience` : null].filter(Boolean).join(", ") || "Location and experience not set"}
          </p>
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle-foreground">Experience</p>
        {experience.length ? (
          <ul className="space-y-1.5">
            {experience.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-x-3">
                <span className="font-medium">
                  {e.title}, {e.companyName}
                </span>
                <span className="text-xs text-subtle-foreground">
                  {formatMonth(e.startMonth)} to {e.endMonth ? formatMonth(e.endMonth) : "Present"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No experience added.</p>
        )}
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle-foreground">Education</p>
        {education.length ? (
          <ul className="space-y-1">
            {education.map((e) => (
              <li key={e.id}>
                <span className="font-medium">{e.institution}</span>
                {e.degree || e.field ? <span className="text-muted-foreground">, {[e.degree, e.field].filter(Boolean).join(", ")}</span> : null}
                {e.endYear ? <span className="text-xs text-subtle-foreground"> ({e.endYear})</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No education added.</p>
        )}
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle-foreground">Skills</p>
        {profile.skills.length ? (
          <div className="flex flex-wrap gap-1.5">
            {profile.skills.map((s) => (
              <Badge key={s.id} size="md">
                {s.name}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No skills added. Skills drive your match score with each job.</p>
        )}
      </div>
    </div>
  );
}

function Stepper({ steps, current }: { steps: Step[]; current: number }) {
  return (
    <ol className="mt-3 flex items-center gap-1.5" aria-label="Application steps">
      {steps.map((s, i) => (
        <li key={s} className="flex min-w-0 flex-1 flex-col gap-1" aria-current={i === current ? "step" : undefined}>
          <span className={cn("h-1 rounded-full", i <= current ? "bg-primary" : "bg-muted")} />
          <span className={cn("truncate text-2xs font-semibold", i === current ? "text-foreground" : "text-subtle-foreground")}>{STEP_LABEL[s]}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Easy Apply: what will be shared (the profile snapshot), an optional resume, the
 * screening questions, an optional note, then a review. State lives here, outside the
 * dialog content, so closing and reopening keeps what was typed.
 */
export function EasyApplyDialog({ job, open, onOpenChange }: { job: Job; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { status } = useAuth();
  const profile = useQuery({ queryKey: qk.myProfile, queryFn: () => api().profiles.mine(), enabled: open && status === "signed-in" });
  const questions = job.screeningQuestions;
  const steps = useMemo<Step[]>(() => ["profile", "resume", ...(questions.length ? (["questions"] as const) : []), "note", "review"], [questions.length]);
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<MyApplication | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploads = useUploads("RESUME", { max: 1, accept: (mime) => RESUME_TYPES.has(mime) });
  const resume = uploads.items[0] ?? null;

  const validateAnswers = () => {
    const errs: Record<string, string> = {};
    for (const q of questions) {
      const a = (answers[q.id] ?? "").trim();
      if (q.required && !a) errs[q.id] = q.kind === "YES_NO" ? "Choose yes or no." : "This question needs an answer.";
      else if (a.length > ANSWER_MAX) errs[q.id] = `Keep it under ${ANSWER_MAX} characters.`;
    }
    setAnswerErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const apply = useMutation({
    mutationFn: () =>
      api().jobs.apply(job.id, {
        coverNote: note.trim() || null,
        answers: questions.map((q) => ({ questionId: q.id, answer: (answers[q.id] ?? "").trim() })).filter((a) => a.answer),
        resumeUploadId: resume?.media?.id ?? null,
      }),
    meta: { silent: true },
    onSuccess: (app) => {
      updateJobEverywhere(qc, job.id, (j) => ({ ...j, applicationCount: j.applicationCount + 1, viewer: { ...j.viewer, application: { id: app.id, stage: app.stage, appliedAt: app.createdAt } } }));
      invalidateApplications(qc, job.id);
      uploads.reset();
      setDone(app);
    },
    onError: (e) => {
      if (!isApiError(e)) return setSubmitError(errorMessage(e));
      if (e.code === "ALREADY_APPLIED") {
        toast.info({ title: "You already applied to this job", description: "Track it under My applications." });
        invalidateApplications(qc, job.id);
        onOpenChange(false);
        return;
      }
      if (e.code === "JOB_NOT_OPEN") {
        void qc.invalidateQueries({ queryKey: qk.job(job.id) });
        return setSubmitError("This job stopped taking applications while you were applying. Your answers were not sent.");
      }
      if (e.code === "ANSWERS_INVALID") {
        const problems = ((e.details as { problems?: { questionId: string; problem: string }[] } | null)?.problems ?? []).filter((p) => p.problem !== "UNKNOWN_QUESTION");
        const errs: Record<string, string> = {};
        for (const p of problems) errs[p.questionId] = p.problem === "MISSING" ? "This question needs an answer." : p.problem === "NOT_YES_NO" ? "Choose yes or no." : "This answer is too long.";
        setAnswerErrors(errs);
        // The questions changed under us when nothing maps; refresh them.
        if (!problems.length) void qc.invalidateQueries({ queryKey: qk.job(job.id) });
        const qi = steps.indexOf("questions");
        if (qi >= 0) setStepIndex(qi);
        return setSubmitError(errorMessage(e));
      }
      if (e.code === "MEDIA_INVALID" || e.code === "MEDIA_NOT_READY") {
        setStepIndex(steps.indexOf("resume"));
        return setSubmitError(errorMessage(e));
      }
      setSubmitError(errorMessage(e));
    },
  });

  const next = () => {
    setSubmitError(null);
    if (step === "questions" && !validateAnswers()) return;
    if (step === "resume" && uploads.busy) return;
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  };
  const back = () => {
    setSubmitError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o && done) {
      setDone(null);
      setStepIndex(0);
      setAnswers({});
      setNote("");
    }
  };

  const isDraft = profile.data?.status === "DRAFT";

  return (
    <Dialog open={open} onOpenChange={(o) => !apply.isPending && close(o)}>
      <DialogContent size="lg" data-testid="easy-apply-dialog">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>Application sent</DialogTitle>
              <DialogDescription>
                {job.company.name} has your application for {job.title}.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col items-center gap-3 py-8 text-center" data-testid="apply-success">
              <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
                <CheckCircle2 className="size-7" aria-hidden />
              </span>
              <p className="max-w-sm text-sm text-muted-foreground">You will get a notification each time your application moves to a new stage. If the team wants to talk, they will message you here.</p>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)}>
                Keep browsing
              </Button>
              <Button asChild>
                <Link href={`/jobs/applications?highlight=${encodeURIComponent(done.id)}`} data-testid="apply-view-timeline">
                  View application
                </Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <CompanyLogo company={job.company} size="sm" />
                <div className="min-w-0">
                  <DialogTitle className="truncate">Apply to {job.company.name}</DialogTitle>
                  <DialogDescription className="mt-0 truncate">{job.title}</DialogDescription>
                </div>
              </div>
              <Stepper steps={steps} current={stepIndex} />
            </DialogHeader>
            <DialogBody className="space-y-4">
              {step === "profile" ? (
                profile.isPending ? (
                  <div className="space-y-3">
                    <Skeleton className="h-12 w-2/3" />
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : profile.isError ? (
                  <div className="rounded-md border border-border p-4 text-sm">
                    <p className="font-semibold">Your profile did not load</p>
                    <p className="mt-1 text-muted-foreground">{errorMessage(profile.error)}</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => void profile.refetch()}>
                      Try again
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">The hiring team receives this snapshot of your profile, as it is right now. Later edits to your profile do not change it.</p>
                    {isDraft ? (
                      <div className="flex gap-3 rounded-md bg-warning-soft p-3 text-sm text-warning-soft-foreground" role="note" data-testid="apply-draft-warning">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                        <p>
                          Your profile is still a draft. The snapshot below is still sent with your application, but recruiters can not open your full profile until you publish it.{" "}
                          <Link href="/profile/setup" className="font-semibold underline">
                            Finish your profile
                          </Link>
                        </p>
                      </div>
                    ) : null}
                    <div className="rounded-md border border-border p-4">
                      <ProfilePreview profile={profile.data} />
                    </div>
                    <p className="flex items-start gap-2 text-xs text-subtle-foreground">
                      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      Your email, phone and WhatsApp are not shared with the application. The team reaches you through messages here.
                    </p>
                  </>
                )
              ) : null}

              {step === "resume" ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Optional. Attach a resume as a PDF or Word (.docx) file.</p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden
                    onChange={(e) => {
                      if (e.target.files?.length) uploads.add(e.target.files);
                      e.target.value = "";
                    }}
                    data-testid="apply-resume-input"
                  />
                  {resume ? (
                    <div className="flex items-center gap-3 rounded-md border border-border p-3" data-testid="apply-resume">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground">
                        <FileText className="size-5" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{resume.file.name}</p>
                        {resume.status === "uploading" ? (
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(resume.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
                            <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(resume.progress * 100)}%` }} />
                          </div>
                        ) : resume.status === "error" ? (
                          <p className="text-xs text-danger">{resume.error}</p>
                        ) : (
                          <p className="text-xs text-subtle-foreground">{(resume.file.size / 1024 / 1024).toFixed(1)} MB, ready</p>
                        )}
                      </div>
                      {resume.status === "error" ? (
                        <IconButton label="Retry upload" size="sm" onClick={() => uploads.retry(resume.localId)}>
                          <RotateCw />
                        </IconButton>
                      ) : null}
                      <IconButton label="Remove resume" size="sm" onClick={() => uploads.remove(resume.localId)} data-testid="apply-resume-remove">
                        <X />
                      </IconButton>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (e.dataTransfer.files.length) uploads.add(e.dataTransfer.files);
                      }}
                      className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-8 text-center transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid="apply-resume-pick"
                    >
                      <Upload className="size-6 text-subtle-foreground" aria-hidden />
                      <span className="text-sm font-semibold">Upload a resume</span>
                      <span className="text-xs text-subtle-foreground">PDF or DOCX. Drop it here or choose a file.</span>
                    </button>
                  )}
                </div>
              ) : null}

              {step === "questions" ? (
                <div className="space-y-5">
                  <p className="text-sm text-muted-foreground">The hiring team asks everyone these questions.</p>
                  {questions.map((q, i) => {
                    const id = `apply-q-${q.id}`;
                    const err = answerErrors[q.id];
                    return (
                      <div key={q.id} className="space-y-1.5" data-testid="apply-question">
                        <Label htmlFor={id} id={`${id}-label`} className="flex items-start gap-1">
                          <span>
                            {i + 1}. {q.prompt}
                          </span>
                          {q.required ? <span className="text-danger" aria-label="required">*</span> : <span className="text-xs font-normal text-subtle-foreground">Optional</span>}
                        </Label>
                        {q.kind === "YES_NO" ? (
                          <div id={id} aria-labelledby={`${id}-label`}>
                            <Segmented
                              kind="radio"
                              aria-label={q.prompt}
                              value={(answers[q.id] as "YES" | "NO" | undefined) ?? ("" as "YES")}
                              onChange={(v) => {
                                setAnswers((a) => ({ ...a, [q.id]: v }));
                                setAnswerErrors((e) => ({ ...e, [q.id]: "" }));
                              }}
                              options={[
                                { value: "YES", label: "Yes" },
                                { value: "NO", label: "No" },
                              ]}
                            />
                          </div>
                        ) : (
                          <Textarea
                            id={id}
                            rows={4}
                            maxLength={ANSWER_MAX}
                            value={answers[q.id] ?? ""}
                            aria-invalid={!!err || undefined}
                            aria-describedby={err ? `${id}-error` : undefined}
                            onChange={(e) => {
                              setAnswers((a) => ({ ...a, [q.id]: e.target.value }));
                              if (err) setAnswerErrors((x) => ({ ...x, [q.id]: "" }));
                            }}
                          />
                        )}
                        {err ? (
                          <p id={`${id}-error`} role="alert" className="text-xs font-medium text-danger">
                            {err}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {step === "note" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="apply-note">Note to the hiring team</Label>
                  <p className="text-sm text-muted-foreground">Optional. A few lines on why this role, or anything the snapshot does not say.</p>
                  <Textarea id="apply-note" rows={7} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} data-testid="apply-note" />
                  <p className="text-right text-xs text-subtle-foreground tabular-nums">
                    {note.length} / {NOTE_MAX}
                  </p>
                </div>
              ) : null}

              {step === "review" ? (
                <div className="space-y-4 text-sm" data-testid="apply-review">
                  <ReviewRow label="Profile snapshot" onEdit={() => setStepIndex(steps.indexOf("profile"))}>
                    {profile.data ? `${profile.data.user.displayName}${profile.data.headline ? `, ${profile.data.headline}` : ""}` : "Your profile"}
                    {isDraft ? <span className="block text-xs text-warning-soft-foreground">Draft profile: the snapshot is still sent.</span> : null}
                  </ReviewRow>
                  <ReviewRow label="Resume" onEdit={() => setStepIndex(steps.indexOf("resume"))}>
                    {resume?.status === "done" ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Paperclip className="size-3.5" aria-hidden />
                        {resume.file.name}
                      </span>
                    ) : (
                      "None attached"
                    )}
                  </ReviewRow>
                  {questions.length ? (
                    <ReviewRow label="Screening answers" onEdit={() => setStepIndex(steps.indexOf("questions"))}>
                      <ul className="space-y-2">
                        {questions.map((q) => (
                          <li key={q.id}>
                            <span className="block text-xs text-subtle-foreground">{q.prompt}</span>
                            <span className="whitespace-pre-line break-words">{answers[q.id]?.trim() ? (q.kind === "YES_NO" ? (answers[q.id] === "YES" ? "Yes" : "No") : answers[q.id]) : "No answer"}</span>
                          </li>
                        ))}
                      </ul>
                    </ReviewRow>
                  ) : null}
                  <ReviewRow label="Note" onEdit={() => setStepIndex(steps.indexOf("note"))}>
                    <span className="line-clamp-4 whitespace-pre-line break-words">{note.trim() || "No note"}</span>
                  </ReviewRow>
                </div>
              ) : null}

              {submitError ? (
                <div role="alert" className="flex gap-2 rounded-md bg-danger-soft p-3 text-sm text-danger-soft-foreground" data-testid="apply-error">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {submitError}
                </div>
              ) : null}
            </DialogBody>
            <DialogFooter className="justify-between">
              <span className="text-xs text-subtle-foreground tabular-nums">
                Step {stepIndex + 1} of {steps.length}
              </span>
              <div className="flex gap-2">
                {stepIndex > 0 ? (
                  <Button variant="ghost" onClick={back} disabled={apply.isPending}>
                    Back
                  </Button>
                ) : null}
                {step === "review" ? (
                  <Button onClick={() => (validateAnswers() ? apply.mutate() : setStepIndex(steps.indexOf("questions")))} loading={apply.isPending} disabled={uploads.busy} data-testid="apply-submit">
                    Submit application
                  </Button>
                ) : (
                  <Button onClick={next} disabled={(step === "profile" && !profile.data) || (step === "resume" && uploads.busy)} data-testid="apply-next">
                    {step === "resume" && uploads.busy ? "Uploading..." : step === "resume" && !resume ? "Skip" : "Next"}
                  </Button>
                )}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewRow({ label, onEdit, children }: { label: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-border pb-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle-foreground">{label}</p>
        <div className="mt-1">{children}</div>
      </div>
      <Button variant="link" size="sm" onClick={onEdit}>
        Edit
      </Button>
    </div>
  );
}
