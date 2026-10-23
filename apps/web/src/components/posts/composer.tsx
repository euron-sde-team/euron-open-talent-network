"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, ImagePlus, Paperclip, PartyPopper, Sparkles } from "lucide-react";
import {
  Avatar,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Select,
  Tooltip,
  cn,
  toast,
} from "@open-talent/ui";
import type { Post, PostKind, PostVisibility } from "@open-talent/types";
import { api } from "@/lib/api";
import { useMe, useRestricted } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useUploads } from "@/lib/hooks/use-uploads";
import { prependPost } from "@/lib/post-cache";
import { qk } from "@/lib/query-keys";
import { MentionTextarea } from "@/components/common/mention-textarea";
import { UploadPreviews } from "@/components/media/upload-previews";

type Start = "text" | "media" | "hiring" | "open-to-work" | "milestone";

const KIND_FOR_START: Record<Start, PostKind> = { text: "POST", media: "POST", hiring: "HIRING", "open-to-work": "OPEN_TO_WORK", milestone: "MILESTONE" };

const KINDS: { value: PostKind; label: string }[] = [
  { value: "POST", label: "Post" },
  { value: "HIRING", label: "We are hiring" },
  { value: "OPEN_TO_WORK", label: "I am open to work" },
  { value: "MILESTONE", label: "Celebrate a milestone" },
];

const AUDIENCES: { value: PostVisibility; label: string }[] = [
  { value: "PUBLIC", label: "Anyone" },
  { value: "CONNECTIONS", label: "Connections only" },
];

const PROMPTS: Record<PostKind, string> = {
  POST: "What do you want to talk about?",
  HIRING: "Tell people about the role and who you are looking for",
  OPEN_TO_WORK: "What kind of role are you looking for? What are you great at?",
  MILESTONE: "Share a new role, a launch, a certification...",
  JOB: "Add a few words about this job",
};

/** The "Start a post" card that opens the composer. */
export function ComposerCard({ onPosted }: { onPosted?: (p: Post) => void }) {
  const me = useMe();
  const restricted = useRestricted();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<Start>("text");
  const openWith = (s: Start) => {
    setStart(s);
    setOpen(true);
  };
  const recruiter = me.recruiter?.status === "ACTIVE";
  return (
    <Card className="p-3 pb-2" data-testid="composer-card">
      <div className="flex items-center gap-2">
        <Avatar name={me.displayName} seed={me.id} src={me.avatarUrl} size="lg" />
        <button
          type="button"
          onClick={() => openWith("text")}
          disabled={restricted}
          data-testid="composer"
          className="h-12 flex-1 rounded-full border border-border px-4 text-left text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
        >
          {restricted ? "Your account is restricted, so you can not post right now" : "Start a post"}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1">
        <ComposerShortcut icon={<ImagePlus className="size-5 text-primary" />} label="Media" onClick={() => openWith("media")} disabled={restricted} />
        {recruiter ? (
          <ComposerShortcut icon={<BriefcaseBusiness className="size-5 text-warning" />} label="Hiring" onClick={() => openWith("hiring")} disabled={restricted} />
        ) : (
          <ComposerShortcut icon={<Sparkles className="size-5 text-open-to-work" />} label="Open to work" onClick={() => openWith("open-to-work")} disabled={restricted} />
        )}
        <ComposerShortcut icon={<PartyPopper className="size-5 text-danger" />} label="Milestone" onClick={() => openWith("milestone")} disabled={restricted} />
      </div>
      {open && !restricted ? <ComposerDialog open={open} onOpenChange={setOpen} start={start} onPosted={onPosted} /> : null}
    </Card>
  );
}

