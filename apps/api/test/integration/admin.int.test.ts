import { afterEach, describe, expect, test } from "vitest";
import type { AdminComplaintRow } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { anon, as, createUser, recordRealtime, type Role, type TestUser } from "./harness";
import { getUrl, TINY_PDF, TINY_PNG, upload } from "./media-helpers";
import { profileStatus, userStatus } from "./moderation-fixtures";
import { acceptedApproach, allPages, apply, approach, makeCompanyRecruiter, makeJob, makeProfile, resetSettings, uniq } from "./talent-fixtures";

const rt = recordRealtime();
const MISSING = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

afterEach(resetSettings);

type Method = "get" | "post" | "patch" | "put" | "delete";
interface Route {
  method: Method;
  path: string;
  area: string;
  body?: Record<string, unknown>;
}

/** Every /api/admin route with a body that passes validation, so the area check is what answers. */
const ROUTES: Route[] = [
  { method: "get", path: "/settings", area: "settings" },
  { method: "patch", path: "/settings", area: "settings", body: {} },
  { method: "get", path: "/stats", area: "overview" },
  { method: "get", path: "/stats.csv", area: "overview" },
  { method: "get", path: "/users", area: "people" },
  { method: "patch", path: `/users/${MISSING}`, area: "settings", body: { role: "USER" } },
  { method: "post", path: `/users/${MISSING}/warn`, area: "people", body: { reason: "Be kind" } },
  { method: "post", path: `/users/${MISSING}/suspend`, area: "people", body: { days: 1, reason: "Cool off" } },
  { method: "post", path: `/users/${MISSING}/unsuspend`, area: "people", body: {} },
  { method: "post", path: `/users/${MISSING}/ban`, area: "people", body: { reason: "Spam" } },
  { method: "post", path: `/users/${MISSING}/unban`, area: "people", body: {} },
  { method: "post", path: `/users/${MISSING}/profile/suspend`, area: "people", body: { reason: "Fake" } },
  { method: "post", path: `/users/${MISSING}/profile/restore`, area: "people", body: {} },
  { method: "post", path: `/users/${MISSING}/badges`, area: "people", body: { label: "Verified identity" } },
  { method: "delete", path: `/badges/${MISSING}`, area: "people" },
  { method: "post", path: `/users/${MISSING}/erase`, area: "settings", body: { reason: "GDPR request" } },
  { method: "get", path: "/recruiters", area: "recruiters" },
  { method: "post", path: `/recruiters/${MISSING}/review`, area: "recruiters", body: { decision: "APPROVE" } },
  { method: "post", path: `/recruiters/${MISSING}/suspend`, area: "recruiters", body: { reason: "Spam" } },
  { method: "post", path: `/recruiters/${MISSING}/reinstate`, area: "recruiters", body: {} },
  { method: "put", path: `/recruiters/${MISSING}/quota`, area: "recruiters", body: { quota: 5 } },
  { method: "get", path: "/companies", area: "companies" },
  { method: "patch", path: `/companies/${MISSING}`, area: "companies", body: {} },
  { method: "get", path: "/jobs", area: "jobs" },
  { method: "post", path: `/jobs/${MISSING}/close`, area: "jobs", body: { reason: "Scam" } },
  { method: "get", path: "/complaints", area: "complaints" },
  { method: "post", path: `/complaints/${MISSING}/resolve`, area: "complaints", body: { status: "UNDER_REVIEW" } },
  { method: "post", path: `/ratings/${MISSING}/hide`, area: "complaints", body: { reason: "Abusive" } },
  { method: "get", path: "/audit", area: "audit" },
];

const AREAS: Record<Role, string[]> = {
  USER: [],
  MODERATOR: ["overview", "moderation", "people", "jobs", "complaints"],
  RECRUITER_OPS: ["overview", "recruiters", "companies", "jobs"],
  ADMIN: ["overview", "recruiters", "companies", "moderation", "people", "jobs", "complaints", "settings", "audit"],
};

function call(user: TestUser | null, r: Route) {
  const req = as(user)[r.method](`/api/admin${r.path}`);
  return r.body ? req.send(r.body) : req;
}

