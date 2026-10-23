"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClipboardPaste, FileText, Mic, PencilLine, RotateCcw, Sparkles, Upload, X } from "lucide-react";
import { Button, Card, IconButton, Segmented, Skeleton, Spinner, Textarea, cn, toast } from "@open-talent/ui";
import type { ProfileImport, ProfileSection } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useUploads } from "@/lib/hooks/use-uploads";
import { useNetworkMeta } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { relativeTime } from "@/lib/time";
import { ErrorState } from "@/components/common/states";
import { profileHref } from "@/components/common/user-bits";
import { normalizeProfile } from "../profile-utils";
import { FinishStep } from "./finish-step";
import { ImportProgress, ImportReview, useImport } from "./import-steps";
import { VoiceRecorder, recorderFormat } from "./voice-recorder";

type Step = "source" | "progress" | "review" | "finish";
type Source = "text" | "file" | "voice";

const STEPS: { id: Step; label: string }[] = [
  { id: "source", label: "Add your story" },
  { id: "progress", label: "Draft" },
  { id: "review", label: "Review" },
  { id: "finish", label: "Publish" },
];
const DRAFT_KEY = "ot:profile-import-text";
const RUNNING = ["QUEUED", "EXTRACTING", "GENERATING", "SCORING"];
const ACCEPT = ".pdf,.docx,.txt,image/png,image/jpeg,image/webp,audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/wav,.mp3,.m4a,.ogg,.wav";

