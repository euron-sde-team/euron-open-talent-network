import { describe, expect, test } from "vitest";
import type { AdminArea, UserRole } from "@open-talent/types";
import { ALL_AREAS, canOpenArea, isOperator, permissionsFor } from "../../src/domain/admin-permissions";

/** The whole matrix, written out: a change to who may open what must change this table. */
const MATRIX: Record<UserRole, AdminArea[]> = {
  USER: [],
  MODERATOR: ["overview", "moderation", "people", "jobs", "complaints"],
  RECRUITER_OPS: ["overview", "recruiters", "companies", "jobs"],
  ADMIN: ["overview", "recruiters", "companies", "moderation", "people", "jobs", "complaints", "settings", "audit"],
};

describe("admin areas per role", () => {
  test("ALL_AREAS lists every area once", () => {
    expect([...ALL_AREAS].sort()).toEqual(["audit", "companies", "complaints", "jobs", "moderation", "overview", "people", "recruiters", "settings"]);
    expect(new Set(ALL_AREAS).size).toBe(ALL_AREAS.length);
  });

  for (const role of Object.keys(MATRIX) as UserRole[]) {
    test(`${role}: exactly its areas`, () => {
      for (const area of ALL_AREAS) expect(canOpenArea(role, area), `${role} ${area}`).toBe(MATRIX[role].includes(area));
      expect(permissionsFor(role)).toEqual(Object.fromEntries(ALL_AREAS.map((a) => [a, MATRIX[role].includes(a)])));
    });
  }

  test("only ADMIN reaches settings (role changes, erasure) and the audit trail", () => {
    for (const area of ["settings", "audit"] as const) expect((["USER", "MODERATOR", "RECRUITER_OPS", "ADMIN"] as const).filter((r) => canOpenArea(r, area))).toEqual(["ADMIN"]);
  });

  test("moderators never approve recruiters; recruiter ops never work the case desk", () => {
    expect(canOpenArea("MODERATOR", "recruiters")).toBe(false);
    expect(canOpenArea("MODERATOR", "companies")).toBe(false);
    expect(canOpenArea("RECRUITER_OPS", "moderation")).toBe(false);
    expect(canOpenArea("RECRUITER_OPS", "people")).toBe(false);
    expect(canOpenArea("RECRUITER_OPS", "complaints")).toBe(false);
  });

  test("any staff role is an operator; a member is not", () => {
    expect(isOperator("USER")).toBe(false);
    for (const r of ["MODERATOR", "RECRUITER_OPS", "ADMIN"] as const) expect(isOperator(r)).toBe(true);
  });
});
