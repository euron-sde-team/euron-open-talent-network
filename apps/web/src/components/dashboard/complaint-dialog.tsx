"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isApiError } from "@open-talent/api-client";
import { FileText, Paperclip, RotateCcw, X } from "lucide-react";
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
  IconButton,
  Input,
  NativeSelect,
  Select,
  Spinner,
  Textarea,
  toast,
} from "@open-talent/ui";
import type { Approach, ComplaintCategory, MyApplication } from "@open-talent/types";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { usePagedList } from "@/lib/hooks/queries";
import { useUploads } from "@/lib/hooks/use-uploads";
import { qk } from "@/lib/query-keys";
import { COMPLAINT_CATEGORY } from "./labels";

export interface ComplaintPrefill {
  engagementId?: string;
  approachId?: string;
  againstUsername?: string;
}

type Context = { value: string; label: string; kind: "engagement" | "approach" | "application"; id: string; against: string | null };

const DESC_MIN = 20;
const DESC_MAX = 3000;

/** The dealings a complaint can be about: the viewer's engagements, received approaches and applications. */
function useContexts(enabled: boolean) {
  const me = useMe();
  const engagements = useQuery({ queryKey: qk.engagements, queryFn: () => api().trust.engagements(), enabled, staleTime: 30_000 });
  const approaches = usePagedList<Approach>({ queryKey: qk.approachesReceived("ALL"), fetchPage: (cursor) => api().approaches.received({ cursor }), enabled });
  const applications = usePagedList<MyApplication>({ queryKey: qk.myApplications(false), fetchPage: (cursor) => api().applications.mine({ cursor }), enabled });
  const options = useMemo<Context[]>(() => {
    const out: Context[] = [];
    for (const e of engagements.data ?? []) {
      const other = e.candidate.id === me.id ? e.recruiter : e.candidate;
      out.push({ value: `engagement:${e.id}`, kind: "engagement", id: e.id, against: other.username, label: `Engagement: ${e.title} with ${other.displayName}` });
    }
    for (const a of approaches.items) out.push({ value: `approach:${a.id}`, kind: "approach", id: a.id, against: a.recruiter.username, label: `Approach: ${a.roleTitle} from ${a.recruiter.displayName}, ${a.company.name}` });
    for (const a of applications.items) out.push({ value: `application:${a.id}`, kind: "application", id: a.id, against: null, label: `Application: ${a.job.title} at ${a.job.company.name}` });
    return out;
  }, [engagements.data, approaches.items, applications.items, me.id]);
  return { options, loading: engagements.isPending || approaches.isPending || applications.isPending };
}