describe("the area matrix", () => {
  test("signed out is 401 on every admin route", async () => {
    for (const r of ROUTES) expect((await call(null, r)).status, `${r.method} ${r.path}`).toBe(401);
  });

  for (const role of ["USER", "MODERATOR", "RECRUITER_OPS", "ADMIN"] as const) {
    test(`${role}: exactly the areas of the role`, async () => {
      const user = await createUser({ role });
      for (const r of ROUTES) {
        const res = await call(user, r);
        const label = `${role} ${r.method.toUpperCase()} ${r.path} -> ${res.status} ${JSON.stringify(res.body)}`;
        if (AREAS[role].includes(r.area)) {
          expect(res.status, label).not.toBe(500);
          expect(res.body?.code, label).not.toBe("FORBIDDEN_AREA");
        } else {
          expect(res.status, label).toBe(403);
          expect(res.body.code, label).toBe("FORBIDDEN_AREA");
        }
      }
    });
  }

  test("/admin/me reports the role and its areas (a member gets no areas)", async () => {
    const want = (role: Role) => Object.fromEntries(AREAS.ADMIN.map((a) => [a, AREAS[role].includes(a)]));
    for (const role of ["USER", "MODERATOR", "RECRUITER_OPS", "ADMIN"] as const) {
      const res = await as(await createUser({ role })).get("/api/admin/me").expect(200);
      expect(res.body).toEqual({ role, areas: want(role) });
    }
  });

  test("a suspended operator has no powers", async () => {
    const mod = await createUser({ role: "MODERATOR", status: "SUSPENDED" });
    const target = await createUser();
    expect((await as(mod).post(`/api/admin/users/${target.id}/suspend`).send({ days: 1, reason: "Cool off" }).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
    expect((await as(mod).get("/api/admin/users").expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
    expect(await userStatus(target.id)).toBe("ACTIVE");
  });

  test("moderators cannot ban (admins only) and cannot approve recruiters; recruiter ops cannot change roles", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const target = await createUser();
    expect((await as(mod).post(`/api/admin/users/${target.id}/ban`).send({ reason: "Spam" }).expect(403)).body.code).toBe("STAFF_ONLY");
    const pending = await makeCompanyRecruiter({ stopAt: "PENDING_REVIEW" });
    expect((await as(mod).post(`/api/admin/recruiters/${pending.recruiterId}/review`).send({ decision: "APPROVE" }).expect(403)).body.code).toBe("FORBIDDEN_AREA");
    const ops = await createUser({ role: "RECRUITER_OPS" });
    expect((await as(ops).patch(`/api/admin/users/${target.id}`).send({ role: "ADMIN" }).expect(403)).body.code).toBe("FORBIDDEN_AREA");
    expect((await db.selectFrom("users").select("role").where("id", "=", target.id).executeTakeFirstOrThrow()).role).toBe("USER");
    expect((await as(ops).post(`/api/admin/users/${target.id}/suspend`).send({ days: 1, reason: "x" }).expect(403)).body.code).toBe("FORBIDDEN_AREA");
    expect((await as(ops).get("/api/moderation/cases").expect(403)).status).toBe(403);
  });
});

describe("settings", () => {
  test("read, then a strict patch with an audit entry recording before and after", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const before = await as(admin).get("/api/admin/settings").expect(200);
    expect(before.body.profile.publishThreshold).toEqual(expect.any(Number));
    const res = await as(admin).patch("/api/admin/settings").send({ recruiter: { approachesPerDay: 7 }, networkName: "Fictional Talent" }).expect(200);
    expect(res.body.recruiter.approachesPerDay).toBe(7);
    expect(res.body.recruiter.declineCooldownDays).toBe(before.body.recruiter.declineCooldownDays);
    expect(res.body.networkName).toBe("Fictional Talent");
    const audit = await as(admin).get(`/api/admin/audit?action=settings.update&actorId=${admin.id}`).expect(200);
    expect(audit.body.items[0]).toMatchObject({ action: "settings.update", actor: { id: admin.id }, data: { keys: expect.arrayContaining(["recruiter", "networkName"]) } });
    expect(audit.body.items[0].data.before.recruiter.approachesPerDay).toBe(before.body.recruiter.approachesPerDay);
    expect(audit.body.items[0].data.after.recruiter.approachesPerDay).toBe(7);
  });

  test("bad values are 400 and change nothing", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const bad = [
      { moderation: { thresholds: { harassment: { review: 0.9, hide: 0.5 } } } },
      { moderation: { thresholds: { harassment: { review: 0.2, hide: 1.5 } } } },
      { profile: { publishThreshold: 101 } },
      { recruiter: { freeMailDomains: ["not a domain"] } },
      { recruiter: { madeUp: 1 } },
      { unknownGroup: {} },
      { analytics: { timezone: "Mars/Olympus" } },
      { registration: "MAYBE" },
    ];
    for (const body of bad) {
      const res = await as(admin).patch("/api/admin/settings").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await as(admin).get("/api/admin/settings").expect(200)).body.profile.publishThreshold).toBe(55);
  });
});

describe("overview", () => {
  test("stats over a range and the CSV export; bad ranges are 400", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await makeProfile();
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
    const res = await as(admin).get(`/api/admin/stats?from=${weekAgo}&to=${today}`).expect(200);
    expect(res.body.range).toEqual({ from: weekAgo, to: today, timezone: "UTC" });
    expect(res.body.daily).toHaveLength(7);
    expect(res.body.totals.profilesPublished).toBeGreaterThan(0);
    expect(res.body.funnel.signups).toBeGreaterThan(0);
    const csv = await as(admin).get(`/api/admin/stats.csv?from=${weekAgo}&to=${today}`).expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const lines = csv.text.trim().split("\n");
    expect(lines[0]).toBe("date,signups,profiles_published,applications,approaches,posts");
    expect(lines).toHaveLength(8);
    expect(csv.text).not.toContain("@");
    expect((await as(admin).get(`/api/admin/stats?from=${today}&to=${weekAgo}`).expect(400)).body.code).toBe("RANGE_INVALID");
    expect((await as(admin).get("/api/admin/stats?from=2020-01-01&to=2026-01-01").expect(400)).body.code).toBe("RANGE_TOO_LONG");
  });
});

