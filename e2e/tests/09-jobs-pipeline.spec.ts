import { expect, test } from "@playwright/test";
import { createJob, newRecruiter, newUser, pageFor, publishProfile } from "../helpers";

test("Easy Apply with a screening question; the recruiter moves the card and the candidate sees it live", async ({ browser, request }) => {
  const recruiter = await newRecruiter(request);
  const job = await createJob(request, recruiter, { questions: [{ prompt: "Have you run Kubernetes in production?", kind: "YES_NO", required: true }] });
  const candidate = await newUser(request, { displayName: "Avery Applicant" });
  await publishProfile(request, candidate);

  const c = await pageFor(browser, candidate, `/jobs?job=${job.id}`);
  await test.step("the candidate applies through Easy Apply", async () => {
    await c.getByTestId("job-easy-apply").click();
    const dialog = c.getByTestId("easy-apply-dialog");
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 6 && !(await dialog.getByTestId("apply-submit").isVisible()); i++) {
      const q = dialog.getByTestId("apply-question");
      if (await q.first().isVisible().catch(() => false)) await q.first().getByRole("radio", { name: "Yes" }).click();
      await dialog.getByTestId("apply-next").click();
    }
    await dialog.getByTestId("apply-submit").click();
    await expect(dialog.getByTestId("apply-success")).toBeVisible();
  });

  await c.goto("/jobs/applications");
  const myCard = c.getByTestId("application-card").filter({ hasText: job.title });
  await expect(myCard.getByTestId("stage-badge")).toContainText(/Applied/i);

  const r = await pageFor(browser, recruiter, `/recruiter/jobs/${job.id}`);
  await test.step("the recruiter sees the card in Applied and moves it to Screening", async () => {
    const card = r.getByTestId("pipeline-column-applied").getByTestId("pipeline-card").filter({ hasText: "Avery Applicant" });
    await expect(card).toBeVisible();
    await card.getByTestId("pipeline-card-menu").click();
    await r.getByTestId("move-to-screening").click();
    await expect(r.getByTestId("pipeline-column-screening").getByTestId("pipeline-card").filter({ hasText: "Avery Applicant" })).toBeVisible();
  });

  await test.step("the candidate's page updates without a reload", async () => {
    await expect(myCard.getByTestId("stage-badge")).toContainText(/Screening/i);
  });

  await c.context().close();
  await r.context().close();
});
