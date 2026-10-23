"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { isApiError } from "@open-talent/api-client";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Textarea, cn, toast } from "@open-talent/ui";
import type { ModerationTarget, ReportReason } from "@open-talent/types";
import { api } from "@/lib/api";

export const REPORT_REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: "SPAM", label: "Spam", hint: "Misleading, repetitive or unwanted promotion" },
  { value: "HARASSMENT", label: "Harassment or bullying", hint: "Targets or intimidates someone" },
  { value: "HATE", label: "Hate speech", hint: "Attacks people for who they are" },
  { value: "VIOLENCE", label: "Violence or threats", hint: "Threatens or encourages harm" },
  { value: "SEXUAL", label: "Sexual content", hint: "Nudity or sexual material" },
  { value: "SELF_HARM", label: "Self-harm", hint: "Promotes or depicts self-harm" },
  { value: "MISINFORMATION", label: "False information", hint: "Spreads harmful misinformation" },
  { value: "IMPERSONATION", label: "Impersonation", hint: "Pretends to be someone else" },
  { value: "FAKE_PROFILE", label: "Fake profile or company", hint: "Invented experience, or not a real employer" },
  { value: "SCAM", label: "Scam or fraud", hint: "Asks for money, fake job offers, phishing" },
  { value: "OTHER", label: "Something else", hint: "Tell us what is wrong" },
];

const NOUN: Record<ModerationTarget, string> = {
  POST: "post",
  COMMENT: "comment",
  DM_MESSAGE: "message",
  USER: "account",
  PROFILE: "profile",
  COMPANY: "company page",
  JOB: "job",
  APPROACH: "approach",
};

export function ReportDialog({ open, onOpenChange, targetType, targetId }: { open: boolean; onOpenChange: (o: boolean) => void; targetType: ModerationTarget; targetId: string }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const noun = NOUN[targetType];
  const report = useMutation({
    mutationFn: () => api().reports.create({ targetType, targetId, reason: reason!, details: details.trim() || undefined }),
    meta: { silent: true },
    onSuccess: () => {
      toast.success({ title: "Thanks for letting us know", description: "Moderators will review it. Reporters stay anonymous." });
      onOpenChange(false);
      setReason(null);
      setDetails("");
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "ALREADY_REPORTED") {
        toast.info({ title: "You already reported this", description: "Moderators will take a look." });
        onOpenChange(false);
      } else toast.error({ title: "Could not send the report", description: isApiError(e) ? e.message : undefined });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="report-dialog">
        <DialogHeader>
          <DialogTitle>Report this {noun}</DialogTitle>
          <DialogDescription>Why are you reporting it? The author will not know who reported.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div role="radiogroup" aria-label="Reason" className="grid gap-2 sm:grid-cols-2">
            {REPORT_REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={reason === r.value}
                data-testid={`report-reason-${r.value.toLowerCase()}`}
                onClick={() => setReason(r.value)}
                className={cn(
                  "rounded-md border px-3 py-2.5 text-left transition-colors",
                  reason === r.value ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
                )}
              >
                <span className="block text-sm font-semibold">{r.label}</span>
                <span className="block text-xs text-subtle-foreground">{r.hint}</span>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-details">Anything else? (optional)</Label>
            <Textarea id="report-details" value={details} maxLength={1000} onChange={(e) => setDetails(e.target.value)} placeholder="Add context that helps moderators decide" />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!reason} loading={report.isPending} onClick={() => report.mutate()} data-testid="report-submit">
            Submit report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
