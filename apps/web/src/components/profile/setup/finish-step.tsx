"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isApiError } from "@open-talent/api-client";
import { Globe, ShieldCheck } from "lucide-react";
import { Button, Card, Segmented, toast } from "@open-talent/ui";
import type { MyProfile, OpenToWorkMode } from "@open-talent/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { CompletenessMeter } from "@/components/shell/left-rail";
import { profileHref } from "@/components/common/user-bits";
import { ContactFields, PRIVACY_NOTE, contactErrors } from "../owner-panel";
import { TagInput } from "../tag-input";
import { useApplyMine } from "../use-profile";

/** Step 4: a private contact channel, the open-to-work signal, then publish. */
export function FinishStep({ my }: { my: MyProfile }) {
  const router = useRouter();
  const applyMine = useApplyMine();
  const [contact, setContact] = useState({ email: my.contact.email ?? "", phone: my.contact.phone ?? "", whatsapp: my.contact.whatsapp ?? "" });
  const [mode, setMode] = useState<OpenToWorkMode>(my.openToWorkMode === "OFF" ? "RECRUITERS" : my.openToWorkMode);
  const [roles, setRoles] = useState<string[]>(my.openToWorkSettings.roles.length ? my.openToWorkSettings.roles : my.currentTitle ? [my.currentTitle] : []);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<"publish" | "save" | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const errors = contactErrors(contact);
  const valid = !errors.email && !errors.phone && !errors.whatsapp;
  const hasContact = !!(contact.email.trim() || contact.phone || contact.whatsapp);

  const run = async (publish: boolean) => {
    setTouched(true);
    setBlocked(null);
    if (!valid) return;
    setBusy(publish ? "publish" : "save");
    try {
      let fresh = await api().profiles.contact({ email: contact.email.trim() || null, phone: contact.phone || null, whatsapp: contact.whatsapp || null });
      fresh = await api().profiles.openToWork({ ...my.openToWorkSettings, mode, roles });
      if (publish && fresh.status !== "PUBLISHED") fresh = await api().profiles.setStatus("PUBLISHED");
      applyMine(fresh);
      toast.success({ title: publish ? "Your profile is live" : "Saved", description: publish ? "People and recruiters can find you now." : undefined });
      router.push(profileHref(fresh.user.username));
    } catch (e) {
      if (isApiError(e) && e.code.startsWith("PUBLISH_")) {
        setBlocked(e.message);
        try {
          applyMine(await api().profiles.mine());
        } catch {
          /* keep what is on screen */
        }
      } else toast.error({ title: "Could not save", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="setup-finish">
      <Card className="p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <ShieldCheck className="size-5 text-primary" /> How recruiters reach you
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{PRIVACY_NOTE}</p>
        <div className="mt-4">
          <ContactFields value={contact} onChange={(p) => setContact((c) => ({ ...c, ...p }))} errors={touched ? errors : {}} />
        </div>
        {touched && !hasContact ? <p className="mt-2 text-sm text-warning-soft-foreground">Add at least one channel to publish.</p> : null}
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Open to work</h2>
        <p className="mt-1 text-sm text-muted-foreground">Recruiters search for people who are open. You can change this any time.</p>
        <div className="mt-4 space-y-4">
          <Segmented<OpenToWorkMode>
            value={mode}
            onChange={setMode}
            aria-label="Who sees it"
            options={[
              { value: "OFF", label: "Not looking" },
              { value: "RECRUITERS", label: "Recruiters only" },
              { value: "PUBLIC", label: "Everyone" },
            ]}
          />
          {mode !== "OFF" ? (
            <div className="space-y-1.5">
              <label htmlFor="finish-roles" className="text-sm font-medium">
                Roles you want
              </label>
              <TagInput id="finish-roles" value={roles} onChange={setRoles} max={5} maxLength={80} placeholder="Staff Engineer" aria-label="Roles you want" />
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Globe className="size-5 text-primary" /> Publish
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Profile strength <span className="font-semibold text-foreground">{Math.round(my.completeness)}%</span>, {my.publishThreshold}% needed.
        </p>
        <CompletenessMeter value={my.completeness} threshold={my.publishThreshold} className="mt-2 max-w-md" />
        {my.missing.length ? <p className="mt-2 text-xs text-subtle-foreground">Still open: {my.missing.join(", ")}.</p> : null}
        {blocked ? (
          <p role="alert" className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground" data-testid="publish-blocked">
            {blocked} Your contact and open-to-work settings were saved; finish the rest on your page.
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void run(true)} loading={busy === "publish"} disabled={!!busy} data-testid="setup-publish">
            <Globe /> Save and publish
          </Button>
          <Button variant="outline" onClick={() => void run(false)} loading={busy === "save"} disabled={!!busy} data-testid="setup-save-draft">
            Save and review my page first
          </Button>
          {blocked ? (
            <Button variant="ghost" onClick={() => router.push(profileHref(my.user.username))}>
              Go to my page
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
