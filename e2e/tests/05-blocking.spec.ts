import { expect, test } from "@playwright/test";
import { API, as, connect, newUser, pageFor, publishProfile } from "../helpers";

test("blocking cuts the connection, hides the profile (404) and ends messaging", async ({ browser, request }) => {
  const alice = await newUser(request, { displayName: "Bea Blocker" });
  const bob = await newUser(request, { displayName: "Bo Blocked" });
  await publishProfile(request, alice);
  await publishProfile(request, bob);
  await connect(request, alice, bob);
  expect((await as<{ canMessage: boolean }>(request, bob, "GET", `/dms/eligibility/${alice.id}`)).canMessage).toBe(true);

  const a = await pageFor(browser, alice, `/in/${bob.username}`);
  await test.step("Bea blocks Bo from his profile", async () => {
    await a.getByTestId("profile-menu").click();
    await a.getByTestId("block-user").click();
    await a.getByTestId("confirm-action").click();
    await expect(a.getByText("Blocked Bo Blocked")).toBeVisible();
  });

  await test.step("Bo gets a 404 for Bea's page, and nothing confirms it exists", async () => {
    const b = await pageFor(browser, bob, `/in/${alice.username}`);
    await expect(b.getByText(/not available/i).first()).toBeVisible();
    await expect(b.getByTestId("profile-header")).toHaveCount(0);
    const r = await request.get(`${API}/profiles/${alice.username}`, { headers: { Authorization: `Bearer ${bob.accessToken}`, "X-Forwarded-For": bob.ip } });
    expect(r.status()).toBe(404);
    await b.context().close();
  });

  await test.step("the connection is gone and Bo can not message Bea", async () => {
    const conns = await as<{ items: { user: { id: string } }[] }>(request, bob, "GET", "/network/connections");
    expect(conns.items.map((c) => c.user.id)).not.toContain(alice.id);
    const elig = await as<{ canMessage: boolean; canRequest: boolean; reason: string }>(request, bob, "GET", `/dms/eligibility/${alice.id}`);
    expect(elig).toMatchObject({ canMessage: false, canRequest: false, reason: "BLOCKED" });
    const r = await request.post(`${API}/dms/threads`, { headers: { Authorization: `Bearer ${bob.accessToken}`, "X-Forwarded-For": bob.ip }, data: { userId: alice.id } });
    expect([403, 404]).toContain(r.status());
  });

  await a.context().close();
});
