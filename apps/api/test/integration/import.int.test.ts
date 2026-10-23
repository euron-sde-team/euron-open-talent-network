/**
 * AI profile import against apps/ai-stub (started in-process on an ephemeral port), with
 * AI_PROVIDER switched on the live config object (the providers read it at call time).
 * Imports run as inline jobs, so an import is finished when POST /me/imports answers.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { MyProfile, ProfileImport } from "@open-talent/types";
import { startStub } from "../../../ai-stub/server.mjs";
import { config } from "../../src/core/config";
import { db } from "../../src/db/kysely";
import { setAiProviderForTests, type AiProvider } from "../../src/integrations/ai";
import { rooms } from "../../src/realtime/port";
import { as, createUser, recordRealtime, type TestUser } from "./harness";
import { resetSettings, setSettings } from "./talent-fixtures";

const rt = recordRealtime();
const original = { AI_PROVIDER: config.AI_PROVIDER, AI_STUB_URL: config.AI_STUB_URL };
let stub: Awaited<ReturnType<typeof startStub>>;

const RESUME = [
  "Platform engineer who keeps queues calm",
  "I build TypeScript services on PostgreSQL. Reach me at private.person@mail.example.com or +15550001234.",
  "Senior Engineer at Fictional Labs (2017-present)",
  "Engineer at Example Widgets (2014-2016)",
  "Example State University",
  "Portfolio: https://portfolio.example.com and code at https://github.com/fictional-person",
].join("\n");

beforeAll(async () => {
  stub = await startStub(0);
  config.AI_STUB_URL = stub.url;
  config.AI_PROVIDER = "stub";
});

afterAll(async () => {
  config.AI_PROVIDER = original.AI_PROVIDER;
  config.AI_STUB_URL = original.AI_STUB_URL;
  setAiProviderForTests(null);
  await stub.close();
});

afterEach(async () => {
  config.AI_PROVIDER = "stub";
  setAiProviderForTests(null);
  delete process.env.RATE_LIMITS;
  await resetSettings();
});

async function startImport(u: TestUser, text = RESUME): Promise<ProfileImport> {
  const res = await as(u).post("/api/profiles/me/imports").send({ text });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return res.body as ProfileImport;
}

describe("when AI is not available", () => {
  test("AI_PROVIDER=none: import and polish answer 503 AI_UNAVAILABLE", async () => {
    config.AI_PROVIDER = "none";
    const u = await createUser();
    expect((await as(u).post("/api/profiles/me/imports").send({ text: RESUME }).expect(503)).body.code).toBe("AI_UNAVAILABLE");
    expect((await as(u).post("/api/profiles/me/polish").send({ field: "headline", text: "an engineer" }).expect(503)).body.code).toBe("AI_UNAVAILABLE");
    expect(await db.selectFrom("profile_imports").select("id").where("user_id", "=", u.id).execute()).toEqual([]);
  });

  test("import switched off in the settings answers 503 IMPORT_DISABLED", async () => {
    await setSettings({ import: { enabled: false } });
    expect((await as(await createUser()).post("/api/profiles/me/imports").send({ text: RESUME }).expect(503)).body.code).toBe("IMPORT_DISABLED");
  });
});

describe("import from text through the stub", () => {
  test("empty or too-short input is a 400; unknown fields are rejected", async () => {
    const u = await createUser();
    expect((await as(u).post("/api/profiles/me/imports").send({}).expect(400)).body.code).toBe("IMPORT_EMPTY");
    expect((await as(u).post("/api/profiles/me/imports").send({ text: "I code." }).expect(400)).body.code).toBe("IMPORT_TOO_SHORT");
    await as(u).post("/api/profiles/me/imports").send({ text: RESUME, userId: (await createUser()).id }).expect(400);
    await as(null).post("/api/profiles/me/imports").send({ text: RESUME }).expect(401);
  });

  test("a READY proposal: roles, skills, links; contact details stripped; badges only with evidence", async () => {
    const u = await createUser();
    rt.clear();
    const imp = await startImport(u);
    expect(imp).toMatchObject({ source: "TEXT", status: "READY", error: null });
    const statuses = rt.to(rooms.user(u.id), "import:status").map((e) => e.status);
    expect(statuses).toEqual(["EXTRACTING", "GENERATING", "SCORING", "READY"]);

    const p = imp.proposal!;
    expect(p.headline).toBe("Platform engineer who keeps queues calm");
    expect(p.experience.map((e) => [e.title, e.companyName, e.startMonth, e.endMonth])).toEqual([
      ["Senior Engineer", "Fictional Labs", "2017-01", null],
      ["Engineer", "Example Widgets", "2014-01", "2016-12"],
    ]);
    expect(p.skills.map((s) => s.name)).toEqual(expect.arrayContaining(["TypeScript", "PostgreSQL"]));
    expect(p.links.map((l) => l.url)).toEqual(["https://portfolio.example.com/", "https://github.com/fictional-person"]);
    expect(p.education.map((e) => e.institution)).toEqual(["Example State University"]);
    const json = JSON.stringify(imp);
    expect(json).not.toContain("private.person@mail.example.com");
    expect(json).not.toContain("15550001234");

    const slugs = imp.proposedBadges.map((b) => b.slug);
    expect(slugs).toContain("fit-typescript");
    expect(slugs).not.toContain("decoy-award");
    expect(imp.proposedBadges.find((b) => b.kind === "SENIORITY")).toMatchObject({ slug: expect.stringMatching(/^experience-\d+-plus$/) });

    expect((await as(u).get("/api/profiles/me/imports/latest").expect(200)).body.id).toBe(imp.id);
    expect((await as(u).get(`/api/profiles/me/imports/${imp.id}`).expect(200)).body.status).toBe("READY");
    expect(await db.selectFrom("notifications").select("type").where("recipient_id", "=", u.id).where("type", "=", "IMPORT_READY").execute()).toHaveLength(1);
  });

  test("nothing is applied until asked; applying picks sections, basics and badges, then purges the input", async () => {
    const u = await createUser();
    const imp = await startImport(u);
    const before = (await as(u).get("/api/profiles/me").expect(200)).body as MyProfile;
    expect(before.headline).toBeNull();
    expect(before.status).toBe("DRAFT");

    const res = await as(u).post(`/api/profiles/me/imports/${imp.id}/apply`).send({ sections: ["experience", "skills"], basics: true, badges: true }).expect(200);
    expect(res.body.status).toBe("APPLIED");
    const after = (await as(u).get("/api/profiles/me").expect(200)).body as MyProfile;
    expect(after.headline).toBe("Platform engineer who keeps queues calm");
    expect(after.status).toBe("DRAFT");
    expect(after.experience.map((e: { companyName: string }) => e.companyName)).toEqual(["Fictional Labs", "Example Widgets"]);
    expect(after.skills.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(["TypeScript", "PostgreSQL"]));
    expect(after.links).toEqual([]);
    expect(after.education).toEqual([]);
    expect(JSON.stringify(after)).not.toContain("private.person@mail.example.com");

    const badges = await db.selectFrom("profile_badges as b").innerJoin("talent_profiles as p", "p.id", "b.profile_id").select(["b.slug", "b.source"]).where("p.user_id", "=", u.id).execute();
    expect(badges.map((b) => b.slug)).toContain("fit-typescript");
    expect(badges.map((b) => b.slug)).not.toContain("decoy-award");
    expect(badges.find((b) => b.slug === "fit-typescript")!.source).toBe("AI");

    const row = await db.selectFrom("profile_imports").select(["input_text", "purged_at", "applied_at"]).where("id", "=", imp.id).executeTakeFirstOrThrow();
    expect(row.input_text).toBeNull();
    expect(row.purged_at).not.toBeNull();
    expect((await as(u).post(`/api/profiles/me/imports/${imp.id}/apply`).send({ sections: ["links"] }).expect(409)).body.code).toBe("IMPORT_NOT_READY");
  });

  test("another member's import is a 404", async () => {
    const owner = await createUser();
    const imp = await startImport(owner);
    const other = await createUser();
    expect((await as(other).get(`/api/profiles/me/imports/${imp.id}`).expect(404)).body.code).toBe("IMPORT_NOT_FOUND");
    await as(other).post(`/api/profiles/me/imports/${imp.id}/apply`).send({ sections: ["skills"] }).expect(404);
    expect((await as(other).get("/api/profiles/me/imports/latest").expect(200)).body).toBeNull();
  });

  test("a provider failure ends FAILED with a readable reason", async () => {
    const u = await createUser();
    const imp = await startImport(u, `${RESUME}\n[[ai:fail]]`);
    expect(imp.status).toBe("FAILED");
    expect(imp.error).toBe("The AI could not process this input. Try pasting the text instead.");
    expect(imp.proposal).toBeNull();
    await as(u).post(`/api/profiles/me/imports/${imp.id}/apply`).send({ sections: ["skills"] }).expect(409);
  });

  test("the daily limit (settings.import.perDay) answers 429 once spent", async () => {
    process.env.RATE_LIMITS = "on";
    await setSettings({ import: { perDay: 1 } });
    const u = await createUser();
    await startImport(u);
    expect((await as(u).post("/api/profiles/me/imports").send({ text: RESUME }).expect(429)).body.code).toBe("RATE_LIMITED");
  });

  test("polish returns a suggestion and saves nothing", async () => {
    const u = await createUser();
    const res = await as(u).post("/api/profiles/me/polish").send({ field: "headline", text: "backend   engineer,   calm systems" }).expect(200);
    // The stub echoes the prompt it was given, tidied: whitespace collapsed.
    expect(res.body).toEqual({ text: expect.stringContaining("backend engineer, calm systems") });
    expect(((await as(u).get("/api/profiles/me").expect(200)).body as MyProfile).headline).toBeNull();
    await as(u).post("/api/profiles/me/polish").send({ field: "salary", text: "a lot please" }).expect(400);
  });
});

describe("the sanitiser stands between the model and the profile", () => {
  test("javascript: and data: links, contact details and impossible months never reach a proposal", async () => {
    const usage = { model: "fake", tokensIn: 1, tokensOut: 1 };
    const fake: AiProvider = {
      name: "fake",
      transcribe: async () => ({ text: "", usage }),
      polish: async (_f, text) => ({ text, usage }),
      badges: async () => ({ raw: { badges: [{ kind: "DOMAIN", slug: "Fin Tech!", label: "Fintech", rationale: "Worked on payments", evidenceQuote: "payments ledger", confidence: 0.95 }, { kind: "ACHIEVEMENT", slug: "low", label: "Low", rationale: "x", evidenceQuote: "payments ledger", confidence: 0.3 }] }, usage }),
      extract: async () => ({
        raw: {
          headline: "Payments engineer, write to me at someone@mail.example.com",
          about: "Built a payments ledger. Call +1 555 000 9999 any time.",
          experience: [
            { title: "Engineer", companyName: "Fictional Pay", startMonth: "2020-13", endMonth: null, skills: [] },
            { title: "Engineer", companyName: "Fictional Bank", startMonth: "2018-02", endMonth: "2017-01", skills: ["Go", "go"] },
          ],
          projects: [{ name: "Ledger", url: "javascript:alert(1)", repoUrl: "//evil.example.com/x" }],
          skills: [{ name: "Go" }, { name: " go " }],
          certifications: [{ name: "Cert", credentialUrl: "data:text/html,hi" }],
          links: [{ kind: "WEBSITE", url: "javascript:alert(document.cookie)" }, { kind: "GITHUB", url: "github.com/fictional-pay" }, { kind: "NOPE", url: "https://ok.example.com" }],
        },
        usage,
      }),
    };
    setAiProviderForTests(fake);
    const u = await createUser();
    const imp = await startImport(u, "I built a payments ledger at Fictional Bank and before that at Fictional Pay, for years.");
    expect(imp.status).toBe("READY");
    const p = imp.proposal!;
    expect(p.headline).toBe("Payments engineer, write to me at");
    expect(p.about).not.toMatch(/555/);
    expect(p.experience).toEqual([expect.objectContaining({ companyName: "Fictional Bank", startMonth: "2018-02", endMonth: null, skills: ["Go"] })]);
    expect(p.projects[0]).toMatchObject({ name: "Ledger", url: null, repoUrl: "https://evil.example.com/x" });
    expect(p.certifications[0]!.credentialUrl).toBeNull();
    expect(p.links).toEqual([expect.objectContaining({ kind: "GITHUB", url: "https://github.com/fictional-pay" }), expect.objectContaining({ kind: "WEBSITE", url: "https://ok.example.com/" })]);
    expect(p.skills.map((s) => s.name)).toEqual(["Go"]);
    expect(JSON.stringify(imp)).not.toContain("javascript:");
    expect(imp.proposedBadges.filter((b) => b.kind !== "SENIORITY").map((b) => b.slug)).toEqual(["fin-tech"]);
  });
});
