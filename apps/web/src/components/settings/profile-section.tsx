"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, ExternalLink, X } from "lucide-react";
import { isApiError } from "@open-talent/api-client";
import { Avatar, Button, Field, Input, Spinner, Switch, toast } from "@open-talent/ui";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { useUploads } from "@/lib/hooks/use-uploads";
import { qk } from "@/lib/query-keys";
import { profileHref } from "@/components/common/user-bits";
import { SettingsCard } from "./section";

const schema = z.object({ displayName: z.string().trim().min(1, "Enter your name").max(80) });
type Values = z.infer<typeof schema>;

/** Account basics. Everything shown on the talent page itself is edited on the page. */
export function ProfileSection() {
  const me = useMe();
  const { setUser } = useAuth();
  const avatar = useUploads("AVATAR", { max: 1, accept: (m) => m.startsWith("image/") });
  const avatarRef = useRef<HTMLInputElement>(null);

  const form = useForm<Values>({ resolver: zodResolver(schema), values: { displayName: me.displayName }, resetOptions: { keepDirtyValues: true } });

  const onSubmit = async (v: Values) => {
    try {
      const updated = await api().users.updateMe({ displayName: v.displayName, ...(avatar.mediaIds[0] ? { avatarUploadId: avatar.mediaIds[0] } : {}) });
      setUser(updated);
      avatar.reset();
      form.reset(v);
      toast.success({ title: "Saved" });
    } catch (e) {
      if (isApiError(e) && e.code === "VALIDATION_FAILED") {
        for (const [path, msg] of Object.entries(e.fieldErrors)) if (path in v) form.setError(path as keyof Values, { message: msg });
      }
      toast.error({ title: "Could not save", description: errorMessage(e) });
    }
  };

  const digest = useMutation({
    mutationFn: (on: boolean) => api().users.updateMe({ emailDigest: on }),
    onSuccess: (m) => setUser(m),
    onError: (e) => toast.error({ title: "Could not update email preferences", description: errorMessage(e) }),
  });

  const avatarPreview = avatar.items[0]?.previewUrl ?? me.avatarUrl;
  const dirty = form.formState.isDirty || avatar.mediaIds.length > 0;
  const errs = form.formState.errors;

  return (
    <div className="space-y-4">
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <SettingsCard
          title="Name and photo"
          description="Shown on your page, in search results and next to everything you post."
          footer={
            <Button type="submit" loading={form.formState.isSubmitting} disabled={!dirty || avatar.busy || avatar.failed} data-testid="settings-save">
              {avatar.busy ? "Uploading..." : "Save changes"}
            </Button>
          }
        >
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar name={me.displayName} seed={me.id} src={avatarPreview} size="xl" />
              {avatar.busy ? (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-overlay/40">
                  <Spinner className="text-white" />
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => avatarRef.current?.click()}
                aria-label="Change profile photo"
                data-testid="avatar-upload"
                className="absolute -bottom-1 -right-1 flex size-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-card hover:bg-muted"
              >
                <Camera className="size-4" />
              </button>
              <input
                ref={avatarRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) {
                    avatar.items.forEach((i) => avatar.remove(i.localId));
                    avatar.add(e.target.files);
                  }
                  e.target.value = "";
                }}
              />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <Field label="Name" htmlFor="displayName" error={errs.displayName?.message}>
                <Input id="displayName" {...form.register("displayName")} aria-invalid={!!errs.displayName || undefined} />
              </Field>
              {avatar.items.length ? (
                <Button size="sm" variant="ghost" onClick={() => avatar.remove(avatar.items[0]!.localId)}>
                  <X /> Undo photo change
                </Button>
              ) : null}
            </div>
          </div>
          {avatar.failed ? <p className="mt-3 text-sm text-danger">The upload failed. Pick another image.</p> : null}
          <p className="mt-4 text-sm text-muted-foreground">
            Headline, experience, skills and everything else on your talent page are edited on the page itself.{" "}
            <Link href={profileHref(me.username)} className="inline-flex items-center gap-1 font-semibold text-link hover:underline">
              Open your page <ExternalLink className="size-3.5" />
            </Link>
          </p>
        </SettingsCard>
      </form>

      <UsernameCard />

      <SettingsCard title="Email updates" description="A digest of what you missed while you were away: invitations, messages, application updates.">
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm">Send me digest emails</span>
          <Switch checked={me.emailDigest} onCheckedChange={(on) => digest.mutate(on)} disabled={digest.isPending} data-testid="email-digest" />
        </label>
      </SettingsCard>
    </div>
  );
}

function UsernameCard() {
  const me = useMe();
  const { reloadMe } = useAuth();
  const qc = useQueryClient();
  const [value, setValue] = useState(me.username);
  const candidate = value.trim().toLowerCase();
  const debounced = useDebounced(candidate, 250);
  const changed = debounced.length >= 3 && debounced !== me.username;
  const check = useQuery({ queryKey: qk.usernameCheck(debounced), queryFn: () => api().profiles.usernameCheck(debounced), enabled: changed, staleTime: 30_000 });
  const save = useMutation({
    mutationFn: () => api().profiles.changeUsername(candidate),
    onSuccess: async () => {
      await reloadMe();
      void qc.invalidateQueries({ queryKey: qk.myProfile });
      toast.success({ title: "Username changed", description: "Your old address redirects to the new one." });
    },
    onError: (e) => toast.error({ title: "Could not change your username", description: errorMessage(e) }),
  });
  const r = check.data;
  const reason = r && !r.available ? (r.reason === "TAKEN" ? "That username is taken." : r.reason === "RESERVED" ? "That username is reserved." : "Use 3 to 40 lowercase letters, numbers or hyphens.") : null;
  return (
    <SettingsCard
      title="Public address"
      description="Your page lives at /in/your-username. You can change it from time to time; links to the old address keep working."
      footer={
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!changed || candidate !== debounced || !r?.available} data-testid="username-save">
          Change username
        </Button>
      }
    >
      <Field label="Username" htmlFor="username" error={reason ?? undefined}>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-subtle-foreground">/in/</span>
          <Input id="username" value={value} onChange={(e) => setValue(e.target.value)} className="pl-10" autoComplete="off" spellCheck={false} maxLength={40} aria-invalid={!!reason || undefined} data-testid="username-input" />
          {changed && check.isFetching ? <Spinner size="sm" className="absolute right-3 top-1/2 -translate-y-1/2" /> : changed && r?.available ? <Check className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-success" aria-label="Available" /> : null}
        </div>
      </Field>
      {r && !r.available && r.suggestions.length ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Try:
          {r.suggestions.map((s) => (
            <button key={s} type="button" onClick={() => setValue(s)} className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium hover:bg-muted">
              {s}
            </button>
          ))}
        </p>
      ) : null}
    </SettingsCard>
  );
}
