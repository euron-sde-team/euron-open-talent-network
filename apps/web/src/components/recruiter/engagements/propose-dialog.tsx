"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, toast } from "@open-talent/ui";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";

/** Record work that came out of an accepted approach or a hire. Both sides confirm before it starts. */
export function ProposeEngagementDialog({
  open,
  onOpenChange,
  approachId,
  applicationId,
  candidateName,
  defaultTitle,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  approachId?: string;
  applicationId?: string;
  candidateName: string;
  defaultTitle: string;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(defaultTitle);
  const [touched, setTouched] = useState(false);
  const invalid = title.trim().length < 2;
  const propose = useMutation({
    mutationFn: () => api().trust.propose({ ...(approachId ? { approachId } : { applicationId: applicationId! }), title: title.trim() }),
    meta: { silent: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.engagements });
      toast.success({ title: "Engagement proposed", description: `${candidateName} will be asked to confirm it.` });
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !propose.isPending && onOpenChange(o)}>
      <DialogContent size="sm" data-testid="propose-engagement-dialog">
        <form
          noValidate
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!invalid) propose.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Record an engagement</DialogTitle>
            <DialogDescription>
              Track the work you do together with {candidateName}. It starts once both of you confirm, and when it is complete you can rate each other.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="What is the engagement?" htmlFor="eng-title" error={touched && invalid ? "Give it a short title." : undefined}>
              <Input id="eng-title" autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-invalid={touched && invalid} data-testid="eng-title" />
            </Field>
            {propose.error ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {errorMessage(propose.error)}{" "}
                <Link href="/recruiter/engagements" className="text-link underline">
                  See engagements
                </Link>
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={propose.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={propose.isPending} data-testid="eng-propose-submit">
              Propose
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
