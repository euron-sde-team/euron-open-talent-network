import { expect, test } from "@playwright/test";
import { as, newUser, pageFor } from "../helpers";

// The local stack runs AI_PROVIDER=stub: the extraction is deterministic, no key needed.
test("import a profile from pasted resume text, review it and apply the sections", async ({ browser, request }) => {
  const user = await newUser(request, { displayName: "Ivo Import" });
  const resume = [
    "Ivo Import, Senior Data Engineer in Harbour City.",
    "Experience: Senior Data Engineer at Fictional Streams since 2021, building streaming pipelines with Kafka and Python.",
    "Before that, Data Engineer at Example Analytics from 2018 to 2021.",
    "Skills: Python, Kafka, SQL, Airflow, dbt.",
    "Education: BSc Computer Science, Example University, 2018.",
    "Portfolio: https://github.example.com/ivo-import",
  ].join("\n");

  const page = await pageFor(browser, user, "/profile/setup");
  await test.step("paste the resume and start", async () => {
    await page.getByTestId("import-text").fill(resume);
    await page.getByTestId("import-start").click();
  });

  await test.step("progress ends in a review with proposed sections", async () => {
    await expect(page.getByTestId("import-review")).toBeVisible({ timeout: 45_000 });
  });

  await test.step("apply the proposal and the page has the skills", async () => {
    await page.getByTestId("import-apply").click();
    await expect.poll(async () => (await as<{ skills: { name: string }[] }>(request, user, "GET", "/profiles/me")).skills.map((s) => s.name.toLowerCase()), { timeout: 20_000 }).toContain("python");
  });

  await page.context().close();
});
