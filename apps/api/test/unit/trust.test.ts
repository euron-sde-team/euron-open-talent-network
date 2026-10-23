import { describe, expect, test } from "vitest";
import { approachBlock, averageScore, ratingEditBlock, ratingWindowOpen, shouldReveal, type ApproachFacts } from "../../src/domain/trust";

const now = new Date("2026-06-15T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400_000);
const base: ApproachFacts = { recruiterUserId: "R", candidateId: "C", profileStatus: "PUBLISHED", blocked: false, pending: false, lastDeclinedAt: null, sentToday: 0, quota: 25, cooldownDays: 30, now };
const block = (over: Partial<ApproachFacts>) => approachBlock({ ...base, ...over });

describe("approachBlock", () => {
  test("a published profile with nothing in the way: no block", () => {
    expect(block({})).toEqual({ block: null, cooldownUntil: null });
  });

  test("an unlisted profile can be approached through its direct link", () => {
    expect(block({ profileStatus: "UNLISTED" }).block).toBeNull();
  });

  test("draft and suspended profiles are not open to approaches", () => {
    expect(block({ profileStatus: "DRAFT" }).block).toBe("NOT_PUBLISHED");
    expect(block({ profileStatus: "SUSPENDED" }).block).toBe("NOT_PUBLISHED");
  });

  test("yourself first, then a block, then visibility, then pending, cooldown and quota", () => {
    expect(block({ candidateId: "R", blocked: true, profileStatus: "DRAFT" }).block).toBe("SELF");
    expect(block({ blocked: true, profileStatus: "DRAFT", pending: true, sentToday: 99 }).block).toBe("BLOCKED");
    expect(block({ profileStatus: "DRAFT", pending: true }).block).toBe("NOT_PUBLISHED");
    expect(block({ pending: true, lastDeclinedAt: daysAgo(1), sentToday: 99 }).block).toBe("ALREADY_PENDING");
    expect(block({ lastDeclinedAt: daysAgo(1), sentToday: 99 }).block).toBe("COOLDOWN");
    expect(block({ sentToday: 99 }).block).toBe("QUOTA");
  });

  test("after a decline the recruiter waits cooldownDays and is told until when", () => {
    const declined = daysAgo(10);
    expect(block({ lastDeclinedAt: declined })).toEqual({ block: "COOLDOWN", cooldownUntil: new Date(declined.getTime() + 30 * 86400_000) });
    expect(block({ lastDeclinedAt: daysAgo(31) }).block).toBeNull();
    expect(block({ lastDeclinedAt: daysAgo(30) }).block).toBeNull();
    expect(block({ lastDeclinedAt: daysAgo(1), cooldownDays: 0 }).block).toBeNull();
  });

  test("the daily quota: at the limit is blocked, a quota of zero blocks everything", () => {
    expect(block({ sentToday: 24 }).block).toBeNull();
    expect(block({ sentToday: 25 }).block).toBe("QUOTA");
    expect(block({ sentToday: 0, quota: 0 }).block).toBe("QUOTA");
  });
});

describe("ratings", () => {
  test("editable once before reveal, never after", () => {
    expect(ratingEditBlock({ revealedAt: null, editedAt: null })).toBeNull();
    expect(ratingEditBlock({ revealedAt: null, editedAt: now })).toBe("ALREADY_EDITED");
    expect(ratingEditBlock({ revealedAt: now, editedAt: null })).toBe("REVEALED");
    expect(ratingEditBlock({ revealedAt: now, editedAt: now })).toBe("REVEALED");
  });

  test("the rating window runs from completion for windowDays, inclusive", () => {
    expect(ratingWindowOpen(null, 60, now)).toBe(false);
    expect(ratingWindowOpen(daysAgo(0), 60, now)).toBe(true);
    expect(ratingWindowOpen(daysAgo(60), 60, now)).toBe(true);
    expect(ratingWindowOpen(daysAgo(60.01), 60, now)).toBe(false);
  });

  test("reveal when both sides have rated or the window has closed, not before", () => {
    expect(shouldReveal({ ratingsIn: 2, completedAt: daysAgo(1), windowDays: 60, now })).toBe(true);
    expect(shouldReveal({ ratingsIn: 1, completedAt: daysAgo(1), windowDays: 60, now })).toBe(false);
    expect(shouldReveal({ ratingsIn: 1, completedAt: daysAgo(61), windowDays: 60, now })).toBe(true);
    expect(shouldReveal({ ratingsIn: 0, completedAt: daysAgo(61), windowDays: 60, now })).toBe(true);
    expect(shouldReveal({ ratingsIn: 0, completedAt: null, windowDays: 60, now })).toBe(false);
  });

  test("averageScore: two decimals, null when empty", () => {
    expect(averageScore([])).toBeNull();
    expect(averageScore([5])).toBe(5);
    expect(averageScore([5, 4, 4])).toBe(4.33);
    expect(averageScore([1, 2])).toBe(1.5);
  });
});
