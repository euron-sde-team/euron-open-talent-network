/**
 * Screening questions on a job and the answers an application carries. Pure, so the
 * shape is validated the same way on create, edit and apply.
 */
import type { ScreeningQuestion } from "@open-talent/types";

export const MAX_QUESTIONS = 10;

export function readQuestions(raw: unknown): ScreeningQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q): q is ScreeningQuestion => !!q && typeof q === "object" && typeof (q as ScreeningQuestion).id === "string" && typeof (q as ScreeningQuestion).prompt === "string")
    .map((q) => ({ id: q.id, prompt: q.prompt, kind: q.kind === "YES_NO" ? "YES_NO" : "TEXT", required: !!q.required }));
}

export type AnswerProblem = { questionId: string; problem: "MISSING" | "NOT_YES_NO" | "TOO_LONG" | "UNKNOWN_QUESTION" };

/** Check answers against the questions; returns the problems (empty when fine). */
export function checkAnswers(questions: readonly ScreeningQuestion[], answers: readonly { questionId: string; answer: string }[]): AnswerProblem[] {
  const problems: AnswerProblem[] = [];
  const byId = new Map(answers.map((a) => [a.questionId, a.answer.trim()]));
  const known = new Set(questions.map((q) => q.id));
  for (const a of answers) if (!known.has(a.questionId)) problems.push({ questionId: a.questionId, problem: "UNKNOWN_QUESTION" });
  for (const q of questions) {
    const a = byId.get(q.id) ?? "";
    if (!a) {
      if (q.required) problems.push({ questionId: q.id, problem: "MISSING" });
      continue;
    }
    if (q.kind === "YES_NO" && a !== "YES" && a !== "NO") problems.push({ questionId: q.id, problem: "NOT_YES_NO" });
    if (a.length > 2000) problems.push({ questionId: q.id, problem: "TOO_LONG" });
  }
  return problems;
}
