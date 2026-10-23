"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Download, Trash2 } from "lucide-react";
import { isApiError } from "@open-talent/api-client";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, toast } from "@open-talent/ui";
import { exportErrorMessage, ownedCompany } from "@/lib/account";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { exportFileName, saveBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { PasswordInput } from "@/components/auth/password-input";
import { FormAlert } from "@/components/auth/auth-shell";
import { SettingsCard } from "./section";

export function AccountSection() {
  const me = useMe();
  const [deleting, setDeleting] = useState(false);
  const download = useMutation({
    mutationFn: () => api().users.exportData(),
    meta: { silent: true },
    onSuccess: (blob) => saveBlob(blob, exportFileName(me.username)),
    onError: (e) => toast.error({ title: exportErrorMessage(e, errorMessage) }),
  });
  return (
    <div className="space-y-4">
      <SettingsCard
        title="Download your data"
        description="A JSON file with the information your account holds on this network."
        footer={
          <Button variant="outline" onClick={() => download.mutate()} loading={download.isPending} data-testid="export-data">
            <Download /> Download your data
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">You can export 3 times a day.</p>
      </SettingsCard>
      <SettingsCard
        title="Delete account"
        description="Permanently delete your account and your talent page. This can not be undone."
        footer={
          <Button variant="danger" onClick={() => setDeleting(true)} data-testid="delete-account">
            <Trash2 /> Delete account
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">If you are the only owner of a company page, make a teammate an owner first.</p>
      </SettingsCard>
      {deleting ? <DeleteAccountDialog onClose={() => setDeleting(false)} /> : null}
    </div>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const { logout } = useAuth();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [owned, setOwned] = useState<{ name: string; slug: string } | null>(null);
  const ready = typed.trim() === me.username && !!password && (!me.totpEnabled || totp.length === 6);
  const del = useMutation({
    mutationFn: () => api().users.deleteMe({ password, ...(me.totpEnabled ? { totp } : {}) }),
    meta: { silent: true },
    onSuccess: async () => {
      await logout({ silent: true });
      router.replace("/goodbye");
    },
    onError: (e) => {
      const company = ownedCompany(e);
      if (company) {
        setOwned(company);
        setError(null);
        return;
      }
      setOwned(null);
      if (isApiError(e) && e.code === "INVALID_CREDENTIALS") setError("That password is not right.");
      else if (isApiError(e) && e.code === "INVALID_TOTP") setError("That code did not match. Codes change every 30 seconds.");
      else setError(errorMessage(e));
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <DialogContent size="sm" data-testid="delete-account-dialog">
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>Your talent page, applications and private data are deleted for good. Posts and messages stay, shown under &quot;Deleted user&quot;.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {owned ? (
            <FormAlert>
              Make another teammate an owner of{" "}
              {owned.slug ? (
                <Link href={`/company/${encodeURIComponent(owned.slug)}?tab=team`} className="font-semibold underline">
                  {owned.name}
                </Link>
              ) : (
                owned.name
              )}{" "}
              before deleting your account.
            </FormAlert>
          ) : null}
          {error ? <FormAlert>{error}</FormAlert> : null}
          <Field label={<>Type your username <span className="font-mono">{me.username}</span> to confirm</>} htmlFor="delete-confirm">
            <Input id="delete-confirm" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="delete-confirm-username" />
          </Field>
          <Field label="Password" htmlFor="delete-password">
            <PasswordInput id="delete-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {me.totpEnabled ? (
            <Field label="6 digit code from your app" htmlFor="delete-totp">
              <Input
                id="delete-totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="max-w-[160px] text-center tracking-[0.3em]"
                data-testid="delete-totp"
              />
            </Field>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => del.mutate()} disabled={!ready} loading={del.isPending} data-testid="delete-account-confirm">
            Delete account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
