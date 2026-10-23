"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";

/** The full recruiter record (quota, work email, review note). Only fetched when the person has one. */
export function useRecruiterAccount() {
  const { status, user } = useAuth();
  return useQuery({
    queryKey: qk.recruiterMe,
    queryFn: () => api().recruiter.me(),
    enabled: status === "signed-in" && !!user?.recruiter,
    staleTime: 30_000,
  });
}

/** The company's open jobs (first page), for pickers and the home stats. */
export function useOpenJobs(slug: string | undefined) {
  return useQuery({
    queryKey: [...qk.companyJobs(slug ?? "", "OPEN"), "picker"],
    queryFn: () => api().companies.jobs(slug!, { status: "OPEN", limit: 50 }),
    enabled: !!slug,
    staleTime: 60_000,
  });
}
