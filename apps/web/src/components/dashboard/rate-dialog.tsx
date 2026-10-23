"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EyeOff } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Textarea, toast } from "@open-talent/ui";
import type { Engagement, SubScores, UserSummary } from "@open-talent/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { fullTimestamp } from "@/lib/time";
import { StarInput } from "@/components/talent/stars";

const SUBS: { key: keyof SubScores; label: string }[] = [
  { key: "communication", label: "Communication" },
  { key: "quality", label: "Quality of work" },
  { key: "reliability", label: "Reliability" },
  { key: "professionalism", label: "Professionalism" },
];

export function RateDialog({ engagement, counterpart, open, onOpenChange }: { engagement: Engagement; counterpart: UserSummary; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [score, setScore] = useState(0);
  const [subs, setSubs] = useState<Partial<SubScores>>({});
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rate = useMutation({
    mutationFn: () => api().trust.rate(engagement.id, { score, subScores: Object.keys(subs).length ? subs : undefined, comment: comment.trim() || null }),
    onSuccess: (r) => {
      toast.success(
        r.revealed
          ? { title: "Rating saved", description: "You have both rated, so both ratings are now visible." }
          : { title: "Rating saved", description: `It stays hidden until ${counterpart.displayName} rates you or the window closes.` },
      );
      void qc.invalidateQueries({ queryKey: qk.engagements });
      onOpenChange(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const closes = engagement.rating.windowClosesAt;

  return (
    <Dialog open={open} onOpenChange={(o) => !rate.isPending && onOpenChange(o)}>
      <DialogContent size="md" data-testid="rate-dialog">
        <DialogHeader>
          <DialogTitle>Rate {counterpart.displayName}</DialogTitle>
          <DialogDescription>For {engagement.title}. Be fair and specific: ratings help others decide who to work with.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <div className="space-y-1.5">
            <Label>Overall</Label>
            <div>
              <StarInput value={score} onChange={setScore} label="Overall rating" testId="rate-overall" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {SUBS.map((s) => (
              <div key={s.key} className="space-y-1">
                <p className="text-sm text-foreground">
                  {s.label} <span className="text-xs text-subtle-foreground">Optional</span>
                </p>
                <StarInput value={subs[s.key] ?? 0} onChange={(v) => setSubs((cur) => ({ ...cur, [s.key]: v }))} label={s.label} testId={`rate-${s.key}`} />
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rate-comment" className="flex items-center gap-1.5">
              Comment <span className="text-xs font-normal text-subtle-foreground">Optional</span>
            </Label>
            <Textarea id="rate-comment" value={comment} onChange={(e) => setComment(e.target.value.slice(0, 1000))} rows={4} placeholder="What went well, and what could have been better?" data-testid="rate-comment" />
            <p className="text-right text-xs text-subtle-foreground">{comment.length}/1000</p>
          </div>
          <div className="flex gap-3 rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
            <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              Ratings are double-blind: neither of you sees the other&apos;s rating until both have rated
              {closes ? <>, or until the window closes on {fullTimestamp(closes)}</> : null}. Once revealed, a rating is final.
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={rate.isPending}>
            Cancel
          </Button>
          <Button
            loading={rate.isPending}
            disabled={!score}
            onClick={() => {
              setError(null);
              rate.mutate();
            }}
            data-testid="rate-submit"
          >
            Submit rating
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
