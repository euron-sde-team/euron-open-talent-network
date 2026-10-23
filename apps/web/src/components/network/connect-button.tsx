"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, MessageSquareText, UserPlus } from "lucide-react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  toast,
  type ButtonProps,
} from "@open-talent/ui";
import type { ConnectionState, UserSummary } from "@open-talent/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useOpenConversation } from "@/lib/hooks/use-open-conversation";
import { qk } from "@/lib/query-keys";

const NOTE_MAX = 300;

/** Refresh everything that shows a connection state after one changes. */
export function useInvalidateNetwork() {
  const qc = useQueryClient();
  return (username?: string) => {
    for (const key of [qk.connections, qk.invitationsAll, qk.suggestions, qk.counts, qk.me])
      void qc.invalidateQueries({ queryKey: key });
    if (username) void qc.invalidateQueries({ queryKey: qk.profile(username) });
  };
}

/**
 * The one Connect control: Connect (with an optional note), Pending (withdraw),
 * Accept, or Message once connected. Local state carries the result so cards
 * update instantly; the lists refetch in the background.
 */
export function ConnectButton({
  user,
  state,
  connectionId,
  size = "sm",
  block,
  withNote = true,
  messageWhenConnected = true,
}: {
  user: Pick<UserSummary, "id" | "username" | "displayName">;
  state: ConnectionState;
  connectionId: string | null;
  size?: ButtonProps["size"];
  block?: boolean;
  withNote?: boolean;
  messageWhenConnected?: boolean;
}) {
  const { status } = useAuth();
  const [local, setLocal] = useState<{ state: ConnectionState; connectionId: string | null }>({
    state,
    connectionId,
  });
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const invalidate = useInvalidateNetwork();
  const openConversation = useOpenConversation();

  const connect = useMutation({
    mutationFn: (n: string | null) => api().network.connect(user.id, n),
    onSuccess: (r) => {
      setLocal({ state: r.state, connectionId: r.connectionId });
      setNoteOpen(false);
      toast.success({
        title:
          r.state === "CONNECTED"
            ? `You and ${user.displayName} are now connected`
            : "Invitation sent",
      });
      invalidate(user.username);
    },
    onError: (e) =>
      toast.error({ title: "Could not send the invitation", description: errorMessage(e) }),
  });
  const withdraw = useMutation({
    mutationFn: () => api().network.withdraw(local.connectionId!),
    onSuccess: () => {
      setLocal({ state: "NONE", connectionId: null });
      invalidate(user.username);
    },
    onError: (e) => toast.error({ title: "Could not withdraw", description: errorMessage(e) }),
  });
  const accept = useMutation({
    mutationFn: () => api().network.accept(local.connectionId!),
    onSuccess: () => {
      setLocal({ state: "CONNECTED", connectionId: null });
      invalidate(user.username);
    },
    onError: (e) => toast.error({ title: "Could not accept", description: errorMessage(e) }),
  });

  if (status !== "signed-in" || local.state === "SELF") return null;
  const busy = connect.isPending || withdraw.isPending || accept.isPending;

  if (local.state === "CONNECTED") {
    if (!messageWhenConnected)
      return (
        <Button size={size} variant="secondary" block={block} disabled>
          <Check /> Connected
        </Button>
      );
    return (
      <Button
        size={size}
        variant="outline"
        block={block}
        onClick={() => openConversation.mutate(user)}
        disabled={openConversation.isPending}
        data-testid="message-button"
      >
        <MessageSquareText /> Message
      </Button>
    );
  }
  if (local.state === "PENDING_OUTGOING")
    return (
      <Button
        size={size}
        variant="outline"
        block={block}
        onClick={() => withdraw.mutate()}
        disabled={busy || !local.connectionId}
        data-testid="connect-pending"
        title="Withdraw invitation"
      >
        <Clock /> Pending
      </Button>
    );
  if (local.state === "PENDING_INCOMING")
    return (
      <Button
        size={size}
        block={block}
        onClick={() => accept.mutate()}
        disabled={busy || !local.connectionId}
        data-testid="connect-accept"
      >
        <Check /> Accept
      </Button>
    );

  return (
    <>
      <Button
        size={size}
        variant="outline"
        block={block}
        onClick={() => (withNote ? setNoteOpen(true) : connect.mutate(null))}
        disabled={busy}
        data-testid="connect-button"
      >
        <UserPlus /> Connect
      </Button>
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Invite {user.displayName} to connect</DialogTitle>
            <DialogDescription>
              A short note about how you know each other makes an invitation far more likely to be
              accepted.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
              placeholder="We worked together on..."
              rows={4}
              aria-label="Note"
              data-testid="connect-note"
            />
            <p className="text-right text-xs text-subtle-foreground">
              {note.length}/{NOTE_MAX}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => connect.mutate(null)} disabled={busy}>
              Send without a note
            </Button>
            <Button
              onClick={() => connect.mutate(note.trim() || null)}
              disabled={busy || !note.trim()}
              data-testid="connect-send"
            >
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
