import { expect, test } from "@playwright/test";
import { as, connect, newUser, pageFor, publishProfile, uniq } from "../helpers";

test("the owner edits the headline and adds a role on the page itself, then publishes", async ({ browser, request }) => {
  const owner = await newUser(request, { displayName: "Ola Owner" });
  // A private contact channel and an About are part of the publish gate; set them up front.
  await as(request, owner, "PATCH", "/profiles/me", { about: "I like turning messy data into clear decisions." });
  await as(request, owner, "PUT", "/profiles/me/contact", { email: `ola.${uniq("c")}@example.com`, phone: null, whatsapp: null });
  const headline = `Analytics engineer ${uniq("h").slice(-5)}`;

  const page = await pageFor(browser, owner, `/in/${owner.username}`);
  await test.step("a draft page shows the owner strip with what is missing", async () => {
    await expect(page.getByTestId("owner-strip")).toBeVisible();
    await expect(page.getByTestId("profile-status")).toContainText(/draft/i);
  });

  await test.step("edit the headline in the basics editor", async () => {
    await page.getByTestId("edit-profile").click();
    const editor = page.getByTestId("basics-editor");
    await editor.getByTestId("basics-headline").fill(headline);
    await editor.getByTestId("basics-save").click();
    await expect(editor).toBeHidden();
    await expect(page.getByTestId("profile-header")).toContainText(headline);
  });

  await test.step("add a current role in the experience editor", async () => {
    await page.getByTestId("add-first-experience").click();
    const editor = page.getByTestId("section-editor-experience");
    const item = editor.getByTestId("editor-item").last();
    await item.getByLabel("Title").fill("Analytics Engineer");
    await item.getByLabel("Company").fill("Fictional Data Co");
    await item.getByLabel("Start").fill("2021-06");
    await editor.getByTestId("editor-save").click();
    await expect(editor).toBeHidden();
    await expect(page.getByText("Fictional Data Co").first()).toBeVisible();
  });

  await test.step("publish", async () => {
    await page.getByTestId("publish-profile").click();
    await expect(page.getByTestId("profile-status")).toContainText(/published/i);
    const mine = await as<{ status: string }>(request, owner, "GET", "/profiles/me");
    expect(mine.status).toBe("PUBLISHED");
  });

  await page.context().close();
});

test("a section limited to connections is a placeholder for strangers and visible to connections", async ({ browser, request }) => {
  const owner = await newUser(request, { displayName: "Pim Private" });
  await publishProfile(request, owner);
  await as(request, owner, "PUT", "/profiles/me/visibility", { experience: "CONNECTIONS" });
  const stranger = await newUser(request);
  const friend = await newUser(request);
  await connect(request, owner, friend);

  const s = await pageFor(browser, stranger, `/in/${owner.username}`);
  await expect(s.getByTestId("profile-header")).toBeVisible();
  await expect(s.getByTestId("hidden-section-experience")).toBeVisible();
  await expect(s.getByText("Fictional Systems").first()).toHaveCount(0);

  const f = await pageFor(browser, friend, `/in/${owner.username}`);
  await expect(f.getByText("Built the billing pipeline.")).toBeVisible();
  await expect(f.getByTestId("hidden-section-experience")).toHaveCount(0);

  await s.context().close();
  await f.context().close();
});
