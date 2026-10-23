"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Select, toast } from "@open-talent/ui";
import type { Post, PostVisibility } from "@open-talent/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { prependPost, updatePostEverywhere } from "@/lib/post-cache";
import { MentionTextarea } from "@/components/common/mention-textarea";

const AUDIENCES: { value: PostVisibility; label: string }[] = [
  { value: "PUBLIC", label: "Anyone" },
  { value: "CONNECTIONS", label: "Connections only" },
];

/** Repost to your own feed, with an optional note. */
export function ShareDialog({ post, open, onOpenChange }: { post: Post; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("PUBLIC");
  const source = post.sharedPost ?? post;
  const share = useMutation({
    mutationFn: () => api().posts.create({ body: body.trim(), sharedPostId: source.id, visibility }),
    onSuccess: (p) => {
      prependPost(qc, p);
      updatePostEverywhere(qc, source.id, (x) => ({ ...x, repostCount: x.repostCount + 1 }));
      toast.success({ title: "Reposted to your feed" });
      onOpenChange(false);
    },
    onError: (e) => toast.error({ title: "Could not repost", description: errorMessage(e) }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle>Repost</DialogTitle>
          <DialogDescription>Share {source.company?.name ?? source.author.displayName}&apos;s post with your network.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="rounded-md border border-border p-3">
            <MentionTextarea value={body} onValueChange={setBody} placeholder="Add your thoughts (optional)" aria-label="Your note" className="min-h-[60px] text-[15px]" maxLength={3000} />
          </div>
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-semibold">{source.company?.name ?? source.author.displayName}</p>
            <p className="line-clamp-3 text-muted-foreground">{source.body || (source.media.length ? "Photo or video" : "")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="share-audience">Who can see this</Label>
            <Select id="share-audience" value={visibility} onValueChange={(v) => setVisibility(v as PostVisibility)} options={AUDIENCES} />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={share.isPending} onClick={() => share.mutate()} data-testid="share-submit">
            Repost
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
