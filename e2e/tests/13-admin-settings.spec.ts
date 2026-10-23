import { expect, test } from "@playwright/test";
import { apiLogin, as, DEMO, newContext, pageFor, type TestUser } from "../helpers";

let admin: TestUser;

test.beforeAll(async ({ request }) => {
  admin = await apiLogin(request, DEMO.admin);
});

// Always leave sign-ups open for the other specs, however this one ends.
test.afterAll(async ({ request }) => {
  await as(request, admin, "PATCH", "/admin/settings", { registration: "OPEN" });
});

test("an admin closes sign-ups in the control plane and the sign-up page says so; RBAC keeps others out", async ({ browser, request }) => {
  const a = await pageFor(browser, admin, "/admin?area=settings");
  await test.step("close registration and save", async () => {
    await a.getByTestId("setting-registration").click();
    await a.getByRole("option", { name: "Closed" }).click();
    const saved = a.waitForResponse((r) => r.url().endsWith("/api/admin/settings") && r.request().method() === "PATCH");
    await a.getByTestId("admin-settings-save").click();
    expect((await saved).status()).toBe(200);
  });

  await test.step("a visitor sees that sign-ups are closed", async () => {
    const ctx = await newContext(browser);
    const v = await ctx.newPage();
    await v.goto("/signup");
    await expect(v.getByText("Sign-ups are closed on this network right now.")).toBeVisible();
    await ctx.close();
  });

  await test.step("a moderator only sees the areas their role allows", async () => {
    const mod = await apiLogin(request, DEMO.moderator);
    const m = await pageFor(browser, mod, "/admin?area=settings");
    await expect(m.getByTestId("admin-forbidden")).toBeVisible();
    const me = await as<{ areas: Record<string, boolean> | string[] }>(request, mod, "GET", "/admin/me");
    expect(JSON.stringify(me.areas)).not.toContain("settings\":true");
    await m.context().close();
  });

  await a.context().close();
});