export function ComplaintDialog({ open, onOpenChange, prefill }: { open: boolean; onOpenChange: (o: boolean) => void; prefill?: ComplaintPrefill }) {
  const qc = useQueryClient();
  const { options, loading } = useContexts(open);
  const [context, setContext] = useState("");
  const [against, setAgainst] = useState("");
  const [category, setCategory] = useState<ComplaintCategory | "">("");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploads = useUploads("EVIDENCE", { max: 10 });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const v = prefill?.engagementId ? `engagement:${prefill.engagementId}` : prefill?.approachId ? `approach:${prefill.approachId}` : "";
    if (v) setContext(v);
    if (prefill?.againstUsername) setAgainst(prefill.againstUsername);
    setError(null);
  }, [open, prefill?.engagementId, prefill?.approachId, prefill?.againstUsername]);

  const chosen = options.find((o) => o.value === context);
  // The other side is known for engagements and approaches; for an application, name the recruiter you dealt with.
  const lockedAgainst = chosen?.against ?? null;
  const username = (lockedAgainst ?? against).trim().replace(/^@/, "");
  const descLen = description.trim().length;
  const problems = {
    context: !chosen ? "Choose what this complaint is about." : null,
    against: username.length < 3 ? "Enter the username of the person." : null,
    category: !category ? "Choose a category." : null,
    description: descLen < DESC_MIN ? `Describe what happened in at least ${DESC_MIN} characters.` : null,
  };
  const valid = !Object.values(problems).some(Boolean);

  const reset = () => {
    setContext("");
    setAgainst("");
    setCategory("");
    setDescription("");
    setTouched(false);
    setError(null);
    uploads.reset();
  };

  const file = useMutation({
    mutationFn: () =>
      api().trust.fileComplaint({
        againstUsername: username,
        category: category as ComplaintCategory,
        description: description.trim(),
        engagementId: chosen?.kind === "engagement" ? chosen.id : null,
        approachId: chosen?.kind === "approach" ? chosen.id : null,
        applicationId: chosen?.kind === "application" ? chosen.id : null,
        evidenceUploadIds: uploads.mediaIds.length ? uploads.mediaIds : undefined,
      }),
    onSuccess: () => {
      toast.success({ title: "Complaint filed", description: "Our trust team will review it. You will be notified of the outcome." });
      void qc.invalidateQueries({ queryKey: qk.complaints });
      reset();
      onOpenChange(false);
    },
    onError: (e) => {
      if (isApiError(e) && e.status === 404 && e.code !== "NO_RELATIONSHIP") setError("We could not find that person. Check the username.");
      else setError(errorMessage(e));
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !file.isPending && onOpenChange(o)}>
      <DialogContent size="lg" data-testid="complaint-dialog">
        <DialogHeader>
          <DialogTitle>File a complaint</DialogTitle>
          <DialogDescription>For a real problem with someone you dealt with here: an approach, an application or an engagement. The trust team reviews every complaint privately.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!valid || uploads.busy) return;
            setError(null);
            file.mutate();
          }}
        >
          <DialogBody className="space-y-4">
            <Field label="What is it about?" htmlFor="complaint-context" error={touched ? problems.context : null}>
              {loading ? (
                <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                  <Spinner size="sm" /> Loading your approaches, applications and engagements
                </div>
              ) : options.length ? (
                <NativeSelect
                  id="complaint-context"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  aria-invalid={touched && !!problems.context}
                  data-testid="complaint-context"
                >
                  <option value="">Choose one</option>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <p className="text-sm text-muted-foreground">You have no approaches, applications or engagements yet, so there is nothing to file a complaint about. To report content or an account, use Report on it instead.</p>
              )}
            </Field>

            <Field
              label="Who is it about?"
              htmlFor="complaint-against"
              hint={lockedAgainst ? "Filled in from what you picked." : chosen?.kind === "application" ? "The username of the recruiter you dealt with on this application." : undefined}
              error={touched ? problems.against : null}
            >
              <Input
                id="complaint-against"
                value={lockedAgainst ? `@${lockedAgainst}` : against}
                onChange={(e) => setAgainst(e.target.value.slice(0, 40))}
                readOnly={!!lockedAgainst}
                placeholder="username"
                aria-invalid={touched && !!problems.against}
                data-testid="complaint-against"
              />
            </Field>

            <Field label="Category" htmlFor="complaint-category" error={touched ? problems.category : null}>
              <Select
                id="complaint-category"
                aria-label="Category"
                value={category || undefined}
                onValueChange={(v) => setCategory(v as ComplaintCategory)}
                placeholder="Choose a category"
                options={(Object.keys(COMPLAINT_CATEGORY) as ComplaintCategory[]).map((c) => ({ value: c, label: COMPLAINT_CATEGORY[c] }))}
                data-testid="complaint-category"
              />
            </Field>

            <Field label="What happened?" htmlFor="complaint-description" hint={`${descLen}/${DESC_MAX}. Dates, amounts and what was agreed help the most.`} error={touched ? problems.description : null}>
              <Textarea
                id="complaint-description"
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, DESC_MAX))}
                rows={5}
                aria-invalid={touched && !!problems.description}
                data-testid="complaint-description"
              />
            </Field>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  Evidence <span className="text-xs font-normal text-subtle-foreground">Optional, up to 10 files</span>
                </p>
                <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploads.items.length >= 10} data-testid="complaint-add-evidence">
                  <Paperclip /> Add files
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept="image/*,application/pdf,.doc,.docx,.txt"
                  onChange={(e) => {
                    if (e.target.files?.length) uploads.add(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              {uploads.items.length ? (
                <ul className="space-y-1.5">
                  {uploads.items.map((u) => (
                    <li key={u.localId} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
                      <FileText className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{u.file.name}</span>
                      {u.status === "uploading" ? (
                        <span className="text-xs tabular-nums text-subtle-foreground">{Math.round(u.progress * 100)}%</span>
                      ) : u.status === "error" ? (
                        <>
                          <span className="text-xs text-danger">{u.error ?? "Failed"}</span>
                          <IconButton label={`Retry ${u.file.name}`} size="sm" onClick={() => uploads.retry(u.localId)}>
                            <RotateCcw />
                          </IconButton>
                        </>
                      ) : (
                        <span className="text-xs text-success-soft-foreground">Uploaded</span>
                      )}
                      <IconButton label={`Remove ${u.file.name}`} size="sm" onClick={() => uploads.remove(u.localId)}>
                        <X />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {error ? (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-foreground" data-testid="complaint-error">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={file.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={file.isPending} disabled={uploads.busy || !options.length} data-testid="complaint-submit">
              {uploads.busy ? "Uploading..." : "File complaint"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