function ComposerShortcut({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function ComposerDialog({
  open,
  onOpenChange,
  start = "text",
  jobId: initialJobId,
  onPosted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  start?: Start;
  /** Preselects a job to share (from the recruiter's job page). */
  jobId?: string;
  onPosted?: (p: Post) => void;
}) {
  const me = useMe();
  const restricted = useRestricted();
  const qc = useQueryClient();
  const recruiter = me.recruiter?.status === "ACTIVE" ? me.recruiter : null;
  const canPostAsCompany = !!recruiter && (recruiter.role === "OWNER" || recruiter.role === "ADMIN") && recruiter.company.status !== "SUSPENDED";
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<PostKind>(initialJobId ? "HIRING" : KIND_FOR_START[start]);
  const [visibility, setVisibility] = useState<PostVisibility>("PUBLIC");
  const [asCompany, setAsCompany] = useState(false);
  const [jobId, setJobId] = useState<string>(initialJobId ?? "");
  const uploads = useUploads("POST", { max: 10 });
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // A recruiter can attach one of their company's open jobs to a hiring post.
  const jobs = useQuery({
    queryKey: qk.companyJobs(recruiter?.company.slug ?? "", "OPEN"),
    queryFn: () => api().companies.jobs(recruiter!.company.slug, { status: "OPEN", limit: 50 }),
    enabled: !!recruiter && kind === "HIRING",
    staleTime: 60_000,
  });

  useEffect(() => {
    if (start === "media") setTimeout(() => fileRef.current?.click(), 50);
  }, [start]);

  const attachJob = kind === "HIRING" && jobId ? jobId : undefined;
  const empty = !body.trim() && !uploads.mediaIds.length && !attachJob;
  const dirty = !!body.trim() || uploads.items.length > 0;

  const create = useMutation({
    mutationFn: () =>
      api().posts.create({
        body: body.trim(),
        kind,
        visibility,
        companyId: asCompany && recruiter ? recruiter.company.id : undefined,
        jobId: attachJob,
        mediaIds: uploads.mediaIds.length ? uploads.mediaIds : undefined,
      }),
    onSuccess: (post) => {
      prependPost(qc, post);
      uploads.reset();
      onPosted?.(post);
      toast.success(post.status === "PENDING_REVIEW" ? { title: "Submitted for review", description: "A moderator will approve it before others can see it." } : { title: "Posted" });
      onOpenChange(false);
    },
    onError: (e) => toast.error({ title: "Could not post", description: errorMessage(e) }),
  });

  const close = (o: boolean) => {
    if (!o && dirty && !create.isSuccess && !window.confirm("Discard this post?")) return;
    onOpenChange(o);
  };

  const kindOptions = KINDS.filter((k) => k.value !== "HIRING" || recruiter);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        size="lg"
        data-testid="composer-dialog"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          textRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Create a post</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="flex items-center gap-3">
            {asCompany && recruiter ? (
              <Avatar name={recruiter.company.name} seed={recruiter.company.id} src={recruiter.company.logoUrl} size="lg" shape="square" />
            ) : (
              <Avatar name={me.displayName} seed={me.id} src={me.avatarUrl} size="lg" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">{asCompany && recruiter ? recruiter.company.name : me.displayName}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                <Select value={visibility} onValueChange={(v) => setVisibility(v as PostVisibility)} options={AUDIENCES} aria-label="Who can see this" data-testid="composer-audience" className="h-8 w-auto gap-1 rounded-full px-3 text-xs font-semibold" />
                <Select value={kind} onValueChange={(v) => setKind(v as PostKind)} options={kindOptions} aria-label="Post type" data-testid="composer-kind" className="h-8 w-auto gap-1 rounded-full px-3 text-xs font-semibold" />
                {canPostAsCompany ? (
                  <Select
                    value={asCompany ? "company" : "me"}
                    onValueChange={(v) => setAsCompany(v === "company")}
                    options={[
                      { value: "me", label: "Post as yourself" },
                      { value: "company", label: `Post as ${recruiter!.company.name}` },
                    ]}
                    aria-label="Post as"
                    data-testid="composer-as"
                    className="h-8 w-auto gap-1 rounded-full px-3 text-xs font-semibold"
                  />
                ) : null}
              </div>
            </div>
          </div>

          <MentionTextarea
            ref={textRef}
            value={body}
            onValueChange={setBody}
            placeholder={PROMPTS[kind]}
            aria-label="Post text"
            data-testid="composer-input"
            maxLength={3000}
            className={cn("min-h-[140px] leading-relaxed", body.length < 85 && !uploads.items.length ? "text-xl" : "text-[15px]")}
          />

          {kind === "HIRING" && recruiter ? (
            <div className="space-y-1.5 rounded-md border border-border p-3">
              <p className="text-sm font-semibold">Attach an open job (optional)</p>
              {jobs.data?.items.length ? (
                <Select
                  value={jobId || "none"}
                  onValueChange={(v) => setJobId(v === "none" ? "" : v)}
                  options={[{ value: "none", label: "No job attached" }, ...jobs.data.items.map((j) => ({ value: j.id, label: j.title }))]}
                  aria-label="Job"
                  data-testid="composer-job"
                />
              ) : (
                <p className="text-sm text-muted-foreground">{jobs.isPending ? "Loading your open jobs..." : "Your company has no open jobs yet."}</p>
              )}
            </div>
          ) : null}

          <UploadPreviews uploads={uploads.items} onRemove={uploads.remove} onRetry={uploads.retry} />
        </DialogBody>
        <DialogFooter>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,application/pdf"
            data-testid="composer-file-input"
            onChange={(e) => {
              if (e.target.files) uploads.add(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="mr-auto flex items-center">
            <Tooltip content="Photo or video">
              <IconButton label="Add photos or videos" onClick={() => fileRef.current?.click()} className="text-primary">
                <ImagePlus />
              </IconButton>
            </Tooltip>
            <Tooltip content="Attach a PDF">
              <IconButton label="Attach a document" onClick={() => fileRef.current?.click()} className="text-muted-foreground">
                <Paperclip />
              </IconButton>
            </Tooltip>
          </div>
          <Button disabled={restricted || empty || uploads.busy || uploads.failed} loading={create.isPending} onClick={() => create.mutate()} data-testid="composer-submit">
            {uploads.busy ? "Uploading..." : "Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
