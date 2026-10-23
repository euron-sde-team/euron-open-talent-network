import { expect, test } from "@playwright/test";
import { as, newRecruiter, newUser, pageFor, publishProfile, uniq } from "../helpers";

test("an engagement both sides confirm and complete, then double-blind ratings appear on the profile once both have rated", async ({ browser, request }) => {
  const recruiter = await newRecruiter(request);
  const candidate = await newUser(request, { displayName: "Rina Rated" });
  await publishProfile(request, candidate);

  // Setup through the API: an accepted approach, then an engagement both sides confirm and complete.
  const approach = await as<{ id: string }>(request, recruiter, "POST", "/approaches", { username: candidate.username, roleTitle: "Contract Data Engineer", message: "A three month contract on our data platform. Interested in hearing more?" }, 201);
  await as(request, candidate, "POST", `/approaches/${approach.id}/accept`, { channels: ["EMAIL"] });
  const title = `Data platform contract ${uniq("e").slice(-5)}`;
  const e = await as<{ id: string }>(request, recruiter, "POST", "/trust/engagements", { approachId: approach.id, title }, 201);
  await as(request, recruiter, "POST", `/trust/engagements/${e.id}/confirm`, {});
  await as(request, candidate, "POST", `/trust/engagements/${e.id}/confirm`, {});
  await as(request, recruiter, "POST", `/trust/engagements/${e.id}/complete`, {});
  await as(request, candidate, "POST", `/trust/engagements/${e.id}/complete`, {});

  const c = await pageFor(browser, candidate, "/dashboard?tab=engagements");
  await test.step("the candidate rates the engagement in the dashboard", async () => {
    const row = c.getByTestId("engagement-row").filter({ hasText: title });
    await row.getByTestId("engagement-rate").click();
    const dialog = c.getByTestId("rate-dialog");
    await dialog.getByTestId("rate-overall").getByRole("radio", { name: "5 stars" }).click();
    await dialog.getByTestId("rate-comment").fill("Clear brief, fast feedback, paid on time.");
    await dialog.getByTestId("rate-submit").click();
    await expect(dialog).toBeHidden();
  });

  await test.step("while only one side has rated, nothing is revealed", async () => {
    const recruiterRatings = await as<unknown[]>(request, candidate, "GET", `/profiles/${recruiter.username}/ratings`);
    expect(recruiterRatings).toHaveLength(0);
  });

  await test.step("the recruiter rates too, and both ratings are revealed", async () => {
    const r = await as<{ revealed: boolean }>(request, recruiter, "POST", `/trust/engagements/${e.id}/rating`, { score: 4, comment: "Solid work, good communication." });
    expect(r.revealed).toBe(true);
    await c.goto(`/in/${candidate.username}`);
    await expect(c.getByTestId("rating-item").filter({ hasText: "Solid work" })).toBeVisible();
  });

  await c.context().close();
});
