"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@open-talent/ui";
import type { Company } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { patchCompanyEverywhere, restoreCompanySnapshot } from "@/lib/company-cache";
import { qk } from "@/lib/query-keys";

/**
 * Follow / unfollow a company page, optimistic. The API answers with the fresh Company,
 * which replaces the cached page; the summary caches (directory, landing, search) are
 * patched too, so every card for this company agrees. `initial` is the state the caller
 * already knows (a summary's `viewerFollowing`, or the full page's `viewer.following`).
 */
export function useFollowCompany(slug: string, name: string, initial?: { following: boolean; followerCount: number }) {
  const qc = useQueryClient();
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const cached = qc.getQueryData<Company>(qk.company(slug));
  const [local, setLocal] = useState<{ following: boolean; followerCount: number } | null>(null);
  const state = local ?? (cached ? { following: cached.viewer.following, followerCount: cached.followerCount } : (initial ?? { following: false, followerCount: 0 }));

  const m = useMutation({
    mutationFn: (on: boolean) => (on ? api().companies.follow(slug) : api().companies.unfollow(slug)),
    onMutate: async (on) => {
      const prev = state;
      const next = { following: on, followerCount: Math.max(0, prev.followerCount + (on === prev.following ? 0 : on ? 1 : -1)) };
      setLocal(next);
      await qc.cancelQueries({ queryKey: ["companies"] });
      const snapshot = patchCompanyEverywhere(qc, slug, { viewerFollowing: next.following, followerCount: next.followerCount });
      return { prev, snapshot };
    },
    onError: (_e, _on, ctx) => {
      setLocal(ctx?.prev ?? null);
      if (ctx) restoreCompanySnapshot(qc, ctx.snapshot);
    },
    onSuccess: (company, on) => {
      qc.setQueryData(qk.company(slug), company);
      patchCompanyEverywhere(qc, slug, { viewerFollowing: company.viewer.following, followerCount: company.followerCount });
      setLocal({ following: company.viewer.following, followerCount: company.followerCount });
      if (on) toast.success({ title: `You follow ${name}`, description: "Their posts and jobs show up for you." });
    },
  });

  return {
    following: state.following,
    followerCount: state.followerCount,
    pending: m.isPending,
    toggle: () => {
      if (status !== "signed-in") {
        router.push(`/login?next=${encodeURIComponent(pathname || "/companies")}`);
        return;
      }
      m.mutate(!state.following);
    },
  };
}
