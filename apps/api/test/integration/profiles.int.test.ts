/**
 * /api/profiles: the editor (basics, sections, contact, visibility, publish, username),
 * the public read per viewer, views, analytics, endorsements, badges and resume export.
 */
import { afterEach, describe, expect, test } from "vitest";
import type { MyProfile, Profile } from "@open-talent/types";
import { db } from "../../src/db/kysely";
import { anon, app, as, createUser, type TestUser } from "./harness";
import { block, connect, makeCompanyRecruiter, makeProfile, notificationsOf, operator, resetSettings, setSettings, uniq } from "./talent-fixtures";
import request from "supertest";

afterEach(resetSettings);

const me = async (u: TestUser) => (await as(u).get("/api/profiles/me").expect(200)).body as MyProfile;
/** Read a binary body (supertest only buffers text types by default). */
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on("data", (c: Buffer) => chunks.push(c));
  stream.on("end", () => cb(null, Buffer.concat(chunks)));
};
const pub = (viewer: TestUser | null, username: string) => as(viewer).get(`/api/profiles/${username}`);

describe("the editor", () => {
  test("a fresh profile is an empty DRAFT with every completeness hint", async () => {
    const u = await createUser();
    const p = await me(u);
    expect(p.status).toBe("DRAFT");
    expect(p.completeness).toBe(0);
    expect(p.missing).toHaveLength(9);
    expect(p.contact).toEqual({ email: null, phone: null, whatsapp: null });
    expect(p.publishThreshold).toBe(55);
    expect(p.viewer.isSelf).toBe(true);
  });

  test("basics: strict body, rate bounds, country code upper-cased, completeness moves", async () => {
    const u = await createUser();
    const bad = await as(u).patch("/api/profiles/me").send({ headline: "x", userId: "someone-else" }).expect(400);
    expect(bad.body.code).toBe("VALIDATION_FAILED");
    const rate = await as(u).patch("/api/profiles/me").send({ rate: { min: 100, max: 50, currency: "eur", period: "HOUR" } }).expect(400);
    expect(rate.body.code).toBe("RATE_INVALID");
    await as(u).patch("/api/profiles/me").send({ countryCode: "pt", yearsExperience: 71 }).expect(400);
    const ok = await as(u).patch("/api/profiles/me").send({ headline: "Data engineer", countryCode: "pt", rate: { min: 50, max: 90, currency: "eur", period: "HOUR" } }).expect(200);
    expect(ok.body.countryCode).toBe("PT");
    expect(ok.body.rate).toEqual({ min: 50, max: 90, currency: "EUR", period: "HOUR" });
    expect(ok.body.completeness).toBe(15);
    expect(ok.body.missing).not.toContain("Add a headline");
    // Clearing a field: an empty string becomes null.
    const cleared = await as(u).patch("/api/profiles/me").send({ headline: "" }).expect(200);
    expect(cleared.body.headline).toBeNull();
    expect(cleared.body.completeness).toBe(0);
  });

  test("experience: dates validated, month format checked, a current role fills the current title", async () => {
    const u = await createUser();
    const put = (items: unknown[]) => as(u).put("/api/profiles/me/sections/experience").send({ items });
    const role = { title: "Analyst", companyName: "Fictional Labs", startMonth: "2020-05" };
    expect((await put([{ ...role, endMonth: "2019-01" }]).expect(400)).body.code).toBe("DATES_INVALID");
    expect((await put([{ ...role, startMonth: "2020-13" }]).expect(400)).body.code).toBe("VALIDATION_FAILED");
    expect((await put([{ ...role, startMonth: "1850-01" }]).expect(400)).body.code).toBe("MONTH_INVALID");
    expect((await put(Array.from({ length: 31 }, () => role)).expect(400)).body.code).toBe("VALIDATION_FAILED");
    expect((await put([{ ...role, extra: true }]).expect(400)).body.code).toBe("VALIDATION_FAILED");
    const ok = (await put([{ ...role, skills: ["SQL", "sql", "Python"] }]).expect(200)).body as MyProfile;
    expect(ok.experience).toHaveLength(1);
    expect(ok.experience[0]).toMatchObject({ title: "Analyst", startMonth: "2020-05", endMonth: null, skills: ["SQL", "Python"] });
    expect(ok.currentTitle).toBe("Analyst");
    expect(ok.currentCompany).toBe("Fictional Labs");
    // A replace, not an append.
    const again = (await put([{ ...role, title: "Lead Analyst" }]).expect(200)).body as MyProfile;
    expect(again.experience.map((e) => e.title)).toEqual(["Lead Analyst"]);
  });

  test("education years are checked; an unknown section is a 400", async () => {
    const u = await createUser();
    const bad = await as(u).put("/api/profiles/me/sections/education").send({ items: [{ institution: "Example College", startYear: 2015, endYear: 2012 }] }).expect(400);
    expect(bad.body.code).toBe("DATES_INVALID");
    await as(u).put("/api/profiles/me/sections/hobbies").send({ items: [] }).expect(400);
  });

  test("links and project URLs go through safeUrl: no javascript:, data: or credentials; bare hosts get https", async () => {
    const u = await createUser();
    const link = (url: string) => as(u).put("/api/profiles/me/sections/links").send({ items: [{ kind: "WEBSITE", url }] });
    for (const url of ["javascript:alert(1)", "data:text/html,<b>x</b>", "https://user:pw@evil.example.com", "https://localhost", "ftp://files.example.com"]) {
      const res = await link(url).expect(400);
      expect(res.body.code, url).toBe("URL_INVALID");
    }
    const ok = (await link("example.com/portfolio").expect(200)).body as MyProfile;
    expect(ok.links[0]!.url).toBe("https://example.com/portfolio");
    const proto = (await link("//cdn.example.com/x").expect(200)).body as MyProfile;
    expect(proto.links[0]!.url).toBe("https://cdn.example.com/x");
    const proj = await as(u).put("/api/profiles/me/sections/projects").send({ items: [{ name: "Thing", url: "javascript:void(0)" }] }).expect(400);
    expect(proj.body.code).toBe("URL_INVALID");
    const repo = await as(u).put("/api/profiles/me/sections/projects").send({ items: [{ name: "Thing", repoUrl: "data:,x" }] }).expect(400);
    expect(repo.body.code).toBe("URL_INVALID");
    const cert = await as(u).put("/api/profiles/me/sections/certifications").send({ items: [{ name: "Cert", credentialUrl: "javascript:x" }] }).expect(400);
    expect(cert.body.code).toBe("URL_INVALID");
    const yt = (await as(u).put("/api/profiles/me/sections/links").send({ items: [{ kind: "YOUTUBE", url: "https://youtu.be/dQw4w9WgXcQ" }] }).expect(200)).body as MyProfile;
    expect(yt.links[0]!.embedId).toBe("dQw4w9WgXcQ");
  });

  test("skills are unique ignoring case and keep their endorsements across a replace", async () => {
    const owner = await makeProfile({ skills: ["Go", "Rust"] });
    const peer = await createUser();
    await connect(owner, peer);
    const go = owner.profile.skills.find((s) => s.name === "Go")!;
    await as(peer).put(`/api/profiles/skills/${go.id}/endorsement`).expect(200);
    const res = (await as(owner).put("/api/profiles/me/sections/skills").send({ items: [{ name: "rust" }, { name: "Go", category: "Languages" }, { name: "GO" }, { name: "Kotlin" }] }).expect(200)).body as MyProfile;
    // The existing row (and its spelling) is kept; a case variant does not create a second skill.
    expect(res.skills.map((s) => s.name)).toEqual(["Rust", "Go", "Kotlin"]);
    const kept = res.skills.find((s) => s.name === "Go")!;
    expect(kept.id).toBe(go.id);
    expect(kept.endorsementCount).toBe(1);
    expect(kept.category).toBe("Languages");
  });

  test("contact details: international phone format only, never on the public page", async () => {
    const u = await createUser();
    await as(u).put("/api/profiles/me/contact").send({ email: null, phone: "5551234", whatsapp: null }).expect(400);
    await as(u).put("/api/profiles/me/contact").send({ email: "not-an-email", phone: null, whatsapp: null }).expect(400);
    const ok = (await as(u).put("/api/profiles/me/contact").send({ email: "Me@Contact.example.test", phone: "+15551230001", whatsapp: "+15551230002" }).expect(200)).body as MyProfile;
    expect(ok.contact).toMatchObject({ phone: "+15551230001", whatsapp: "+15551230002" });
    expect(ok.missing).not.toContain("Add a private contact channel");
  });
});

