"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { isApiError, type SectionItems } from "@open-talent/api-client";
import { AlertCircle, ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, IconButton, cn, toast } from "@open-talent/ui";
import type { Profile, ProfileSection } from "@open-talent/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { SECTION_ITEM, SECTION_LABEL, SECTION_LIMIT, blankItem, cleanInput, itemTitle, sectionInputs, validateItem } from "./profile-utils";
import { CertificationForm, EducationForm, ExperienceForm, LinkForm, ProjectForm, SkillRow } from "./section-forms";
import { useApplyMine } from "./use-profile";

type AnyItem = SectionItems[ProfileSection][number];
interface Row {
  key: string;
  data: AnyItem;
}

let seq = 0;
const newKey = () => `row${++seq}`;

const HINT: Record<ProfileSection, string> = {
  experience: "Most recent first. Use the arrows to set the order people see.",
  education: "Degrees, bootcamps and courses.",
  projects: "Things you built, with links people can open.",
  skills: "Endorsements stay with a skill as long as you keep its name.",
  certifications: "Add a credential link so it can be checked.",
  links: "Featured links are pinned near the top of your profile.",
};

/**
 * Edit a whole section as one list: add, edit, remove and reorder, then save the full
 * list in one request (the API replaces the section in order).
 */
export function SectionEditor({ profile, section, startWithNew, onClose }: { profile: Profile; section: ProfileSection; startWithNew?: boolean; onClose: () => void }) {
  const applyMine = useApplyMine();
  const initial = useMemo<Row[]>(() => (sectionInputs(profile, section) as AnyItem[]).map((data) => ({ key: newKey(), data })), [profile, section]);
  const [rows, setRows] = useState<Row[]>(() => {
    if (!startWithNew || initial.length >= SECTION_LIMIT[section]) return initial;
    return [...initial, { key: newKey(), data: blankItem(section) }];
  });
  const [expanded, setExpanded] = useState<string | null>(() => (startWithNew ? (rows[rows.length - 1]?.key ?? null) : null));
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const [confirmClose, setConfirmClose] = useState(false);
  const [covers, setCovers] = useState<Record<string, string | null>>(() => {
    const out: Record<string, string | null> = {};
    if (section === "projects") profile.projects.forEach((p, i) => (out[initial[i]!.key] = p.cover?.thumbUrl ?? p.cover?.url ?? null));
    return out;
  });
  const dirty = JSON.stringify(rows.map((r) => r.data)) !== JSON.stringify(initial.map((r) => r.data));
  const limit = SECTION_LIMIT[section];

  const save = useMutation({
    mutationFn: () => api().profiles.section(section, rows.map((r) => cleanInput(r.data)) as SectionItems[typeof section]),
    meta: { silent: true },
    onSuccess: (fresh) => {
      applyMine(fresh);
      toast.success({ title: `${SECTION_LABEL[section]} saved` });
      onClose();
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "VALIDATION_FAILED") {
        const next: Record<string, Record<string, string>> = {};
        for (const [path, msg] of Object.entries(e.fieldErrors)) {
          const m = /items\D*(\d+)\D+(\w+)/.exec(path);
          const row = m ? rows[Number(m[1])] : undefined;
          if (row && m) next[row.key] = { ...next[row.key], [m[2]!]: msg };
        }
        if (Object.keys(next).length) {
          setErrors(next);
          setExpanded(Object.keys(next)[0]!);
        }
      }
      toast.error({ title: "Could not save", description: errorMessage(e) });
    },
  });

  const patch = (key: string, p: Partial<AnyItem>) => {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, data: { ...r.data, ...p } as AnyItem } : r)));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: Object.fromEntries(Object.entries(e[key] ?? {}).filter(([k]) => !(k in p))) }));
  };
  const move = (i: number, d: -1 | 1) =>
    setRows((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const add = () => {
    const row = { key: newKey(), data: blankItem(section) };
    setRows((list) => [...list, row]);
    setExpanded(row.key);
  };
  const submit = () => {
    const all: Record<string, Record<string, string>> = {};
    for (const r of rows) {
      const e = validateItem(section, r.data as unknown as Record<string, unknown>);
      if (Object.keys(e).length) all[r.key] = e;
    }
    setErrors(all);
    const first = rows.find((r) => all[r.key]);
    if (first) {
      setExpanded(first.key);
      return;
    }
    save.mutate();
  };
  const requestClose = () => {
    if (save.isPending) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  const form = (r: Row) => {
    const props = { uid: r.key, errors: errors[r.key] ?? {}, onChange: (p: Partial<AnyItem>) => patch(r.key, p) };
    switch (section) {
      case "experience":
        return <ExperienceForm {...props} value={r.data as SectionItems["experience"][number]} />;
      case "education":
        return <EducationForm {...props} value={r.data as SectionItems["education"][number]} />;
      case "projects":
        return (
          <ProjectForm
            {...props}
            value={r.data as SectionItems["projects"][number]}
            coverUrl={covers[r.key] ?? null}
            onCover={(id, url) => {
              patch(r.key, { coverUploadId: id });
              setCovers((c) => ({ ...c, [r.key]: url }));
            }}
          />
        );
      case "certifications":
        return <CertificationForm {...props} value={r.data as SectionItems["certifications"][number]} />;
      case "links":
        return <LinkForm {...props} value={r.data as SectionItems["links"][number]} />;
      default:
        return null;
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && requestClose()}>
        <DialogContent size="lg" data-testid={`section-editor-${section}`} onEscapeKeyDown={(e) => dirty && (e.preventDefault(), requestClose())} onInteractOutside={(e) => dirty && (e.preventDefault(), requestClose())}>
          <DialogHeader>
            <DialogTitle>Edit {SECTION_LABEL[section].toLowerCase()}</DialogTitle>
            <DialogDescription>{HINT[section]}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            {!rows.length ? <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Nothing here yet.</p> : null}
            {section === "skills" ? (
              <ul className="space-y-2">
                {rows.map((r, i) => (
                  <li key={r.key} className="flex items-start gap-1">
                    <SkillRow {...{ uid: r.key, errors: errors[r.key] ?? {}, onChange: (p) => patch(r.key, p) }} value={r.data as SectionItems["skills"][number]} />
                    <ReorderControls i={i} n={rows.length} move={move} onRemove={() => setRows((list) => list.filter((x) => x.key !== r.key))} label={itemTitle(section, r.data as never).title} />
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="space-y-2">
                {rows.map((r, i) => {
                  const t = itemTitle(section, r.data as never);
                  const open = expanded === r.key;
                  const hasErr = !!errors[r.key] && Object.keys(errors[r.key]!).length > 0;
                  return (
                    <li key={r.key} className={cn("rounded-lg border", hasErr ? "border-danger" : "border-border")} data-testid="editor-item">
                      <div className="flex items-center gap-1 py-1 pl-3 pr-1">
                        <button type="button" onClick={() => setExpanded(open ? null : r.key)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 text-left focus-visible:ring-2" aria-expanded={open}>
                          {hasErr ? <AlertCircle className="size-4 shrink-0 text-danger" aria-label="Needs attention" /> : null}
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-foreground">{t.title}</span>
                            {t.sub ? <span className="block truncate text-xs text-subtle-foreground">{t.sub}</span> : null}
                          </span>
                          <ChevronDown className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
                        </button>
                        <ReorderControls i={i} n={rows.length} move={move} onRemove={() => setRows((list) => list.filter((x) => x.key !== r.key))} label={t.title} />
                      </div>
                      {open ? <div className="border-t border-border px-3 py-4">{form(r)}</div> : null}
                    </li>
                  );
                })}
              </ul>
            )}
            <Button variant="outline" onClick={add} disabled={rows.length >= limit} className="w-full" data-testid="editor-add">
              <Plus /> {rows.length >= limit ? `Up to ${limit}` : `Add ${SECTION_ITEM[section]}`}
            </Button>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={requestClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button onClick={submit} loading={save.isPending} disabled={!dirty} data-testid="editor-save">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Discard your changes?"
        description="You have edits that are not saved yet."
        confirmLabel="Discard"
        destructive
        onConfirm={onClose}
      />
    </>
  );
}

function ReorderControls({ i, n, move, onRemove, label }: { i: number; n: number; move: (i: number, d: -1 | 1) => void; onRemove: () => void; label: string }) {
  return (
    <span className="flex shrink-0 items-center">
      <IconButton size="sm" label={`Move ${label} up`} onClick={() => move(i, -1)} disabled={i === 0}>
        <ArrowUp />
      </IconButton>
      <IconButton size="sm" label={`Move ${label} down`} onClick={() => move(i, 1)} disabled={i === n - 1}>
        <ArrowDown />
      </IconButton>
      <IconButton size="sm" label={`Remove ${label}`} onClick={onRemove} className="hover:text-danger">
        <Trash2 />
      </IconButton>
    </span>
  );
}
