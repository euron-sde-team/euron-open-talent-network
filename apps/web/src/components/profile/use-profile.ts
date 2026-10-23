"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isApiError } from "@open-talent/api-client";
import type { MyProfile, Profile } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";
import { normalizeProfile } from "./profile-utils";

/**
 * The profile behind /in/<username>. The owner reads `profiles.mine()` (private fields,
 * visibility, what is missing); everyone else reads the public view.
 */
export function useProfileView(username: string) {
  const { status, user } = useAuth();
  const selfByAuth = !!user && user.username.toLowerCase() === username.toLowerCase();
  const pub = useQuery({
    queryKey: qk.profile(username),
    queryFn: async () => normalizeProfile(await api().profiles.get(username)),
    enabled: status !== "loading" && !selfByAuth,
    retry: (count, e) => !(isApiError(e) && e.status > 0 && e.status < 500) && count < 2,
  });
  const isSelf = selfByAuth || !!pub.data?.viewer.isSelf;
  const mine = useQuery({
    queryKey: qk.myProfile,
    queryFn: async () => normalizeProfile(await api().profiles.mine()),
    enabled: status === "signed-in" && isSelf,
  });
  const active = isSelf ? mine : pub;
  const profile: Profile | undefined = active.data;
  return {
    profile,
    my: isSelf ? (mine.data as MyProfile | undefined) : undefined,
    isSelf,
    loading: status === "loading" || active.isPending,
    error: active.error,
    refetch: () => void active.refetch(),
  };
}

/** Owner saves: every editor endpoint returns the fresh MyProfile; put it in the cache and refresh the rest. */
export function useApplyMine() {
  const qc = useQueryClient();
  const { reloadMe } = useAuth();
  return useCallback(
    (fresh: MyProfile) => {
      const p = normalizeProfile(fresh);
      qc.setQueryData(qk.myProfile, p);
      void qc.invalidateQueries({ queryKey: qk.profile(p.user.username) });
      void reloadMe().catch(() => undefined);
      return p;
    },
    [qc, reloadMe],
  );
}

/** Patch the cached public profile (optimistic toggles). Returns a rollback. */
export function usePatchProfile(username: string) {
  const qc = useQueryClient();
  return useCallback(
    (fn: (p: Profile) => Profile) => {
      const key = qk.profile(username);
      const prev = qc.getQueryData<Profile>(key);
      if (prev) qc.setQueryData<Profile>(key, fn(prev));
      const prevMine = qc.getQueryData<MyProfile>(qk.myProfile);
      if (prevMine && prevMine.user.username.toLowerCase() === username.toLowerCase()) qc.setQueryData<MyProfile>(qk.myProfile, fn(prevMine) as MyProfile);
      return () => {
        if (prev) qc.setQueryData(key, prev);
        if (prevMine) qc.setQueryData(qk.myProfile, prevMine);
      };
    },
    [qc, username],
  );
}