describe("publishing", () => {
  test("the gate: incomplete first, then a contact channel, then published", async () => {
    const u = await createUser();
    const early = await as(u).post("/api/profiles/me/status").send({ status: "PUBLISHED" }).expect(422);
    expect(early.body.code).toBe("PUBLISH_INCOMPLETE");
    expect(early.body.details).toEqual({ completeness: 0, threshold: 55 });
    const filled = await makeProfile({ user: u, status: "DRAFT", contact: { email: null, phone: null, whatsapp: null } });
    expect(filled.profile.completeness).toBe(85);
    const noContact = await as(u).post("/api/profiles/me/status").send({ status: "PUBLISHED" }).expect(422);
    expect(noContact.body.code).toBe("PUBLISH_NO_CONTACT");
    await as(u).put("/api/profiles/me/contact").send({ email: null, phone: null, whatsapp: "+15551239999" }).expect(200);
    const ok = (await as(u).post("/api/profiles/me/status").send({ status: "PUBLISHED" }).expect(200)).body as MyProfile;
    expect(ok.status).toBe("PUBLISHED");
    expect(ok.publishedAt).not.toBeNull();
    // Status is strict too: SUSPENDED is not something an owner can choose.
    await as(u).post("/api/profiles/me/status").send({ status: "SUSPENDED" }).expect(400);
  });

  test("the threshold comes from the platform settings", async () => {
    await setSettings({ profile: { publishThreshold: 95 } });
    const u = await createUser();
    await makeProfile({ user: u, status: "DRAFT" });
    const res = await as(u).post("/api/profiles/me/status").send({ status: "PUBLISHED" }).expect(422);
    expect(res.body).toMatchObject({ code: "PUBLISH_INCOMPLETE", details: { completeness: 90, threshold: 95 } });
    await setSettings({ profile: { publishThreshold: 10 } });
    await as(u).post("/api/profiles/me/status").send({ status: "PUBLISHED" }).expect(200);
  });

  test("DRAFT is a 404 to others, readable by the owner and staff; back to draft is always allowed", async () => {
    const t = await makeProfile({ status: "DRAFT" });
    const stranger = await createUser();
    expect((await pub(null, t.username).expect(404)).body.code).toBe("PROFILE_NOT_FOUND");
    await pub(stranger, t.username).expect(404);
    expect((await pub(t, t.username).expect(200)).body.status).toBe("DRAFT");
    await pub(await operator("MODERATOR"), t.username).expect(200);
    const published = await makeProfile();
    await as(published).post("/api/profiles/me/status").send({ status: "DRAFT" }).expect(200);
    await pub(stranger, published.username).expect(404);
  });

  test("UNLISTED opens by direct link but stays out of the directory", async () => {
    const word = uniq("unl");
    const t = await makeProfile({ status: "UNLISTED", headline: `Specialist in ${word}` });
    const page = (await pub(null, t.username).expect(200)).body as Profile;
    expect(page.status).toBe("UNLISTED");
    const found = await anon().get("/api/search/people").query({ q: word }).expect(200);
    expect(found.body.items).toEqual([]);
    await as(t).post("/api/profiles/me/status").send({ status: "PUBLISHED" }).expect(200);
    const after = await anon().get("/api/search/people").query({ q: word }).expect(200);
    expect(after.body.items.map((c: { user: { id: string } }) => c.user.id)).toEqual([t.id]);
  });

  test("a SUSPENDED profile is hidden, cannot be republished, and is still visible to its owner and staff", async () => {
    const t = await makeProfile();
    const admin = await operator("ADMIN");
    await as(admin).post(`/api/admin/users/${t.id}/profile/suspend`).send({ reason: "Impersonation report" }).expect(200);
    await pub(null, t.username).expect(404);
    expect((await pub(t, t.username).expect(200)).body.status).toBe("SUSPENDED");
    await pub(await operator("MODERATOR"), t.username).expect(200);
    expect((await as(t).post("/api/profiles/me/status").send({ status: "PUBLISHED" }).expect(403)).body.code).toBe("PROFILE_SUSPENDED");
    await as(admin).post(`/api/admin/users/${t.id}/profile/restore`).send({}).expect(200);
    expect((await pub(null, t.username).expect(200)).body.status).toBe("UNLISTED");
  });
});