function readDraft(): string {
  try {
    return sessionStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(v: string) {
  try {
    if (v) sessionStorage.setItem(DRAFT_KEY, v);
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage can be unavailable; the text stays in memory */
  }
}

function Stepper({ step, manual }: { step: Step; manual: boolean }) {
  const list = manual ? STEPS.filter((s) => s.id === "source" || s.id === "finish") : STEPS;
  const at = list.findIndex((s) => s.id === step);
  return (
    <ol className="mb-4 flex items-center gap-2 overflow-x-auto text-sm [scrollbar-width:none]" aria-label="Steps">
      {list.map((s, i) => (
        <li key={s.id} className="flex shrink-0 items-center gap-2" aria-current={i === at ? "step" : undefined}>
          <span className={cn("flex size-6 items-center justify-center rounded-full text-xs font-bold", i <= at ? "bg-primary text-primary-foreground" : "bg-muted text-subtle-foreground")}>{i + 1}</span>
          <span className={cn("font-semibold", i === at ? "text-foreground" : "text-subtle-foreground")}>{s.label}</span>
          {i < list.length - 1 ? <span className="mx-1 h-px w-6 bg-border" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

function ManualPath({ username, onFinish }: { username: string; onFinish: () => void }) {
  return (
    <Card className="p-5 sm:p-6" data-testid="setup-manual">
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        <PencilLine className="size-5 text-primary" /> Build your page section by section
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        AI import is not available on this network, so fill in your page directly. Start with a headline, an About section and your most recent role; those carry the most weight.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild>
          <Link href={profileHref(username)}>Open my page editor</Link>
        </Button>
        <Button variant="outline" onClick={onFinish}>
          Contact and publish settings
        </Button>
      </div>
    </Card>
  );
}

function SourceStep({
  text,
  setText,
  onStarted,
  previous,
  onResume,
}: {
  text: string;
  setText: (v: string) => void;
  onStarted: (imp: ProfileImport) => void;
  previous: ProfileImport | null | undefined;
  onResume: (imp: ProfileImport) => void;
}) {
  const [source, setSource] = useState<Source>("text");
  const up = useUploads("IMPORT", { max: 1 });
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const item = up.items[0];
  const uploadId = item?.status === "done" ? (item.media?.id ?? null) : null;
  const canVoice = !!recorderFormat();

  const start = useMutation({
    mutationFn: () => api().profiles.startImport(source === "text" ? { text } : { uploadId, text: null }),
    meta: { silent: true },
    onSuccess: (imp) => {
      up.reset();
      onStarted(imp);
    },
    onError: (e) => toast.error({ title: "Could not start the import", description: errorMessage(e) }),
  });
  const textOk = text.trim().length >= 60;
  const ready = source === "text" ? textOk : !!uploadId;

  const pick = (files: FileList | File[]) => {
    if (item) up.remove(item.localId);
    up.add(files);
  };

  return (
    <div className="space-y-4">
      {previous && previous.status === "READY" ? (
        <Card className="flex flex-col gap-3 border-primary/40 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="resume-import">
          <p className="text-sm">
            <span className="font-semibold">You have a draft ready to review</span> <span className="text-muted-foreground">from {relativeTime(previous.createdAt)}.</span>
          </p>
          <Button size="sm" onClick={() => onResume(previous)}>
            Continue reviewing
          </Button>
        </Card>
      ) : previous && previous.status === "FAILED" && previous.error && previous.error !== "Expired" ? (
        <Card className="p-4 text-sm text-muted-foreground">
          Your last import did not finish: <span className="text-foreground">{previous.error}</span>
        </Card>
      ) : null}

      <Card className="p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Sparkles className="size-5 text-primary" /> Start from what you already have
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Paste a resume, upload one, or just talk about your work. We draft your page and you approve every part. Nothing is published until you say so, and contact details in your input are never copied to the page.</p>
        <Segmented<Source>
          className="mt-4"
          value={source}
          onChange={setSource}
          aria-label="Source"
          options={[
            { value: "text", label: (<span className="inline-flex items-center gap-1.5"><ClipboardPaste className="size-3.5" /> Paste text</span>) },
            { value: "file", label: (<span className="inline-flex items-center gap-1.5"><Upload className="size-3.5" /> Upload a file</span>) },
            ...(canVoice ? [{ value: "voice" as const, label: (<span className="inline-flex items-center gap-1.5"><Mic className="size-3.5" /> Record voice</span>) }] : []),
          ]}
        />

        <div className="mt-4">
          {source === "text" ? (
            <div className="space-y-1.5">
              <label htmlFor="import-text" className="sr-only">
                Your resume or a description of your work
              </label>
              <Textarea
                id="import-text"
                rows={12}
                maxLength={30000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"Paste your resume, or write a few paragraphs: your current role, what you built and the results, tools you use, education, and links to your work."}
                data-testid="import-text"
              />
              <p className="text-xs text-subtle-foreground">{textOk ? `${text.length.toLocaleString()} characters` : `At least 60 characters (${text.trim().length} so far)`}</p>
            </div>
          ) : (
            <>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                data-testid="import-file-input"
                onChange={(e) => {
                  if (e.target.files?.length) pick(e.target.files);
                  e.target.value = "";
                }}
              />
              {item ? (
                <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3" data-testid="import-file">
                  <FileText className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.file.name}</p>
                    {item.status === "uploading" ? (
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(item.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                      </div>
                    ) : item.status === "error" ? (
                      <p className="text-xs text-danger">{item.error}</p>
                    ) : (
                      <p className="text-xs text-success-soft-foreground">Uploaded</p>
                    )}
                  </div>
                  {item.status === "error" ? (
                    <IconButton label="Retry upload" onClick={() => up.retry(item.localId)}>
                      <RotateCcw />
                    </IconButton>
                  ) : null}
                  <IconButton label="Remove file" onClick={() => up.remove(item.localId)}>
                    <X />
                  </IconButton>
                </div>
              ) : source === "voice" ? (
                <VoiceRecorder onFile={(f) => pick([f])} disabled={start.isPending} />
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDrag(false);
                    if (e.dataTransfer.files.length) pick(e.dataTransfer.files);
                  }}
                  className={cn("flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors focus-visible:ring-2", drag ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}
                  data-testid="import-dropzone"
                >
                  <Upload className="size-6 text-muted-foreground" />
                  <span className="text-sm font-semibold">Drop your resume here, or choose a file</span>
                  <span className="text-xs text-subtle-foreground">PDF, DOCX, a photo of a printed resume, or an audio file</span>
                </button>
              )}
              {item && source === "voice" && item.status !== "uploading" ? (
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => up.remove(item.localId)}>
                  <RotateCcw /> Record a new note
                </Button>
              ) : null}
            </>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          <Button onClick={() => start.mutate()} loading={start.isPending} disabled={!ready || up.busy} data-testid="import-start">
            <Sparkles /> Draft my profile
          </Button>
        </div>
      </Card>
    </div>
  );
}

/** /profile/setup: one guided path from a resume (or a voice note) to a published page. */
export function ProfileSetup() {
  const { user } = useAuth();
  const meta = useNetworkMeta();
  const aiImport = !!meta.data?.ai.import;
  const [step, setStep] = useState<Step>("source");
  const [importId, setImportId] = useState<string | null>(null);
  const [text, setTextState] = useState("");
  const setText = (v: string) => {
    setTextState(v);
    writeDraft(v);
  };
  useEffect(() => setTextState(readDraft()), []);

  const latest = useQuery({ queryKey: qk.importLatest, queryFn: () => api().profiles.latestImport(), enabled: aiImport, meta: { silent: true } });
  const mine = useQuery({ queryKey: qk.myProfile, queryFn: async () => normalizeProfile(await api().profiles.mine()) });
  const imp = useImport(step === "progress" || step === "review" ? importId : null);

  // Pick up a run that is still going when the page opens.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !latest.data) return;
    resumed.current = true;
    if (RUNNING.includes(latest.data.status)) {
      setImportId(latest.data.id);
      setStep("progress");
    }
  }, [latest.data]);

  useEffect(() => {
    if (step === "progress" && imp.data?.status === "READY") setStep("review");
  }, [step, imp.data?.status]);

  if (!user) return null;
  const manual = meta.isSuccess && !aiImport;
  const existing: Partial<Record<ProfileSection, number>> = mine.data
    ? { experience: mine.data.experience.length, education: mine.data.education.length, projects: mine.data.projects.length, skills: mine.data.skills.length, certifications: mine.data.certifications.length, links: mine.data.links.length }
    : {};

  return (
    <div className="py-2" data-testid="profile-setup">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Build your profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">A complete page in a few minutes. You review everything before anyone sees it.</p>
      </div>
      <Stepper step={step} manual={manual} />

      {meta.isPending ? (
        <Card className="space-y-3 p-6">
          <Skeleton className="h-6 w-60" />
          <Skeleton className="h-32" />
        </Card>
      ) : step === "finish" ? (
        mine.isPending ? (
          <Card className="flex justify-center p-10">
            <Spinner />
          </Card>
        ) : mine.data ? (
          <FinishStep my={mine.data} />
        ) : (
          <Card>
            <ErrorState error={mine.error} onRetry={() => void mine.refetch()} />
          </Card>
        )
      ) : manual ? (
        <ManualPath username={user.username} onFinish={() => setStep("finish")} />
      ) : step === "source" ? (
        <SourceStep
          text={text}
          setText={setText}
          previous={latest.data}
          onStarted={(i) => {
            setImportId(i.id);
            setStep("progress");
          }}
          onResume={(i) => {
            setImportId(i.id);
            setStep("review");
          }}
        />
      ) : step === "progress" ? (
        <ImportProgress imp={imp.data} onRetry={() => setStep("source")} />
      ) : imp.data?.status === "READY" && imp.data.proposal ? (
        <ImportReview
          imp={imp.data}
          existing={existing}
          onApplied={() => {
            writeDraft("");
            setStep("finish");
          }}
        />
      ) : imp.isError ? (
        <Card>
          <ErrorState error={imp.error} onRetry={() => void imp.refetch()} />
        </Card>
      ) : imp.data && imp.data.status !== "READY" ? (
        <Card className="p-6 text-sm text-muted-foreground">
          This draft is no longer available to review.{" "}
          <button type="button" className="font-semibold text-link hover:underline" onClick={() => setStep("source")}>
            Start a new one
          </button>
        </Card>
      ) : (
        <Card className="flex justify-center p-10">
          <Spinner />
        </Card>
      )}

      {step !== "finish" && !manual && !meta.isPending ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Prefer to type it in?{" "}
          <Link href={profileHref(user.username)} className="font-semibold text-link hover:underline">
            Edit your page directly
          </Link>{" "}
          or{" "}
          <button type="button" className="font-semibold text-link hover:underline" onClick={() => setStep("finish")}>
            skip to publishing
          </button>
          .
        </p>
      ) : null}
    </div>
  );
}
