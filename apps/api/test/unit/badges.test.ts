import { describe, expect, test } from "vitest";
import { gateBadges, MAX_AI_BADGES, MIN_CONFIDENCE, seniorityBadge, type CandidateBadge } from "../../src/domain/badges";

const EVIDENCE = `Led the payments team at Fictional Systems.
Cut   checkout latency by 40% across three regions. Speaker at a local meetup.`;

const badge = (over: Partial<CandidateBadge> = {}): CandidateBadge => ({ kind: "ACHIEVEMENT", slug: "latency-cut", label: "Latency cutter", rationale: "Measured result", evidenceQuote: "cut checkout latency by 40%", confidence: 0.8, ...over });

describe("gateBadges", () => {
  test("the evidence quote must appear verbatim, ignoring case and runs of whitespace", () => {
    expect(gateBadges([badge()], EVIDENCE)).toHaveLength(1);
    expect(gateBadges([badge({ evidenceQuote: "CUT CHECKOUT\n latency  BY 40%" })], EVIDENCE)).toHaveLength(1);
  });

  test("a remembered award that is not in the evidence is dropped", () => {
    expect(gateBadges([badge({ evidenceQuote: "won the national coding award" })], EVIDENCE)).toEqual([]);
    expect(gateBadges([badge({ evidenceQuote: "cut checkout latency by 50%" })], EVIDENCE)).toEqual([]);
  });

  test("quotes shorter than three characters prove nothing", () => {
    expect(gateBadges([badge({ evidenceQuote: "40" })], EVIDENCE)).toEqual([]);
    expect(gateBadges([badge({ evidenceQuote: "   at  " })], EVIDENCE)).toEqual([]);
  });

  test("confidence at least 0.6", () => {
    expect(MIN_CONFIDENCE).toBe(0.6);
    expect(gateBadges([badge({ confidence: 0.6 })], EVIDENCE)).toHaveLength(1);
    expect(gateBadges([badge({ confidence: 0.59 })], EVIDENCE)).toEqual([]);
  });

  test("highest confidence first, one per slug, at most five", () => {
    const many = Array.from({ length: 8 }, (_, i) => badge({ slug: `b${i}`, confidence: 0.6 + i * 0.05 }));
    const out = gateBadges(many, EVIDENCE);
    expect(MAX_AI_BADGES).toBe(5);
    expect(out.map((b) => b.slug)).toEqual(["b7", "b6", "b5", "b4", "b3"]);
    const dupes = gateBadges([badge({ slug: "x", confidence: 0.7, label: "low" }), badge({ slug: "x", confidence: 0.9, label: "high" })], EVIDENCE);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]!.label).toBe("high");
  });

  test("does not mutate its input", () => {
    const input = [badge({ slug: "a", confidence: 0.7 }), badge({ slug: "b", confidence: 0.9 })];
    gateBadges(input, EVIDENCE);
    expect(input.map((b) => b.slug)).toEqual(["a", "b"]);
  });
});

describe("seniorityBadge", () => {
  test("none below three years or without dates", () => {
    expect(seniorityBadge(null)).toBeNull();
    expect(seniorityBadge(0)).toBeNull();
    expect(seniorityBadge(2)).toBeNull();
  });

  test("bands at 3, 5, 10 and 15 years", () => {
    const slug = (y: number) => seniorityBadge(y)?.slug;
    expect([3, 4, 5, 9, 10, 14, 15, 40].map(slug)).toEqual([
      "experience-3-plus",
      "experience-3-plus",
      "experience-5-plus",
      "experience-5-plus",
      "experience-10-plus",
      "experience-10-plus",
      "experience-15-plus",
      "experience-15-plus",
    ]);
  });

  test("label and rationale come from the dates", () => {
    expect(seniorityBadge(12)).toEqual({ slug: "experience-10-plus", label: "10+ years of experience", rationale: "Roles on this profile add up to about 12 years." });
  });
});
