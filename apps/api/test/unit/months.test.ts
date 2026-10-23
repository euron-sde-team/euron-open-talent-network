import { describe, expect, test } from "vitest";
import { parseYearMonth, toYearMonth, yearsFromRoles } from "../../src/domain/months";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("parseYearMonth", () => {
  test("YYYY-MM becomes the first of the month in UTC", () => {
    expect(parseYearMonth("2024-03")?.toISOString()).toBe("2024-03-01T00:00:00.000Z");
    expect(parseYearMonth(" 2024-12 ")?.toISOString()).toBe("2024-12-01T00:00:00.000Z");
  });

  test("anything else is null", () => {
    for (const bad of ["2024-13", "2024-00", "2024-3", "24-03", "2024/03", "Mar 2024", "2024-03-01", "1899-12", "2101-01", "", null, undefined]) expect(parseYearMonth(bad), String(bad)).toBeNull();
  });
});

describe("toYearMonth", () => {
  test("dates and ISO strings to YYYY-MM, in UTC", () => {
    expect(toYearMonth(d("2024-03-15"))).toBe("2024-03");
    expect(toYearMonth("2024-11-30T23:59:59Z")).toBe("2024-11");
    expect(toYearMonth(parseYearMonth("2020-01"))).toBe("2020-01");
  });

  test("missing or invalid is null", () => {
    expect(toYearMonth(null)).toBeNull();
    expect(toYearMonth(undefined)).toBeNull();
    expect(toYearMonth("not a date")).toBeNull();
  });
});

describe("yearsFromRoles", () => {
  const now = d("2026-01-01");
  test("separate roles add up", () => {
    expect(yearsFromRoles([{ start: d("2010-01-01"), end: d("2013-01-01") }, { start: d("2015-01-01"), end: d("2017-01-01") }], now)).toBe(5);
  });

  test("overlapping and nested periods are counted once", () => {
    expect(yearsFromRoles([{ start: d("2015-01-01"), end: d("2020-01-01") }, { start: d("2018-01-01"), end: d("2022-01-01") }], now)).toBe(7);
    expect(yearsFromRoles([{ start: d("2015-01-01"), end: d("2021-01-01") }, { start: d("2016-01-01"), end: d("2017-01-01") }], now)).toBe(6);
  });

  test("a current role runs until now; order does not matter", () => {
    expect(yearsFromRoles([{ start: d("2020-01-01"), end: null }], now)).toBe(6);
    expect(yearsFromRoles([{ start: d("2020-01-01"), end: null }, { start: d("2010-01-01"), end: d("2013-01-01") }], now)).toBe(9);
  });

  test("whole years only; empty and backwards periods count nothing", () => {
    expect(yearsFromRoles([{ start: d("2025-03-01"), end: null }], now)).toBe(0);
    expect(yearsFromRoles([], now)).toBe(0);
    expect(yearsFromRoles([{ start: d("2020-01-01"), end: d("2019-01-01") }], now)).toBe(0);
  });
});
