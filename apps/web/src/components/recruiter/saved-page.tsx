"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Pencil, Star, StickyNote } from "lucide-react";
import type { Page, TalentCard } from "@open-talent/types";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Card, EmptyState, Skeleton, Textarea, toast } from "@open-talent/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { usePagedList } from "@/lib/hooks/queries";
import { ErrorState, LoadMore, PageTitle } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { TalentResultCard } from "./talent/talent-card";

type SavedCard = TalentCard & { note: string | null; savedAt: string; id: string };
const LIST_KEY = [...qk.savedCandidates, "list"] as const;

export function SavedCandidatesPage() {
  const list = usePagedList<SavedCard>({
    queryKey: LIST_KEY,
    fetchPage: async (cursor) => {
      const page = await api().recruiter.saved({ cursor, limit: 20 });
      return { ...page, items: page.items.map((c) => ({ ...c, id: c.user.id })) };
    },
  });
  const [editing, setEditing] = useState<SavedCard | null>(null);
  // Unsaved in this visit: the card stays (as "Save") so a slip can be undone in place.
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const items = list.items;

  return (
    <div data-testid="saved-candidates">
      <PageTitle title="Saved candidates" description="People you bookmarked, with your private notes. Only you see this list." />
      {list.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i} className="flex gap-3 p-4">
              <Skeleton className="size-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </Card>
          ))}
        </div>
      ) : list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : !items.length ? (
        <Card>
          <EmptyState
            icon={<Star />}
            title="No saved candidates yet"
            description="Save people from talent search or their profile to build a shortlist."
            action={
              <Button asChild size="sm" variant="soft">
                <Link href="/recruiter/talent">Search talent</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((c) => (
            <TalentResultCard
              key={c.id}
              card={c}
              saved={!removed.has(c.user.username)}
              onSavedChange={(on) =>
                setRemoved((r) => {
                  const next = new Set(r);
                  if (on) next.delete(c.user.username);
                  else next.add(c.user.username);
                  return next;
                })
              }
              testId="saved-candidate"
              footer={
                <div className="mt-3 flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm">
                  <span className="sr-only">Your note.</span>
                  <StickyNote className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{c.note ?? <span className="text-subtle-foreground">No note</span>}</p>
                  <TimeAgo value={c.savedAt} className="mt-0.5 shrink-0 text-xs text-subtle-foreground" />
                  <Button variant="link" size="sm" onClick={() => setEditing(c)} data-testid="saved-edit-note">
                    <Pencil className="size-3.5" /> {c.note ? "Edit" : "Add note"}
                  </Button>
                </div>
              }
            />
          ))}
        </div>
      )}
      <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => list.fetchNextPage()} />
      {editing ? <NoteDialog card={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function NoteDialog({ card, onClose }: { card: SavedCard; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(card.note ?? "");
  const save = useMutation({
    mutationFn: () => api().recruiter.save(card.user.username, note.trim() || null),
    onSuccess: () => {
      qc.setQueryData<InfiniteData<Page<SavedCard>>>(LIST_KEY, (old) =>
        old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((c) => (c.id === card.id ? { ...c, note: note.trim() || null } : c)) })) } : old,
      );
      toast.success({ title: "Note saved" });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Note about {card.user.displayName}</DialogTitle>
          <DialogDescription>
            Private to you. Saved <TimeAgo value={card.savedAt} />.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <label htmlFor="saved-note" className="sr-only">
            Note
          </label>
          <Textarea id="saved-note" autoFocus rows={4} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="saved-note-input" />
          <p className="mt-1 text-right text-xs text-subtle-foreground">{note.length} / 500</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()} data-testid="saved-note-save">
            Save note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
