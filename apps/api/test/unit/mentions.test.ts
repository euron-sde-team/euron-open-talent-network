import { describe, expect, test } from "vitest";
import { MAX_MENTIONS, newMentions, parseMentions } from "../../src/domain/mentions";

describe("parseMentions", () => {
  test("unique, lower-cased usernames in order of first appearance", () => {
    expect(parseMentions("Hi @Ada-Example and @bob, also @ada-example again")).toEqual(["ada-example", "bob"]);
  });

  test("email addresses and text glued to a word are not mentions", () => {
    expect(parseMentions("mail someone@example.com or x@carol")).toEqual([]);
    expect(parseMentions("path/@dave a.@erin b-@frank @@gil")).toEqual([]);
  });

  test("punctuation around a mention is fine", () => {
    expect(parseMentions("(@dave) @erin! @frank. @gil, @hal?")).toEqual(["dave", "erin", "frank", "gil", "hal"]);
    expect(parseMentions("@start of a line")).toEqual(["start"]);
  });

  test("the username rules: 3 to 40 characters, no leading or trailing hyphen", () => {
    expect(parseMentions("@ab @abc")).toEqual(["abc"]);
    expect(parseMentions(`@${"a".repeat(40)} @${"b".repeat(41)}`)).toEqual(["a".repeat(40)]);
    expect(parseMentions("@-ada @bob- @c-d-e")).toEqual(["c-d-e"]);
  });

  test("empty input and the cap", () => {
    expect(parseMentions(null)).toEqual([]);
    expect(parseMentions(undefined)).toEqual([]);
    expect(parseMentions("")).toEqual([]);
    const body = Array.from({ length: 30 }, (_, i) => `@user${i}x`).join(" ");
    expect(parseMentions(body)).toHaveLength(MAX_MENTIONS);
    expect(parseMentions(body, 3)).toEqual(["user0x", "user1x", "user2x"]);
  });
});

describe("newMentions", () => {
  test("only names added by an edit notify", () => {
    expect(newMentions("hi @ada", "hi @ada and @bob")).toEqual(["bob"]);
    expect(newMentions("hi @ada", "bye")).toEqual([]);
    expect(newMentions(null, "@ada @bob")).toEqual(["ada", "bob"]);
    expect(newMentions("@Ada", "@ada")).toEqual([]);
  });
});
