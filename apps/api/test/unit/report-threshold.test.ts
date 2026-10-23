import { describe, expect, test } from "vitest";
import { bumpPriority, MAX_PRIORITY, shouldAutoHideFromReports } from "../../src/domain/report-threshold";

const base = { targetType: "POST" as const, reporterAgesDays: [5, 10, 30], authorIsStaff: false, targetStatus: "PUBLISHED" };

describe("auto-hide from reports", () => {
  test("three established reporters hide published content", () => {
    expect(shouldAutoHideFromReports(base)).toBe(true);
  });

  test("two are not enough, and day-old accounts do not count", () => {
    expect(shouldAutoHideFromReports({ ...base, reporterAgesDays: [5, 10] })).toBe(false);
    expect(shouldAutoHideFromReports({ ...base, reporterAgesDays: [5, 10, 0.5, 0.2] })).toBe(false);
    expect(shouldAutoHideFromReports({ ...base, reporterAgesDays: [5, 10, 0.5, 2] })).toBe(true);
  });

  test("never for staff, accounts, profiles, company pages or content that is not published", () => {
    expect(shouldAutoHideFromReports({ ...base, authorIsStaff: true })).toBe(false);
    for (const targetType of ["USER", "PROFILE", "COMPANY"] as const) expect(shouldAutoHideFromReports({ ...base, targetType, reporterAgesDays: [5, 10, 30, 40] })).toBe(false);
    expect(shouldAutoHideFromReports({ ...base, targetStatus: "HIDDEN" })).toBe(false);
    expect(shouldAutoHideFromReports({ ...base, targetStatus: "REMOVED" })).toBe(false);
  });

  test("every content target can be hidden by reports", () => {
    for (const targetType of ["POST", "COMMENT", "DM_MESSAGE", "JOB", "APPROACH"] as const) expect(shouldAutoHideFromReports({ ...base, targetType })).toBe(true);
  });

  test("the age floor is strict: exactly one day old does not count", () => {
    expect(shouldAutoHideFromReports({ ...base, reporterAgesDays: [5, 10, 1] })).toBe(false);
    expect(shouldAutoHideFromReports({ ...base, reporterAgesDays: [5, 10, 1.01] })).toBe(true);
  });

  test("priority rises per report up to a cap", () => {
    expect(bumpPriority(0)).toBe(10);
    expect(bumpPriority(MAX_PRIORITY - 3)).toBe(MAX_PRIORITY);
    expect(bumpPriority(MAX_PRIORITY)).toBe(MAX_PRIORITY);
    expect(bumpPriority(5, 50)).toBe(55);
  });
});
