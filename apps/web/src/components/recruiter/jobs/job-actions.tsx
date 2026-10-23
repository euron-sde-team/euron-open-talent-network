"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, KanbanSquare, Megaphone, MoreHorizontal, Pencil, Play, Square } from "lucide-react";
import { isApiError } from "@open-talent/api-client";
import type { Job } from "@open-talent/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, IconButton, toast } from "@open-talent/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { ComposerDialog } from "@/components/posts/composer";

export function useInvalidateJobs() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const slug = user?.recruiter?.company.slug ?? "";
  return (job?: Job) => {
    void qc.invalidateQueries({ queryKey: ["company-jobs", slug] });
    void qc.invalidateQueries({ queryKey: qk.recruiterMe });
    if (job) qc.setQueryData(qk.job(job.id), job);
  };
}

/** Open, close or mark filled, with the open-job cap explained when it bites. */
export function useJobStatus() {
  const invalidate = useInvalidateJobs();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "OPEN" | "CLOSED" | "FILLED" }) => api().jobs.setStatus(id, status),
    meta: { silent: true },
    onSuccess: (job) => {
      invalidate(job);
      toast.success({ title: job.status === "OPEN" ? "Job is open" : job.status === "FILLED" ? "Marked as filled" : "Job closed" });
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "JOB_CAP_REACHED") {
        const cap = (e.details as { cap?: number } | undefined)?.cap;
        toast.error({ title: "Open-job limit reached", description: cap ? `Your company can have ${cap} open jobs at a time. Close or fill one to open another.` : errorMessage(e) });
      } else toast.error({ title: errorMessage(e) });
    },
  });
}

export function JobActionsMenu({ job }: { job: Job }) {
  const status = useJobStatus();
  const [share, setShare] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`Actions for ${job.title}`} size="sm" data-testid="job-actions">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/recruiter/jobs/${job.id}`}>
              <KanbanSquare /> Pipeline
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/recruiter/jobs/${job.id}/edit`} data-testid="job-edit">
              <Pencil /> Edit
            </Link>
          </DropdownMenuItem>
          {job.status === "OPEN" ? (
            <DropdownMenuItem asChild>
              <Link href={`/jobs/${job.id}`}>
                <ExternalLink /> View posting
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {job.status !== "OPEN" ? (
            <DropdownMenuItem onSelect={() => status.mutate({ id: job.id, status: "OPEN" })} data-testid="job-open">
              <Play /> {job.status === "DRAFT" ? "Publish" : "Reopen"}
            </DropdownMenuItem>
          ) : null}
          {job.status === "OPEN" ? (
            <DropdownMenuItem onSelect={() => status.mutate({ id: job.id, status: "CLOSED" })} data-testid="job-close">
              <Square /> Close
            </DropdownMenuItem>
          ) : null}
          {job.status === "OPEN" || job.status === "CLOSED" ? (
            <DropdownMenuItem onSelect={() => status.mutate({ id: job.id, status: "FILLED" })} data-testid="job-fill">
              <CheckCircle2 /> Mark filled
            </DropdownMenuItem>
          ) : null}
          {job.status === "OPEN" ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setShare(true)} data-testid="job-share">
                <Megaphone /> Share as a post
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {share ? <ComposerDialog open={share} onOpenChange={setShare} start="hiring" jobId={job.id} /> : null}
    </>
  );
}
