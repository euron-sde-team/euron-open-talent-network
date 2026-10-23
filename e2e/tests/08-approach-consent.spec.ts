import { expect, test } from "@playwright/test";
import { API, as, newRecruiter, newUser, pageFor, publishProfile, uniq } from "../helpers";

test("approach, accept with chosen channels, a logged reveal the candidate can see, then revoke", async ({ browser, request }) => {
  const candidate = await newUser(request, { displayName: "Cass Candidate" });
  const privateEmail = `cass.${uniq("p")}@example.com`;
  await publishProfile(request, candidate, { email: privateEmail });
  const recruiter = await newRecruiter(request);

  await test.step("contact details are in no public payload", async () => {
    const res = await request.get(`${API}/profiles/${candidate.username}`, { headers: { Authorization: `Bearer ${recruiter.accessToken}`, "X-Forwarded-For": recruiter.ip } });
    expect(await res.text()).not.toContain(privateEmail);
  });

  const r = await pageFor(browser, recruiter, `/in/${candidate.username}`);
  const role = `Staff Engineer ${uniq("r").slice(-5)}`;
  await test.step("the recruiter approaches from the profile", async () => {
    await r.getByTestId("approach-button").click();
    const dialog = r.getByTestId("approach-dialog");
    await dialog.getByTestId("approach-role").fill(role);
    await dialog.getByTestId("approach-message").fill("We are building a calm platform team and your queue work stood out. Open to a chat?");
    await dialog.getByTestId("approach-send").click();
    await expect(dialog).toBeHidden();
  });

  const c = await pageFor(browser, candidate, "/dashboard?tab=approaches");
  await test.step("the candidate accepts and shares only email", async () => {
    const card = c.getByTestId("approach-card").filter({ hasText: role });
    await expect(card).toBeVisible();
    await card.getByTestId("approach-accept").click();
    const dialog = c.getByTestId("approach-accept-dialog");
    await dialog.getByTestId("accept-channel-email").check();
    await dialog.getByTestId("approach-accept-confirm").click();
    await expect(dialog).toBeHidden();
  });

  await test.step("the recruiter reveals the email, and only the email", async () => {
    await r.goto("/recruiter/approaches");
    await r.getByTestId("approaches-tab-accepted").click();
    const row = r.getByTestId("approach-row").filter({ hasText: role });
    await row.getByTestId("approach-view-contact").click();
    const dialog = r.getByTestId("contact-dialog");
    await dialog.getByTestId("contact-reveal").click();
    await expect(dialog.getByTestId("contact-details")).toContainText(privateEmail);
  });

  await test.step("the candidate sees the reveal in their contact log", async () => {
    await c.goto("/dashboard?tab=contact-log");
    await expect(c.getByText(recruiter.displayName).first()).toBeVisible();
  });

  await test.step("the candidate revokes access and the next reveal fails", async () => {
    await c.goto("/dashboard?tab=approaches");
    await c.getByRole("tab", { name: "Accepted" }).click();
    const card = c.getByTestId("approach-card").filter({ hasText: role });
    await card.getByTestId("approach-revoke").click();
    const confirm = c.getByTestId("confirm-action");
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    const approaches = await as<{ items: { id: string; roleTitle: string }[] }>(request, recruiter, "GET", "/approaches/sent");
    const id = approaches.items.find((a) => a.roleTitle === role)!.id;
    await expect.poll(async () => (await request.get(`${API}/approaches/${id}/contact`, { headers: { Authorization: `Bearer ${recruiter.accessToken}`, "X-Forwarded-For": recruiter.ip } })).status()).not.toBe(200);
  });

  await r.context().close();
  await c.context().close();
});
