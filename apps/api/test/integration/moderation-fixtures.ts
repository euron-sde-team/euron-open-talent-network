/**
 * Content fixtures for the reports, moderation and appeals suites. Everything is created
 * through the public API (so the scan pipeline runs as it does in production), and read
 * back with SQL to assert on statuses and cases.
 */
import { expect } from "vitest";
import type { ModerationTarget } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { as, createUser, type TestUser } from "./harness";
import { connect } from "./talent-fixtures";

export const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000);

/** An account old enough for its reports to count toward the auto-hide threshold. */
export const established = () => createUser({ createdAt: daysAgo(30) });

export async function post(author: TestUser, body = "Sharing a short note about queues and retries.", extra: Record<string, unknown> = {}): Promise<string> {
  const res = await as(author).post("/api/posts").send({ body, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

export async function comment(author: TestUser, postId: string, body = "Thanks for writing this up."): Promise<string> {
  const res = await as(author).post(`/api/posts/${postId}/comments`).send({ body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/** a and b connect, a opens the thread and sends `body`. */
export async function dmMessage(a: TestUser, b: TestUser, body: string): Promise<{ threadId: string; messageId: string }> {
  await connect(a, b);
  const t = await as(a).post("/api/dms/threads").send({ userId: b.id });
  expect(t.status, JSON.stringify(t.body)).toBe(200);
  const m = await as(a).post(`/api/dms/threads/${t.body.id}/messages`).send({ body });
  expect(m.status, JSON.stringify(m.body)).toBe(201);
  return { threadId: t.body.id as string, messageId: m.body.id as string };
}

export const postStatus = (id: string) => db.selectFrom("posts").select(["status", "moderation_state"]).where("id", "=", id).executeTakeFirstOrThrow();

export const userStatus = async (id: string) => (await db.selectFrom("users").select("status").where("id", "=", id).executeTakeFirstOrThrow()).status;

export const profileStatus = async (userId: string) => (await db.selectFrom("talent_profiles").select("status").where("user_id", "=", userId).executeTakeFirstOrThrow()).status;

export const profileIdOf = async (userId: string) => (await db.selectFrom("talent_profiles").select("id").where("user_id", "=", userId).executeTakeFirstOrThrow()).id;

export const openCaseOf = (targetType: ModerationTarget, targetId: string) =>
  db.selectFrom("moderation_cases").selectAll().where("target_type", "=", targetType).where("target_id", "=", targetId).orderBy("opened_at", "desc").executeTakeFirst();

export async function report(reporter: TestUser, targetType: ModerationTarget, targetId: string, reason = "SPAM", status = 201) {
  const res = await as(reporter).post("/api/reports").send({ targetType, targetId, reason });
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
}

/** A post with an OPEN report case, ready for a moderator to act on. */
export async function reportedPost(body?: string) {
  const author = await createUser();
  const postId = await post(author, body);
  await report(await createUser(), "POST", postId, "HATE");
  const kase = (await openCaseOf("POST", postId))!;
  return { author, postId, caseId: kase.id };
}

export async function act(staff: TestUser, caseId: string, body: Record<string, unknown>, status = 200) {
  const res = await as(staff).post(`/api/moderation/cases/${caseId}/actions`).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
}
