"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Textarea, toast } from "@open-talent/ui";
import type { MyProfile } from "@open-talent/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useNetworkMeta } from "@/lib/meta";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { TagInput } from "./tag-input";
import { useApplyMine } from "./use-profile";

/** "Polish with AI": a suggestion the owner can take or leave; nothing is saved until they press Save. */
function PolishButton({ field, text, onSuggestion }: { field: "headline" | "about"; text: string; onSuggestion: (s: string) => void }) {
  const polish = useMutation({
    mutationFn: () => api().profiles.polish(field, text.trim()),
    meta: { silent: true },
    onSuccess: (r) => onSuggestion(r.text),
    onError: (e) => toast.error({ title: "No suggestion this time", description: errorMessage(e) }),
  });
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 px-2 text-primary-soft-foreground"
      onClick={() => polish.mutate()}
      loading={polish.isPending}
      disabled={text.trim().length < 3}
      title={text.trim().length < 3 ? "Write a draft first" : undefined}
      data-testid={`polish-${field}`}
    >
      <Sparkles /> AI polish
    </Button>
  );
}

function Suggestion({ text, onUse, onDismiss }: { text: string; onUse: () => void; onDismiss: () => void }) {
  return (
    <div className="rounded-md border border-primary/30 bg-primary-soft px-3 py-2 text-sm" data-testid="polish-suggestion">
      <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-primary-soft-foreground">
        <Sparkles className="size-3.5" /> Suggestion
      </p>
      <p className="whitespace-pre-wrap text-foreground">{text}</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={onUse}>
          Use this
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Keep mine
        </Button>
      </div>
    </div>
  );
}

export function BasicsEditor({ my, onClose, focus }: { my: MyProfile; onClose: () => void; focus?: "about" }) {
  const applyMine = useApplyMine();
  const polishOn = !!useNetworkMeta().data?.ai.polish;
  const start = {
    headline: my.headline ?? "",
    about: my.about ?? "",
    currentTitle: my.currentTitle ?? "",
    currentCompany: my.currentCompany ?? "",
    location: my.location ?? "",
    years: my.yearsExperience == null ? "" : String(my.yearsExperience),
    languages: my.languages,
  };
  const [f, setF] = useState(start);
  const [suggest, setSuggest] = useState<{ headline?: string; about?: string }>({});
  const [confirmClose, setConfirmClose] = useState(false);
  const set = (p: Partial<typeof f>) => setF((c) => ({ ...c, ...p }));
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const years = f.years.trim() === "" ? null : Number(f.years);
  const yearsError = years != null && (!Number.isInteger(years) || years < 0 || years > 70) ? "Use a whole number from 0 to 70" : undefined;
  const nn = (s: string) => (s.trim() ? s.trim() : null);

  const save = useMutation({
    mutationFn: () =>
      api().profiles.updateBasics({
        headline: nn(f.headline),
        about: nn(f.about),
        currentTitle: nn(f.currentTitle),
        currentCompany: nn(f.currentCompany),
        location: nn(f.location),
        yearsExperience: years,
        languages: f.languages,
      }),
    meta: { silent: true },
    onSuccess: (fresh) => {
      applyMine(fresh);
      toast.success({ title: "Profile updated" });
      onClose();
    },
    onError: (e) => toast.error({ title: "Could not save", description: errorMessage(e) }),
  });
  const requestClose = () => {
    if (save.isPending) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && requestClose()}>
        <DialogContent size="lg" data-testid="basics-editor" onInteractOutside={(e) => dirty && (e.preventDefault(), requestClose())}>
          <DialogHeader>
            <DialogTitle>Edit profile basics</DialogTitle>
            <DialogDescription>Everything here appears on your page. Change your photo and cover from the camera buttons, and your display name in settings.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="basics-headline" className="text-sm font-medium">
                  Headline
                </label>
                {polishOn ? <PolishButton field="headline" text={f.headline} onSuggestion={(s) => setSuggest((x) => ({ ...x, headline: s }))} /> : null}
              </div>
              <Input id="basics-headline" value={f.headline} maxLength={160} onChange={(e) => set({ headline: e.target.value })} placeholder="Staff Engineer, build and developer experience" autoFocus={focus !== "about"} data-testid="basics-headline" />
              <p className="text-xs text-subtle-foreground">{f.headline.length}/160. What you do and what you are known for, in one line.</p>
              {suggest.headline ? (
                <Suggestion
                  text={suggest.headline}
                  onUse={() => {
                    set({ headline: suggest.headline!.slice(0, 160) });
                    setSuggest((x) => ({ ...x, headline: undefined }));
                  }}
                  onDismiss={() => setSuggest((x) => ({ ...x, headline: undefined }))}
                />
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Current title" htmlFor="basics-title" optional>
                <Input id="basics-title" value={f.currentTitle} maxLength={120} onChange={(e) => set({ currentTitle: e.target.value })} />
              </Field>
              <Field label="Current company" htmlFor="basics-company" optional>
                <Input id="basics-company" value={f.currentCompany} maxLength={120} onChange={(e) => set({ currentCompany: e.target.value })} />
              </Field>
              <Field label="Location" htmlFor="basics-location" optional>
                <Input id="basics-location" value={f.location} maxLength={120} onChange={(e) => set({ location: e.target.value })} placeholder="City, country" />
              </Field>
              <Field label="Years of experience" htmlFor="basics-years" optional error={yearsError}>
                <Input id="basics-years" inputMode="numeric" value={f.years} onChange={(e) => set({ years: e.target.value.replace(/\D/g, "").slice(0, 2) })} aria-invalid={!!yearsError} />
              </Field>
            </div>
            <Field label="Languages" htmlFor="basics-languages" optional hint="Up to 15">
              <TagInput id="basics-languages" value={f.languages} onChange={(languages) => set({ languages })} max={15} maxLength={40} placeholder="English, Spanish" aria-label="Languages" />
            </Field>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="basics-about" className="text-sm font-medium">
                  About
                </label>
                {polishOn ? <PolishButton field="about" text={f.about} onSuggestion={(s) => setSuggest((x) => ({ ...x, about: s }))} /> : null}
              </div>
              <Textarea id="basics-about" rows={7} value={f.about} maxLength={4000} onChange={(e) => set({ about: e.target.value })} autoFocus={focus === "about"} data-testid="basics-about" />
              <p className="text-xs text-subtle-foreground">{f.about.length}/4000. What you do best, a result you are proud of, and what you want next.</p>
              {suggest.about ? (
                <Suggestion
                  text={suggest.about}
                  onUse={() => {
                    set({ about: suggest.about!.slice(0, 4000) });
                    setSuggest((x) => ({ ...x, about: undefined }));
                  }}
                  onDismiss={() => setSuggest((x) => ({ ...x, about: undefined }))}
                />
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={requestClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button onClick={() => !yearsError && save.mutate()} loading={save.isPending} disabled={!dirty || !!yearsError} data-testid="basics-save">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={confirmClose} onOpenChange={setConfirmClose} title="Discard your changes?" description="You have edits that are not saved yet." confirmLabel="Discard" destructive onConfirm={onClose} />
    </>
  );
}
