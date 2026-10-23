import { describe, expect, test } from "vitest";
import { PROFILE_SECTIONS } from "@open-talent/types";
import {
  canSeeSection,
  completeness,
  COMPLETENESS_WEIGHTS,
  displayRating,
  hiddenSections,
  publishBlock,
  RATING_PRIOR,
  RATING_PRIOR_WEIGHT,
  readAudience,
  showsOpenToWork,
  type CompletenessFacts,
  type ViewerRelation,
} from "../../src/domain/profile";

const none: CompletenessFacts = { headline: false, about: false, avatar: false, skills: false, experience: false, projects: false, education: false, links: false, contact: false };
const all: CompletenessFacts = Object.fromEntries(Object.keys(none).map((k) => [k, true])) as CompletenessFacts;

describe("completeness", () => {
  test("the weights sum to 100, one per fact", () => {
    expect(COMPLETENESS_WEIGHTS.reduce((a, w) => a + w.points, 0)).toBe(100);
    expect(COMPLETENESS_WEIGHTS.map((w) => w.key).sort()).toEqual(Object.keys(none).sort());
  });

  test("the exact weight of each fact", () => {
    const expected = { headline: 15, about: 15, avatar: 10, skills: 15, experience: 20, projects: 10, education: 5, links: 5, contact: 5 };
    for (const [key, points] of Object.entries(expected)) expect(completeness({ ...none, [key]: true }).score, key).toBe(points);
  });

  test("everything: 100 and nothing missing; nothing: 0 and every hint, in weight order", () => {
    expect(completeness(all)).toEqual({ score: 100, missing: [] });
    const empty = completeness(none);
    expect(empty.score).toBe(0);
    expect(empty.missing).toEqual(COMPLETENESS_WEIGHTS.map((w) => w.hint));
  });

  test("a typical first draft: headline, about and a role", () => {
    const r = completeness({ ...none, headline: true, about: true, experience: true });
    expect(r.score).toBe(50);
    expect(r.missing).toContain("Add a private contact channel");
    expect(r.missing).not.toContain("Add a headline");
  });
});

describe("publishBlock", () => {
  const T = 55;
  test("a suspended profile is blocked first, even when complete with contact", () => {
    expect(publishBlock({ status: "SUSPENDED", score: 100, hasContact: true }, T)).toBe("SUSPENDED");
  });

  test("below the threshold is INCOMPLETE; at the threshold is enough", () => {
    expect(publishBlock({ status: "DRAFT", score: 54, hasContact: true }, T)).toBe("INCOMPLETE");
    expect(publishBlock({ status: "DRAFT", score: 55, hasContact: true }, T)).toBeNull();
  });

  test("incomplete is reported before missing contact", () => {
    expect(publishBlock({ status: "DRAFT", score: 10, hasContact: false }, T)).toBe("INCOMPLETE");
  });

  test("a complete profile still needs a private contact channel", () => {
    expect(publishBlock({ status: "DRAFT", score: 95, hasContact: false }, T)).toBe("NO_CONTACT");
    expect(publishBlock({ status: "UNLISTED", score: 95, hasContact: true }, T)).toBeNull();
  });

  test("the threshold is the network's setting", () => {
    expect(publishBlock({ status: "DRAFT", score: 30, hasContact: true }, 0)).toBeNull();
    expect(publishBlock({ status: "DRAFT", score: 99, hasContact: true }, 100)).toBe("INCOMPLETE");
  });
});

const anon: ViewerRelation = { isSelf: false, isStaff: false, connected: false, isRecruiter: false };
const VIEWERS: Record<string, ViewerRelation> = {
  anon,
  connection: { ...anon, connected: true },
  recruiter: { ...anon, isRecruiter: true },
  self: { ...anon, isSelf: true },
  staff: { ...anon, isStaff: true },
};

