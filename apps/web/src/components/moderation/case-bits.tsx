"use client";

import { Badge } from "@open-talent/ui";
import type { CaseSource, ModerationCase, ModerationTarget } from "@open-talent/types";
import { TARGET_LABEL, humanize } from "@/lib/moderation";

const SOURCE: Record<CaseSource, { label: string; tone: "primary" | "warning" | "neutral" }> = {
  AI: { label: "AI flag", tone: "primary" },
  REPORT: { label: "Reported", tone: "warning" },
  PREMODERATION: { label: "Pre-moderation", tone: "neutral" },
};

export function SourceBadge({ source }: { source: CaseSource }) {
  const s = SOURCE[source] ?? { label: source, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function TargetBadge({ type }: { type: ModerationTarget }) {
  return <Badge tone="neutral">{TARGET_LABEL[type] ?? humanize(type)}</Badge>;
}

const OK = new Set(["PUBLISHED", "ACTIVE", "VERIFIED", "UNVERIFIED", "UNLISTED", "PENDING", "ACCEPTED", "OPEN"]);
const HELD = new Set(["PENDING_REVIEW", "HIDDEN", "SUSPENDED", "DRAFT", "WITHDRAWN", "EXPIRED", "DECLINED"]);

/** The target's current status, raw (a profile's own status, an account's status, a post's content status). */
export function StatusBadge({ status }: { status: ModerationCase["targetStatus"] }) {
  if (!status) return null;
  const tone = OK.has(status) ? "success" : HELD.has(status) ? "warning" : "danger";
  return <Badge tone={tone}>Now {humanize(status).toLowerCase()}</Badge>;
}

export function Reasons({ reasons }: { reasons: ModerationCase["reasons"] }) {
  if (!reasons.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {reasons.map((r) => (
        <Badge key={r.reason} tone="outline">
          {humanize(r.reason)}
          {r.count > 1 ? ` x${r.count}` : ""}
        </Badge>
      ))}
    </span>
  );
}