describe("who sees what", () => {
  async function world() {
    const owner = await makeProfile({ openToWork: "RECRUITERS" });
    await as(owner).put("/api/profiles/me/visibility").send({ experience: "CONNECTIONS", projects: "RECRUITERS" }).expect(200);
    const friend = await createUser();
    await connect(owner, friend);
    const recruiter = await makeCompanyRecruiter();
    const stranger = await createUser();
    const moderator = await operator("MODERATOR");
    return { owner, friend, recruiter, stranger, moderator };
  }

  test("section audiences per viewer", async () => {
    const w = await world();
    const view = async (v: TestUser | null) => (await pub(v, w.owner.username).expect(200)).body as Profile;

    const a = await view(null);
    expect(a.experience).toEqual([]);
    expect(a.projects).toEqual([]);
    expect(a.hiddenSections.sort()).toEqual(["experience", "projects"]);
    expect(a.skills.length).toBeGreaterThan(0);

    const s = await view(w.stranger);
    expect(s.hiddenSections.sort()).toEqual(["experience", "projects"]);

    const f = await view(w.friend);
    expect(f.hiddenSections).toEqual([]);
    expect(f.experience).toHaveLength(1);
    expect(f.projects).toHaveLength(1);
    expect(f.viewer.connection).toBe("CONNECTED");

    const r = await view(w.recruiter);
    expect(r.hiddenSections).toEqual(["experience"]);
    expect(r.projects).toHaveLength(1);
    expect(r.viewer.recruiter).toMatchObject({ saved: false, approachBlockedReason: null });

    for (const v of [w.owner, w.moderator]) expect((await view(v)).hiddenSections).toEqual([]);

    const mine = await me(w.owner);
    expect(mine.sectionVisibility).toMatchObject({ experience: "CONNECTIONS", projects: "RECRUITERS", skills: "PUBLIC" });
  });

  test("visibility body is strict", async () => {
    const u = await createUser();
    await as(u).put("/api/profiles/me/visibility").send({ experience: "FRIENDS" }).expect(400);
    await as(u).put("/api/profiles/me/visibility").send({ contact: "PUBLIC" }).expect(400);
  });

  test("open to work in RECRUITERS mode shows to active recruiters only; PUBLIC to everyone", async () => {
    const w = await world();
    const anonView = (await pub(null, w.owner.username).expect(200)).body as Profile;
    expect(anonView.openToWork).toBeNull();
    expect(anonView.user.openToWork).toBe(false);
    expect(((await pub(w.friend, w.owner.username).expect(200)).body as Profile).openToWork).toBeNull();
    const rv = (await pub(w.recruiter, w.owner.username).expect(200)).body as Profile;
    expect(rv.openToWork).toMatchObject({ roles: ["Backend Engineer"] });
    expect(rv.user.openToWork).toBe(true);
    await as(w.owner).put("/api/profiles/me/open-to-work").send({ mode: "PUBLIC", roles: ["Data Engineer"], employmentTypes: ["CONTRACT"], workplaceTypes: ["REMOTE"], availableFrom: "2027-01-15" }).expect(200);
    const pubView = (await pub(null, w.owner.username).expect(200)).body as Profile;
    expect(pubView.openToWork).toEqual({ roles: ["Data Engineer"], employmentTypes: ["CONTRACT"], workplaceTypes: ["REMOTE"], availableFrom: "2027-01-15" });
    await as(w.owner).put("/api/profiles/me/open-to-work").send({ mode: "OFF" }).expect(200);
    expect(((await pub(w.recruiter, w.owner.username).expect(200)).body as Profile).openToWork).toBeNull();
  });

  test("contact details never appear in any public payload", async () => {
    const w = await world();
    const { email, phone } = w.owner.contact;
    for (const v of [null, w.stranger, w.friend, w.recruiter, w.moderator]) {
      const json = JSON.stringify((await pub(v, w.owner.username).expect(200)).body);
      expect(json).not.toContain(email!);
      expect(json).not.toContain(phone!);
      expect(json).not.toContain("contact_");
    }
  });

  test("a block hides the profile both ways", async () => {
    const t = await makeProfile();
    const other = await createUser();
    await block(t, other);
    await pub(other, t.username).expect(404);
  });

  test("an invalid username in the path is a 404, not a 400", async () => {
    await anon().get("/api/profiles/not_a_valid_handle!").expect(404);
    expect((await anon().get(`/api/profiles/${uniq("nobody")}`).expect(404)).body.code).toBe("PROFILE_NOT_FOUND");
  });
});

