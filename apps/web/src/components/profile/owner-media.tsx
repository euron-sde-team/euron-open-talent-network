"use client";

import { useEffect, useRef } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, Spinner, toast } from "@open-talent/ui";
import type { Media, UploadPurpose } from "@open-talent/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useUploads } from "@/lib/hooks/use-uploads";
import { useApplyMine } from "./use-profile";
import { useAuth } from "@/lib/auth";

/** One image at a time through the shared upload pipeline; `onDone` attaches it. */
export function useSingleImage(purpose: UploadPurpose, onDone: (m: Media) => Promise<unknown>) {
  const up = useUploads(purpose, { max: 1, accept: (m) => m.startsWith("image/") });
  const item = up.items[0];
  const handled = useRef<string | null>(null);
  const { reset, remove } = up;
  useEffect(() => {
    if (!item || handled.current === item.localId) return;
    if (item.status === "done" && item.media) {
      handled.current = item.localId;
      const media = item.media;
      onDone(media)
        .catch((e: unknown) => {
          toast.error({ title: "Could not save the image", description: errorMessage(e) });
          void api().media.discard(media.id).catch(() => undefined);
        })
        .finally(reset);
    } else if (item.status === "error") {
      handled.current = item.localId;
      toast.error({ title: "The upload did not go through", description: item.error ?? undefined });
      remove(item.localId);
    }
  }, [item, onDone, reset, remove]);
  return { add: up.add, busy: !!item, progress: item?.progress ?? 0, preview: item?.previewUrl ?? null };
}

function FilePicker({ inputRef, onFiles, testId }: { inputRef: React.RefObject<HTMLInputElement | null>; onFiles: (f: FileList) => void; testId: string }) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      data-testid={testId}
      onChange={(e) => {
        if (e.target.files?.length) onFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );
}

export function AvatarUpload({ hasAvatar }: { hasAvatar: boolean }) {
  const { reloadMe } = useAuth();
  const applyMine = useApplyMine();
  const ref = useRef<HTMLInputElement>(null);
  const refresh = async () => {
    await reloadMe();
    applyMine(await api().profiles.mine());
  };
  const img = useSingleImage("AVATAR", async (m) => {
    await api().users.updateMe({ avatarUploadId: m.id });
    await refresh();
    toast.success({ title: "Profile photo updated" });
  });
  const clear = async () => {
    try {
      await api().users.updateMe({ avatarUploadId: null });
      await refresh();
    } catch (e) {
      toast.error({ title: "Could not remove the photo", description: errorMessage(e) });
    }
  };
  return (
    <>
      <FilePicker inputRef={ref} onFiles={img.add} testId="avatar-upload" />
      {img.busy ? (
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-overlay/50 text-white" aria-live="polite">
          <Spinner className="text-current" />
          <span className="sr-only">Uploading {Math.round(img.progress * 100)}%</span>
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="Change profile photo" variant="outline" size="sm" className="absolute bottom-1 right-1 shadow-card" disabled={img.busy}>
            <Camera />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => ref.current?.click()}>
            <ImagePlus /> Upload a photo
          </DropdownMenuItem>
          {hasAvatar ? (
            <DropdownMenuItem destructive onSelect={() => void clear()}>
              <Trash2 /> Remove photo
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function CoverUpload({ hasCover }: { hasCover: boolean }) {
  const applyMine = useApplyMine();
  const ref = useRef<HTMLInputElement>(null);
  const img = useSingleImage("COVER", async (m) => {
    applyMine(await api().profiles.cover(m.id));
    toast.success({ title: "Cover image updated" });
  });
  const clear = async () => {
    try {
      applyMine(await api().profiles.cover(null));
    } catch (e) {
      toast.error({ title: "Could not remove the cover", description: errorMessage(e) });
    }
  };
  return (
    <>
      <FilePicker inputRef={ref} onFiles={img.add} testId="cover-upload" />
      {img.preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img.preview} alt="" className="absolute inset-0 size-full object-cover opacity-70" />
      ) : null}
      {img.busy ? (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-overlay/30" aria-hidden>
          <span className="block h-full bg-primary transition-[width]" style={{ width: `${Math.round(img.progress * 100)}%` }} />
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="Change cover image" variant="outline" size="sm" className="absolute right-3 top-3 shadow-card" disabled={img.busy}>
            {img.busy ? <Spinner size="sm" /> : <Camera />}
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => ref.current?.click()}>
            <ImagePlus /> Upload a cover image
          </DropdownMenuItem>
          {hasCover ? (
            <DropdownMenuItem destructive onSelect={() => void clear()}>
              <Trash2 /> Remove cover
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
