import { afterAll, describe, expect, test } from "vitest";
import type { AuditEntry, Page } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { as, createUser, type TestUser } from "./harness";
import { allPages, makeCompanyRecruiter, makeProfile, operator, resetSettings } from "./talent-fixtures";

afterAll(resetSettings);

const auditOf = async (viewer: TestUser, query: string) => (await as(viewer).get(`/api/admin/audit?${query}`).expect(200)).body as Page<AuditEntry>;

describe("the audit trail records who did it", () => {
  test("publishing a profile and renaming a username are logged with the owner as actor", async () => {
    const t = await makeProfile();
    await as(t).put("/api/profiles/me/username").send({ username: `${t.username}-new` }).expect(200);
    const admin = await operator("ADMIN");
    const published = await auditOf(admin, `action=profile.published&actorId=${t.id}`);
    expect(published.items).toEqual([expect.objectContaining({ action: "profile.published", entityType: "profile", actor: expect.objectContaining({ id: t.id }) })]);
    const renamed = await auditOf(admin, `action=profile.username&actorId=${t.id}`);
    expect(renamed.items[0]).toMatchObject({ entityType: "user", entityId: t.id, data: { from: t.username, to: `${t.username}-new` } });
  });

  test("recruiter approval records the reviewing operator, never null", async () => {
    const r = await makeCompanyRecruiter();
    const admin = await operator("ADMIN");
    const rows = await db.selectFrom("audit_log").select(["actor_id", "entity_id"]).where("action", "=", "recruiter.approve").where("entity_id", "=", r.recruiterId).execute();
    expect(rows).toEqual([{ actor_id: admin.id, entity_id: r.recruiterId }]);
    const reg = await db.selectFrom("audit_log").select("actor_id").where("action", "=", "recruiter.register").where("entity_id", "=", r.recruiterId).execute();
    expect(reg).toEqual([{ actor_id: r.id }]);
  });

  test("settings changes keep the before and after of the changed keys only", async () => {
    const admin = await operator("ADMIN");
    await as(admin).patch("/api/admin/settings").send({ messaging: { requestsPerDay: 7 } }).expect(200);
    const page = await auditOf(admin, `action=settings.update&actorId=${admin.id}`);
    const entry = page.items[0]!;
    expect(entry).toMatchObject({ entityType: "settings", entityId: "platform", actor: { id: admin.id } });
    expect(entry.data.keys).toEqual(["messaging"]);
    expect((entry.data.before as any).messaging.requestsPerDay).toBe(20);
    expect((entry.data.after as any).messaging.requestsPerDay).toBe(7);
    await resetSettings();
  });

  test("role changes record from, to and the operator; you cannot change your own role", async () => {
    const admin = await operator("ADMIN");
    const u = await createUser();
    await as(admin).patch(`/api/admin/users/${u.id}`).send({ role: "MODERATOR" }).expect(200);
    const page = await auditOf(admin, `entityType=user&action=user.role_change&actorId=${admin.id}`);
    expect(page.items.find((e) => e.entityId === u.id)).toMatchObject({ data: { from: "USER", to: "MODERATOR" } });
    expect((await as(admin).patch(`/api/admin/users/${admin.id}`).send({ role: "USER" }).expect(403)).body.code).toBe("CANNOT_CHANGE_OWN_ROLE");
  });
});

describe("reading the trail", () => {
  test("filters by action prefix, actor, entity type and entity id, newest first, paged", async () => {
    const admin = await operator("ADMIN");
    const t = await makeProfile();
    await as(t).post("/api/profiles/me/status").send({ status: "UNLISTED" }).expect(200);
    await as(t).post("/api/profiles/me/status").send({ status: "PUBLISHED" }).expect(200);
    const prefix = await auditOf(admin, `action=profile.&actorId=${t.id}`);
    expect(prefix.items.map((e) => e.action)).toEqual(["profile.published", "profile.unlisted", "profile.published"]);
    const profileId = (await db.selectFrom("talent_profiles").select("id").where("user_id", "=", t.id).executeTakeFirstOrThrow()).id;
    const byEntity = await auditOf(admin, `entityType=profile&entityId=${profileId}`);
    expect(byEntity.items.length).toBe(3);
    expect(byEntity.items.every((e) => e.entityId === profileId)).toBe(true);
    // A LIKE wildcard in the prefix is literal, not a pattern.
    expect((await auditOf(admin, `action=%25&actorId=${t.id}`)).items).toEqual([]);
    const paged = await allPages<AuditEntry>((cursor) => auditOf(admin, `actorId=${t.id}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`));
    expect(paged.length).toBeGreaterThanOrEqual(3);
    expect(new Set(paged.map((e) => e.id)).size).toBe(paged.length);
  });

  test("only ADMIN opens the audit area", async () => {
    for (const role of ["MODERATOR", "RECRUITER_OPS"] as const) {
      const res = await as(await operator(role)).get("/api/admin/audit").expect(403);
      expect(res.body.code).toBe("FORBIDDEN_AREA");
    }
    expect((await as(await createUser()).get("/api/admin/audit").expect(403)).body.code).toBe("FORBIDDEN_AREA");
    await as(null).get("/api/admin/audit").expect(401);
  });
});