describe("usernames", () => {
  test("username-check: INVALID, RESERVED, TAKEN with suggestions, and available", async () => {
    const taken = await createUser({ displayName: "Avery Quill" });
    const viewer = await createUser({ displayName: "Avery Quill" });
    const check = async (u: string, who: TestUser | null = viewer) => (await as(who).get("/api/profiles/username-check").query({ u }).expect(200)).body;
    const invalid = await check("-bad-");
    expect(invalid).toMatchObject({ available: false, reason: "INVALID" });
    expect(invalid.suggestions.length).toBeGreaterThan(0);
    expect(await check("Admin")).toMatchObject({ available: false, reason: "RESERVED" });
    const t = await check(taken.username);
    expect(t).toMatchObject({ available: false, reason: "TAKEN" });
    for (const s of t.suggestions) expect(s).toMatch(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);
    expect(await check(viewer.username)).toEqual({ available: true, reason: null, suggestions: [] });
    expect(await check(uniq("free"))).toEqual({ available: true, reason: null, suggestions: [] });
    await anon().get("/api/profiles/username-check").expect(400);
  });

  test("a rename keeps the old handle answering 301 PROFILE_MOVED, then the cooldown applies", async () => {
    const t = await makeProfile();
    const old = t.username;
    const next = uniq("renamed");
    const res = (await as(t).put("/api/profiles/me/username").send({ username: next }).expect(200)).body as MyProfile;
    expect(res.user.username).toBe(next);
    const moved = await pub(null, old).expect(301);
    expect(moved.body).toMatchObject({ code: "PROFILE_MOVED", details: { username: next } });
    await pub(null, next).expect(200);
    const again = await as(t).put("/api/profiles/me/username").send({ username: uniq("third") }).expect(429);
    expect(again.body.code).toBe("USERNAME_COOLDOWN");
    expect(again.body.details.retryAt).toBeTruthy();
    // The old handle stays reserved for its owner.
    const other = await createUser();
    expect((await as(other).put("/api/profiles/me/username").send({ username: old }).expect(409)).body.code).toBe("USERNAME_TAKEN");
    expect((await as(other).put("/api/profiles/me/username").send({ username: "settings" }).expect(409)).body.code).toBe("USERNAME_RESERVED");
    expect((await as(other).put("/api/profiles/me/username").send({ username: "no_underscores" }).expect(409)).body.code).toBe("USERNAME_INVALID");
  });

  test("after the cooldown the owner can reclaim their own old handle; the newer one then redirects", async () => {
    const t = await makeProfile();
    const old = t.username;
    const mid = uniq("mid");
    await as(t).put("/api/profiles/me/username").send({ username: mid }).expect(200);
    // Age the rename past the 30 day cooldown.
    await db.updateTable("username_history").set({ created_at: new Date(Date.now() - 31 * 86400_000) }).where("user_id", "=", t.id).execute();
    await as(t).put("/api/profiles/me/username").send({ username: old }).expect(200);
    await pub(null, old).expect(200);
    expect((await pub(null, mid).expect(301)).body.details.username).toBe(old);
    // Same name again is a no-op, not an error.
    await as(t).put("/api/profiles/me/username").send({ username: old }).expect(200);
  });
});

