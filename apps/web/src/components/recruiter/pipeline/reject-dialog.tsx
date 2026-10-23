"use client";

import { useState } from "react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Textarea } from "@open-talent/ui";

const QUICK = ["Not enough relevant experience", "Missing key skills for the role", "Location or work authorisation does not fit", "Position filled by another candidate", "Candidate not responsive"];

/** Rejecting needs a reason (the candidate sees "Not selected"; the reason stays with the team). */
export function RejectDialog({ open, count, name, onCancel, onConfirm }: { open: boolean; count: number; name: string; onCancel: () => void; onConfirm: (reason: string, note: string | null) => void }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const invalid = !reason.trim();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent size="sm" data-testid="reject-dialog">
        <form
          noValidate
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!invalid) onConfirm(reason.trim(), note.trim() || null);
          }}
        >
          <DialogHeader>
            <DialogTitle>{count > 1 ? `Reject ${count} candidates` : `Reject ${name}`}</DialogTitle>
            <DialogDescription>The candidate is told they were not selected. Your reason is kept for the team and never shown to them.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((q) => (
                <button key={q} type="button" onClick={() => setReason(q)} className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {q}
                </button>
              ))}
            </div>
            <Field label="Reason" htmlFor="reject-reason" error={touched && invalid ? "Add a reason." : undefined}>
              <Textarea id="reject-reason" autoFocus rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={touched && invalid} data-testid="reject-reason" />
            </Field>
            <Field label="Team note" htmlFor="reject-note" optional>
              <Textarea id="reject-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" data-testid="reject-confirm">
              Reject
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
