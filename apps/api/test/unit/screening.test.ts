import { describe, expect, test } from "vitest";
import type { ScreeningQuestion } from "@open-talent/types";
import { checkAnswers, MAX_QUESTIONS, readQuestions } from "../../src/domain/screening";

const Q: ScreeningQuestion[] = [
  { id: "q1", prompt: "Are you allowed to work in the EU?", kind: "YES_NO", required: true },
  { id: "q2", prompt: "Link to something you built", kind: "TEXT", required: true },
  { id: "q3", prompt: "Anything else?", kind: "TEXT", required: false },
];

describe("readQuestions", () => {
  test("keeps well-formed questions and normalises kind and required", () => {
    expect(readQuestions([{ id: "a", prompt: "Why us?", kind: "WEIRD", required: "yes" }, { id: "b", prompt: "Remote?", kind: "YES_NO" }])).toEqual([
      { id: "a", prompt: "Why us?", kind: "TEXT", required: true },
      { id: "b", prompt: "Remote?", kind: "YES_NO", required: false },
    ]);
  });

  test("drops malformed entries and anything that is not a list", () => {
    expect(readQuestions([null, 1, "x", { id: 1, prompt: "p" }, { id: "x" }, { prompt: "no id" }])).toEqual([]);
    expect(readQuestions(null)).toEqual([]);
    expect(readQuestions({ id: "a", prompt: "p" })).toEqual([]);
    expect(readQuestions("[]")).toEqual([]);
  });

  test("extra fields stored with a question are not passed on", () => {
    expect(readQuestions([{ id: "a", prompt: "p?", kind: "TEXT", required: false, secret: "x" }])[0]).toEqual({ id: "a", prompt: "p?", kind: "TEXT", required: false });
  });

  test("at most ten questions per job", () => expect(MAX_QUESTIONS).toBe(10));
});

describe("checkAnswers", () => {
  test("complete, valid answers: no problems", () => {
    expect(checkAnswers(Q, [{ questionId: "q1", answer: "YES" }, { questionId: "q2", answer: "https://example.com/thing" }])).toEqual([]);
    expect(checkAnswers([], [])).toEqual([]);
  });

  test("a missing or blank required answer", () => {
    expect(checkAnswers(Q, [{ questionId: "q1", answer: "NO" }])).toEqual([{ questionId: "q2", problem: "MISSING" }]);
    expect(checkAnswers(Q, [{ questionId: "q1", answer: "NO" }, { questionId: "q2", answer: "   " }])).toEqual([{ questionId: "q2", problem: "MISSING" }]);
  });

  test("optional questions may be left out", () => {
    expect(checkAnswers(Q, [{ questionId: "q1", answer: "YES" }, { questionId: "q2", answer: "x" }, { questionId: "q3", answer: "" }])).toEqual([]);
  });

  test("YES_NO takes exactly YES or NO (trimmed, case-sensitive)", () => {
    expect(checkAnswers(Q, [{ questionId: "q1", answer: " YES " }, { questionId: "q2", answer: "x" }])).toEqual([]);
    expect(checkAnswers(Q, [{ questionId: "q1", answer: "yes" }, { questionId: "q2", answer: "x" }])).toEqual([{ questionId: "q1", problem: "NOT_YES_NO" }]);
    expect(checkAnswers(Q, [{ questionId: "q1", answer: "maybe" }, { questionId: "q2", answer: "x" }])).toEqual([{ questionId: "q1", problem: "NOT_YES_NO" }]);
  });

  test("answers over 2000 characters", () => {
    expect(checkAnswers(Q, [{ questionId: "q1", answer: "YES" }, { questionId: "q2", answer: "x".repeat(2001) }])).toEqual([{ questionId: "q2", problem: "TOO_LONG" }]);
    expect(checkAnswers(Q, [{ questionId: "q1", answer: "YES" }, { questionId: "q2", answer: "x".repeat(2000) }])).toEqual([]);
  });

  test("answers to questions the job does not have are reported first", () => {
    expect(checkAnswers(Q, [{ questionId: "nope", answer: "hi" }])).toEqual([
      { questionId: "nope", problem: "UNKNOWN_QUESTION" },
      { questionId: "q1", problem: "MISSING" },
      { questionId: "q2", problem: "MISSING" },
    ]);
  });
});