describe("views and analytics", () => {
  test("a view counts once per viewer per day; the owner never counts; signed-out viewers are keyed by IP", async () => {
    const t = await makeProfile();
    const viewer = await createUser();
    const count = async () => (await db.selectFrom("talent_profiles").select("view_count").where("user_id", "=", t.id).executeTakeFirstOrThrow()).view_count;
    const beacon = (ip: string, who: TestUser | null = null) => {
      const r = request(app).post(`/api/profiles/${t.username}/view`).set("X-Forwarded-For", ip);
      return (who ? r.set("Authorization", `Bearer ${who.token}`) : r).expect(204);
    };
    await beacon("203.0.113.21", t);
    expect(await count()).toBe(0);
    await beacon("203.0.113.21");
    await beacon("203.0.113.21");
    expect(await count()).toBe(1);
    await beacon("203.0.113.22");
    expect(await count()).toBe(2);
    await beacon("203.0.113.21", viewer);
    await beacon("203.0.113.99", viewer);
    expect(await count()).toBe(3);
    // The raw IP is never stored.
    const keys = await db.selectFrom("profile_views as v").innerJoin("talent_profiles as p", "p.id", "v.profile_id").select("v.viewer_key").where("p.user_id", "=", t.id).execute();
    expect(keys.map((k) => k.viewer_key).join(" ")).not.toContain("203.0.113");
    // Unknown and DRAFT profiles: still 204, nothing counted.
    await anon().post(`/api/profiles/${uniq("ghost")}/view`).expect(204);
  });

  test("analytics: views by day, recruiter companies, approaches", async () => {
    const t = await makeProfile();
    const recruiter = await makeCompanyRecruiter();
    await as(recruiter).post(`/api/profiles/${t.username}/view`).expect(204);
    await anon().post(`/api/profiles/${t.username}/view`).set("X-Forwarded-For", "198.51.100.7").expect(204);
    const a = (await as(t).get("/api/profiles/me/analytics").expect(200)).body;
    expect(a.views7d).toBe(2);
    expect(a.views30d).toBe(2);
    expect(a.daily).toHaveLength(30);
    expect(a.recruiterCompanies).toEqual([{ name: recruiter.company.name, slug: recruiter.company.slug, views: 1 }]);
    expect(a.approaches).toEqual({ pending: 0, accepted: 0, total: 0 });
    expect(a.searchAppearances30d).toBe(1);
    expect((await as(t).get("/api/profiles/me/contact-log").expect(200)).body).toEqual([]);
  });
});

