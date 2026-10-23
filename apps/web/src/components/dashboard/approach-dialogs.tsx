"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Lock, ShieldCheck } from "lucide-react";
import { Button, Checkbox, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Skeleton, Textarea } from "@open-talent/ui";
import { CONTACT_CHANNELS, type Approach, type ContactChannel } from "@open-talent/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { CHANNEL_LABEL } from "./labels";

const CONTACT_FIELD: Record<ContactChannel, "email" | "phone" | "whatsapp"> = { EMAIL: "email", PHONE: "phone", WHATSAPP: "whatsapp" };

/**
 * Accept an approach by choosing which channels to share. Only whether a channel is set is
 * read from the owner's profile; the values themselves are never shown here.
 */
export function AcceptApproachDialog({
  approach,
  open,
  onOpenChange,
  onAccept,
}: {
  approach: Approach;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAccept: (channels: ContactChannel[]) => Promise<unknown>;
}) {
  const mine = useQuery({ queryKey: qk.myProfile, queryFn: () => api().profiles.mine(), enabled: open, staleTime: 30_000 });
  const isSet = (c: ContactChannel) => !!mine.data?.contact[CONTACT_FIELD[c]];
  const [channels, setChannels] = useState<ContactChannel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from the first channel that is set, once the profile has loaded.
  useEffect(() => {
    if (!open || !mine.data) return;
    setChannels((cur) => (cur.length ? cur.filter(isSet) : CONTACT_CHANNELS.filter(isSet).slice(0, 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mine.data]);
  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  const none = !!mine.data && !CONTACT_CHANNELS.some(isSet);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="md" data-testid="approach-accept-dialog">
        <DialogHeader>
          <DialogTitle>Share your contact details with {approach.recruiter.displayName}</DialogTitle>
          <DialogDescription>
            {approach.company.name} will be able to see only the channels you pick, for the role of {approach.roleTitle}. A conversation with the recruiter opens too.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">Channels to share</legend>
            {mine.isPending ? (
              Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10" />)
            ) : mine.isError ? (
              <p className="text-sm text-danger">{errorMessage(mine.error)}</p>
            ) : (
              CONTACT_CHANNELS.map((c) => {
                const set = isSet(c);
                const id = `accept-channel-${c}`;
                return (
                  <div key={c} className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5">
                    <Checkbox
                      id={id}
                      checked={channels.includes(c)}
                      disabled={!set}
                      onCheckedChange={(v) => setChannels((cur) => (v === true ? [...new Set([...cur, c])] : cur.filter((x) => x !== c)))}
                      data-testid={`accept-channel-${c.toLowerCase()}`}
                    />
                    <Label htmlFor={id} className={set ? "flex-1 cursor-pointer" : "flex-1 text-muted-foreground"}>
                      {CHANNEL_LABEL[c]}
                    </Label>
                    {set ? (
                      <span className="text-xs text-success-soft-foreground">Set</span>
                    ) : (
                      <span className="text-xs text-subtle-foreground">
                        Not set,{" "}
                        <Link href="/profile/setup" className="font-medium text-link hover:underline">
                          add it
                        </Link>
                      </span>
                    )}
                  </div>
                );
              })
            )}
            {none ? <p className="text-sm text-warning-soft-foreground">Add at least one contact channel to your profile before accepting.</p> : null}
          </fieldset>
          <div className="flex gap-3 rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <p>
              Every time the recruiter opens your details it is logged, and you can see it under Contact access. You can revoke access at any time; the conversation stays.
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!channels.length}
            data-testid="approach-accept-confirm"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onAccept(channels);
                onOpenChange(false);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Lock /> Accept and share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeclineApproachDialog({
  approach,
  open,
  onOpenChange,
  onDecline,
}: {
  approach: Approach;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDecline: (reason: string | null) => Promise<unknown>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="md" data-testid="approach-decline-dialog">
        <DialogHeader>
          <DialogTitle>Decline this approach?</DialogTitle>
          <DialogDescription>
            {approach.recruiter.displayName} will be told you declined. They can not approach you again until the cooldown this network sets has passed. Your contact details stay private.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-1.5">
          <Label htmlFor="decline-reason" className="flex items-center gap-1.5">
            Reason <span className="text-xs font-normal text-subtle-foreground">Optional, shared with the recruiter</span>
          </Label>
          <Textarea
            id="decline-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            placeholder="For example: not looking for contract roles right now."
            rows={3}
            data-testid="approach-decline-reason"
          />
          <p className="text-right text-xs text-subtle-foreground">{reason.length}/500</p>
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            data-testid="approach-decline-confirm"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onDecline(reason.trim() || null);
                onOpenChange(false);
                setReason("");
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Decline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