describe("people", () => {
  test("search by name, username or exact email; filter by role and status", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const name = `Quillon ${uniq("q")}`;
    const u = await createUser({ displayName: name });
    const byName = await as(mod).get(`/api/admin/users?q=${encodeURIComponent(name)}`).expect(200);
    expect(byName.body.items.map((x: { id: string }) => x.id)).toEqual([u.id]);
    expect(byName.body.items[0]).toMatchObject({ email: u.email, status: "ACTIVE", profileStatus: "DRAFT" });
    expect((await as(mod).get(`/api/admin/users?q=${u.email}`).expect(200)).body.items[0].id).toBe(u.id);
    expect((await as(mod).get(`/api/admin/users?q=${u.username}`).expect(200)).body.items[0].id).toBe(u.id);
    // LIKE wildcards are matched literally.
    expect((await as(mod).get("/api/admin/users?q=%25%25%25").expect(200)).body.items).toEqual([]);
    const ops = await createUser({ role: "RECRUITER_OPS" });
    const roles = await allPages((c) => as(mod).get(`/api/admin/users?role=RECRUITER_OPS&limit=50${c ? `&cursor=${c}` : ""}`).then((r) => r.body));
    expect(roles.map((x: { id: string }) => x.id)).toContain(ops.id);
    expect(roles.every((x: { role: string }) => x.role === "RECRUITER_OPS")).toBe(true);
  });

  test("role changes: admins only, never your own, audited", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const u = await createUser();
    const res = await as(admin).patch(`/api/admin/users/${u.id}`).send({ role: "MODERATOR" }).expect(200);
    expect(res.body).toMatchObject({ id: u.id, role: "MODERATOR" });
    expect((await as(admin).patch(`/api/admin/users/${admin.id}`).send({ role: "USER" }).expect(403)).body.code).toBe("CANNOT_CHANGE_OWN_ROLE");
    expect((await as(admin).patch(`/api/admin/users/${MISSING}`).send({ role: "USER" }).expect(404)).body.code).toBe("USER_NOT_FOUND");
    await as(admin).patch(`/api/admin/users/${u.id}`).send({ role: "OWNER" }).expect(400);
    const audit = await db.selectFrom("audit_log").select(["actor_id", "data"]).where("action", "=", "user.role_change").where("entity_id", "=", u.id).executeTakeFirstOrThrow();
    expect(audit).toEqual({ actor_id: admin.id, data: { from: "USER", to: "MODERATOR" } });
  });

  test("two admins demoting each other at once: one wins, the network keeps an admin (LAST_ADMIN)", async () => {
    const a = await createUser({ role: "ADMIN" });
    const b = await createUser({ role: "ADMIN" });
    // Make these the only ACTIVE admins for the duration of the test.
    const others = (await db.selectFrom("users").select("id").where("role", "=", "ADMIN").where("status", "=", "ACTIVE").where("id", "not in", [a.id, b.id]).execute()).map((r) => r.id);
    if (others.length) await db.updateTable("users").set({ status: "SUSPENDED" }).where("id", "in", others).execute();
    try {
      const [x, y] = await Promise.all([as(a).patch(`/api/admin/users/${b.id}`).send({ role: "USER" }), as(b).patch(`/api/admin/users/${a.id}`).send({ role: "USER" })]);
      expect([x.status, y.status].sort()).toEqual([200, 409]);
      expect([x, y].find((r) => r.status === 409)!.body.code).toBe("LAST_ADMIN");
      const left = await db.selectFrom("users").select("id").where("id", "in", [a.id, b.id]).where("role", "=", "ADMIN").execute();
      expect(left).toHaveLength(1);
    } finally {
      if (others.length) await db.updateTable("users").set({ status: "ACTIVE" }).where("id", "in", others).execute();
    }
  });

  test("warn, suspend (disconnects), unsuspend, ban (sessions revoked), unban", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const admin = await createUser({ role: "ADMIN" });
    const u = await createUser();
    await as(mod).post(`/api/admin/users/${u.id}/warn`).send({ reason: "Please keep it civil" }).expect(200);
    rt.clear();
    const s = await as(mod).post(`/api/admin/users/${u.id}/suspend`).send({ days: 2, reason: "Cool off" }).expect(200);
    expect(s.body).toMatchObject({ status: "SUSPENDED", suspendedUntil: expect.any(String) });
    expect(rt.disconnects).toEqual([{ userIds: [u.id], reason: "SUSPENDED" }]);
    expect((await as(mod).post(`/api/admin/users/${u.id}/unsuspend`).send({}).expect(200)).body.status).toBe("ACTIVE");
    expect((await as(mod).post(`/api/admin/users/${u.id}/unsuspend`).send({}).expect(409)).body.code).toBe("NOT_SUSPENDED");
    await as(admin).post(`/api/admin/users/${u.id}/ban`).send({ reason: "Spam ring" }).expect(200);
    expect(await userStatus(u.id)).toBe("BANNED");
    await as(u).get("/api/users/me").expect(401);
    expect((await as(admin).post(`/api/admin/users/${u.id}/ban`).send({ reason: "Again" }).expect(409)).body.code).toBe("ALREADY_BANNED");
    await as(admin).post(`/api/admin/users/${u.id}/unban`).send({}).expect(200);
    expect(await userStatus(u.id)).toBe("ACTIVE");
    const actions = await db.selectFrom("moderation_actions").select("action").where("target_id", "=", u.id).orderBy("created_at").execute();
    expect(actions.map((x) => x.action)).toEqual(["WARN", "SUSPEND", "RESTORE", "BAN", "UNBAN"]);
    // Account notices about the same account collapse into one row within the hour, showing the latest.
    const notes = await db.selectFrom("notifications").select(["snippet", "actor_id"]).where("recipient_id", "=", u.id).where("type", "=", "MODERATION_ACTION").execute();
    expect(notes).toEqual([{ snippet: "Your account ban was lifted.", actor_id: null }]);
  });

  test("protected targets: admins cannot be acted on, moderators not by moderators, nobody acts on themselves", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const admin = await createUser({ role: "ADMIN" });
    expect((await as(mod).post(`/api/admin/users/${admin.id}/warn`).send({ reason: "x" }).expect(403)).body.code).toBe("TARGET_PROTECTED");
    expect((await as(mod).post(`/api/admin/users/${(await createUser({ role: "MODERATOR" })).id}/suspend`).send({ days: 1, reason: "x" }).expect(403)).body.code).toBe("TARGET_PROTECTED");
    expect((await as(mod).post(`/api/admin/users/${mod.id}/warn`).send({ reason: "x" }).expect(400)).body.code).toBe("CANNOT_MODERATE_SELF");
    await as(mod).post(`/api/admin/users/${MISSING}/warn`).send({ reason: "x" }).expect(404);
  });

  test("profile suspend ends every contact unlock and hides the page; restore makes it UNLISTED", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const { recruiter, candidate, approach: a } = await acceptedApproach(["EMAIL"]);
    await as(recruiter).get(`/api/approaches/${a.id}/contact`).expect(200);
    const res = await as(mod).post(`/api/admin/users/${candidate.id}/profile/suspend`).send({ reason: "Impersonating someone" }).expect(200);
    expect(res.body.profileStatus).toBe("SUSPENDED");
    expect((await as(recruiter).get(`/api/approaches/${a.id}/contact`).expect(403)).body.code).toBe("CONTACT_NOT_SHARED");
    await anon().get(`/api/profiles/${candidate.username}`).expect(404);
    expect((await as(mod).post(`/api/admin/users/${candidate.id}/profile/suspend`).send({ reason: "Again" }).expect(409)).body.code).toBe("ALREADY_SUSPENDED");
    // The owner cannot republish a suspended profile.
    expect((await as(candidate).post("/api/profiles/me/status").send({ status: "PUBLISHED" }).expect(403)).body.code).toBe("PROFILE_SUSPENDED");

    expect((await as(mod).post(`/api/admin/users/${candidate.id}/profile/restore`).send({}).expect(200)).body.profileStatus).toBe("UNLISTED");
    expect(await profileStatus(candidate.id)).toBe("UNLISTED");
    expect((await as(mod).post(`/api/admin/users/${candidate.id}/profile/restore`).send({}).expect(409)).body.code).toBe("NOT_SUSPENDED");
    await anon().get(`/api/profiles/${candidate.username}`).expect(200);
  });

  test("verification badges: grant (shown on the profile), regrant updates, revoke", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const talent = await makeProfile();
    const g = await as(mod).post(`/api/admin/users/${talent.id}/badges`).send({ label: "Verified identity", rationale: "Checked documents" }).expect(201);
    expect(g.body.id).toEqual(expect.any(String));
    const again = await as(mod).post(`/api/admin/users/${talent.id}/badges`).send({ label: "Verified identity" }).expect(201);
    expect(again.body.id).toBe(g.body.id);
    const page = await anon().get(`/api/profiles/${talent.username}`).expect(200);
    expect(JSON.stringify(page.body)).toContain("Verified identity");
    await as(mod).delete(`/api/admin/badges/${g.body.id}`).expect(204);
    await as(mod).delete(`/api/admin/badges/${g.body.id}`).expect(404);
    expect(JSON.stringify((await anon().get(`/api/profiles/${talent.username}`).expect(200)).body)).not.toContain("Verified identity");
    await as(mod).post(`/api/admin/users/${MISSING}/badges`).send({ label: "Verified identity" }).expect(404);
  });

  test("erasure anonymises the account; admins are protected and you cannot erase yourself", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const talent = await makeProfile();
    await as(admin).post(`/api/admin/users/${talent.id}/erase`).send({ reason: "GDPR request by email" }).expect(204);
    const row = await db.selectFrom("users").select(["status", "email", "display_name"]).where("id", "=", talent.id).executeTakeFirstOrThrow();
    expect(row.status).toBe("DEACTIVATED");
    expect(String(row.email)).not.toBe(talent.email);
    await anon().get(`/api/profiles/${talent.username}`).expect(404);
    expect((await as(admin).post(`/api/admin/users/${(await createUser({ role: "ADMIN" })).id}/erase`).send({ reason: "x" }).expect(403)).body.code).toBe("TARGET_PROTECTED");
    expect((await as(admin).post(`/api/admin/users/${admin.id}/erase`).send({ reason: "x" }).expect(400)).body.code).toBe("SELF_ACTION");
    const audit = await db.selectFrom("audit_log").select(["actor_id", "data"]).where("action", "=", "user.erase").where("entity_id", "=", talent.id).executeTakeFirstOrThrow();
    expect(audit).toEqual({ actor_id: admin.id, data: { reason: "GDPR request by email" } });
  });
});

