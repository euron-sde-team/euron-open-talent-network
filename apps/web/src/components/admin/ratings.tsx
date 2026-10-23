"use client";

import { useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { EyeOff, Star } from "lucide-react";
import { Button, Card, Field, Input, Skeleton, toast } from "@open-talent/ui";
import type { Rating, UserSummary } from "@open-talent/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { TimeAgo } from "@/components/common/time-ago";
import { ReasonDialog } from "./admin-bits";

/** Hide a rating (complaints area). The rating leaves the profile and the average is recomputed. */
export function useHideRating() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; reason: string }) => api().admin.hideRating(v.id, v.reason),
    onSuccess: () => {
      toast.success({ title: "Rating hidden", description: "The average was recomputed." });
      void qc.invalidateQueries({ queryKey: ["profile-ratings"] });
    },
  });
}

export function RatingRow({ rating, onHide }: { rating: Rating; onHide: () => void }) {
  return (
    <li className="flex items-start gap-3 py-2.5" data-testid="rating-row">
      <span className="flex shrink-0 items-center gap-0.5 text-sm font-semibold tabular-nums">
        <Star className="size-3.5 text-warning" aria-hidden /> {rating.score}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-xs text-subtle-foreground">
          From {rating.rater.displayName}, <TimeAgo value={rating.revealedAt ?? rating.createdAt} />
        </p>
        {rating.comment ? <p className="mt-0.5 whitespace-pre-wrap">{rating.comment}</p> : <p className="mt-0.5 text-subtle-foreground">No comment</p>}
      </div>
      <Button size="sm" variant="danger-ghost" onClick={onHide} data-testid="rating-hide">
        <EyeOff /> Hide
      </Button>
    </li>
  );
}

/**
 * Revealed ratings between two people (either direction we can list: ratings shown on
 * a talent profile). Used on a complaint to find the rating it is about.
 */
export function RatingsBetween({ a, b }: { a: UserSummary; b: UserSummary }) {
  const results = useQueries({
    queries: [a, b].map((u) => ({ queryKey: qk.profileRatings(u.username), queryFn: () => api().profiles.ratings(u.username), meta: { silent: true }, retry: false })),
  });
  const hide = useHideRating();
  const [target, setTarget] = useState<Rating | null>(null);
  if (results.some((r) => r.isPending)) return <Skeleton className="h-12" />;
  const between = [...(results[0]?.data ?? []).filter((r) => r.rater.id === b.id), ...(results[1]?.data ?? []).filter((r) => r.rater.id === a.id)];
  return (
    <div>
      {between.length ? (
        <ul className="divide-y divide-border">
          {between.map((r) => (
            <RatingRow key={r.id} rating={r} onHide={() => setTarget(r)} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-subtle-foreground">No visible ratings between these two people.</p>
      )}
      <ReasonDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Hide this rating?"
        description="It disappears from the profile and the average is recomputed. This is recorded in the audit log."
        confirmLabel="Hide rating"
        destructive
        onConfirm={({ reason }) => hide.mutateAsync({ id: target!.id, reason })}
        testId="rating-hide-dialog"
      />
    </div>
  );
}

/** For ratings reported outside a complaint: hide one by its id. */
export function HideRatingTool() {
  const [id, setId] = useState("");
  const [open, setOpen] = useState(false);
  const hide = useHideRating();
  const clean = id.trim();
  return (
    <Card className="p-4" data-testid="hide-rating-tool">
      <h3 className="text-[15px] font-semibold">Hide a rating by id</h3>
      <p className="mb-3 text-xs text-muted-foreground">For a rating reported outside a complaint. The id is in the report or the audit log.</p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean) setOpen(true);
        }}
      >
        <Field label="Rating id" htmlFor="rating-id" className="min-w-0 flex-1">
          <Input id="rating-id" value={id} onChange={(e) => setId(e.target.value)} placeholder="01H..." className="font-mono" autoComplete="off" data-testid="rating-id" />
        </Field>
        <Button type="submit" variant="outline" disabled={!clean}>
          <EyeOff /> Hide
        </Button>
      </form>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Hide this rating?"
        description={<span className="font-mono">{clean}</span>}
        confirmLabel="Hide rating"
        destructive
        onConfirm={async ({ reason }) => {
          await hide.mutateAsync({ id: clean, reason });
          setId("");
        }}
        testId="rating-id-dialog"
      />
    </Card>
  );
}
