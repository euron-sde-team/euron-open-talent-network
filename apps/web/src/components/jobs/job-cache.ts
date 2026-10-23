"use client";

import { useMutation, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { toast } from "@open-talent/ui";
import type { Job, Page } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { useRouter } from "next/navigation";

/** Every cache root that can hold Job objects: search pages, one job, recommended, saved, company lists. */
const JOB_ROOTS = new Set(["jobs", "job", "jobs-recommended", "jobs-saved", "company-jobs"]);

type Snapshot = [readonly unknown[], unknown][];

function transform(data: unknown, id: string, fn: (j: Job) => Job): unknown {
  if (!data || typeof data !== "object") return data;
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.pages)) {
    const inf = data as InfiniteData<Page<Job>>;
    return { ...inf, pages: inf.pages.map((p) => ({ ...p, items: p.items.map((j) => (j.id === id ? fn(j) : j)) })) };
  }
  if (Array.isArray(data)) return (data as Job[]).map((j) => (j && j.id === id && "viewer" in j ? fn(j) : j));
  if (d.id === id && "viewer" in d && "company" in d) return fn(data as Job);
  return data;
}

/** Apply `fn` to the job with `id` wherever it is cached; returns a snapshot for rollback. */
export function updateJobEverywhere(qc: QueryClient, id: string, fn: (j: Job) => Job): Snapshot {
  const snapshot: Snapshot = [];
  for (const [key, data] of qc.getQueriesData({ predicate: (q) => typeof q.queryKey[0] === "string" && JOB_ROOTS.has(q.queryKey[0]) })) {
    snapshot.push([key, data]);
    qc.setQueryData(key, transform(data, id, fn));
  }
  return snapshot;
}

export function restore(qc: QueryClient, snapshot: Snapshot) {
  for (const [key, data] of snapshot) qc.setQueryData(key, data);
}

/** A cached copy of a job from any list, used as placeholder data so the detail paints instantly. */
export function findCachedJob(qc: QueryClient, id: string): Job | undefined {
  let found: Job | undefined;
  const visit = (j: Job) => {
    if (!found && j.id === id) found = j;
    return j;
  };
  for (const [, data] of qc.getQueriesData({ predicate: (q) => typeof q.queryKey[0] === "string" && JOB_ROOTS.has(q.queryKey[0]) })) {
    transform(data, id, visit);
    if (found) break;
  }
  return found;
}

/** Optimistic save / unsave, reflected in every list at once. */
export function useSaveJob() {
  const qc = useQueryClient();
  const { status } = useAuth();
  const router = useRouter();
  const m = useMutation({
    mutationFn: ({ job, save }: { job: Job; save: boolean }) => (save ? api().jobs.save(job.id) : api().jobs.unsave(job.id)),
    onMutate: ({ job, save }) => updateJobEverywhere(qc, job.id, (j) => ({ ...j, viewer: { ...j.viewer, saved: save } })),
    onError: (_e, _v, snapshot) => {
      if (snapshot) restore(qc, snapshot);
    },
    onSuccess: (_d, { save }) => {
      toast.success({ title: save ? "Job saved" : "Removed from saved jobs", description: save ? "Find it any time under Saved jobs." : undefined });
    },
  });
  return {
    pending: m.isPending,
    toggle: (job: Job) => {
      if (status !== "signed-in") {
        router.push(`/login?next=${encodeURIComponent(`/jobs?job=${job.id}`)}`);
        return;
      }
      m.mutate({ job, save: !job.viewer.saved });
    },
  };
}

/** Everything that shows application state after one is created or withdrawn. */
export function invalidateApplications(qc: QueryClient, jobId?: string) {
  void qc.invalidateQueries({ queryKey: qk.myApplicationsAll });
  void qc.invalidateQueries({ queryKey: qk.recommendedJobs });
  void qc.invalidateQueries({ queryKey: qk.jobInvites });
  if (jobId) void qc.invalidateQueries({ queryKey: qk.job(jobId) });
}