describe("recruiters", () => {
  test("the queue: oldest first, with domain evidence (match, free mail)", async () => {
    const ops = await createUser({ role: "RECRUITER_OPS" });
    const matching = await makeCompanyRecruiter({ stopAt: "PENDING_REVIEW" });
    const free = await makeCompanyRecruiter({ stopAt: "PENDING_REVIEW", workEmail: `${uniq("fm")}@gmail.com` });
    const items = await allPages((c) => as(ops).get(`/api/admin/recruiters?limit=50${c ? `&cursor=${c}` : ""}`).then((r) => r.body));
    const a = items.find((x: { id: string }) => x.id === matching.recruiterId);
    const b = items.find((x: { id: string }) => x.id === free.recruiterId);
    expect(a).toMatchObject({ status: "PENDING_REVIEW", workEmailVerified: true, domainMatches: true, freeMail: false, user: { id: matching.id, email: matching.email } });
    expect(b).toMatchObject({ domainMatches: false, freeMail: true });
    expect(items.indexOf(a)).toBeLessThan(items.indexOf(b));
    for (let i = 1; i < items.length; i++) expect(items[i - 1].createdAt <= items[i].createdAt).toBe(true);
    const searched = await as(ops).get(`/api/admin/recruiters?q=${encodeURIComponent(matching.workEmail)}`).expect(200);
    expect(searched.body.items.map((x: { id: string }) => x.id)).toEqual([matching.recruiterId]);
  });

  test("approve activates; reject needs a note the applicant reads; both are told", async () => {
    const ops = await createUser({ role: "RECRUITER_OPS" });
    const yes = await makeCompanyRecruiter({ stopAt: "PENDING_REVIEW" });
    await as(ops).post(`/api/admin/recruiters/${yes.recruiterId}/review`).send({ decision: "APPROVE" }).expect(204);
    expect((await as(yes).get("/api/recruiter/me").expect(200)).body.status).toBe("ACTIVE");
    expect((await as(ops).post(`/api/admin/recruiters/${yes.recruiterId}/review`).send({ decision: "APPROVE" }).expect(409)).body.code).toBe("NOT_PENDING_REVIEW");

    const no = await makeCompanyRecruiter({ stopAt: "PENDING_REVIEW" });
    expect((await as(ops).post(`/api/admin/recruiters/${no.recruiterId}/review`).send({ decision: "REJECT" }).expect(400)).body.code).toBe("NOTE_REQUIRED");
    await as(ops).post(`/api/admin/recruiters/${no.recruiterId}/review`).send({ decision: "REJECT", note: "Use your company email address" }).expect(204);
    const me = await as(no).get("/api/recruiter/me").expect(200);
    expect(me.body).toMatchObject({ status: "REJECTED", reviewNote: "Use your company email address" });
    const types = (await db.selectFrom("notifications").select("type").where("recipient_id", "in", [yes.id, no.id]).execute()).map((n) => n.type).sort();
    expect(types).toEqual(["RECRUITER_APPROVED", "RECRUITER_REJECTED"]);
    expect((await db.selectFrom("audit_log").select("actor_id").where("action", "=", "recruiter.reject").where("entity_id", "=", no.recruiterId).executeTakeFirstOrThrow()).actor_id).toBe(ops.id);
  });

  test("nobody reviews their own application", async () => {
    const ops = await createUser({ role: "RECRUITER_OPS" });
    const self = await makeCompanyRecruiter({ user: ops, stopAt: "PENDING_REVIEW" });
    expect((await as(ops).post(`/api/admin/recruiters/${self.recruiterId}/review`).send({ decision: "APPROVE" }).expect(403)).body.code).toBe("SELF_REVIEW");
  });

  test("suspend withdraws pending approaches and ends unlocks; reinstate; quota", async () => {
    const ops = await createUser({ role: "RECRUITER_OPS" });
    const { recruiter, approach: accepted } = await acceptedApproach(["EMAIL"]);
    const pending = await approach(recruiter, await makeProfile());
    await as(ops).post(`/api/admin/recruiters/${recruiter.recruiterId}/suspend`).send({ reason: "Spamming candidates" }).expect(204);
    expect((await db.selectFrom("approaches").select("status").where("id", "=", pending.id).executeTakeFirstOrThrow()).status).toBe("WITHDRAWN");
    expect((await db.selectFrom("contact_unlocks").select("revoked_at").where("approach_id", "=", accepted.id).executeTakeFirstOrThrow()).revoked_at).not.toBeNull();
    expect((await as(recruiter).post("/api/approaches").send({ username: "anyone", roleTitle: "Engineer", message: "x".repeat(40) }).expect(403)).body.code).toBe("RECRUITER_REQUIRED");
    expect((await as(ops).post(`/api/admin/recruiters/${recruiter.recruiterId}/suspend`).send({ reason: "Again" }).expect(409)).body.code).toBe("ALREADY_SUSPENDED");
    await as(ops).post(`/api/admin/recruiters/${recruiter.recruiterId}/reinstate`).send({}).expect(204);
    expect((await as(recruiter).get("/api/recruiter/me").expect(200)).body.status).toBe("ACTIVE");
    expect((await as(ops).post(`/api/admin/recruiters/${recruiter.recruiterId}/reinstate`).send({}).expect(409)).body.code).toBe("NOT_REINSTATABLE");

    await as(ops).put(`/api/admin/recruiters/${recruiter.recruiterId}/quota`).send({ quota: 2 }).expect(204);
    expect((await as(recruiter).get("/api/recruiter/me").expect(200)).body.quota.approachesPerDay).toBe(2);
    await as(ops).put(`/api/admin/recruiters/${recruiter.recruiterId}/quota`).send({ quota: null }).expect(204);
    expect((await as(recruiter).get("/api/recruiter/me").expect(200)).body.quota.approachesPerDay).toBe(25);
    await as(ops).put(`/api/admin/recruiters/${MISSING}/quota`).send({ quota: 1 }).expect(404);
  });
});

