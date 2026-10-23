"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { useQueryClient, type InfiniteData, type QueryKey } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button, Card, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Skeleton, Textarea, cn } from "@open-talent/ui";
import type { Page, UserRole, UserStatus } from "@open-talent/types";

export const STATUS_TONE: Record<UserStatus, "success" | "warning" | "danger" | "neutral"> = {
  ACTIVE: "success",
  PENDING_VERIFICATION: "neutral",
  SUSPENDED: "warning",
  BANNED: "danger",
  DEACTIVATED: "neutral",
};
export const PROFILE_TONE = { PUBLISHED: "success", UNLISTED: "neutral", DRAFT: "neutral", SUSPENDED: "danger" } as const;
export const ROLE_LABEL: Record<UserRole, string> = { USER: "Member", MODERATOR: "Moderator", RECRUITER_OPS: "Recruiter ops", ADMIN: "Admin" };

type Pages<T> = InfiniteData<Page<T>, string | undefined>;

/**
 * Optimistic surgery on every cached page list under `prefix` (all filter variants).
 * `fn` returns the new row, or null to drop it from that list (the key is passed so a
 * caller can drop rows that no longer match a tab's status filter).
 */
export function useRowCache<T extends { id: string }>(prefix: QueryKey) {
  const qc = useQueryClient();
  const snapshot = () => qc.getQueriesData<Pages<T>>({ queryKey: prefix });
  return {
    snapshot,
    restore: (snap: ReturnType<typeof snapshot>) => {
      for (const [key, data] of snap) qc.setQueryData(key, data);
    },
    patch: (id: string, fn: (row: T, key: QueryKey) => T | null) => {
      void qc.cancelQueries({ queryKey: prefix });
      for (const [key, data] of snapshot()) {
        if (!data) continue;
        qc.setQueryData<Pages<T>>(key, {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.flatMap((row) => {
              if (row.id !== id) return [row];
              const next = fn(row, key);
              return next ? [next] : [];
            }),
          })),
        });
      }
    },
    invalidate: () => qc.invalidateQueries({ queryKey: prefix }),
  };
}

/** The filter object a page list was cached under (the second key element). */
export function filtersOf(key: QueryKey): Record<string, unknown> {
  const f = key[1];
  return f && typeof f === "object" ? (f as Record<string, unknown>) : {};
}

export function AreaHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Underlined status tabs that scroll sideways on narrow screens. */
export function FilterTabs<T extends string>({ value, onChange, options, label, testId }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; testId?: string }) {
  return (
    <div role="tablist" aria-label={label} className="-mx-1 mb-3 flex gap-1 overflow-x-auto border-b border-border px-1 [scrollbar-width:none]" data-testid={testId}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            data-testid={testId ? `${testId}-${o.value.toLowerCase()}` : undefined}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder, testId, className }: { value: string; onChange: (v: string) => void; placeholder: string; testId?: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="pl-9" data-testid={testId} />
    </div>
  );
}

export function ListSkeleton({ rows = 5, height = "h-16" }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-2 p-4" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={height} />
      ))}
    </div>
  );
}

/** A labelled fact in a row: small caption above a value. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-2xs font-semibold uppercase tracking-wide text-subtle-foreground">{label}</p>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

export function ForbiddenArea({ title = "You do not have access to this area", description = "Your role does not include it. Ask an administrator if you need access." }: { title?: string; description?: string }) {
  return (
    <Card className="mx-auto max-w-lg p-8 text-center" data-testid="admin-forbidden">
      <p className="text-sm font-semibold uppercase tracking-wide text-subtle-foreground">403</p>
      <p className="mt-1 text-lg font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </Card>
  );
}

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Reason field: required (default), optional, or hidden. */
  reason?: "required" | "optional" | "none";
  reasonLabel?: string;
  reasonHint?: string;
  /** Show a "days" input with this default. */
  days?: number;
  maxDays?: number;
  /** Ask the operator to type this text before the button enables (irreversible actions). */
  typeToConfirm?: string;
  /** Extra validation from fields passed as children. */
  canConfirm?: boolean;
  children?: ReactNode;
  onConfirm: (input: { reason: string; days: number }) => Promise<unknown>;
  testId?: string;
}

/** Every destructive or recorded action goes through this: a reason, optional days, a confirm. */
export function ReasonDialog(p: ReasonDialogProps) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(String(p.days ?? 7));
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (p.open) {
      setReason("");
      setTyped("");
      setDays(String(p.days ?? 7));
    }
  }, [p.open, p.days]);
  const mode = p.reason ?? "required";
  const dayCount = Number(days);
  const daysOk = p.days === undefined || (Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= (p.maxDays ?? 3650));
  const reasonOk = mode !== "required" || reason.trim().length >= 3;
  const typedOk = !p.typeToConfirm || typed.trim() === p.typeToConfirm;
  const ok = daysOk && reasonOk && typedOk && p.canConfirm !== false;
  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      await p.onConfirm({ reason: reason.trim(), days: dayCount });
      p.onOpenChange(false);
    } catch {
      /* the mutation cache toasts the error; keep the dialog and its input */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={p.open} onOpenChange={(o) => !busy && p.onOpenChange(o)}>
      <DialogContent size="sm" data-testid={p.testId ?? "reason-dialog"}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{p.title}</DialogTitle>
            {p.description ? <DialogDescription>{p.description}</DialogDescription> : null}
          </DialogHeader>
          <DialogBody className="space-y-4">
            {p.children}
            {p.days !== undefined ? (
              <Field label="Days" htmlFor={`${id}-days`} error={daysOk ? undefined : `Between 1 and ${p.maxDays ?? 3650} days.`}>
                <Input id={`${id}-days`} type="number" inputMode="numeric" min={1} max={p.maxDays ?? 3650} value={days} onChange={(e) => setDays(e.target.value)} className="w-28" data-testid="reason-days" />
              </Field>
            ) : null}
            {mode !== "none" ? (
              <Field label={p.reasonLabel ?? "Reason"} htmlFor={`${id}-reason`} optional={mode === "optional"} hint={p.reasonHint ?? "Recorded in the audit log."}>
                <Textarea id={`${id}-reason`} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="reason-input" />
              </Field>
            ) : null}
            {p.typeToConfirm ? (
              <Field label={<span>Type <code className="rounded bg-muted px-1 font-mono text-xs">{p.typeToConfirm}</code> to confirm</span>} htmlFor={`${id}-typed`}>
                <Input id={`${id}-typed`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="reason-typed" />
              </Field>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => p.onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant={p.destructive ? "danger" : "primary"} disabled={!ok} loading={busy} data-testid="reason-confirm">
              {p.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
