/**
 * Search must not reveal what a profile hides, a moderator's hide refunds a recruiter's
 * approach quota, and a recruiter who left keeps their history and can register again.
 */
import { describe, expect, test } from "vitest";
import { anon, as } from "./harness";
import { act, openCaseOf, report } from "./moderation-fixtures";
import { approach, makeCompanyRecruiter, makeProfile, operator, uniq } from "./talent-fixtures";

const found = (body: { items: { user: { id: string } }[] }, id: string) => body.items.some((c) => c.user.id === id);

describe("search respects section audiences", () => {
  test("words in a hidden section do not match full-text search until the section is public", async () => {
    const word = uniq("zq").toLowerCase();
    const p = await makeProfile();
    await as(p).put("/api/profiles/me/sections/experience").send({ items: [{ title: "Platform Engineer", companyName: "Fictional Systems", startMonth: "2020-01", endMonth: null, description: `Led the ${word} migration.`, skills: [] }] }).expect(200);
    await as(p).put("/api/profiles/me/visibility").send({ experience: "CONNECTIONS" }).expect(200);
    expect(found((await anon().get(`/api/search/people?q=${word}`).expect(200)).body, p.id)).toBe(false);

    await as(p).put("/api/profiles/me/visibility").send({ experience: "PUBLIC" }).expect(200);
    expect(found((await anon().get(`/api/search/people?q=${word}`).expect(200)).body, p.id)).toBe(true);
  });

  test("a skills section for recruiters only is filterable by recruiters, not by everyone", async () => {
    const skill = `Lang${uniq("s")}`;
    const p = await makeProfile({ skills: [skill, "TypeScript"] });
    await as(p).put("/api/profiles/me/visibility").send({ skills: "RECRUITERS" }).expect(200);
    const recruiter = await makeCompanyRecruiter();

    expect(found((await anon().get(`/api/search/people?skills=${skill}`).expect(200)).body, p.id)).toBe(false);
    expect(found((await as(await makeProfile()).get(`/api/search/people?skills=${skill}`).expect(200)).body, p.id)).toBe(false);
    expect(found((await as(recruiter).get(`/api/search/people?skills=${skill}`).expect(200)).body, p.id)).toBe(true);
  });
});

describe("the headline card", () => {
  test("the current employer from a hidden experience section is not shown to strangers", async () => {
    const p = await makeProfile();
    await as(p).put("/api/profiles/me/visibility").send({ experience: "CONNECTIONS" }).expect(200);
    const seen = (await anon().get(`/api/profiles/${p.username}`).expect(200)).body;
    expect(seen.currentCompany).toBeNull();
    expect(JSON.stringify(seen)).not.toContain("Fictional Systems");
    // The owner still sees it, and a typed company is the owner's own choice to show.
    expect((await as(p).get("/api/profiles/me").expect(200)).body.currentCompany).toBe("Fictional Systems");
    await as(p).patch("/api/profiles/me").send({ currentCompany: "Shown By Choice" }).expect(200);
    expect((await anon().get(`/api/profiles/${p.username}`).expect(200)).body.currentCompany).toBe("Shown By Choice");
  });
});

describe("approach quota", () => {
  test("a moderator hiding an approach gives the recruiter that approach back", async () => {
    const recruiter = await makeCompanyRecruiter();
    const admin = await operator("ADMIN");
    await as(admin).put(`/api/admin/recruiters/${recruiter.recruiterId}/quota`).send({ quota: 1 }).expect(204);
    const [c1, c2] = [await makeProfile(), await makeProfile()];

    const first = await approach(recruiter, c1);
    expect((await as(recruiter).post("/api/approaches").send({ username: c2.username, roleTitle: "Engineer", message: "We are hiring engineers who like calm systems and good tests." }).expect(429)).body.code).toBe("APPROACH_QUOTA");

    await report(c1, "APPROACH", first.id, "SPAM");
    const kase = (await openCaseOf("APPROACH", first.id))!;
    await act(await operator("MODERATOR"), kase.id, { action: "HIDE", reason: "Unsolicited and off topic" });

    await approach(recruiter, c2);
  });
});

describe("leaving a company", () => {
  test("the record is kept as LEFT and the person can register again", async () => {
    const r = await makeCompanyRecruiter();
    await as(r).delete("/api/recruiter/me").expect(204);
    expect((await as(r).get("/api/recruiter/me").expect(200)).body.status).toBe("LEFT");

    const again = await as(r).post("/api/recruiter/register").send({ newCompany: { name: `Company ${uniq("n")}`, website: `https://${uniq("co")}.test` }, workEmail: `${r.username}@${uniq("co")}.test`, title: "Recruiter" });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.status).toBe("EMAIL_PENDING");
  });
});