describe("companies", () => {
  test("list and search by name, slug or domain", async () => {
    const ops = await createUser({ role: "RECRUITER_OPS" });
    const rec = await makeCompanyRecruiter();
    for (const q of [rec.company.name, rec.company.slug, rec.company.domain]) {
      const res = await as(ops).get(`/api/admin/companies?q=${encodeURIComponent(q)}`).expect(200);
      expect(res.body.items.map((c: { id: string }) => c.id), q).toContain(rec.company.id);
    }
    const row = (await as(ops).get(`/api/admin/companies?q=${rec.company.slug}`).expect(200)).body.items[0];
    expect(row).toMatchObject({ id: rec.company.id, domains: [rec.company.domain], status: "UNVERIFIED", memberCount: 1 });
  });

  test("verify, edit domains, then suspend (reason required): jobs close, pending approaches are withdrawn", async () => {
    const ops = await createUser({ role: "RECRUITER_OPS" });
    const rec = await makeCompanyRecruiter();
    const job = await makeJob(rec);
    const pending = await approach(rec, await makeProfile());
    const v = await as(ops).patch(`/api/admin/companies/${rec.company.id}`).send({ status: "VERIFIED", domains: ["https://jobs.fictional-dom.example", "fictional-dom.example"], autoApproveDomain: true }).expect(200);
    expect(v.body).toMatchObject({ status: "VERIFIED", verifiedAt: expect.any(String), domains: ["fictional-dom.example"], autoApproveDomain: true });
    expect((await as(ops).patch(`/api/admin/companies/${rec.company.id}`).send({ status: "SUSPENDED" }).expect(400)).body.code).toBe("REASON_REQUIRED");
    const s = await as(ops).patch(`/api/admin/companies/${rec.company.id}`).send({ status: "SUSPENDED", reason: "Fake company" }).expect(200);
    expect(s.body).toMatchObject({ status: "SUSPENDED", suspendedReason: "Fake company" });
    expect((await db.selectFrom("jobs").select("status").where("id", "=", job.id).executeTakeFirstOrThrow()).status).toBe("CLOSED");
    expect((await db.selectFrom("approaches").select("status").where("id", "=", pending.id).executeTakeFirstOrThrow()).status).toBe("WITHDRAWN");
    expect((await db.selectFrom("companies").select("open_job_count").where("id", "=", rec.company.id).executeTakeFirstOrThrow()).open_job_count).toBe(0);
    await anon().get(`/api/companies/${rec.company.slug}`).expect(404);
    await as(ops).patch(`/api/admin/companies/${MISSING}`).send({ status: "VERIFIED" }).expect(404);
    const audit = await db.selectFrom("audit_log").select("actor_id").where("action", "=", "company.admin_update").where("entity_id", "=", rec.company.id).execute();
    expect(audit.every((a) => a.actor_id === ops.id)).toBe(true);
  });
});