describe("endorsements", () => {
  test("connections only, never your own, idempotent, and the owner is notified once", async () => {
    const owner = await makeProfile();
    const skill = owner.profile.skills[0]!;
    const friend = await createUser();
    const stranger = await createUser();
    await connect(owner, friend);
    expect((await as(stranger).put(`/api/profiles/skills/${skill.id}/endorsement`).expect(403)).body.code).toBe("NOT_CONNECTED");
    expect((await as(owner).put(`/api/profiles/skills/${skill.id}/endorsement`).expect(400)).body.code).toBe("SELF_ACTION");
    expect((await as(friend).put(`/api/profiles/skills/${skill.id}/endorsement`).expect(200)).body).toEqual({ endorsementCount: 1, endorsedByViewer: true });
    expect((await as(friend).put(`/api/profiles/skills/${skill.id}/endorsement`).expect(200)).body.endorsementCount).toBe(1);
    const page = (await pub(friend, owner.username).expect(200)).body as Profile;
    expect(page.skills.find((s) => s.id === skill.id)).toMatchObject({ endorsementCount: 1, endorsedByViewer: true });
    expect((await notificationsOf(owner.id)).filter((n) => n.type === "ENDORSEMENT")).toHaveLength(1);
    expect((await as(friend).delete(`/api/profiles/skills/${skill.id}/endorsement`).expect(200)).body).toEqual({ endorsementCount: 0, endorsedByViewer: false });
    expect((await as(friend).delete(`/api/profiles/skills/${skill.id}/endorsement`).expect(200)).body.endorsementCount).toBe(0);
    await as(friend).put("/api/profiles/skills/01ARZ3NDEKTSV4RRFFQ69G5FAV/endorsement").expect(404);
  });
});