describe("section audiences", () => {
  test("readAudience: anything unknown is PUBLIC", () => {
    expect(readAudience({ experience: "CONNECTIONS" }, "experience")).toBe("CONNECTIONS");
    expect(readAudience({ experience: "RECRUITERS" }, "experience")).toBe("RECRUITERS");
    expect(readAudience({ experience: "PRIVATE" }, "experience")).toBe("PUBLIC");
    expect(readAudience({}, "skills")).toBe("PUBLIC");
    expect(readAudience(null, "skills")).toBe("PUBLIC");
    expect(readAudience("CONNECTIONS", "skills")).toBe("PUBLIC");
  });

  test("who sees what, for every audience and viewer", () => {
    const see: Record<string, Record<string, boolean>> = {
      PUBLIC: { anon: true, connection: true, recruiter: true, self: true, staff: true },
      CONNECTIONS: { anon: false, connection: true, recruiter: false, self: true, staff: true },
      RECRUITERS: { anon: false, connection: true, recruiter: true, self: true, staff: true },
    };
    for (const [audience, row] of Object.entries(see)) {
      for (const [viewer, expected] of Object.entries(row)) expect(canSeeSection(audience as "PUBLIC", VIEWERS[viewer]!), `${audience} ${viewer}`).toBe(expected);
    }
  });

  test("hiddenSections lists exactly the sections this viewer may not see", () => {
    const raw = { experience: "CONNECTIONS", education: "RECRUITERS", links: "PUBLIC" };
    expect(hiddenSections(raw, anon)).toEqual(["experience", "education"]);
    expect(hiddenSections(raw, VIEWERS.recruiter!)).toEqual(["experience"]);
    expect(hiddenSections(raw, VIEWERS.connection!)).toEqual([]);
    expect(hiddenSections(raw, VIEWERS.self!)).toEqual([]);
    expect(hiddenSections(Object.fromEntries(PROFILE_SECTIONS.map((s) => [s, "CONNECTIONS"])), anon)).toEqual([...PROFILE_SECTIONS]);
  });
});

describe("open to work signal", () => {
  test("OFF shows to nobody, not even the owner", () => {
    for (const v of Object.values(VIEWERS)) expect(showsOpenToWork("OFF", v)).toBe(false);
  });
  test("PUBLIC shows to everyone", () => {
    for (const v of Object.values(VIEWERS)) expect(showsOpenToWork("PUBLIC", v)).toBe(true);
  });
  test("RECRUITERS shows to recruiters, the owner and staff only (connections do not see it)", () => {
    expect(showsOpenToWork("RECRUITERS", anon)).toBe(false);
    expect(showsOpenToWork("RECRUITERS", VIEWERS.connection!)).toBe(false);
    expect(showsOpenToWork("RECRUITERS", VIEWERS.recruiter!)).toBe(true);
    expect(showsOpenToWork("RECRUITERS", VIEWERS.self!)).toBe(true);
    expect(showsOpenToWork("RECRUITERS", VIEWERS.staff!)).toBe(true);
  });
});

describe("displayRating (Bayesian)", () => {
  test("the prior is 4.0 worth three ratings", () => {
    expect(RATING_PRIOR).toBe(4);
    expect(RATING_PRIOR_WEIGHT).toBe(3);
  });

  test("no ratings: null", () => {
    expect(displayRating(null, 0)).toBeNull();
    expect(displayRating(4.5, 0)).toBeNull();
    expect(displayRating(null, 3)).toBeNull();
  });

  test("a single rating is pulled towards the prior", () => {
    expect(displayRating(5, 1)).toBe(4.3);
    expect(displayRating(1, 1)).toBe(3.3);
    expect(displayRating(4, 1)).toBe(4);
  });

  test("a long consistent record outranks one glowing review", () => {
    expect(displayRating(4.8, 10)).toBe(4.6);
    expect(displayRating(4.8, 10)!).toBeGreaterThan(displayRating(5, 1)!);
    expect(displayRating(5, 97)).toBe(5);
  });

  test("rounded to one decimal", () => {
    const r = displayRating(4.37, 7)!;
    expect(Math.round(r * 10)).toBe(r * 10);
  });
});