describe("jobs", () => {
  test("every job of any status; closing an open job; closing twice is 409", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const rec = await makeCompanyRecruiter();
    const open = await makeJob(rec, { title: `Scam watch ${uniq("t")}` });
    const draft = await makeJob(rec, { publish: false, title: `Draft watch ${uniq("t")}` });
    const all = await as(mod).get(`/api/admin/jobs?q=${encodeURIComponent("watch")}&limit=50`).expect(200);
    const ids = all.body.items.map((j: { id: string }) => j.id);
    expect(ids).toEqual(expect.arrayContaining([open.id, draft.id]));
    expect((await as(mod).get("/api/admin/jobs?status=DRAFT&limit=50").expect(200)).body.items.every((j: { status: string }) => j.status === "DRAFT")).toBe(true);
    await as(mod).post(`/api/admin/jobs/${open.id}/close`).send({ reason: "Asks for a fee" }).expect(204);
    expect((await anon().get(`/api/jobs/${open.id}`).expect(200)).body.status).toBe("CLOSED");
    expect((await as(mod).post(`/api/admin/jobs/${open.id}/close`).send({ reason: "Again" }).expect(409)).body.code).toBe("JOB_NOT_OPEN");
  });
});

/** Engagement from an accepted approach, confirmed and completed by both sides. */
async function completedEngagement() {
  const { recruiter, candidate, approach: a } = await acceptedApproach(["EMAIL"]);
  const e = await as(recruiter).post("/api/trust/engagements").send({ approachId: a.id, title: "Contract build" }).expect(201);
  await as(candidate).post(`/api/trust/engagements/${e.body.id}/confirm`).expect(200);
  await as(recruiter).post(`/api/trust/engagements/${e.body.id}/complete`).expect(200);
  await as(candidate).post(`/api/trust/engagements/${e.body.id}/complete`).expect(200);
  return { recruiter, candidate, approachId: a.id, engagementId: e.body.id as string };
}