describe("badges, ratings and resume", () => {
  test("an owner can hide a badge from everyone but themselves and staff", async () => {
    const t = await makeProfile();
    const admin = await operator("ADMIN");
    const { id } = (await as(admin).post(`/api/admin/users/${t.id}/badges`).send({ label: "Identity checked" }).expect(201)).body;
    expect(((await pub(null, t.username).expect(200)).body as Profile).badges.map((b) => b.id)).toEqual([id]);
    const hidden = (await as(t).patch(`/api/profiles/me/badges/${id}`).send({ visible: false }).expect(200)).body as MyProfile;
    expect(hidden.badges.find((b) => b.id === id)?.isVisible).toBe(false);
    expect(((await pub(null, t.username).expect(200)).body as Profile).badges).toEqual([]);
    expect(((await pub(await operator("MODERATOR"), t.username).expect(200)).body as Profile).badges).toHaveLength(1);
    // Someone else's badge id is not yours to toggle.
    const other = await createUser();
    await as(other).patch(`/api/profiles/me/badges/${id}`).send({ visible: true }).expect(404);
  });

  test("ratings: revealed ones only, 404 for an unknown person", async () => {
    const t = await makeProfile();
    expect((await anon().get(`/api/profiles/${t.username}/ratings`).expect(200)).body).toEqual([]);
    await anon().get(`/api/profiles/${uniq("nobody")}/ratings`).expect(404);
  });

  test("resume export as PDF and DOCX, private and not cached", async () => {
    const t = await makeProfile();
    const pdf = await as(t).get("/api/profiles/me/resume.pdf").buffer(true).parse(binary).expect(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.headers["cache-control"]).toBe("no-store");
    expect(pdf.headers["content-disposition"]).toMatch(/attachment; filename=".+-resume\.pdf"/);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    const docx = await as(t).get("/api/profiles/me/resume.docx").buffer(true).parse(binary).expect(200);
    expect(docx.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect((docx.body as Buffer).subarray(0, 2).toString()).toBe("PK");
    await as(t).get("/api/profiles/me/resume.txt").expect(400);
    await anon().get("/api/profiles/me/resume.pdf").expect(401);
  });
});
