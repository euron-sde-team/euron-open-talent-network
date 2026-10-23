/**
 * Becoming a recruiter: registration (new company or an existing page), the work-email
 * code, routing to review or domain auto-approval, the admin queue, suspension, quota,
 * leaving, and the recruiter workspace (saved candidates, saved searches, team notes).
 */
import { afterEach, describe, expect, test } from "vitest";
import type { RecruiterAccount } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { as, createUser, type TestUser } from "./harness";
import { approach, lastCodeFor, makeCompanyRecruiter, makeProfile, notificationsOf, operator, resetSettings, setSettings, teammate, uniq, verifyCompany } from "./talent-fixtures";

afterEach(resetSettings);

const register = (user: TestUser, body: Record<string, unknown>) => as(user).post("/api/recruiter/register").send(body);

async function recruiterRow(userId: string) {
  return db.selectFrom("recruiters").selectAll().where("user_id", "=", userId).executeTakeFirst();
}

describe("registration", () => {
  test("creating a company makes you its OWNER, EMAIL_PENDING, with the company's domains from the website and the work email", async () => {
    const u = await createUser();
    const domain = `${uniq("nw")}.test`;
    const res = await as(u).post("/api/recruiter/register").send({ newCompany: { name: "Harbor Fictional Labs", website: `https://jobs.${domain}` }, workEmail: `Riley@${domain}`, title: "Talent Partner" }).expect(201);
    const a = res.body as RecruiterAccount;
    expect(a).toMatchObject({ status: "EMAIL_PENDING", role: "OWNER", workEmail: `riley@${domain}`, workEmailVerified: false, title: "Talent Partner" });
    expect(a.company.name).toBe("Harbor Fictional Labs");
    expect(a.company.slug).toMatch(/^harbor-fictional-labs/);
    const company = await db.selectFrom("companies").select(["domains", "status", "created_by"]).where("id", "=", a.company.id).executeTakeFirstOrThrow();
    expect(company.domains.map(String)).toEqual([domain]);
    expect(company.status).toBe("UNVERIFIED");
    expect(company.created_by).toBe(u.id);
    // The code is emailed to the work address; only its HMAC is stored.
    const code = lastCodeFor(`riley@${domain}`);
    const stored = await db.selectFrom("recruiter_email_codes").select("code_hash").where("recruiter_id", "=", a.id).executeTakeFirstOrThrow();
    expect(stored.code_hash).not.toContain(code);
    expect(stored.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("joining a company page that has an owner makes you a RECRUITER", async () => {
    const owner = await makeCompanyRecruiter();
    const mate = await teammate(owner);
    expect(mate.account).toMatchObject({ role: "RECRUITER", status: "ACTIVE" });
    expect(mate.company.id).toBe(owner.company.id);
  });

  test("choose exactly one of companySlug and newCompany; unknown fields are rejected", async () => {
    const u = await createUser();
    const both = await register(u, { companySlug: "some-company", newCompany: { name: "Both Ways" }, workEmail: "a@both.test" }).expect(400);
    expect(both.body.code).toBe("COMPANY_CHOICE");
    const neither = await register(u, { workEmail: "a@neither.test" }).expect(400);
    expect(neither.body.code).toBe("COMPANY_CHOICE");
    const forged = await register(u, { newCompany: { name: "Forged Inc" }, workEmail: "a@forged.test", userId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }).expect(400);
    expect(forged.body.code).toBe("VALIDATION_FAILED");
    const missing = await register(u, { companySlug: "no-such-company-here", workEmail: "a@missing.test" }).expect(404);
    expect(missing.body.code).toBe("COMPANY_NOT_FOUND");
  });

  test("a work email used by another recruiter is refused; an existing recruiter cannot register again", async () => {
    const owner = await makeCompanyRecruiter();
    const other = await createUser();
    const taken = await register(other, { companySlug: owner.company.slug, workEmail: owner.workEmail }).expect(409);
    expect(taken.body.code).toBe("WORK_EMAIL_TAKEN");
    const again = await register(owner, { newCompany: { name: "Second Venture" }, workEmail: `again@${owner.company.domain}` }).expect(409);
    expect(again.body.code).toBe("ALREADY_RECRUITER");
  });

  test("an EMAIL_PENDING registration can be replaced by a new one", async () => {
    const r = await makeCompanyRecruiter({ stopAt: "EMAIL_PENDING" });
    const domain = `${uniq("re")}.test`;
    const res = await register(r, { newCompany: { name: "Replacement Works" }, workEmail: `me@${domain}` }).expect(201);
    expect(res.body.id).toBe(r.recruiterId);
    expect(res.body.workEmail).toBe(`me@${domain}`);
    expect(res.body.company.name).toBe("Replacement Works");
  });

  test("a suspended company page accepts no recruiters", async () => {
    const owner = await makeCompanyRecruiter();
    const admin = await operator("ADMIN");
    await as(admin).patch(`/api/admin/companies/${owner.company.id}`).send({ status: "SUSPENDED", reason: "Fake listing" }).expect(200);
    const u = await createUser();
    const res = await register(u, { companySlug: owner.company.slug, workEmail: `x@${owner.company.domain}` }).expect(403);
    expect(res.body.code).toBe("COMPANY_SUSPENDED");
  });

  test("/recruiter/me is 404 NOT_A_RECRUITER for everyone else", async () => {
    const u = await createUser();
    const res = await as(u).get("/api/recruiter/me").expect(404);
    expect(res.body.code).toBe("NOT_A_RECRUITER");
  });
});

describe("work email code", () => {
  test("a wrong code says how many attempts are left; after five the code is locked even when right", async () => {
    const r = await makeCompanyRecruiter({ stopAt: "EMAIL_PENDING" });
    const code = lastCodeFor(r.workEmail);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let left = 4; left >= 0; left--) {
      const res = await as(r).post("/api/recruiter/me/verify").send({ code: wrong }).expect(400);
      expect(res.body.code).toBe("CODE_WRONG");
      expect(res.body.details.attemptsLeft).toBe(left);
    }
    const locked = await as(r).post("/api/recruiter/me/verify").send({ code }).expect(429);
    expect(locked.body.code).toBe("CODE_LOCKED");
    expect((await recruiterRow(r.id))?.status).toBe("EMAIL_PENDING");
  });

  test("an expired code is refused; a fresh one works", async () => {
    const r = await makeCompanyRecruiter({ stopAt: "EMAIL_PENDING" });
    const code = lastCodeFor(r.workEmail);
    await db.updateTable("recruiter_email_codes").set({ expires_at: new Date(Date.now() - 1000) }).where("recruiter_id", "=", r.recruiterId).execute();
    const res = await as(r).post("/api/recruiter/me/verify").send({ code }).expect(400);
    expect(res.body.code).toBe("CODE_EXPIRED");
    await as(r).post("/api/recruiter/me/code").send({}).expect(204);
    const ok = await as(r).post("/api/recruiter/me/verify").send({ code: lastCodeFor(r.workEmail) }).expect(200);
    expect(ok.body.status).toBe("PENDING_REVIEW");
  });

  test("resending invalidates the old code", async () => {
    const r = await makeCompanyRecruiter({ stopAt: "EMAIL_PENDING" });
    const old = lastCodeFor(r.workEmail);
    await as(r).post("/api/recruiter/me/code").send({}).expect(204);
    const fresh = lastCodeFor(r.workEmail);
    if (fresh !== old) {
      const res = await as(r).post("/api/recruiter/me/verify").send({ code: old }).expect(400);
      expect(res.body.code).toBe("CODE_WRONG");
    }
    const live = await db.selectFrom("recruiter_email_codes").select("id").where("recruiter_id", "=", r.recruiterId).where("consumed_at", "is", null).execute();
    expect(live).toHaveLength(1);
    await as(r).post("/api/recruiter/me/verify").send({ code: fresh }).expect(200);
  });

  test("the code must be six digits; there is nothing to verify or resend once confirmed", async () => {
    const r = await makeCompanyRecruiter({ stopAt: "PENDING_REVIEW" });
    await as(r).post("/api/recruiter/me/verify").send({ code: "12345" }).expect(400);
    const v = await as(r).post("/api/recruiter/me/verify").send({ code: "123456" }).expect(400);
    expect(v.body.code).toBe("NOT_EMAIL_PENDING");
    const c = await as(r).post("/api/recruiter/me/code").send({}).expect(400);
    expect(c.body.code).toBe("NOT_EMAIL_PENDING");
  });

  test("a confirmed email on an unverified company goes to review", async () => {
    const r = await makeCompanyRecruiter({ stopAt: "PENDING_REVIEW" });
    expect(r.account).toMatchObject({ status: "PENDING_REVIEW", workEmailVerified: true });
    const row = await recruiterRow(r.id);
    expect(row?.work_email_verified_at).not.toBeNull();
    // Not a recruiter yet: recruiter-only endpoints refuse.
    const res = await as(r).get("/api/approaches/sent").expect(403);
    expect(res.body.code).toBe("RECRUITER_REQUIRED");
  });
});

describe("domain auto-approval", () => {
  test("VERIFIED company + autoApproveDomain + platform setting + matching domain: ACTIVE at once and notified", async () => {
    const owner = await makeCompanyRecruiter();
    await verifyCompany(owner.company.id, true);
    const mate = await teammate(owner, { stopAt: "PENDING_REVIEW" });
    expect(mate.account.status).toBe("ACTIVE");
    expect((await notificationsOf(mate.id)).map((n) => n.type)).toContain("RECRUITER_APPROVED");
    const company = await db.selectFrom("companies").select("member_count").where("id", "=", owner.company.id).executeTakeFirstOrThrow();
    expect(company.member_count).toBe(2);
  });

  test("a sub-domain of the company domain counts", async () => {
    const owner = await makeCompanyRecruiter();
    await verifyCompany(owner.company.id, true);
    const u = await createUser();
    const mate = await teammate(owner, { user: u, workEmail: `${u.username}@eu.${owner.company.domain}`, stopAt: "PENDING_REVIEW" });
    expect(mate.account.status).toBe("ACTIVE");
  });

  test("goes to review when the platform turns auto-approval off, the company has not opted in, or the domain differs", async () => {
    const owner = await makeCompanyRecruiter();
    await verifyCompany(owner.company.id, true);
    await setSettings({ recruiter: { allowDomainAutoApprove: false } });
    expect((await teammate(owner, { stopAt: "PENDING_REVIEW" })).account.status).toBe("PENDING_REVIEW");
    await resetSettings();

    const optedOut = await makeCompanyRecruiter();
    await verifyCompany(optedOut.company.id, false);
    expect((await teammate(optedOut, { stopAt: "PENDING_REVIEW" })).account.status).toBe("PENDING_REVIEW");

    const other = await makeCompanyRecruiter({ companySlug: owner.company.slug, domain: `${uniq("elsewhere")}.test`, stopAt: "PENDING_REVIEW" });
    expect(other.account.status).toBe("PENDING_REVIEW");
  });

  test("free mail can apply, never auto-approves, and the queue flags it", async () => {
    await setSettings({ recruiter: { freeMailDomains: ["freemail.example"] } });
    const owner = await makeCompanyRecruiter();
    const admin = await operator("ADMIN");
    // Even a company that (wrongly) lists the free-mail domain does not auto-approve it.
    await as(admin).patch(`/api/admin/companies/${owner.company.id}`).send({ status: "VERIFIED", autoApproveDomain: true, domains: [owner.company.domain, "freemail.example"] }).expect(200);
    const u = await createUser();
    const r = await makeCompanyRecruiter({ user: u, companySlug: owner.company.slug, workEmail: `${u.username}@freemail.example`, stopAt: "PENDING_REVIEW" });
    expect(r.account.status).toBe("PENDING_REVIEW");
    const queue = await as(admin).get("/api/admin/recruiters").query({ q: r.workEmail }).expect(200);
    const row = queue.body.items.find((x: { id: string }) => x.id === r.recruiterId);
    expect(row).toMatchObject({ freeMail: true, domainMatches: false, workEmailVerified: true, status: "PENDING_REVIEW" });
    expect(row.user.email).toBe(u.email);

    const matching = await teammate(owner, { stopAt: "EMAIL_PENDING" });
    await as(matching).post("/api/recruiter/me/verify").send({ code: lastCodeFor(matching.workEmail) }).expect(200);
    const active = await as(admin).get("/api/admin/recruiters").query({ status: "ACTIVE", q: matching.workEmail }).expect(200);
    expect(active.body.items[0]).toMatchObject({ freeMail: false, domainMatches: true });
  });

  test("a new company registered with free mail does not take the free-mail domain as its own", async () => {
    await setSettings({ recruiter: { freeMailDomains: ["freemail.example"] } });
    const u = await createUser();
    const res = await register(u, { newCompany: { name: "Kitchen Table Studio" }, workEmail: `${u.username}@freemail.example` }).expect(201);
    const company = await db.selectFrom("companies").select("domains").where("id", "=", res.body.company.id).executeTakeFirstOrThrow();
    expect(company.domains).toEqual([]);
  });
});

describe("admin review", () => {
  test("approve activates and notifies; a second decision is NOT_PENDING_REVIEW", async () => {
    const r = await makeCompanyRecruiter({ stopAt: "PENDING_REVIEW" });
    const admin = await operator("ADMIN");
    const pending = await as(admin).get("/api/admin/recruiters").expect(200);
    expect(pending.body.items.some((x: { id: string }) => x.id === r.recruiterId)).toBe(true);
    await as(admin).post(`/api/admin/recruiters/${r.recruiterId}/review`).send({ decision: "APPROVE" }).expect(204);
    const me = await as(r).get("/api/recruiter/me").expect(200);
    expect(me.body.status).toBe("ACTIVE");
    expect((await notificationsOf(r.id)).map((n) => n.type)).toContain("RECRUITER_APPROVED");
    const again = await as(admin).post(`/api/admin/recruiters/${r.recruiterId}/review`).send({ decision: "REJECT", note: "Changed my mind" }).expect(409);
    expect(again.body.code).toBe("NOT_PENDING_REVIEW");
    const row = await recruiterRow(r.id);
    expect(row?.reviewed_by).toBe(admin.id);
    const log = await db.selectFrom("audit_log").select(["actor_id", "action"]).where("entity_id", "=", r.recruiterId).where("action", "=", "recruiter.approve").executeTakeFirstOrThrow();
    expect(log.actor_id).toBe(admin.id);
  });

  test("rejecting needs a note the applicant reads; they can register again", async () => {
    const r = await makeCompanyRecruiter({ stopAt: "PENDING_REVIEW" });
    const admin = await operator("ADMIN");
    const bare = await as(admin).post(`/api/admin/recruiters/${r.recruiterId}/review`).send({ decision: "REJECT" }).expect(400);
    expect(bare.body.code).toBe("NOTE_REQUIRED");
    await as(admin).post(`/api/admin/recruiters/${r.recruiterId}/review`).send({ decision: "REJECT", note: "Use your company email address" }).expect(204);
    const me = await as(r).get("/api/recruiter/me").expect(200);
    expect(me.body).toMatchObject({ status: "REJECTED", reviewNote: "Use your company email address" });
    expect((await notificationsOf(r.id)).map((n) => n.type)).toContain("RECRUITER_REJECTED");
    const again = await register(r, { companySlug: r.company.slug, workEmail: `second.${r.workEmail}` }).expect(201);
    expect(again.body).toMatchObject({ id: r.recruiterId, status: "EMAIL_PENDING", reviewNote: null });
  });

  test("an operator cannot review their own application; a moderator cannot open the queue", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const r = await makeCompanyRecruiter({ user: admin, stopAt: "PENDING_REVIEW" });
    const self = await as(admin).post(`/api/admin/recruiters/${r.recruiterId}/review`).send({ decision: "APPROVE" }).expect(403);
    expect(self.body.code).toBe("SELF_REVIEW");
    const mod = await operator("MODERATOR");
    const res = await as(mod).post(`/api/admin/recruiters/${r.recruiterId}/review`).send({ decision: "APPROVE" }).expect(403);
    expect(res.body.code).toBe("FORBIDDEN_AREA");
    const ops = await operator("RECRUITER_OPS");
    await as(ops).post(`/api/admin/recruiters/${r.recruiterId}/review`).send({ decision: "APPROVE" }).expect(204);
  });
});

describe("suspension, quota and leaving", () => {
  test("suspending withdraws pending approaches and ends contact unlocks; reinstating restores access", async () => {
    const r = await makeCompanyRecruiter();
    const [pendingCand, acceptedCand] = [await makeProfile(), await makeProfile()];
    const pending = await approach(r, pendingCand);
    const accepted = await approach(r, acceptedCand);
    await as(acceptedCand).post(`/api/approaches/${accepted.id}/accept`).send({ channels: ["EMAIL"] }).expect(200);
    const admin = await operator("ADMIN");
    await as(admin).post(`/api/admin/recruiters/${r.recruiterId}/suspend`).send({ reason: "Spam outreach" }).expect(204);
    const again = await as(admin).post(`/api/admin/recruiters/${r.recruiterId}/suspend`).send({ reason: "Twice" }).expect(409);
    expect(again.body.code).toBe("ALREADY_SUSPENDED");

    expect((await db.selectFrom("approaches").select("status").where("id", "=", pending.id).executeTakeFirstOrThrow()).status).toBe("WITHDRAWN");
    const unlock = await db.selectFrom("contact_unlocks").select(["revoked_at", "revoked_reason"]).where("approach_id", "=", accepted.id).executeTakeFirstOrThrow();
    expect(unlock.revoked_at).not.toBeNull();
    expect((await as(r).get(`/api/approaches/${accepted.id}/contact`).expect(403)).body.code).toBe("RECRUITER_REQUIRED");
    expect((await as(r).post("/api/approaches").send({ username: pendingCand.username, roleTitle: "Engineer", message: "x".repeat(40) }).expect(403)).body.code).toBe("RECRUITER_REQUIRED");
    const me = await as(r).get("/api/recruiter/me").expect(200);
    expect(me.body).toMatchObject({ status: "SUSPENDED", reviewNote: "Spam outreach" });

    await as(admin).post(`/api/admin/recruiters/${r.recruiterId}/reinstate`).send({}).expect(204);
    expect((await as(r).get("/api/recruiter/me").expect(200)).body.status).toBe("ACTIVE");
    const twice = await as(admin).post(`/api/admin/recruiters/${r.recruiterId}/reinstate`).send({}).expect(409);
    expect(twice.body.code).toBe("NOT_REINSTATABLE");
    // The unlock stays ended: the candidate shares again only by accepting a new approach.
    expect((await as(r).get(`/api/approaches/${accepted.id}/contact`).expect(403)).body.code).toBe("CONTACT_NOT_SHARED");
  });

  test("a recruiter without a confirmed email cannot be reinstated", async () => {
    const r = await makeCompanyRecruiter({ stopAt: "EMAIL_PENDING" });
    const admin = await operator("ADMIN");
    await as(admin).post(`/api/admin/recruiters/${r.recruiterId}/suspend`).send({ reason: "Odd" }).expect(204);
    expect((await as(admin).post(`/api/admin/recruiters/${r.recruiterId}/reinstate`).send({}).expect(409)).body.code).toBe("NOT_REINSTATABLE");
  });

  test("a quota override bounds approaches per day; null returns to the platform default", async () => {
    const r = await makeCompanyRecruiter();
    const admin = await operator("RECRUITER_OPS");
    await as(admin).put(`/api/admin/recruiters/${r.recruiterId}/quota`).send({ quota: 1 }).expect(204);
    expect((await as(r).get("/api/recruiter/me").expect(200)).body.quota).toEqual({ approachesPerDay: 1, usedToday: 0 });
    await approach(r, await makeProfile());
    const over = await as(r).post("/api/approaches").send({ username: (await makeProfile()).username, roleTitle: "Engineer", message: "y".repeat(40) }).expect(429);
    expect(over.body.code).toBe("APPROACH_QUOTA");
    await as(admin).put(`/api/admin/recruiters/${r.recruiterId}/quota`).send({ quota: null }).expect(204);
    expect((await as(r).get("/api/recruiter/me").expect(200)).body.quota).toEqual({ approachesPerDay: 25, usedToday: 1 });
  });

  test("the only active owner of a team must hand over before leaving", async () => {
    const owner = await makeCompanyRecruiter();
    await teammate(owner);
    const res = await as(owner).delete("/api/recruiter/me").expect(409);
    expect(res.body.code).toBe("OWNER_MUST_TRANSFER");
  });

  test("a teammate leaving: their jobs pass to an owner, the account is LEFT and can register again", async () => {
    const owner = await makeCompanyRecruiter();
    const mate = await teammate(owner);
    const job = await as(mate).post("/api/jobs").send({ title: "Data Engineer", description: "Move data around reliably for a living, with care and tests.", employmentType: "FULL_TIME", workplaceType: "REMOTE", publish: true }).expect(201);
    await as(mate).delete("/api/recruiter/me").expect(204);
    expect((await as(mate).get("/api/recruiter/me").expect(200)).body.status).toBe("LEFT");
    // LEFT is not a working account.
    expect((await as(mate).get("/api/recruiter/saved").expect(403)).body.code).toBe("RECRUITER_REQUIRED");
    const row = await db.selectFrom("jobs").select(["posted_by", "status"]).where("id", "=", job.body.id).executeTakeFirstOrThrow();
    expect(row).toEqual({ posted_by: owner.recruiterId, status: "OPEN" });
  });

  test("a sole owner leaving: pending approaches withdrawn, unlocks end, open jobs close, the row is kept as LEFT", async () => {
    const r = await makeCompanyRecruiter();
    const [c1, c2] = [await makeProfile(), await makeProfile()];
    const pending = await approach(r, c1);
    const accepted = await approach(r, c2);
    await as(c2).post(`/api/approaches/${accepted.id}/accept`).send({ channels: ["EMAIL"] }).expect(200);
    const job = await as(r).post("/api/jobs").send({ title: "Site Engineer", description: "Keep the lights on and the pages fast for many happy readers.", employmentType: "CONTRACT", workplaceType: "ONSITE", publish: true }).expect(201);
    await as(r).delete("/api/recruiter/me").expect(204);
    expect((await db.selectFrom("approaches").select("status").where("id", "=", pending.id).executeTakeFirstOrThrow()).status).toBe("WITHDRAWN");
    expect((await db.selectFrom("contact_unlocks").select("revoked_reason").where("approach_id", "=", accepted.id).executeTakeFirstOrThrow()).revoked_reason).toBe("Recruiter left the company");
    expect((await db.selectFrom("jobs").select("status").where("id", "=", job.body.id).executeTakeFirstOrThrow()).status).toBe("CLOSED");
    expect((await as(r).get("/api/recruiter/me").expect(200)).body.status).toBe("LEFT");
    // The candidate's record of who saw their details survives.
    expect((await db.selectFrom("contact_unlocks").select("id").where("approach_id", "=", accepted.id).execute()).length).toBe(1);
  });

  test("the title can be edited", async () => {
    const r = await makeCompanyRecruiter();
    const res = await as(r).patch("/api/recruiter/me").send({ title: "Head of Talent" }).expect(200);
    expect(res.body.title).toBe("Head of Talent");
    await as(await createUser()).patch("/api/recruiter/me").send({ title: "Nobody" }).expect(404);
  });
});

describe("workspace", () => {
  test("saved candidates: published profiles only, with a note; unpublished ones drop out", async () => {
    const r = await makeCompanyRecruiter();
    const [a, b] = [await makeProfile(), await makeProfile()];
    const draft = await makeProfile({ status: "DRAFT" });
    await as(r).put(`/api/recruiter/saved/${a.username}`).send({ note: "Strong on queues" }).expect(204);
    await as(r).put(`/api/recruiter/saved/${b.username}`).send({}).expect(204);
    expect((await as(r).put(`/api/recruiter/saved/${draft.username}`).send({}).expect(404)).body.code).toBe("PROFILE_NOT_FOUND");
    let list = (await as(r).get("/api/recruiter/saved").expect(200)).body.items;
    expect(list.map((x: { user: { id: string } }) => x.user.id).sort()).toEqual([a.id, b.id].sort());
    expect(list.find((x: { user: { id: string } }) => x.user.id === a.id).note).toBe("Strong on queues");

    await as(b).post("/api/profiles/me/status").send({ status: "DRAFT" }).expect(200);
    list = (await as(r).get("/api/recruiter/saved").expect(200)).body.items;
    expect(list.map((x: { user: { id: string } }) => x.user.id)).toEqual([a.id]);
    await as(r).delete(`/api/recruiter/saved/${a.username}`).expect(204);
    expect((await as(r).get("/api/recruiter/saved").expect(200)).body.items).toEqual([]);
    // Saved lists are recruiter-only.
    expect((await as(a).get("/api/recruiter/saved").expect(403)).body.code).toBe("RECRUITER_REQUIRED");
  });

  test("saved searches: create with a strict query, list, delete only your own", async () => {
    const r = await makeCompanyRecruiter();
    const other = await makeCompanyRecruiter();
    const created = await as(r).post("/api/recruiter/searches").send({ name: "Remote TypeScript", query: { q: "engineer", skills: ["TypeScript"], openToWork: true } }).expect(201);
    expect(created.body).toMatchObject({ name: "Remote TypeScript", query: { q: "engineer", skills: ["TypeScript"], openToWork: true } });
    const bad = await as(r).post("/api/recruiter/searches").send({ name: "Bad", query: { recruiterId: "x" } }).expect(400);
    expect(bad.body.code).toBe("VALIDATION_FAILED");
    expect((await as(r).get("/api/recruiter/searches").expect(200)).body.map((s: { id: string }) => s.id)).toEqual([created.body.id]);
    await as(other).delete(`/api/recruiter/searches/${created.body.id}`).expect(204);
    expect((await as(r).get("/api/recruiter/searches").expect(200)).body).toHaveLength(1);
    expect((await as(other).get("/api/recruiter/searches").expect(200)).body).toEqual([]);
    await as(r).delete(`/api/recruiter/searches/${created.body.id}`).expect(204);
    expect((await as(r).get("/api/recruiter/searches").expect(200)).body).toEqual([]);
  });

  test("team notes are shared by the company team, never by other companies or the candidate", async () => {
    const r = await makeCompanyRecruiter();
    const mate = await teammate(r);
    const outsider = await makeCompanyRecruiter();
    const cand = await makeProfile();
    const note = await as(r).post("/api/recruiter/notes").send({ candidateId: cand.id, body: "Great systems thinker", rating: 5 }).expect(201);
    expect(note.body).toMatchObject({ body: "Great systems thinker", rating: 5, applicationId: null });
    expect(note.body.author.id).toBe(r.id);
    expect((await as(mate).get(`/api/recruiter/notes/${cand.id}`).expect(200)).body.map((n: { id: string }) => n.id)).toEqual([note.body.id]);
    expect((await as(outsider).get(`/api/recruiter/notes/${cand.id}`).expect(200)).body).toEqual([]);
    expect((await as(cand).get(`/api/recruiter/notes/${cand.id}`).expect(403)).body.code).toBe("RECRUITER_REQUIRED");
    const none = await as(r).post("/api/recruiter/notes").send({ body: "About whom?" }).expect(400);
    expect(none.body.code).toBe("CANDIDATE_REQUIRED");
    const profile = await as(cand).get("/api/profiles/me").expect(200);
    expect(JSON.stringify(profile.body)).not.toContain("Great systems thinker");
  });
});
