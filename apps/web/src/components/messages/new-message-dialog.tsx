"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Spinner, toast } from "@open-talent/ui";
import type { Thread, UserSummary } from "@open-talent/types";
import { api } from "@/lib/api";
import { dmDenialCopy, errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { PeoplePicker } from "./people-picker";

/** Start a conversation with one person, checking first whether it lands as a message or a request. */
export function NewMessageDialog({ open, onOpenChange, onOpened }: { open: boolean; onOpenChange: (o: boolean) => void; onOpened: (t: Thread) => void }) {
  const qc = useQueryClient();
  const [person, setPerson] = useState<UserSummary | null>(null);

  const eligibility = useQuery({
    queryKey: qk.eligibility(person?.id ?? ""),
    queryFn: () => api().dms.eligibility(person!.id),
    enabled: !!person,
    staleTime: 30_000,
    meta: { silent: true },
  });

  const openDirect = useMutation({
    mutationFn: () => api().dms.open(person!.id),
    onSuccess: (t) => {
      qc.setQueryData(qk.thread(t.id), t);
      void qc.invalidateQueries({ queryKey: qk.threadsAll });
      onOpened(t);
      onOpenChange(false);
      setPerson(null);
    },
    onError: (e) => toast.error({ title: "Could not start the conversation", description: errorMessage(e) }),
  });

  const e = eligibility.data;
  const allowed = !!e && (e.canMessage || e.canRequest);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-message-dialog">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>You can message your connections. Anyone else gets a request they can accept or decline.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <PeoplePicker autoFocus selected={person ? [person] : []} onToggle={(u) => setPerson((p) => (p?.id === u.id ? null : u))} />
          {person ? (
            <div className="rounded-md border border-border p-3 text-sm" aria-live="polite">
              {eligibility.isPending ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Spinner size="sm" /> Checking whether you can message {person.displayName}...
                </span>
              ) : e && !allowed ? (
                <p className="text-danger" data-testid="dm-denial">
                  {dmDenialCopy(e.reason, person.displayName)}
                </p>
              ) : e && !e.canMessage ? (
                <p className="flex items-start gap-2 text-muted-foreground" data-testid="dm-as-request">
                  <Info className="mt-0.5 size-4 shrink-0" /> You are not connected, so your first message arrives as a request. {person.displayName} can accept or decline it.
                </p>
              ) : (
                <p className="text-muted-foreground">You can message {person.displayName}.</p>
              )}
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!person || !allowed} loading={openDirect.isPending} onClick={() => openDirect.mutate()} data-testid="new-message-start">
            Message
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
