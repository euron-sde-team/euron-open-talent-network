/**
 * Generic HTTP hardening: the error envelope, body parsing, headers, CORS, request ids,
 * authentication failures, validation of ids, limits and cursors, LIKE escaping, URL
 * safety on profile links, display-name cleaning and rate limiting. The per-route
 * authorization rules are in authorization.int.test.ts.
 */
import { afterEach, describe, expect, test } from "vitest";
import request from "supertest";
import { db } from "../../src/db/kysely";
import { anon, app, as, createUser } from "./harness";
import { makeProfile, uniq } from "./talent-fixtures";

const ORIGIN = process.env.CORS_ORIGINS?.split(",")[0] ?? "http://localhost:3520";

describe("the error envelope", () => {
  test("unknown routes answer 404 JSON with a request id", async () => {
    const res = await anon().get("/api/no-such-route").expect(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toMatchObject({ code: "NOT_FOUND", error: expect.any(String), requestId: expect.any(String) });
  });

  test("malformed JSON is a 400, never a 500", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{not json").expect(400);
    expect(res.body.code).toBe("BAD_REQUEST");
  });

  test("a body over 1 MB is a 413 PAYLOAD_TOO_LARGE", async () => {
    const u = await createUser();
    const res = await as(u)
      .patch("/api/profiles/me")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ about: "x".repeat(1_100_000) }))
      .expect(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("validation failures name the fields; unknown fields are refused by strict schemas", async () => {
    const u = await createUser();
    const res = await as(u).patch("/api/profiles/me").send({ headline: "x".repeat(200), surprise: true }).expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    const paths = res.body.details.fields.map((f: { path: string }) => f.path);
    expect(paths.join(" ")).toMatch(/headline|surprise|body/);
  });

  test("the request id is echoed when well formed and replaced when not", async () => {
    const good = await anon().get("/up").set("X-Request-Id", "trace-abc12345").expect(200);
    expect(good.headers["x-request-id"]).toBe("trace-abc12345");
    const bad = await anon().get("/up").set("X-Request-Id", "bad id\twith spaces").expect(200);
    expect(bad.headers["x-request-id"]).not.toBe("bad id\twith spaces");
    expect(bad.headers["x-request-id"]).toMatch(/^[0-9A-Z]{26}$/);
  });

  test("health and readiness answer", async () => {
    expect((await anon().get("/up").expect(200)).body).toEqual({ ok: true });
    expect((await anon().get("/api/ready").expect(200)).body).toEqual({ ok: true });
  });
});

describe("headers and CORS", () => {
  test("security headers are set and the framework is not advertised", async () => {
    const res = await anon().get("/api/meta").expect(200);
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toMatch(/default-src 'none'/);
    expect(res.headers["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
  });

  test("a write from a foreign origin is refused; the app's origin is allowed", async () => {
    const refused = await request(app).post("/api/auth/logout").set("Origin", "https://attacker.example.com").expect(403);
    expect(refused.body.code).toBe("CORS_ORIGIN_DENIED");
    const allowed = await request(app).post("/api/auth/logout").set("Origin", ORIGIN);
    expect(allowed.status).not.toBe(403);
    expect(allowed.headers["access-control-allow-origin"]).toBe(ORIGIN);
    const preflight = await request(app).options("/api/posts").set("Origin", "https://attacker.example.com").set("Access-Control-Request-Method", "POST");
    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("the contact reveal is never cached", async () => {
    // Even the refusal carries no cache headers that would let a proxy keep a reveal.
    const u = await createUser();
    const res = await as(u).get("/api/approaches/01ARZ3NDEKTSV4RRFFQ69G5FAV/contact");
    expect(res.status).toBe(403);
    expect(res.headers["cache-control"] ?? "").not.toMatch(/public/);
  });
});

describe("authentication failures", () => {
  test("missing, garbage and stale tokens", async () => {
    expect((await anon().get("/api/users/me").expect(401)).body.code).toBe("UNAUTHENTICATED");
    expect((await request(app).get("/api/users/me").set("Authorization", "Bearer ").expect(401)).body.code).toBe("UNAUTHENTICATED");
    expect((await request(app).get("/api/users/me").set("Authorization", "Bearer not.a.token").expect(401)).body.code).toBe("TOKEN_INVALID");
    expect((await request(app).get("/api/users/me").set("Authorization", "Basic dXNlcjpwYXNz").expect(401)).body.code).toBe("UNAUTHENTICATED");
    const u = await createUser();
    await db
      .updateTable("users")
      .set((eb) => ({ token_version: eb("token_version", "+", 1) }))
      .where("id", "=", u.id)
      .execute();
    expect((await as(u).get("/api/users/me").expect(401)).body.code).toBe("TOKEN_INVALID");
  });

  test("a bad token on a public route is ignored, not rejected", async () => {
    const t = await makeProfile();
    await request(app).get(`/api/profiles/${t.username}`).set("Authorization", "Bearer garbage").expect(200);
  });

  test("a deactivated account cannot use its token", async () => {
    const u = await createUser();
    await db.updateTable("users").set({ status: "DEACTIVATED" }).where("id", "=", u.id).execute();
    expect((await as(u).get("/api/users/me").expect(403)).body.code).toBe("ACCOUNT_DEACTIVATED");
  });
});

describe("ids, limits and cursors", () => {
  test("malformed ids are a 400 VALIDATION_FAILED, never a database error", async () => {
    const u = await createUser();
    for (const url of ["/api/jobs/not-an-id", "/api/posts/123", "/api/approaches/x/contact", "/api/applications/%27%20OR%201%3D1", "/api/dms/threads/abc"]) {
      const res = await as(u).get(url);
      expect(res.status, url).toBe(400);
      expect(res.body.code, url).toBe("VALIDATION_FAILED");
    }
  });

  test("a well formed id that does not exist is a 404", async () => {
    const u = await createUser();
    expect((await as(u).get("/api/jobs/01ARZ3NDEKTSV4RRFFQ69G5FAV")).status).toBe(404);
    expect((await as(u).get("/api/posts/01ARZ3NDEKTSV4RRFFQ69G5FAV")).status).toBe(404);
  });

  test("usernames outside the pattern are a plain 404 (no lookup)", async () => {
    for (const name of ["x", "bad_name!", "a'or'1'='1", "-leading", "trailing-"]) {
      expect((await anon().get(`/api/profiles/${encodeURIComponent(name)}`)).status, name).toBe(404);
    }
  });

  test("page limits are bounded", async () => {
    const u = await createUser();
    for (const limit of ["0", "51", "1000", "-1", "abc"]) {
      expect((await as(u).get(`/api/notifications?limit=${limit}`)).status, limit).toBe(400);
    }
    await as(u).get("/api/notifications?limit=50").expect(200);
  });

  test("tampered cursors are a 400 INVALID_CURSOR on every kind of list", async () => {
    const u = await createUser();
    const forged = [Buffer.from("not json").toString("base64url"), Buffer.from(JSON.stringify(["2026-01-01T00:00:00.000Z", "'; DROP TABLE users; --"])).toString("base64url"), Buffer.from(JSON.stringify([{}, 1])).toString("base64url"), "%%%"];
    for (const url of ["/api/search/people", "/api/jobs", "/api/companies", "/api/posts/feed", "/api/network/connections", "/api/approaches/received", "/api/applications/mine"]) {
      for (const c of forged) {
        const res = await as(u).get(`${url}?cursor=${encodeURIComponent(c)}`);
        expect(res.status, `${url} ${c}`).toBe(400);
        expect(["INVALID_CURSOR", "VALIDATION_FAILED"], `${url} ${c}`).toContain(res.body.code);
      }
    }
  });

  test("a real cursor round-trips", async () => {
    const marker = uniq("page");
    for (let i = 0; i < 3; i++) await makeProfile({ headline: `Pager ${marker}` });
    const first = (await anon().get(`/api/search/people?q=${marker}&limit=2`).expect(200)).body;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await anon().get(`/api/search/people?q=${marker}&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`).expect(200)).body;
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((c: { user: { id: string } }) => c.user.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("user text never becomes query syntax", () => {
  test("LIKE wildcards and tsquery operators are matched literally", async () => {
    await makeProfile({ headline: `Wildcard check ${uniq("w")}` });
    for (const q of ["%", "_", "%%", "\\", "a & b | !c", "':*", "(("]) {
      const res = await anon().get(`/api/search/people?q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
      for (const card of res.body.items as { user: { displayName: string; username: string }; headline: string | null; location: string | null }[]) {
        const hay = `${card.user.displayName} ${card.user.username} ${card.headline ?? ""} ${card.location ?? ""}`;
        // Whatever matched must contain the literal text or a word of it: never "everything".
        if (q === "%" || q === "_" || q === "%%" || q === "\\") expect(hay, q).toContain(q);
      }
      expect((await anon().get(`/api/jobs?q=${encodeURIComponent(q)}`)).status, q).toBe(200);
      expect((await anon().get(`/api/search?q=${encodeURIComponent(q)}`)).status, q).toBe(200);
    }
  });
});

describe("profile URLs and names are sanitised at write time", () => {
  test("dangerous links are refused; bare and protocol-relative addresses become https", async () => {
    const u = await createUser();
    for (const url of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "https://user:pass@example.com", "https://localhost", "ftp://example.com/x"]) {
      const res = await as(u).put("/api/profiles/me/sections/links").send({ items: [{ kind: "WEBSITE", url }] });
      expect(res.status, url).toBe(400);
      expect(res.body.code, url).toBe("URL_INVALID");
    }
    const ok = await as(u).put("/api/profiles/me/sections/projects").send({ items: [{ name: "Site", url: "portfolio.example.com/work" }] }).expect(200);
    expect(ok.body.projects[0].url).toBe("https://portfolio.example.com/work");
    const rel = await as(u).put("/api/profiles/me/sections/links").send({ items: [{ kind: "WEBSITE", url: "//site.example.com/x" }] }).expect(200);
    expect(rel.body.links[0].url).toBe("https://site.example.com/x");
  });

  test("display names lose email addresses and phone numbers; a name with nothing left is refused", async () => {
    const u = await createUser();
    const res = await as(u).patch("/api/users/me").send({ displayName: "Avery Stone avery@example.com +1 555 010 9999" }).expect(200);
    expect(res.body.displayName).toBe("Avery Stone");
    expect((await as(u).patch("/api/users/me").send({ displayName: "avery@example.com" }).expect(400)).body.code).toBe("DISPLAY_NAME_INVALID");
  });

  test("contact phone numbers must be international format", async () => {
    const u = await createUser();
    for (const phone of ["5550100", "+0123456789", "+1 555 0100", "tel:+15550100"]) {
      expect((await as(u).put("/api/profiles/me/contact").send({ email: null, phone, whatsapp: null })).status, phone).toBe(400);
    }
    await as(u).put("/api/profiles/me/contact").send({ email: null, phone: "+15550100123", whatsapp: null }).expect(200);
  });
});

describe("rate limits", () => {
  afterEach(() => {
    delete process.env.RATE_LIMITS;
    delete process.env.RATE_LIMIT_STORE;
  });

  test("an IP-keyed limit answers 429 with Retry-After once spent", async () => {
    process.env.RATE_LIMITS = "on";
    process.env.RATE_LIMIT_STORE = "memory";
    const ip = "198.51.100.77";
    let last = 0;
    let retryAfter: string | undefined;
    for (let i = 0; i < 61; i++) {
      const res = await request(app).get(`/api/profiles/username-check?u=${uniq("free")}`).set("X-Forwarded-For", ip);
      last = res.status;
      retryAfter = res.headers["retry-after"];
    }
    expect(last).toBe(429);
    expect(Number(retryAfter)).toBeGreaterThan(0);
    // Another IP still has its own budget.
    await request(app).get(`/api/profiles/username-check?u=${uniq("free")}`).set("X-Forwarded-For", "198.51.100.78").expect(200);
  });
});
