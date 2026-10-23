import { describe, expect, it } from "vitest";
import type { ModerationCase } from "@open-talent/types";
import { availableActions, canAppeal, caseSnippet, contentStatus, severity, sortedScores, targetHref } from "@/lib/moderation";

const author = { id: "u1", username: "a", displayName: "A", avatarUrl: null, headline: null, role: "USER" as const, openToWork: false, recruiterAt: null };
const base: Pick<ModerationCase, "status" | "targetType" | "targetStatus" | "author"> = { status: "OPEN", targetType: "POST", targetStatus: "PUBLISHED", author };
const mod = { isStaff: true, isAdmin: false };
const admin = { isStaff: true, isAdmin: true };

describe("availableActions", () => {
  it("offers nothing to non-staff or on resolved cases", () => {
    expect(availableActions(base, { isStaff: false, isAdmin: false })).toEqual([]);
    expect(availableActions({ ...base, status: "RESOLVED" }, admin)).toEqual([]);
  });
  it("gives moderators content and account actions, admins also ban", () => {
    expect(availableActions(base, mod)).toEqual(["HIDE", "REMOVE", "DISMISS", "WARN", "SUSPEND"]);
    expect(availableActions(base, admin)).toEqual(["HIDE", "REMOVE", "DISMISS", "WARN", "SUSPEND", "BAN"]);
  });
  it("offers approve for pre-moderated content and restore for hidden content", () => {
    expect(availableActions({ ...base, targetStatus: "PENDING_REVIEW", author: null }, mod)).toEqual(["APPROVE", "HIDE", "REMOVE", "DISMISS"]);
    expect(availableActions({ ...base, targetStatus: "HIDDEN", author: null }, mod)).toEqual(["REMOVE", "RESTORE", "DISMISS"]);
  });
  it("maps profiles, companies and approaches to their own statuses", () => {
    expect(availableActions({ ...base, targetType: "PROFILE", targetStatus: "SUSPENDED", author: null }, mod)).toEqual(["RESTORE", "DISMISS"]);
    expect(availableActions({ ...base, targetType: "COMPANY", targetStatus: "VERIFIED", author: null }, mod)).toEqual(["HIDE", "DISMISS"]);
    expect(availableActions({ ...base, targetType: "APPROACH", targetStatus: "ACCEPTED", author: null }, mod)).toEqual(["DISMISS"]);
    expect(availableActions({ ...base, targetType: "APPROACH", targetStatus: "PENDING", author: null }, mod)).toEqual(["HIDE", "DISMISS"]);
  });
  it("treats user cases as account-only and offers unban for banned accounts", () => {
    expect(availableActions({ ...base, targetType: "USER", targetStatus: "ACTIVE" }, mod)).toEqual(["DISMISS", "WARN", "SUSPEND"]);
    expect(availableActions({ ...base, targetType: "USER", targetStatus: "BANNED" }, admin)).toEqual(["DISMISS", "WARN", "SUSPEND", "UNBAN"]);
  });
});

describe("targets", () => {
  it("normalises statuses", () => {
    expect(contentStatus("PROFILE", "UNLISTED")).toBe("PUBLISHED");
    expect(contentStatus("APPROACH", "WITHDRAWN")).toBe("HIDDEN");
    expect(contentStatus("POST", "REMOVED")).toBe("REMOVED");
  });
  it("links targets that have a page", () => {
    expect(targetHref({ targetType: "POST", targetId: "p1", author })).toBe("/posts/p1");
    expect(targetHref({ targetType: "JOB", targetId: "j1", author })).toBe("/jobs?job=j1");
    expect(targetHref({ targetType: "PROFILE", targetId: "x", author })).toBe("/in/a");
    expect(targetHref({ targetType: "DM_MESSAGE", targetId: "m", author })).toBeNull();
  });
});

describe("scores and snippets", () => {
  it("buckets severity", () => {
    expect([severity(0.1), severity(0.5), severity(0.79), severity(0.8)]).toEqual(["low", "medium", "medium", "high"]);
  });
  it("sorts categories by score and drops junk", () => {
    expect(sortedScores({ spam: 0.2, hate: 0.9, bad: Number.NaN })).toEqual([["hate", 0.9], ["spam", 0.2]]);
    expect(sortedScores(null)).toEqual([]);
  });
  it("prefers title, then body, then media count", () => {
    expect(caseSnippet({ targetType: "JOB", snapshot: { title: "T", body: "B" } })).toBe("T");
    expect(caseSnippet({ targetType: "POST", snapshot: { body: "x".repeat(200) } })).toHaveLength(140);
    expect(caseSnippet({ targetType: "POST", snapshot: { media: [{}, {}] as never } })).toBe("2 attachments");
    expect(caseSnippet({ targetType: "USER", snapshot: {} })).toBe("Account");
  });
});

describe("canAppeal", () => {
  const resolved = (resolution: ModerationCase["resolution"]) => ({ status: "RESOLVED" as const, resolution, targetStatus: "HIDDEN" as const, appeal: null });
  it("allows hide, remove, suspend and ban decisions", () => {
    for (const r of ["HIDE", "REMOVE", "SUSPEND", "BAN"] as const) expect(canAppeal(resolved(r))).toBe(true);
  });
  it("refuses warnings and no-action outcomes (the API answers NOT_APPEALABLE)", () => {
    for (const r of ["WARN", "APPROVE", "DISMISS", "RESTORE", null] as const) expect(canAppeal(resolved(r))).toBe(false);
  });
  it("allows an open case only while the content is auto-hidden", () => {
    expect(canAppeal({ status: "OPEN", resolution: null, targetStatus: "HIDDEN", appeal: null })).toBe(true);
    expect(canAppeal({ status: "OPEN", resolution: null, targetStatus: "PUBLISHED", appeal: null })).toBe(false);
  });
  it("allows one appeal only", () => {
    const appeal = { id: "a1", caseId: "c1", appellant: author, statement: "x", status: "PENDING" as const, decisionNote: null, decidedAt: null, createdAt: "2026-01-01T00:00:00.000Z" };
    expect(canAppeal({ ...resolved("REMOVE"), appeal })).toBe(false);
  });
});