describe("complaints and ratings", () => {
  test("list open complaints oldest first; resolve with an action; both sides told; resolved is final", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const { recruiter, candidate, approach: a } = await acceptedApproach(["EMAIL"]);
    const filed = await as(candidate).post("/api/trust/complaints").send({ againstUsername: recruiter.username, category: "HARASSMENT", description: "Kept calling at night after I asked them to stop.", approachId: a.id }).expect(201);
    const list = await allPages((c) => as(mod).get(`/api/admin/complaints?limit=50${c ? `&cursor=${c}` : ""}`).then((r) => r.body));
    const row = list.find((x: { id: string }) => x.id === filed.body.id);
    expect(row).toMatchObject({ category: "HARASSMENT", status: "OPEN", complainant: { id: candidate.id }, against: { id: recruiter.id }, priorComplaintsAgainst: 0 });

    await as(mod).post(`/api/admin/complaints/${filed.body.id}/resolve`).send({ status: "UNDER_REVIEW" }).expect(204);
    expect((await as(mod).post(`/api/admin/complaints/${filed.body.id}/resolve`).send({ status: "ACTION_TAKEN" }).expect(400)).body.code).toBe("NOTE_REQUIRED");
    await as(mod).post(`/api/admin/complaints/${filed.body.id}/resolve`).send({ status: "ACTION_TAKEN", note: "The recruiter is suspended for a week.", action: { kind: "SUSPEND", days: 7 } }).expect(204);
    expect(await userStatus(recruiter.id)).toBe("SUSPENDED");
    const c = await db.selectFrom("complaints").select(["status", "action_id", "resolved_by", "admin_note"]).where("id", "=", filed.body.id).executeTakeFirstOrThrow();
    expect(c).toMatchObject({ status: "ACTION_TAKEN", resolved_by: mod.id, admin_note: "The recruiter is suspended for a week." });
    expect(c.action_id).toEqual(expect.any(String));
    for (const who of [candidate.id, recruiter.id]) {
      expect(await db.selectFrom("notifications").select("type").where("recipient_id", "=", who).where("type", "=", "COMPLAINT_UPDATED").execute()).toHaveLength(1);
    }
    expect((await as(mod).post(`/api/admin/complaints/${filed.body.id}/resolve`).send({ status: "DISMISSED", note: "Changed my mind" }).expect(409)).body.code).toBe("COMPLAINT_RESOLVED");
    const mine = await as(candidate).get("/api/trust/complaints").expect(200);
    expect(mine.body[0]).toMatchObject({ id: filed.body.id, status: "ACTION_TAKEN", adminNote: "The recruiter is suspended for a week." });
  });

  test("rows carry what the complaint is about and the evidence, signed", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const queue = async () => (await allPages((c) => as(mod).get(`/api/admin/complaints?limit=50${c ? `&cursor=${c}` : ""}`).then((r) => r.body))) as AdminComplaintRow[];
    // About an approach, with a PDF and an image attached.
    const { recruiter, candidate, approach: a } = await acceptedApproach(["EMAIL"]);
    const pdf = await upload(candidate, "EVIDENCE", "call-log.pdf", "application/pdf", TINY_PDF);
    const png = await upload(candidate, "EVIDENCE", "screenshot.png", "image/png", TINY_PNG);
    const byApproach = (await as(candidate).post("/api/trust/complaints").send({ againstUsername: recruiter.username, category: "HARASSMENT", description: "Kept calling at night after I asked them to stop.", approachId: a.id, evidenceUploadIds: [pdf.uploadId, png.uploadId] }).expect(201)).body as { id: string };
    // About an application, with nothing attached.
    const team = await makeCompanyRecruiter();
    const job = await makeJob(team);
    const cand = await makeProfile();
    const app = await apply(cand, job.id);
    const byApplication = (await as(cand).post("/api/trust/complaints").send({ againstUsername: team.username, category: "DISCRIMINATION", description: "The rejection note made it clear it was about my age.", applicationId: app.id }).expect(201)).body as { id: string };

    const rows = await queue();
    const first = rows.find((r) => r.id === byApproach.id)!;
    expect(first).toMatchObject({ approachId: a.id, applicationId: null, engagementId: null, evidenceCount: 2 });
    expect(first.evidence.map((m) => m.id).sort()).toEqual([pdf.uploadId, png.uploadId].sort());
    const file = first.evidence.find((m) => m.id === pdf.uploadId)!;
    expect(file).toMatchObject({ kind: "PDF", fileName: "call-log.pdf", mimeType: "application/pdf" });
    expect((await getUrl(file.url)).status).toBe(200);
    expect(rows.find((r) => r.id === byApplication.id)).toMatchObject({ approachId: null, applicationId: app.id, engagementId: null, evidenceCount: 0, evidence: [] });
    // Members never reach the queue.
    await as(candidate).get("/api/admin/complaints").expect(403);
  });

  test("staff who are part of a complaint cannot resolve it", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const { recruiter, approach: a } = await acceptedApproach(["EMAIL"], { candidate: await makeProfile({ user: mod }) });
    const filed = await as(mod).post("/api/trust/complaints").send({ againstUsername: recruiter.username, category: "SPAM", description: "Sent the same message to my whole team twice.", approachId: a.id }).expect(201);
    expect((await as(mod).post(`/api/admin/complaints/${filed.body.id}/resolve`).send({ status: "DISMISSED", note: "Not mine to judge" }).expect(403)).body.code).toBe("SELF_REVIEW");
  });

  test("hiding a rating recomputes the candidate's average", async () => {
    const mod = await createUser({ role: "MODERATOR" });
    const one = await completedEngagement();
    await as(one.candidate).post(`/api/trust/engagements/${one.engagementId}/rating`).send({ score: 5 }).expect(200);
    const r = await as(one.recruiter).post(`/api/trust/engagements/${one.engagementId}/rating`).send({ score: 2, comment: "Late every time" }).expect(200);
    expect(r.body.revealed).toBe(true);
    expect(await db.selectFrom("talent_profiles").select(["rating_avg", "rating_count"]).where("user_id", "=", one.candidate.id).executeTakeFirstOrThrow()).toEqual({ rating_avg: 2, rating_count: 1 });
    await as(mod).post(`/api/admin/ratings/${r.body.id}/hide`).send({ reason: "Retaliation after a complaint" }).expect(204);
    expect(await db.selectFrom("talent_profiles").select(["rating_avg", "rating_count"]).where("user_id", "=", one.candidate.id).executeTakeFirstOrThrow()).toEqual({ rating_avg: null, rating_count: 0 });
    expect((await anon().get(`/api/profiles/${one.candidate.username}/ratings`).expect(200)).body).toEqual([]);
    await as(mod).post(`/api/admin/ratings/${r.body.id}/hide`).send({ reason: "Again" }).expect(404);
  });
});

describe("audit", () => {
  test("filters by action prefix, actor and entity; every entry names its operator", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const u = await createUser();
    await as(admin).post(`/api/admin/users/${u.id}/warn`).send({ reason: "Heads up" }).expect(200);
    const byEntity = await as(admin).get(`/api/admin/audit?entityType=user&entityId=${u.id}`).expect(200);
    expect(byEntity.body.items).toEqual([expect.objectContaining({ action: "moderation.warn", actor: expect.objectContaining({ id: admin.id }), entityId: u.id })]);
    const byPrefix = await as(admin).get(`/api/admin/audit?action=moderation.&actorId=${admin.id}`).expect(200);
    expect(byPrefix.body.items.every((e: { action: string }) => e.action.startsWith("moderation."))).toBe(true);
    // A LIKE wildcard in the prefix is literal.
    expect((await as(admin).get("/api/admin/audit?action=%25").expect(200)).body.items).toEqual([]);
  });
});
