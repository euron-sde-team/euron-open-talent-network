import { describe, expect, test } from "vitest";
import { APPLICATION_STAGES, type ApplicationStage } from "@open-talent/types";
import { canMoveStage, matchScore, OPEN_STAGES, STAGE_COPY } from "../../src/domain/pipeline";

/**
 * The full transition table, written out. Rows are the current stage, columns the target,
 * in APPLICATION_STAGES order: APPLIED SCREENING INTERVIEW OFFER HIRED REJECTED WITHDRAWN.
 *   A allowed, S SAME_STAGE, F STAGE_FINAL, N STAGE_NOT_ALLOWED, R REASON_REQUIRED
 */
const TEAM_NO_REASON: Record<ApplicationStage, string> = {
  APPLIED: "S A A A A R N",
  SCREENING: "A S A A A R N",
  INTERVIEW: "A A S A A R N",
  OFFER: "A A A S A R N",
  HIRED: "F F F F S F F",
  REJECTED: "N A N N N S N",
  WITHDRAWN: "F F F F F F S",
};
const TEAM_WITH_REASON: Record<ApplicationStage, string> = {
  APPLIED: "S A A A A A N",
  SCREENING: "A S A A A A N",
  INTERVIEW: "A A S A A A N",
  OFFER: "A A A S A A N",
  HIRED: "F F F F S F F",
  REJECTED: "N A N N N S N",
  WITHDRAWN: "F F F F F F S",
};
const CANDIDATE: Record<ApplicationStage, string> = {
  APPLIED: "S N N N N N A",
  SCREENING: "N S N N N N A",
  INTERVIEW: "N N S N N N A",
  OFFER: "N N N S N N A",
  HIRED: "F F F F S F F",
  REJECTED: "N N N N N S N",
  WITHDRAWN: "F F F F F F S",
};
const CODE: Record<string, string | null> = { A: null, S: "SAME_STAGE", F: "STAGE_FINAL", N: "STAGE_NOT_ALLOWED", R: "REASON_REQUIRED" };

function check(table: Record<ApplicationStage, string>, by: "TEAM" | "CANDIDATE", reason: string | null) {
  for (const from of APPLICATION_STAGES) {
    const row = table[from].split(" ");
    APPLICATION_STAGES.forEach((to, i) => {
      const want = CODE[row[i]!];
      const got = canMoveStage(from, to, by, { reason });
      expect(got, `${by} ${from} -> ${to}`).toEqual(want === null ? { allowed: true } : { allowed: false, code: want });
    });
  }
}

describe("canMoveStage: the full transition table", () => {
  test("the team, without a reason", () => check(TEAM_NO_REASON, "TEAM", null));
  test("the team, with a reason", () => check(TEAM_WITH_REASON, "TEAM", "Not enough backend experience"));
  test("the candidate", () => check(CANDIDATE, "CANDIDATE", null));
  test("the candidate's reason changes nothing", () => check(CANDIDATE, "CANDIDATE", "changed my mind"));
});

describe("canMoveStage: rules in words", () => {
  test("rejecting needs a non-blank reason", () => {
    expect(canMoveStage("INTERVIEW", "REJECTED", "TEAM")).toEqual({ allowed: false, code: "REASON_REQUIRED" });
    expect(canMoveStage("INTERVIEW", "REJECTED", "TEAM", { reason: "   " })).toEqual({ allowed: false, code: "REASON_REQUIRED" });
    expect(canMoveStage("INTERVIEW", "REJECTED", "TEAM", { reason: "Role filled" })).toEqual({ allowed: true });
  });

  test("a mistaken drag can be moved back to an earlier open stage", () => {
    expect(canMoveStage("OFFER", "APPLIED", "TEAM")).toEqual({ allowed: true });
  });

  test("a rejected application can only be reopened into SCREENING", () => {
    expect(canMoveStage("REJECTED", "SCREENING", "TEAM")).toEqual({ allowed: true });
    expect(canMoveStage("REJECTED", "HIRED", "TEAM")).toEqual({ allowed: false, code: "STAGE_NOT_ALLOWED" });
  });

  test("HIRED and WITHDRAWN are final for everyone", () => {
    for (const by of ["TEAM", "CANDIDATE"] as const) {
      expect(canMoveStage("HIRED", "OFFER", by)).toEqual({ allowed: false, code: "STAGE_FINAL" });
      expect(canMoveStage("WITHDRAWN", "APPLIED", by)).toEqual({ allowed: false, code: "STAGE_FINAL" });
    }
  });

  test("only the candidate withdraws, and only from an open stage", () => {
    expect(canMoveStage("SCREENING", "WITHDRAWN", "TEAM")).toEqual({ allowed: false, code: "STAGE_NOT_ALLOWED" });
    for (const from of OPEN_STAGES) expect(canMoveStage(from, "WITHDRAWN", "CANDIDATE")).toEqual({ allowed: true });
    expect(canMoveStage("REJECTED", "WITHDRAWN", "CANDIDATE")).toEqual({ allowed: false, code: "STAGE_NOT_ALLOWED" });
  });

  test("the open stages", () => {
    expect([...OPEN_STAGES]).toEqual(["APPLIED", "SCREENING", "INTERVIEW", "OFFER"]);
  });
});

describe("STAGE_COPY", () => {
  test("every stage has plain words for the candidate", () => {
    for (const s of APPLICATION_STAGES) expect(STAGE_COPY[s].length).toBeGreaterThan(3);
    expect(STAGE_COPY.REJECTED).toBe("Not selected");
  });
});

describe("matchScore", () => {
  test("the share of the job's skills the candidate lists, case-insensitively", () => {
    expect(matchScore(["TypeScript", "Go", "SQL"], ["typescript", "sql", "Rust"])).toEqual({ score: 67, matched: ["TypeScript", "SQL"], missing: ["Go"] });
  });

  test("all, none, and extra candidate skills do not matter", () => {
    expect(matchScore(["Go"], ["go", "rust", "c"])).toEqual({ score: 100, matched: ["Go"], missing: [] });
    expect(matchScore(["Go", "Rust"], [])).toEqual({ score: 0, matched: [], missing: ["Go", "Rust"] });
  });

  test("a job without skills has nothing to compare: null", () => {
    expect(matchScore([], ["Go"])).toEqual({ score: null, matched: [], missing: [] });
  });

  test("rounded to a whole percent", () => {
    expect(matchScore(["a", "b", "c"], ["a"]).score).toBe(33);
    expect(matchScore(["a", "b", "c", "d", "e", "f"], ["a"]).score).toBe(17);
  });
});
