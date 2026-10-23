import { describe, expect, test } from "vitest";
import { likeContains, normalizeSkill, prefixTsQuery, searchTerms, uniqueSkills } from "../../src/domain/search-text";

describe("searchTerms", () => {
  test("letters and digits only, lower-cased, split like Postgres's simple parser", () => {
    expect(searchTerms("C++ and Node.js")).toEqual(["c", "and", "node", "js"]);
    expect(searchTerms("Data   Scientist")).toEqual(["data", "scientist"]);
    expect(searchTerms("Café São Paulo")).toEqual(["café", "são", "paulo"]);
    expect(searchTerms("snake_case")).toEqual(["snake_case"]);
  });

  test("at most eight terms; punctuation alone is nothing", () => {
    expect(searchTerms("a b c d e f g h i j")).toHaveLength(8);
    expect(searchTerms("!!! ... ---")).toEqual([]);
    expect(searchTerms("")).toEqual([]);
  });
});

describe("prefixTsQuery", () => {
  test("every term is a prefix match, all required", () => {
    expect(prefixTsQuery("data sci")).toBe("data:* & sci:*");
    expect(prefixTsQuery("Rust")).toBe("rust:*");
  });

  test("tsquery operators in the input are never passed through", () => {
    expect(prefixTsQuery("a & b | !c <-> (d)")).toBe("a:* & b:* & c:* & d:*");
    expect(prefixTsQuery("x:* & y")).toBe("x:* & y:*");
    expect(prefixTsQuery("'; DROP TABLE users; --")).toBe("drop:* & table:* & users:*");
  });

  test("nothing searchable: null", () => {
    expect(prefixTsQuery("&|!")).toBeNull();
    expect(prefixTsQuery("   ")).toBeNull();
  });
});

describe("likeContains", () => {
  test("wraps in % and escapes LIKE wildcards and the escape character", () => {
    expect(likeContains("ada")).toBe("%ada%");
    expect(likeContains("50%")).toBe("%50\\%%");
    expect(likeContains("a_b")).toBe("%a\\_b%");
    expect(likeContains("back\\slash")).toBe("%back\\\\slash%");
    expect(likeContains("%_%")).toBe("%\\%\\_\\%%");
  });
});

describe("skills", () => {
  test("normalizeSkill: NFKC, single spaces, trimmed, at most 60 characters, case kept", () => {
    expect(normalizeSkill("  Machine   Learning ")).toBe("Machine Learning");
    expect(normalizeSkill("ＳＱＬ")).toBe("SQL");
    expect(normalizeSkill("x".repeat(80))).toBe("x".repeat(60));
    expect(normalizeSkill("   ")).toBeNull();
    expect(normalizeSkill("")).toBeNull();
  });

  test("uniqueSkills: case-insensitive, first spelling wins, order kept, bounded", () => {
    expect(uniqueSkills(["TypeScript", "typescript", " Go ", "TYPESCRIPT", "", "go", "Rust"])).toEqual(["TypeScript", "Go", "Rust"]);
    expect(uniqueSkills(Array.from({ length: 80 }, (_, i) => `skill ${i}`))).toHaveLength(50);
    expect(uniqueSkills(["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });
});
