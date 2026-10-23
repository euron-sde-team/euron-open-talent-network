"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Select, Skeleton, Textarea, toast } from "@open-talent/ui";
import { useMe } from "@/lib/auth";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useOpenJobs } from "../use-recruiter";

export function InviteDialog({ open, onOpenChange, username, name }: { open: boolean; onOpenChange: (o: boolean) => void; username: string; name: string }) {
  const me = useMe();
  const jobs = useOpenJobs(me.recruiter?.company.slug);
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState("");
  const send = useMutation({
    mutationFn: () => api().jobs.invite(jobId!, username, message.trim() || null),
    meta: { silent: true },
    onSuccess: () => {
      toast.success({ title: `Invitation sent to ${name}` });
      onOpenChange(false);
    },
  });
  const items = jobs.data?.items ?? [];
  return (
    <Dialog open={open} onOpenChange={(o) => !send.isPending && onOpenChange(o)}>
      <DialogContent size="sm" data-testid="invite-dialog">
        <DialogHeader>
          <DialogTitle>Invite {name} to apply</DialogTitle>
          <DialogDescription>They get a notification with the job and can apply in one step. Their contact details stay private.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {jobs.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : !items.length ? (
            <p className="rounded-md bg-muted px-3 py-3 text-sm text-muted-foreground">
              You have no open jobs.{" "}
              <Link href="/recruiter/jobs/new" className="font-semibold text-link hover:underline">
                Post one
              </Link>{" "}
              to invite people to it.
            </p>
          ) : (
            <Field label="Job" htmlFor="invite-job">
              <Select id="invite-job" value={jobId} onValueChange={setJobId} placeholder="Choose an open job" options={items.map((j) => ({ value: j.id, label: j.title }))} data-testid="invite-job" />
            </Field>
          )}
          <Field label="Message" htmlFor="invite-msg" optional>
            <Textarea id="invite-msg" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Why you think they would be a great fit" />
          </Field>
          {send.error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {errorMessage(send.error)}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={send.isPending}>
            Cancel
          </Button>
          <Button onClick={() => send.mutate()} disabled={!jobId} loading={send.isPending} data-testid="invite-send">
            Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
