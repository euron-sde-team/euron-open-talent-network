/**
 * Test harness: the app in-process, fast user creation, and a realtime recorder.
 *
 *   const alice = await createUser();               // ACTIVE, email verified, empty DRAFT profile
 *   await as(alice).put("/api/profiles/me/contact").send({...}).expect(200);
 *   const events = recordRealtime();                 // every emit after this point
 */
import { afterAll, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { newId } from "../../src/core/ids";
import { db, initDbTypes } from "../../src/db/kysely";
import type { EventName, EventPayload } from "../../src/realtime/port";
import { setRealtimeTransport } from "../../src/realtime/port";
import { hashPassword } from "../../src/security/passwords";
import { signAccessToken } from "../../src/security/tokens";
import { registerAllJobs } from "../../src/jobs";

registerAllJobs();
export const app = createApp();

// citext[] columns (skills, domains) parse as arrays only after this lookup, as at boot.
beforeAll(async () => {
  await initDbTypes();
});

export const PASSWORD = "correct-horse-battery-staple";
let passwordHash: string | null = null;

export interface TestUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  token: string;
}

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${process.pid.toString(36)}${counter}`.slice(0, 38);
}

export type Role = "USER" | "MODERATOR" | "RECRUITER_OPS" | "ADMIN";
export type RequestPolicy = "ANYONE" | "RECRUITERS" | "NOBODY";

/**
 * Insert an ACTIVE, verified user (and the empty DRAFT talent profile sign-up creates)
 * directly, and mint an access token for them.
 */
export async function createUser(over: { role?: Role; status?: "ACTIVE" | "SUSPENDED" | "BANNED"; displayName?: string; requestPolicy?: RequestPolicy; createdAt?: Date; username?: string } = {}): Promise<TestUser> {
  passwordHash ??= await hashPassword(PASSWORD);
  const username = over.username ?? unique("u");
  const email = `${username}@example.test`;
  const row = await db
    .insertInto("users")
    .values({
      id: newId(),
      email,
      username,
      display_name: over.displayName ?? `User ${username}`,
      password_hash: passwordHash,
      role: over.role ?? "USER",
      status: over.status ?? "ACTIVE",
      email_verified_at: new Date(),
      message_request_policy: over.requestPolicy ?? "RECRUITERS",
      ...(over.createdAt ? { created_at: over.createdAt } : {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db.insertInto("talent_profiles").values({ id: newId(), user_id: row.id }).execute();
  return { id: row.id, email, username, displayName: row.display_name, token: signAccessToken(row.id, row.token_version) };
}

/** A supertest agent that sends the user's bearer token on every request. */
export function as(user: TestUser | null) {
  const agent = request(app);
  const auth = (r: request.Test) => (user ? r.set("Authorization", `Bearer ${user.token}`) : r);
  return {
    get: (url: string) => auth(agent.get(url)),
    post: (url: string) => auth(agent.post(url)),
    put: (url: string) => auth(agent.put(url)),
    patch: (url: string) => auth(agent.patch(url)),
    delete: (url: string) => auth(agent.delete(url)),
  };
}

export const anon = () => as(null);

export interface RecordedEmit {
  rooms: string[];
  event: EventName;
  payload: unknown;
}

/** Capture every realtime emit from now until the end of the file. */
export function recordRealtime() {
  const emits: RecordedEmit[] = [];
  const disconnects: { userIds: string[]; reason: string }[] = [];
  const leaves: { userIds: string[]; rooms: string[] }[] = [];
  setRealtimeTransport({
    emit(rooms, event, payload) {
      emits.push({ rooms, event, payload });
    },
    disconnectUsers(userIds, reason) {
      disconnects.push({ userIds, reason });
    },
    leaveRooms(userIds, rooms) {
      leaves.push({ userIds, rooms });
    },
  });
  return {
    emits,
    disconnects,
    leaves,
    to<E extends EventName>(room: string, event: E): EventPayload<E>[] {
      return emits.filter((e) => e.event === event && e.rooms.includes(room)).map((e) => e.payload as EventPayload<E>);
    },
    clear() {
      emits.length = 0;
      disconnects.length = 0;
      leaves.length = 0;
    },
  };
}

afterAll(() => setRealtimeTransport(null));
