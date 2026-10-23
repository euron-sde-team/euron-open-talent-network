import { describe, expect, test } from "vitest";
import { adjustForContext, baselineVerdict, decideModeration, type ModerationContext, type Thresholds } from "../../src/domain/moderation-decision";

const T: Thresholds = { harassment: { review: 0.5, hide: 0.85 }, spam: { review: 0.6, hide: 0.9 }, hate: { review: 0.4, hide: 0.8 } };
const member: ModerationContext = { reportCount: 0, authorConnections: 10, authorAccountAgeDays: 100, authorIsStaff: false };

describe("baselineVerdict", () => {
  test("below every review threshold: CLEAN", () => {
    expect(baselineVerdict({ harassment: 0.49, spam: 0.1 }, T)).toEqual({ outcome: "CLEAN", categories: [], priority: 0 });
    expect(baselineVerdict({}, T)).toEqual({ outcome: "CLEAN", categories: [], priority: 0 });
  });

  test("at the review threshold: REVIEW, priority is the top score in percent", () => {
    expect(baselineVerdict({ harassment: 0.5 }, T)).toEqual({ outcome: "REVIEW", categories: ["harassment"], priority: 50 });
    expect(baselineVerdict({ harassment: 0.55, spam: 0.7 }, T)).toEqual({ outcome: "REVIEW", categories: ["harassment", "spam"], priority: 70 });
  });

  test("at the hide threshold: HIDE, listing hide categories first then review ones", () => {
    expect(baselineVerdict({ spam: 0.7, hate: 0.81 }, T)).toEqual({ outcome: "HIDE", categories: ["hate", "spam"], priority: 81 });
    expect(baselineVerdict({ harassment: 0.85 }, T)).toMatchObject({ outcome: "HIDE", priority: 85 });
  });

  test("categories without a threshold and non-finite scores are ignored", () => {
    expect(baselineVerdict({ violence: 0.99, harassment: Number.NaN, spam: Number.POSITIVE_INFINITY }, T)).toEqual({ outcome: "CLEAN", categories: [], priority: 0 });
  });
});

describe("decideModeration and context", () => {
  test("member content follows the thresholds", () => {
    expect(decideModeration({ hate: 0.95 }, T, member).outcome).toBe("HIDE");
  });

  test("staff content never auto-hides: HIDE becomes REVIEW, categories and priority kept", () => {
    expect(decideModeration({ hate: 0.95 }, T, { ...member, authorIsStaff: true })).toEqual({ outcome: "REVIEW", categories: ["hate"], priority: 95 });
    expect(decideModeration({ harassment: 0.6 }, T, { ...member, authorIsStaff: true })).toEqual({ outcome: "REVIEW", categories: ["harassment"], priority: 60 });
    expect(decideModeration({}, T, { ...member, authorIsStaff: true }).outcome).toBe("CLEAN");
  });

  test("other context does not change a verdict today", () => {
    const v = baselineVerdict({ harassment: 0.6 }, T);
    expect(adjustForContext(v, { reportCount: 50, authorConnections: 0, authorAccountAgeDays: 0, authorIsStaff: false })).toEqual(v);
  });
});
